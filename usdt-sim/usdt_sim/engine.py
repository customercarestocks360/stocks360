"""The matching engine: orders, positions, and P/L.

The model is spot, long-only. Buying opens or adds to a position, selling reduces or
closes it, and there is no borrowing -- a sell with nothing behind it is rejected rather
than silently opening a short. Shorts need a margin system (collateral, maintenance
margin, liquidation), and pretending otherwise would make every P/L number here a lie.

Cost basis carries the entry fee, so `avg_entry_price` is the real break-even and
unrealized P/L is already net of what it cost to get in. Market orders pay taker fees
and slippage; a limit order that rests and gets hit pays the maker fee and no slippage,
which is the entire trade-off between the two order types.
"""

from __future__ import annotations

from collections.abc import Callable
from datetime import datetime
from decimal import Decimal

from .config import MAKER_FEE_BPS, TAKER_FEE_BPS
from .ledger import Ledger
from .models import (
    Fill,
    Liquidity,
    NotFound,
    Order,
    OrderRejected,
    OrderStatus,
    OrderType,
    Portfolio,
    Position,
    PositionSummary,
    Side,
)
from .money import ZERO, fee_of, qty, to_step, to_tick, usdt
from .prices import PriceFeed
from .wallet import Wallet

_HUNDRED = Decimal(100)


class Engine:
    def __init__(
        self,
        wallet: Wallet,
        feed: PriceFeed,
        ledger: Ledger,
        clock: Callable[[], datetime],
    ):
        self._wallet = wallet
        self._feed = feed
        self._ledger = ledger
        self._clock = clock
        self.orders: dict[str, Order] = {}
        self.trades: list[Fill] = []
        self.positions: dict[str, Position] = {}
        self.realized_pnl_usdt = ZERO
        self.fees_paid_usdt = ZERO
        self._order_seq = 0
        self._fill_seq = 0

    # --- placing ------------------------------------------------------------
    def place(
        self,
        symbol: str,
        side: Side,
        quantity: Decimal | None = None,
        order_type: OrderType = OrderType.MARKET,
        limit_price: Decimal | None = None,
        quote_amount: Decimal | None = None,
        reduce_only: bool = False,
    ) -> Order:
        """Place an order. Market orders fill now; limit orders fill now or rest.

        `quote_amount` sizes a buy in USDT instead of base units ("buy 500 USDT of
        BTC"); fees are charged on top of it, the same as `quoteOrderQty` on a real venue.
        """
        market = self._feed.market(symbol)
        self._order_seq += 1
        order = Order(
            id=f"ord_{self._order_seq:05d}",
            symbol=market.symbol,
            side=Side(side),
            type=OrderType(order_type),
            quantity=ZERO,
            limit_price=None,
            status=OrderStatus.OPEN,
            reduce_only=reduce_only,
            created_at=self._clock(),
            updated_at=self._clock(),
        )
        self.orders[order.id] = order

        try:
            if order.type is OrderType.LIMIT:
                if limit_price is None or Decimal(limit_price) <= 0:
                    raise OrderRejected("a limit order needs a positive limit_price")
                order.limit_price = to_tick(Decimal(limit_price), market.tick_size)

            reference = order.limit_price or self._feed.ask(market.symbol)
            order.quantity = self._resolve_quantity(market, quantity, quote_amount, reference)
            if order.side is Side.SELL:
                self._require_inventory(market.symbol, order.quantity)

            if order.type is OrderType.MARKET:
                fill_price = self._feed.fill_price(market.symbol, order.side, order.quantity)
                self._fill_taker(order, *fill_price)
            else:
                self._place_limit(order)
        except Exception as error:
            order.status = OrderStatus.REJECTED
            order.reject_reason = str(error)
            order.updated_at = self._clock()
            self._ledger.record(
                "order.rejected",
                order_id=order.id,
                symbol=order.symbol,
                side=order.side,
                type=order.type,
                reason=order.reject_reason,
            )
            raise
        return order

    def _resolve_quantity(self, market, quantity, quote_amount, reference: Decimal) -> Decimal:
        if quantity is None and quote_amount is None:
            raise OrderRejected("either quantity or quote_amount is required")
        if quantity is not None and quote_amount is not None:
            raise OrderRejected("pass quantity or quote_amount, not both")
        if quote_amount is not None:
            if Decimal(quote_amount) <= 0:
                raise OrderRejected("quote_amount must be positive")
            quantity = Decimal(quote_amount) / reference
        resolved = to_step(qty(quantity), market.step_size)
        if resolved <= 0:
            raise OrderRejected(f"quantity rounds to zero at a {market.step_size} lot size")
        if resolved < market.min_quantity:
            raise OrderRejected(
                f"{market.symbol} minimum order size is {market.min_quantity} {market.base}"
            )
        return resolved

    def _require_inventory(self, symbol: str, quantity: Decimal) -> None:
        position = self.positions.get(symbol)
        free = position.free_quantity if position else ZERO
        if quantity > free:
            raise OrderRejected(
                f"no short selling: {quantity} to sell but only {free} unlocked in {symbol}"
            )

    def _place_limit(self, order: Order) -> None:
        """Cross against the current book if it can, otherwise reserve and rest."""
        if order.side is Side.BUY and self._feed.ask(order.symbol) <= order.limit_price:
            self._fill_taker(order, self._feed.ask(order.symbol), ZERO)
            return
        if order.side is Side.SELL and self._feed.bid(order.symbol) >= order.limit_price:
            self._fill_taker(order, self._feed.bid(order.symbol), ZERO)
            return

        if order.side is Side.BUY:
            notional = usdt(order.quantity * order.limit_price)
            order.locked_usdt = self._wallet.lock(notional + fee_of(notional, MAKER_FEE_BPS))
        else:
            position = self.positions[order.symbol]
            position.locked_quantity = qty(position.locked_quantity + order.quantity)
            order.locked_quantity = order.quantity
        self._ledger.record(
            "order.placed",
            order_id=order.id,
            symbol=order.symbol,
            side=order.side,
            type=order.type,
            quantity=order.quantity,
            limit_price=order.limit_price,
            locked_usdt=order.locked_usdt,
            locked_quantity=order.locked_quantity,
        )

    # --- resting orders -----------------------------------------------------
    def match_open_orders(self) -> list[Order]:
        """Fill any resting order the market has moved through. Call after every tick."""
        filled = []
        for order in list(self.orders.values()):
            if order.status is not OrderStatus.OPEN or order.type is not OrderType.LIMIT:
                continue
            if order.side is Side.BUY and self._feed.ask(order.symbol) <= order.limit_price:
                self._fill_maker(order)
                filled.append(order)
            elif order.side is Side.SELL and self._feed.bid(order.symbol) >= order.limit_price:
                self._fill_maker(order)
                filled.append(order)
        return filled

    def cancel(self, order_id: str) -> Order:
        order = self.orders.get(order_id)
        if order is None:
            raise NotFound(f"no order with id {order_id}")
        if order.status is not OrderStatus.OPEN:
            raise OrderRejected(f"order {order_id} is {order.status.value}, not cancellable")
        self._release_reservation(order)
        order.status = OrderStatus.CANCELLED
        order.updated_at = self._clock()
        self._ledger.record("order.cancelled", order_id=order.id, symbol=order.symbol)
        return order

    def _release_reservation(self, order: Order) -> None:
        if order.locked_usdt > 0:
            self._wallet.unlock(order.locked_usdt)
            order.locked_usdt = ZERO
        if order.locked_quantity > 0:
            position = self.positions.get(order.symbol)
            if position is not None:
                position.locked_quantity = qty(position.locked_quantity - order.locked_quantity)
            order.locked_quantity = ZERO

    # --- fills --------------------------------------------------------------
    def _fill_maker(self, order: Order) -> None:
        self._settle_fill(order, order.limit_price, ZERO, MAKER_FEE_BPS, Liquidity.MAKER)

    def _fill_taker(self, order: Order, price: Decimal, slippage_bps: Decimal) -> None:
        self._settle_fill(order, price, slippage_bps, TAKER_FEE_BPS, Liquidity.TAKER)

    def _settle_fill(
        self,
        order: Order,
        price: Decimal,
        slippage_bps: Decimal,
        fee_bps: int,
        liquidity: Liquidity,
    ) -> None:
        notional = usdt(order.quantity * price)
        fee = fee_of(notional, fee_bps)

        if order.side is Side.BUY:
            if order.locked_usdt > 0:
                # A resting buy already reserved cash: settle from the reserve and hand
                # back whatever the reserve over-estimated.
                self._wallet.spend_locked(min(notional + fee, order.locked_usdt))
                self._wallet.unlock(max(ZERO, order.locked_usdt - (notional + fee)))
                order.locked_usdt = ZERO
            else:
                self._wallet.debit(notional + fee)
            realized = None
            self._open_or_add(order.symbol, order.quantity, notional, fee)
        else:
            if order.locked_quantity > 0:
                position = self.positions[order.symbol]
                position.locked_quantity = qty(position.locked_quantity - order.locked_quantity)
                order.locked_quantity = ZERO
            realized = self._reduce(order.symbol, order.quantity, notional, fee)
            self._wallet.credit(notional - fee)

        self.fees_paid_usdt = usdt(self.fees_paid_usdt + fee)
        self._fill_seq += 1
        fill = Fill(
            id=f"fil_{self._fill_seq:05d}",
            order_id=order.id,
            symbol=order.symbol,
            side=order.side,
            quantity=order.quantity,
            price=price,
            notional_usdt=notional,
            fee_usdt=fee,
            liquidity=liquidity,
            slippage_bps=slippage_bps,
            realized_pnl_usdt=realized,
            timestamp=self._clock(),
        )
        self.trades.append(fill)
        order.fills.append(fill)
        order.filled_quantity = order.quantity
        order.avg_fill_price = price
        order.fee_usdt = fee
        order.status = OrderStatus.FILLED
        order.updated_at = fill.timestamp
        self._ledger.record(
            "order.filled",
            order_id=order.id,
            fill_id=fill.id,
            symbol=order.symbol,
            side=order.side,
            quantity=order.quantity,
            price=price,
            notional_usdt=notional,
            fee_usdt=fee,
            liquidity=liquidity,
            slippage_bps=slippage_bps,
            realized_pnl_usdt=realized,
            available_balance_usdt=self._wallet.available_usdt,
        )

    # --- positions ----------------------------------------------------------
    def _open_or_add(self, symbol: str, quantity: Decimal, notional: Decimal, fee: Decimal) -> None:
        position = self.positions.get(symbol)
        if position is None:
            position = Position(
                symbol=symbol,
                base=self._feed.market(symbol).base,
                quantity=ZERO,
                cost_basis_usdt=ZERO,
                opened_at=self._clock(),
            )
            self.positions[symbol] = position
        elif position.quantity == 0:
            position.opened_at = self._clock()
        position.quantity = qty(position.quantity + quantity)
        position.cost_basis_usdt = usdt(position.cost_basis_usdt + notional + fee)
        position.fees_paid_usdt = usdt(position.fees_paid_usdt + fee)

    def _reduce(self, symbol: str, quantity: Decimal, notional: Decimal, fee: Decimal) -> Decimal:
        position = self.positions[symbol]
        # Proportional relief, and exact on a full close, so repeated partial exits
        # cannot leave a phantom cost basis behind on a zero position.
        if quantity >= position.quantity:
            cost_removed = position.cost_basis_usdt
        else:
            cost_removed = usdt(position.cost_basis_usdt * quantity / position.quantity)
        realized = usdt(notional - fee - cost_removed)
        position.quantity = qty(position.quantity - quantity)
        position.cost_basis_usdt = usdt(position.cost_basis_usdt - cost_removed)
        position.realized_pnl_usdt = usdt(position.realized_pnl_usdt + realized)
        position.fees_paid_usdt = usdt(position.fees_paid_usdt + fee)
        self.realized_pnl_usdt = usdt(self.realized_pnl_usdt + realized)
        return realized

    def close(
        self,
        symbol: str,
        order_type: OrderType = OrderType.MARKET,
        limit_price: Decimal | None = None,
        quantity: Decimal | None = None,
    ) -> Order:
        """Sell out of a position, all of it by default."""
        key = self._feed.market(symbol).symbol
        position = self.positions.get(key)
        if position is None or position.free_quantity <= 0:
            raise NotFound(f"no open unlocked position in {key}")
        return self.place(
            key,
            Side.SELL,
            quantity=quantity if quantity is not None else position.free_quantity,
            order_type=order_type,
            limit_price=limit_price,
            reduce_only=True,
        )

    # --- reporting ----------------------------------------------------------
    def summary(self, symbol: str) -> PositionSummary:
        position = self.positions[self._feed.market(symbol).symbol]
        # Marked at the bid: the price the position would actually be sold into.
        mark = self._feed.bid(position.symbol)
        market_value = usdt(position.quantity * mark)
        unrealized = usdt(market_value - position.cost_basis_usdt)
        basis = position.cost_basis_usdt
        return PositionSummary(
            symbol=position.symbol,
            base=position.base,
            quantity=position.quantity,
            locked_quantity=position.locked_quantity,
            avg_entry_price=position.avg_entry_price,
            mark_price=mark,
            cost_basis_usdt=basis,
            market_value_usdt=market_value,
            unrealized_pnl_usdt=unrealized,
            unrealized_pnl_pct=(
                (unrealized / basis * _HUNDRED).quantize(Decimal("0.01")) if basis else ZERO
            ),
            realized_pnl_usdt=position.realized_pnl_usdt,
            fees_paid_usdt=position.fees_paid_usdt,
        )

    def open_positions(self) -> list[PositionSummary]:
        return [self.summary(symbol) for symbol, p in self.positions.items() if p.quantity > 0]

    def portfolio(self) -> Portfolio:
        summaries = self.open_positions()
        positions_value = usdt(sum((s.market_value_usdt for s in summaries), ZERO))
        unrealized = usdt(sum((s.unrealized_pnl_usdt for s in summaries), ZERO))
        cash = self._wallet.total_usdt
        equity = usdt(cash + positions_value)
        # Measured against capital still in the account, so depositing or withdrawing
        # does not register as a profit or a loss.
        total_pnl = usdt(equity - self._wallet.net_deposited_usdt)
        deposited = self._wallet.total_deposited_usdt
        return Portfolio(
            usdt_usd_rate=self._feed.usdt_usd,
            cash_usdt=cash,
            positions_value_usdt=positions_value,
            equity_usdt=equity,
            equity_usd=self._feed.to_usd(equity),
            unrealized_pnl_usdt=unrealized,
            realized_pnl_usdt=self.realized_pnl_usdt,
            fees_paid_usdt=self.fees_paid_usdt,
            net_deposited_usdt=self._wallet.net_deposited_usdt,
            total_pnl_usdt=total_pnl,
            total_pnl_usd=self._feed.to_usd(total_pnl),
            total_pnl_pct=(
                (total_pnl / deposited * _HUNDRED).quantize(Decimal("0.01")) if deposited else ZERO
            ),
            positions=summaries,
        )
