"""Trading rules: who may trade, what an order has to satisfy, and how a fill settles.

This is a **simulated venue**. Orders execute against the same live market data the read
endpoints serve, and cash is book money this API creates on request. There is no broker,
no clearing member and no custody anywhere behind it. Everything here is built to be
correct as an accounting system, which is a different claim from being a real one.

The order of the checks in `place_order()` is deliberate and is the honest answer to
"proper conditionality":

1. **Is the venue open for business** — the feature flag.
2. **Is the caller allowed to trade at all** — onboarding submitted, KYC tier reached.
3. **Does the instrument exist, and can we hold what it settles in** — resolved against
   the live symbol universe, not a list in this repository.
4. **Is the specific product enabled for this caller** — crypto spot, forex, domestic or
   foreign equity, taken from the onboarding outcome. A product still under review is a
   separate answer from one never requested, because the user can do something about one
   of them.
5. **Is the order itself coherent against the market** — stop on the correct side, price
   inside the band, notional inside the bounds, and for anything that must fill now, a
   market that is open and a price that is fresh.
6. **Are the funds or the units actually there** — atomically, as part of locking them.

Each check is cheap and ordered before the expensive one after it, and no check is done
twice with a gap in between where the answer could change.
"""

import asyncio
import logging
from datetime import datetime, time, timezone
from decimal import Decimal

from fastapi import HTTPException, status
from pymongo.errors import DuplicateKeyError

from app.core.config import (
    TRADING_ENABLED,
    TRADING_MAX_DEPOSIT,
    TRADING_MAX_OPEN_ORDERS,
    TRADING_MAX_ORDER_NOTIONAL,
    TRADING_MAX_WITHDRAWAL,
    TRADING_MIN_ORDER_NOTIONAL,
    TRADING_PRICE_BAND_PERCENT,
)
from app.onboarding import repository as onboarding_repository
from app.schemas.onboarding import KycTier, OnboardingStatus, Product
from app.schemas.trading import (
    Account,
    AssetClass,
    AssetClassEligibility,
    Balance,
    Eligibility,
    FundsRequest,
    LedgerKind,
    MarketState,
    OrderRequest,
    OrderSide,
    OrderStatus,
    OrderType,
    Portfolio,
    Position,
    PositionValuation,
    TimeInForce,
)
from app.trading import pricing, repository
from app.trading.money import ZERO, fee_for, money, notional_of, percent_change
from app.trading.pricing import Mark
from app.users import repository as users_repository

logger = logging.getLogger(__name__)

# Settlement is serialised within the process. A fill touches a wallet, a position, an
# order and a trade, and the only way to keep those four consistent without a multi-
# document transaction is to make sure two fills are never in flight at once. Fills are
# short and rare compared to quote traffic, so the contention is negligible — and the
# atomic guards underneath remain in place regardless, because this lock does not span
# processes. See the readme on running a single worker.
_settlement = asyncio.Lock()

# Statuses that mean the account has finished onboarding. `under_review` is included on
# purpose: the products that need a human are already held back in `pending_products`, so
# waiting on the review does not need to block the products that were granted outright.
_TRADING_STATUSES = frozenset({OnboardingStatus.under_review, OnboardingStatus.approved})
_TRADING_TIERS = frozenset({KycTier.verified, KycTier.pro})


def _conflict(detail: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_409_CONFLICT, detail=detail)


def _forbidden(detail: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=detail)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def assert_enabled() -> None:
    if not TRADING_ENABLED:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Trading is disabled on this deployment",
        )


# --------------------------------------------------------------------------- #
# Who may trade
# --------------------------------------------------------------------------- #


def _profile(uid: str) -> dict:
    return users_repository.get_profile(uid) or {}


def _status_of(user: dict) -> OnboardingStatus:
    try:
        return OnboardingStatus(user.get("onboarding_status") or OnboardingStatus.not_started.value)
    except ValueError:
        return OnboardingStatus.not_started


def _tier_of(user: dict) -> KycTier:
    try:
        return KycTier(user.get("kyc_tier") or KycTier.unverified.value)
    except ValueError:
        return KycTier.unverified


def _products(user: dict, field: str) -> list[Product]:
    out: list[Product] = []
    for value in user.get(field) or []:
        try:
            out.append(Product(value))
        except ValueError:  # a product retired from the catalogue but still on a profile
            continue
    return out


def _trading_block(user: dict) -> str | None:
    """Why this account cannot trade at all, or None when it can."""
    onboarding = _status_of(user)
    if onboarding is OnboardingStatus.rejected:
        return "Your application was rejected — trading is not available on this account"
    if onboarding not in _TRADING_STATUSES:
        return (
            "Complete onboarding before trading — finish the ten steps and call "
            "POST /onboarding/submit"
        )
    if _tier_of(user) not in _TRADING_TIERS:
        return "Your KYC tier does not permit trading yet"
    return None


def assert_can_trade(user: dict) -> None:
    blocked = _trading_block(user)
    if blocked:
        raise _forbidden(blocked)


def assert_product_enabled(user: dict, product: Product) -> None:
    """The product gate, with the reason the caller can act on.

    A product sitting in `pending_products` was requested and is waiting on the income
    proof; one in neither list was never asked for during onboarding. Telling those apart
    is the difference between "wait" and "you need to do something".
    """
    if product in _products(user, "enabled_products"):
        return
    if product in _products(user, "pending_products"):
        raise _forbidden(
            f"{product.value} was requested during onboarding and is still under review"
        )
    raise _forbidden(
        f"{product.value} is not enabled on this account — it was not requested during onboarding"
    )


def base_currency(uid: str) -> str | None:
    profile = onboarding_repository.get_kyc_profile(uid) or {}
    return (profile.get("markets") or {}).get("base_currency")


def eligibility(uid: str) -> Eligibility:
    user = _profile(uid)
    blocked = _trading_block(user)
    enabled = _products(user, "enabled_products")
    pending = _products(user, "pending_products")

    classes: list[AssetClassEligibility] = []
    for asset_class in AssetClass:
        candidates = pricing.products_for_class(asset_class)
        granted = [p for p in candidates if p in enabled]
        waiting = [p for p in candidates if p in pending]
        if blocked:
            reason = blocked
        elif granted:
            reason = None
        elif waiting:
            reason = f"{', '.join(p.value for p in waiting)} is still under review"
        else:
            reason = (
                f"None of {', '.join(p.value for p in candidates)} were requested during onboarding"
            )
        classes.append(
            AssetClassEligibility(
                asset_class=asset_class,
                products=candidates,
                enabled=blocked is None and bool(granted),
                pending_review=bool(waiting),
                market_state=pricing.feed_state(asset_class),
                reason=reason,
            )
        )

    return Eligibility(
        uid=uid,
        onboarding_status=_status_of(user),
        kyc_tier=_tier_of(user),
        can_trade=blocked is None,
        base_currency=base_currency(uid),
        asset_classes=classes,
        at=_now(),
    )


# --------------------------------------------------------------------------- #
# Order validation against the market
# --------------------------------------------------------------------------- #


def _assert_price_band(price: Decimal, label: str, mark: Mark) -> None:
    """Refuse a price absurdly far from the last trade.

    Every venue has a version of this. Without it the commonest fat-finger — an extra
    zero — is accepted as a resting order that sits there looking legitimate until the
    market happens to reach it.
    """
    if mark.last <= 0:
        return
    move = abs(percent_change(price, mark.last) or Decimal(0))
    if move > TRADING_PRICE_BAND_PERCENT:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"`{label}` is {move}% from the last price of {mark.last} — the band is "
            f"{TRADING_PRICE_BAND_PERCENT}%",
        )


def _assert_stop_direction(payload: OrderRequest, mark: Mark) -> None:
    """A stop has to sit on the side it can actually be reached from.

    A sell stop below the market is a stop-loss; a sell stop above it is an order that
    triggers on the next tick, which is a market order the caller did not ask for.
    """
    if payload.stop_price is None:
        return
    if payload.side is OrderSide.buy and payload.stop_price <= mark.last:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"A buy stop triggers on the way up, so `stop_price` must be above the "
            f"last price of {mark.last}",
        )
    if payload.side is OrderSide.sell and payload.stop_price >= mark.last:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"A sell stop triggers on the way down, so `stop_price` must be below the "
            f"last price of {mark.last}",
        )


def _assert_notional(notional: Decimal, currency: str) -> None:
    if notional < TRADING_MIN_ORDER_NOTIONAL:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Order value {notional} {currency} is below the {TRADING_MIN_ORDER_NOTIONAL} "
            "minimum",
        )
    if notional > TRADING_MAX_ORDER_NOTIONAL:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Order value {notional} {currency} exceeds the {TRADING_MAX_ORDER_NOTIONAL} "
            "per-order limit",
        )


def _reservation_price(payload: OrderRequest, mark: Mark) -> Decimal:
    """The worst price this order can reasonably cost, which is what gets locked.

    A limit buy cannot pay more than its limit. A stop buy becomes a market order at the
    stop, so the stop price is the best available estimate — and if the market gaps past
    it, `execute()` tops the reservation up from available cash or rejects the order,
    rather than quietly filling on money that was never there.
    """
    if payload.type in (OrderType.limit, OrderType.stop_limit):
        assert payload.limit_price is not None  # guaranteed by OrderRequest
        return payload.limit_price
    if payload.type is OrderType.stop:
        assert payload.stop_price is not None
        return payload.stop_price
    return mark.execution_price(payload.side)


def _marketable_at(order: dict, mark: Mark) -> Decimal | None:
    """The price this order fills at right now, or None if it does not.

    Shared by placement and the matcher, so an order cannot fill on one rule when it is
    placed and a different rule a second later.
    """
    if not mark.tradable:
        return None

    side = OrderSide(order["side"])
    order_type = OrderType(order["type"])
    price = mark.execution_price(side)

    if order_type is OrderType.market:
        return price

    if order_type in (OrderType.stop, OrderType.stop_limit) and not order.get("triggered"):
        stop = order["stop_price"]
        reached = mark.last >= stop if side is OrderSide.buy else mark.last <= stop
        if not reached:
            return None
        if order_type is OrderType.stop:
            return price
        # A triggered stop-limit is a limit order from here on; it still has to be
        # marketable, and often is not.

    if order_type is OrderType.stop:
        return price  # already triggered on an earlier tick

    limit = order["limit_price"]
    if side is OrderSide.buy and price <= limit:
        return price
    if side is OrderSide.sell and price >= limit:
        return price
    return None


def _day_expiry(now: datetime) -> datetime:
    """A `day` order lives until the end of the UTC day it was placed.

    Not the exchange's session end: a single order endpoint spans three feeds whose
    sessions differ per symbol and per exchange, and a rule the client can predict is
    worth more than one that is marginally more faithful to one of them.
    """
    return datetime.combine(now.date(), time(23, 59, 59, tzinfo=timezone.utc))


# --------------------------------------------------------------------------- #
# Placing
# --------------------------------------------------------------------------- #


async def place_order(uid: str, payload: OrderRequest) -> dict:
    assert_enabled()

    user = await asyncio.to_thread(_profile, uid)
    assert_can_trade(user)

    # Resolves the instrument against the live universe and prices it in one step, so a
    # symbol that does not exist is a 404 before anything is written.
    mark = await pricing.mark(payload.asset_class, payload.symbol)
    assert_product_enabled(user, pricing.product_for(payload.asset_class, payload.symbol))

    if payload.limit_price is not None:
        _assert_price_band(payload.limit_price, "limit_price", mark)
    if payload.stop_price is not None:
        _assert_price_band(payload.stop_price, "stop_price", mark)
    _assert_stop_direction(payload, mark)

    must_fill_now = payload.type is OrderType.market
    if must_fill_now and not mark.tradable:
        raise _conflict(_closed_detail(mark))

    reserve_price = _reservation_price(payload, mark)
    notional = notional_of(payload.quantity, reserve_price)
    _assert_notional(notional, mark.currency)

    if await asyncio.to_thread(repository.count_open_orders, uid) >= TRADING_MAX_OPEN_ORDERS:
        raise _conflict(
            f"You already have {TRADING_MAX_OPEN_ORDERS} open orders — cancel one first"
        )

    now = _now()
    is_buy = payload.side is OrderSide.buy
    reserved_amount = money(notional + fee_for(notional)) if is_buy else ZERO
    reserved_quantity = payload.quantity if not is_buy else ZERO

    doc = {
        "_id": repository.new_id(),
        "uid": uid,
        "client_order_id": payload.client_order_id,
        "asset_class": payload.asset_class.value,
        "symbol": payload.symbol,
        "side": payload.side.value,
        "type": payload.type.value,
        "time_in_force": payload.time_in_force.value,
        "status": OrderStatus.open.value,
        "funded": False,
        "currency": mark.currency,
        "quantity": payload.quantity,
        "filled_quantity": ZERO,
        "limit_price": payload.limit_price,
        "stop_price": payload.stop_price,
        "triggered": False,
        "average_price": None,
        "filled_notional": None,
        "fee": ZERO,
        "reserved_amount": reserved_amount,
        "reserved_quantity": reserved_quantity,
        "reject_reason": None,
        "created_at": now,
        "updated_at": now,
        "expires_at": _day_expiry(now) if payload.time_in_force is TimeInForce.day else None,
        "closed_at": None,
    }

    # The order is written first so a repeated client order id collides here, before any
    # money moves. Until `funded` is set it is invisible to the matcher.
    try:
        order = await asyncio.to_thread(repository.create_order, doc)
    except DuplicateKeyError as exc:
        raise _conflict(
            f"You have already used client_order_id {payload.client_order_id!r}"
        ) from exc

    await _reserve_for(order, reserved_amount, reserved_quantity)
    await asyncio.to_thread(repository.mark_funded, order["id"])
    order["funded"] = True

    if payload.type is OrderType.market or _marketable_at(order, mark) is not None:
        filled = await execute(order, mark)
        if filled is not None:
            return filled

    if payload.time_in_force is TimeInForce.ioc:
        closed = await close_and_release(
            order["id"],
            OrderStatus.cancelled,
            "Immediate-or-cancel order could not fill against the current price",
        )
        # None means a tick filled it in the moment between the attempt and the cancel,
        # which is a better outcome than the one being asked for — report what happened.
        return closed or await asyncio.to_thread(repository.get_order, uid, order["id"]) or order

    await _engine_notify()
    return order


def _closed_detail(mark: Mark) -> str:
    if mark.market_state is not MarketState.open:
        return f"{mark.symbol} is not trading right now ({mark.market_state.value})"
    return (
        f"The last price for {mark.symbol} is from {mark.quoted_at.isoformat()} and is too "
        "old to trade against"
    )


async def _reserve_for(order: dict, amount: Decimal, quantity: Decimal) -> None:
    """Lock cash for a buy or units for a sell. Failure closes the order as rejected."""
    uid, order_id = order["uid"], order["id"]

    if order["side"] == OrderSide.buy.value:
        await asyncio.to_thread(repository.ensure_wallet, uid, order["currency"])
        entry = await asyncio.to_thread(
            repository.apply_to_wallet,
            uid,
            order["currency"],
            available_delta=-amount,
            reserved_delta=amount,
            kind=LedgerKind.reserve,
            require_available=amount,
            order_id=order_id,
        )
        if entry is None:
            balance = await asyncio.to_thread(repository.get_balance, uid, order["currency"])
            held = balance["available"] if balance else ZERO
            await _reject(order_id, "Insufficient funds")
            raise _conflict(
                f"This order needs {amount} {order['currency']} and you have {held} available"
            )
        return

    position = await asyncio.to_thread(
        repository.reserve_quantity, uid, order["asset_class"], order["symbol"], quantity
    )
    if position is None:
        held = await asyncio.to_thread(
            repository.get_position, uid, order["asset_class"], order["symbol"]
        )
        free = held["available_quantity"] if held else ZERO
        await _reject(order_id, "Insufficient position")
        raise _conflict(
            f"Selling {quantity} {order['symbol']} needs that many free units and you hold "
            f"{free}. This venue is long-only spot — there is no short selling."
        )


async def _reject(order_id: str, reason: str) -> None:
    await asyncio.to_thread(
        repository.claim_close, order_id, OrderStatus.rejected, None, reason
    )
    await asyncio.to_thread(repository.clear_reservations, order_id)


async def close_and_release(
    order_id: str, new_status: OrderStatus, reason: str | None = None
) -> dict | None:
    """Cancel, expire or reject an open order and give back whatever it was holding.

    The status moves first, atomically, so only one caller can ever be the one that
    releases — a cancel racing a fill cannot double-release. None means the order was no
    longer open, and the caller decides whether that is an error or simply news.
    """
    closed = await asyncio.to_thread(
        repository.claim_close, order_id, new_status, None, reason
    )
    if closed is None:
        return None
    await release_reservation(closed)
    return await asyncio.to_thread(repository.get_order_unscoped, order_id) or closed


async def release_reservation(order: dict) -> None:
    """Return an order's reservation. Safe to run twice — the guards are on the balances
    themselves, so a second attempt finds nothing to give back and does nothing. That is
    what lets the sweep re-run a release that a crash interrupted."""
    if order.get("reserved_amount", ZERO) > 0:
        await asyncio.to_thread(
            repository.apply_to_wallet,
            order["uid"],
            order["currency"],
            available_delta=order["reserved_amount"],
            reserved_delta=-order["reserved_amount"],
            kind=LedgerKind.release,
            require_reserved=order["reserved_amount"],
            order_id=order["id"],
        )
    if order.get("reserved_quantity", ZERO) > 0:
        await asyncio.to_thread(
            repository.release_quantity,
            order["uid"],
            order["asset_class"],
            order["symbol"],
            order["reserved_quantity"],
        )
    await asyncio.to_thread(repository.clear_reservations, order["id"])


async def cancel_order(uid: str, order_id: str) -> dict:
    assert_enabled()
    order = await asyncio.to_thread(repository.get_order, uid, order_id)
    if order is None:
        # Same answer whether it never existed or belongs to someone else.
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Order not found")
    if order["status"] != OrderStatus.open.value:
        raise _conflict(f"This order is already {order['status']}")

    async with _settlement:
        closed = await asyncio.to_thread(
            repository.claim_close, order_id, OrderStatus.cancelled, uid, None
        )
        if closed is None:
            current = await asyncio.to_thread(repository.get_order, uid, order_id)
            raise _conflict(f"This order is already {current['status']}" if current else "Gone")
        await release_reservation(closed)
        refreshed = await asyncio.to_thread(repository.get_order, uid, order_id)

    await _engine_notify()
    return refreshed or closed


# --------------------------------------------------------------------------- #
# Filling
# --------------------------------------------------------------------------- #


async def execute(order: dict, mark: Mark) -> dict | None:
    """Fill an order in full at the current price, or return None if it cannot fill.

    Held under the settlement lock from the moment the price is decided: everything after
    that point is bookkeeping that has to happen as one unit, and the lock is what keeps a
    tick-driven fill and a request-driven one from interleaving on the same order.
    """
    async with _settlement:
        return await _execute_locked(order["id"], mark)


async def _execute_locked(order_id: str, mark: Mark) -> dict | None:
    order = await asyncio.to_thread(repository.get_order_unscoped, order_id)
    if order is None or order["status"] != OrderStatus.open.value or not order.get("funded"):
        return None

    price = _marketable_at(order, mark)
    if price is None:
        # A stop that has been reached but whose limit is not yet marketable stays open,
        # and stays triggered — reaching the stop is a one-way door.
        if order["type"] == OrderType.stop_limit.value and not order.get("triggered"):
            if _stop_reached(order, mark):
                await asyncio.to_thread(repository.mark_triggered, order_id)
        return None

    quantity: Decimal = order["quantity"]
    notional = notional_of(quantity, price)
    fee = fee_for(notional)
    side = OrderSide(order["side"])

    if side is OrderSide.buy:
        funded = await _fund_buy(order, notional, fee)
        if not funded:
            return await _reject_for_funds(order)

    claimed = await asyncio.to_thread(
        repository.claim_fill, order_id, quantity=quantity, price=price, notional=notional, fee=fee
    )
    if claimed is None:
        return None  # someone else took it between the read and here

    if side is OrderSide.buy:
        settled = await _settle_buy(claimed, notional, fee)
    else:
        settled = await _settle_sell(claimed, notional, fee)

    trade = await asyncio.to_thread(
        repository.record_trade,
        {
            "_id": repository.new_id(),
            "uid": order["uid"],
            "order_id": order_id,
            "asset_class": order["asset_class"],
            "symbol": order["symbol"],
            "side": side.value,
            "currency": order["currency"],
            "quantity": quantity,
            "price": price,
            "notional": notional,
            "fee": fee,
            "realized_pnl": settled,
            "at": _now(),
        },
    )
    logger.info(
        "Filled %s %s %s %s @ %s (%s), trade %s",
        order["uid"], side.value, quantity, order["symbol"], price, order["currency"], trade["id"],
    )

    await asyncio.to_thread(repository.clear_reservations, order_id)
    await _engine_notify()
    return await asyncio.to_thread(repository.get_order_unscoped, order_id)


def _stop_reached(order: dict, mark: Mark) -> bool:
    stop = order["stop_price"]
    return mark.last >= stop if order["side"] == OrderSide.buy.value else mark.last <= stop


async def _fund_buy(order: dict, notional: Decimal, fee: Decimal) -> bool:
    """Make sure the reservation covers what the fill actually costs.

    A stop buy reserved at its stop price; if the market gapped through it the fill costs
    more, and the difference has to come out of available cash. When it cannot, the order
    is rejected rather than filled on credit — this venue does not lend.
    """
    shortfall = money(notional + fee - order["reserved_amount"])
    if shortfall <= 0:
        return True
    entry = await asyncio.to_thread(
        repository.apply_to_wallet,
        order["uid"],
        order["currency"],
        available_delta=-shortfall,
        reserved_delta=shortfall,
        kind=LedgerKind.reserve,
        require_available=shortfall,
        order_id=order["id"],
    )
    if entry is None:
        return False
    await asyncio.to_thread(repository.add_reservation, order["id"], shortfall)
    order["reserved_amount"] = money(order["reserved_amount"] + shortfall)
    return True


async def _reject_for_funds(order: dict) -> dict | None:
    closed = await asyncio.to_thread(
        repository.claim_close,
        order["id"],
        OrderStatus.rejected,
        None,
        "Insufficient funds at execution — the market moved past the reserved price",
    )
    if closed is None:
        return None
    await release_reservation(closed)
    logger.info("Rejected order %s: reservation could not cover the fill", order["id"])
    return await asyncio.to_thread(repository.get_order_unscoped, order["id"])


async def _settle_buy(order: dict, notional: Decimal, fee: Decimal) -> None:
    """Cash leaves first, then the position appears.

    That order matters: if this process dies between the two, the user is short the cash
    and missing the asset, which is recoverable from the trade record. The other order
    would create the asset for free.
    """
    cost = money(notional + fee)
    reserved: Decimal = order["reserved_amount"]
    refund = money(reserved - cost)  # `_fund_buy` guarantees this is not negative

    entry = await asyncio.to_thread(
        repository.apply_to_wallet,
        order["uid"],
        order["currency"],
        available_delta=refund,
        reserved_delta=-reserved,
        kind=LedgerKind.trade_debit,
        require_reserved=reserved,
        order_id=order["id"],
    )
    if entry is None:
        # Unreachable while the settlement lock holds and the reservation is intact. If it
        # ever fires, the order says filled and the cash was not taken — loud, not silent.
        logger.critical(
            "Order %s filled but its %s reservation of %s could not be consumed",
            order["id"], order["currency"], reserved,
        )
    await asyncio.to_thread(
        repository.ensure_position,
        order["uid"], order["asset_class"], order["symbol"], order["currency"],
    )
    await asyncio.to_thread(
        repository.add_to_position,
        order["uid"], order["asset_class"], order["symbol"], order["quantity"], cost,
    )
    return None


async def _settle_sell(order: dict, notional: Decimal, fee: Decimal) -> Decimal:
    """The position goes first, then the proceeds arrive — the mirror of a buy, and
    conservative for the same reason.

    Realised P&L is proceeds net of fee less the average cost of the units sold, where the
    average already includes the fee paid on the way in. So a round trip at an unchanged
    price shows a loss of both commissions, which is the true result.
    """
    uid, asset_class, symbol = order["uid"], order["asset_class"], order["symbol"]
    quantity: Decimal = order["quantity"]
    proceeds = money(notional - fee)

    position = await asyncio.to_thread(repository.get_position, uid, asset_class, symbol)
    total = (
        position["available_quantity"] + position["reserved_quantity"] if position else ZERO
    )
    average = money(position["cost_basis"] / total) if position and total > 0 else ZERO
    basis_sold = money(average * quantity)
    realized = money(proceeds - basis_sold)

    reduced = await asyncio.to_thread(
        repository.reduce_position, uid, asset_class, symbol, quantity, basis_sold, realized
    )
    if reduced is None:
        logger.critical(
            "Order %s filled but %s units of %s were not reserved on the position",
            order["id"], quantity, symbol,
        )
    await asyncio.to_thread(repository.ensure_wallet, uid, order["currency"])
    await asyncio.to_thread(
        repository.apply_to_wallet,
        uid,
        order["currency"],
        available_delta=proceeds,
        reserved_delta=ZERO,
        kind=LedgerKind.trade_credit,
        order_id=order["id"],
    )
    return realized


# --------------------------------------------------------------------------- #
# Funding
# --------------------------------------------------------------------------- #


def _assert_funding_allowed(user: dict) -> None:
    """Money in and money out sit behind the same gate as trading.

    Crediting an account before it is identified is exactly the step anti-money-laundering
    rules exist to prevent, and it costs nothing here to refuse it.
    """
    assert_can_trade(user)


async def deposit(uid: str, payload: FundsRequest) -> dict:
    assert_enabled()
    if payload.amount > TRADING_MAX_DEPOSIT:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"A single deposit is capped at {TRADING_MAX_DEPOSIT}",
        )
    user = await asyncio.to_thread(_profile, uid)
    _assert_funding_allowed(user)
    return await _move_funds(uid, payload, LedgerKind.deposit, credit=True)


async def withdraw(uid: str, payload: FundsRequest) -> dict:
    assert_enabled()
    if payload.amount > TRADING_MAX_WITHDRAWAL:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"A single withdrawal is capped at {TRADING_MAX_WITHDRAWAL}",
        )
    user = await asyncio.to_thread(_profile, uid)
    _assert_funding_allowed(user)
    return await _move_funds(uid, payload, LedgerKind.withdrawal, credit=False)


async def _move_funds(uid: str, payload: FundsRequest, kind: LedgerKind, credit: bool) -> dict:
    """Idempotent by construction.

    The key is claimed before the balance moves and completed after, so a replay can tell
    "already done" (return the original entry) from "the first attempt never finished"
    (refuse, rather than guess). A retried deposit that credits twice is the one bug in
    this module nobody would notice until the numbers stopped adding up.
    """
    scope = kind.value
    currency = payload.currency.value
    existing = await asyncio.to_thread(repository.claim_key, uid, scope, payload.idempotency_key)
    if existing is not None:
        if existing.get("result_id"):
            entry = await asyncio.to_thread(
                repository.get_ledger_entry, uid, existing["result_id"]
            )
            if entry is not None:
                return entry
        raise _conflict(
            f"idempotency_key {payload.idempotency_key!r} is already in flight — retry it "
            "later rather than sending a new one"
        )

    try:
        if credit:
            await asyncio.to_thread(repository.ensure_wallet, uid, currency)
        entry = await asyncio.to_thread(
            repository.apply_to_wallet,
            uid,
            currency,
            available_delta=payload.amount if credit else -payload.amount,
            reserved_delta=ZERO,
            kind=kind,
            require_available=None if credit else payload.amount,
            reference=payload.reference,
        )
    except Exception:
        await asyncio.to_thread(repository.release_key, uid, scope, payload.idempotency_key)
        raise

    if entry is None:
        await asyncio.to_thread(repository.release_key, uid, scope, payload.idempotency_key)
        balance = await asyncio.to_thread(repository.get_balance, uid, currency)
        held = balance["available"] if balance else ZERO
        raise _conflict(
            f"Withdrawing {payload.amount} {currency} needs that much available and you have "
            f"{held}. Funds locked by open orders do not count — cancel them first."
        )

    await asyncio.to_thread(
        repository.complete_key, uid, scope, payload.idempotency_key, entry["id"]
    )
    return entry


# --------------------------------------------------------------------------- #
# Reads
# --------------------------------------------------------------------------- #


def _balance(doc: dict) -> Balance:
    return Balance(
        currency=doc["currency"],
        available=doc["available"],
        reserved=doc["reserved"],
        total=doc["available"] + doc["reserved"],
    )


def balances(uid: str) -> list[Balance]:
    return [_balance(doc) for doc in repository.list_balances(uid)]


def _position(doc: dict) -> Position:
    total = doc["available_quantity"] + doc["reserved_quantity"]
    return Position(
        asset_class=AssetClass(doc["asset_class"]),
        symbol=doc["symbol"],
        currency=doc["currency"],
        quantity=total,
        available_quantity=doc["available_quantity"],
        reserved_quantity=doc["reserved_quantity"],
        average_price=money(doc["cost_basis"] / total) if total > 0 else None,
        cost_basis=doc["cost_basis"],
        realized_pnl=doc["realized_pnl"],
        updated_at=doc["updated_at"],
    )


def positions(uid: str, include_flat: bool = False) -> list[Position]:
    return [_position(doc) for doc in repository.list_positions(uid, include_flat)]


def position(uid: str, asset_class: str, symbol: str) -> Position | None:
    doc = repository.get_position(uid, asset_class, symbol)
    return _position(doc) if doc else None


def account(uid: str) -> Account:
    user = _profile(uid)
    return Account(
        uid=uid,
        base_currency=base_currency(uid),
        onboarding_status=_status_of(user),
        kyc_tier=_tier_of(user),
        enabled_products=_products(user, "enabled_products"),
        pending_products=_products(user, "pending_products"),
        balances=balances(uid),
        open_orders=repository.count_open_orders(uid),
        positions=repository.count_positions(uid),
        at=_now(),
    )


async def portfolio(uid: str) -> Portfolio:
    """Positions marked against the live feeds.

    Totals are per currency and there is no grand total, because converting INR into USDT
    would need an FX rate this API has no licensed source for. A made-up total is worse
    than no total.
    """
    held = await asyncio.to_thread(positions, uid)
    cash = await asyncio.to_thread(balances, uid)

    marks = await asyncio.gather(
        *(pricing.mark_or_none(p.asset_class, p.symbol) for p in held)
    )

    valued: list[PositionValuation] = []
    market_value: dict[str, Decimal] = {}
    unrealized: dict[str, Decimal] = {}
    realized: dict[str, Decimal] = {}

    for position, mark in zip(held, marks):
        realized[position.currency] = money(
            realized.get(position.currency, ZERO) + position.realized_pnl
        )
        row = PositionValuation(**position.model_dump())
        if mark is not None:
            value = money(position.quantity * mark.last)
            pnl = money(value - position.cost_basis)
            row.last_price = mark.last
            row.market_value = value
            row.unrealized_pnl = pnl
            row.unrealized_pnl_percent = (
                percent_change(value, position.cost_basis) if position.cost_basis > 0 else None
            )
            row.market_state = mark.market_state
            row.stale = mark.stale
            market_value[position.currency] = money(
                market_value.get(position.currency, ZERO) + value
            )
            unrealized[position.currency] = money(
                unrealized.get(position.currency, ZERO) + pnl
            )
        valued.append(row)

    priced = sum(1 for row in valued if row.market_value is not None)
    return Portfolio(
        uid=uid,
        balances=cash,
        positions=valued,
        market_value_by_currency=market_value,
        unrealized_pnl_by_currency=unrealized,
        realized_pnl_by_currency=realized,
        priced=priced,
        unpriced=len(valued) - priced,
        at=_now(),
    )


# --------------------------------------------------------------------------- #
# Engine hand-off
# --------------------------------------------------------------------------- #

# Set by app.trading.engine at import time. Kept as a hook rather than an import so the
# service does not depend on the matcher: the rules are testable, and callable, with no
# engine running at all.
_notify_engine = None


def set_engine_notifier(callback) -> None:
    global _notify_engine
    _notify_engine = callback


async def _engine_notify() -> None:
    if _notify_engine is None:
        return
    try:
        await _notify_engine()
    except Exception:  # a matcher problem must not fail the caller's order
        logger.exception("Notifying the trading engine failed")
