"""`Exchange` -- the one object callers touch.

It owns the wallet, the price feed, the engine and the ledger, and it is the only place
that advances the clock. Every public method is a thing a user can actually do on an
exchange, and every failure lands in the audit trail before it is re-raised.

State is in memory. Restarting loses it, which is fine for a simulator; the note in the
README says what to swap in if you want it durable.
"""

from __future__ import annotations

from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from random import Random

from . import chain as chain_module
from .config import DEFAULT_CHAIN, TICK_SECONDS
from .engine import Engine
from .ledger import Ledger
from .models import (
    Balance,
    Deposit,
    Event,
    Fill,
    Order,
    OrderStatus,
    OrderType,
    Portfolio,
    PositionSummary,
    Side,
    SimError,
    Withdrawal,
)
from .prices import PriceFeed
from .wallet import Wallet


class Exchange:
    def __init__(self, seed: int | None = None, start_time: datetime | None = None):
        self._rng = Random(seed)
        self._now = start_time or datetime.now(timezone.utc)
        self.ledger = Ledger(self._clock)
        self.feed = PriceFeed(seed)
        self.wallet = Wallet(self.ledger, self._clock, self._rng)
        self.engine = Engine(self.wallet, self.feed, self.ledger, self._clock)
        self.ledger.record("exchange.started", seed=seed, markets=list(self.feed.markets))

    # --- clock --------------------------------------------------------------
    def _clock(self) -> datetime:
        return self._now

    def _bump(self, seconds: int = 1) -> None:
        """Simulated time. Each operation costs a second, each tick five minutes."""
        self._now += timedelta(seconds=seconds)

    @contextmanager
    def _audit_errors(self, action: str, **context):
        """Anything that fails gets a line in the trail before the caller sees it.

        Order failures are excluded on purpose: `Engine.place` already records an
        `order.rejected` event carrying the order id, which is strictly more useful
        than a generic error line saying the same thing.
        """
        try:
            yield
        except SimError as error:
            self.ledger.record(
                "error",
                action=action,
                error=type(error).__name__,
                message=str(error),
                **context,
            )
            raise

    # --- funding ------------------------------------------------------------
    def deposit_address(self, chain: str = DEFAULT_CHAIN, rotate: bool = False) -> str:
        self._bump()
        with self._audit_errors("deposit_address", chain=chain):
            return self.wallet.deposit_address(chain, rotate=rotate)

    def deposit_qr(self, chain: str = DEFAULT_CHAIN) -> dict:
        self._bump()
        with self._audit_errors("deposit_qr", chain=chain):
            return self.wallet.deposit_qr(chain)

    def qr_terminal(self, chain: str = DEFAULT_CHAIN) -> str:
        """The deposit QR as ANSI blocks -- scannable straight off a terminal."""
        return chain_module.qr_terminal(self.deposit_address(chain))

    def deposit(
        self, amount: Decimal, chain: str = DEFAULT_CHAIN, auto_confirm: bool = True
    ) -> Deposit:
        """Mock an inbound transfer. `auto_confirm` skips straight to credited."""
        self._bump()
        with self._audit_errors("deposit", chain=chain, amount_usdt=amount):
            confirmations = 10**6 if auto_confirm else 0
            return self.wallet.receive(amount, chain, confirmations=confirmations)

    def confirm_deposit(self, tx_hash: str, blocks: int = 1) -> Deposit:
        self._bump()
        with self._audit_errors("confirm_deposit", tx_hash=tx_hash):
            return self.wallet.confirm(tx_hash, blocks)

    def deposits(self) -> list[Deposit]:
        return list(self.wallet.deposits.values())

    def balance(self, chain: str = DEFAULT_CHAIN) -> Balance:
        return self.wallet.balance(chain)

    def withdraw(self, address: str, amount: Decimal, chain: str | None = None) -> Withdrawal:
        self._bump()
        with self._audit_errors("withdraw", address=address, amount_usdt=amount):
            return self.wallet.request_withdrawal(address, amount, chain)

    def process_withdrawals(
        self, withdrawal_id: str | None = None, until_settled: bool = False
    ) -> list[Withdrawal]:
        """Advance the withdrawal queue one stage, or all the way with `until_settled`."""
        self._bump()
        with self._audit_errors("process_withdrawals", withdrawal_id=withdrawal_id):
            touched = self.wallet.process_withdrawals(withdrawal_id)
            if until_settled:
                self.wallet.process_withdrawals(withdrawal_id)
            return touched

    def withdrawals(self) -> list[Withdrawal]:
        return list(self.wallet.withdrawals.values())

    # --- market data --------------------------------------------------------
    def markets(self) -> list[dict]:
        return [self.feed.quote(symbol) for symbol in self.feed.markets]

    def tick(self, steps: int = 1) -> list[Order]:
        """Advance the market and fill any resting order it moved through."""
        self._bump(TICK_SECONDS * max(0, steps))
        self.feed.tick(steps)
        return self.engine.match_open_orders()

    # --- trading ------------------------------------------------------------
    def place_order(
        self,
        symbol: str,
        side: Side | str,
        quantity: Decimal | None = None,
        order_type: OrderType | str = OrderType.MARKET,
        limit_price: Decimal | None = None,
        quote_amount: Decimal | None = None,
    ) -> Order:
        self._bump()
        return self.engine.place(
            symbol,
            Side(side),
            quantity=quantity,
            order_type=OrderType(order_type),
            limit_price=limit_price,
            quote_amount=quote_amount,
        )

    def cancel_order(self, order_id: str) -> Order:
        self._bump()
        with self._audit_errors("cancel_order", order_id=order_id):
            return self.engine.cancel(order_id)

    def orders(self, status: OrderStatus | str | None = None) -> list[Order]:
        orders = list(self.engine.orders.values())
        if status is None:
            return orders
        wanted = OrderStatus(status)
        return [order for order in orders if order.status is wanted]

    def close_position(
        self,
        symbol: str,
        order_type: OrderType | str = OrderType.MARKET,
        limit_price: Decimal | None = None,
        quantity: Decimal | None = None,
    ) -> Order:
        self._bump()
        with self._audit_errors("close_position", symbol=symbol):
            return self.engine.close(
                symbol, OrderType(order_type), limit_price=limit_price, quantity=quantity
            )

    def positions(self) -> list[PositionSummary]:
        return self.engine.open_positions()

    def trades(self) -> list[Fill]:
        return list(self.engine.trades)

    def portfolio(self) -> Portfolio:
        return self.engine.portfolio()

    # --- audit --------------------------------------------------------------
    def history(self, kind: str | None = None, limit: int | None = None) -> list[Event]:
        return self.ledger.history(kind, limit)
