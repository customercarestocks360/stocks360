"""Trading rules: who may trade, what an order has to satisfy, and how a fill settles.

This is a **simulated venue**. Orders execute against the same live market data the read
endpoints serve, and cash is book money this API creates on request. There is no broker,
no clearing member and no custody anywhere behind it. Everything here is built to be
correct as an accounting system, which is a different claim from being a real one.

**One balance funds everything.** An account holds a single wallet in
`TRADING_ACCOUNT_CURRENCY` (USDT), opened at `TRADING_INITIAL_BALANCE`, and every asset
class settles into it. An instrument priced in something else has its notional converted by
`app.trading.fx` at a rate fixed when the order is placed and carried on the order, so the
same order can never settle at two different rates and the matcher never has to look one
up. Prices stay in the instrument's own currency; everything that reaches a balance is in
the account currency.

**Positions are signed, and both directions are real.** Positive is long, negative short,
one document per instrument. A sell against a long reduces it and reserves the units; a sell
with nothing behind it opens a short and reserves cash. Shorting is allowed on the asset
classes in `TRADING_SHORT_SELLING_CLASSES` — all three desks by default in this simulated
margin venue. An order that would carry a position *through* zero is refused rather than split.

**One settlement path.** `money.apply_fill` turns a fill into a complete set of deltas and
`_settle_fill` applies them. There used to be a `_settle_buy` and a `_settle_sell`, and the
split is what let a leveraged round trip mint money: the buy took only its margin out of the
wallet while the sell credited the full gross proceeds back, so buying and selling at one
unchanged price left the account richer by most of the notional. Closing now returns the
margin released plus the P&L realized, which is the only pair of numbers that conserves.

The order of the checks in `place_order()` is deliberate and is the honest answer to
"proper conditionality":

1. **Is the venue open for business** — the feature flag.
2. **Is the caller allowed to trade at all** — onboarding submitted, KYC tier reached.
3. **Does the instrument exist, and can we price what it settles in** — resolved against
   the live symbol universe, not a list in this repository, and convertible to the account
   currency.
4. **Is the specific product enabled for this caller** — crypto spot, forex, domestic or
   foreign equity, taken from the onboarding outcome. A product still under review is a
   separate answer from one never requested, because the user can do something about one
   of them.
5. **Is the order itself coherent against the market** — stop on the correct side, price
   inside the band, notional inside the bounds, and for anything that must fill now, a
   market that is open and a price that is fresh.
6. **Is the direction permitted** — a short only where the asset class carries one, and
   never through zero.
7. **Are the funds or the units actually there** — atomically, as part of locking them.

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
    TRADING_ACCOUNT_CURRENCY,
    TRADING_ENABLED,
    TRADING_MAX_DEPOSIT,
    TRADING_MAX_OPEN_ORDERS,
    TRADING_MAX_ORDER_NOTIONAL,
    TRADING_MAX_WITHDRAWAL,
    TRADING_MIN_ORDER_NOTIONAL,
    TRADING_MIN_QUANTITY,
    TRADING_OPEN_ACCESS,
    TRADING_PRICE_BAND_PERCENT,
    TRADING_SHORT_SELLING_CLASSES,
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
    HedgeSide,
    LedgerKind,
    MarketState,
    OrderRequest,
    OrderSide,
    OrderStatus,
    OrderType,
    Portfolio,
    Position,
    PositionSide,
    PositionValuation,
    TimeInForce,
)
from app.trading import fx, pricing, repository
from app.trading.money import (
    ONE,
    ZERO,
    FillEffect,
    apply_fill,
    cash_shortfall,
    fee_for,
    margin_of,
    money,
    notional_of,
    percent_change,
    sign_of,
    wallet_delta,
)
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
_TRADING_STATUSES = frozenset(
    {OnboardingStatus.under_review, OnboardingStatus.approved}
)
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
        return OnboardingStatus(
            user.get("onboarding_status") or OnboardingStatus.not_started.value
        )
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
        except (
            ValueError
        ):  # a product retired from the catalogue but still on a profile
            continue
    return out


def _trading_block(user: dict) -> str | None:
    """Why this account cannot trade at all, or None when it can.

    The single place the account-level gate is decided, so `TRADING_OPEN_ACCESS` only has to
    be honoured here: `assert_can_trade`, `eligibility` and the funding gate all read this.
    """
    if user.get("account_status", "active") == "suspended":
        reason = user.get("account_status_reason") or "Contact support for details"
        return f"This account is suspended: {reason}"
    if TRADING_OPEN_ACCESS:
        return None
    onboarding = _status_of(user)
    if onboarding is OnboardingStatus.rejected:
        return (
            "Your application was rejected — trading is not available on this account"
        )
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

    Skipped entirely when `TRADING_OPEN_ACCESS` is explicitly enabled: refusing a funded
    account access to a paper market because it did not tick that box during onboarding was
    the gate with the least to justify it.
    """
    if TRADING_OPEN_ACCESS:
        return
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
        # Under open access every class is tradable, so there is nothing to explain and no
        # review to be waiting on — the products list stays, since it still describes what
        # this class *would* require if the gate were put back.
        if TRADING_OPEN_ACCESS:
            reason = None
        elif blocked:
            reason = blocked
        elif granted:
            reason = None
        elif waiting:
            reason = f"{', '.join(p.value for p in waiting)} is still under review"
        else:
            reason = f"None of {', '.join(p.value for p in candidates)} were requested during onboarding"
        classes.append(
            AssetClassEligibility(
                asset_class=asset_class,
                products=candidates,
                enabled=TRADING_OPEN_ACCESS or (blocked is None and bool(granted)),
                pending_review=bool(waiting) and not TRADING_OPEN_ACCESS,
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


def _assert_quantity(quantity: Decimal, symbol: str) -> None:
    if quantity < TRADING_MIN_QUANTITY:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Minimum order size for {symbol} is {TRADING_MIN_QUANTITY}, got {quantity}",
        )


def _net_quantity(position: dict | None) -> Decimal:
    """A position's signed size, locked units included.

    `available_quantity` is signed and `reserved_quantity` is not, so the net is the sum:
    a long with a resting sell is still that long, and a short has nothing reserved.
    """
    if position is None:
        return ZERO
    return money(position["available_quantity"] + position["reserved_quantity"])


def _direction(quantity: Decimal) -> PositionSide:
    sign = sign_of(quantity)
    if sign > 0:
        return PositionSide.long
    return PositionSide.short if sign < 0 else PositionSide.flat


def _reserves_units(side: OrderSide, net: Decimal) -> bool:
    """Whether this order locks stock rather than cash.

    Exactly one case does: a sell against an existing long, which is the classic "these
    shares are promised" reservation. Everything else — a buy either way, and a sell that
    opens a short — commits cash, because that is what it actually consumes.
    """
    return side is OrderSide.sell and net > 0


def _assert_short_selling_allowed(
    asset_class: AssetClass, symbol: str, net: Decimal
) -> None:
    """A sell with nothing behind it is a short, and not every market can carry one.

    The configured deployment policy is authoritative. This simulated margin venue enables
    every desk by default; a cash-delivery deployment may remove equities from the setting.
    """
    if asset_class.value in TRADING_SHORT_SELLING_CLASSES:
        return
    held = f"you hold {net}" if net != 0 else "you hold none"
    raise _conflict(
        f"Selling {symbol} needs units you already own and {held}. Short selling is not "
        f"available on {asset_class.value} — it would need a stock borrow this venue cannot "
        f"arrange. It is available on "
        f"{', '.join(sorted(TRADING_SHORT_SELLING_CLASSES))}."
    )


def _assert_no_flip(
    side: OrderSide, quantity: Decimal, net: Decimal, symbol: str
) -> None:
    """Refuse an order that would carry a position through zero and out the other side.

    Deliberate, not an oversight: one fill carries one fee, and splitting it across a close
    and an open makes both halves approximate. "Close it, then open the other way" is two
    orders the caller can already place, and both of them price honestly.
    """
    side_sign = 1 if side is OrderSide.buy else -1
    if sign_of(net) in (0, side_sign) or quantity <= abs(net):
        return
    raise _conflict(
        f"You are {_direction(net).value} {abs(net)} {symbol} and this order is for "
        f"{quantity}, which would flip the position through zero. Close the {abs(net)} you "
        f"hold first, then open the other side — one order cannot price both halves."
    )


def _assert_position_leg(payload: OrderRequest, net: Decimal) -> None:
    """Validate one-way orders and explicit hedge legs without conflating the modes."""
    if payload.position_side is HedgeSide.long:
        if net < 0:
            raise _conflict("The LONG leg contains an invalid negative position")
        if payload.side is OrderSide.sell and payload.quantity > net:
            raise _conflict(f"The LONG leg only has {net} {payload.symbol} to close")
    elif payload.position_side is HedgeSide.short:
        if net > 0:
            raise _conflict("The SHORT leg contains an invalid positive position")
        if payload.side is OrderSide.sell:
            _assert_short_selling_allowed(payload.asset_class, payload.symbol, net)
        elif payload.quantity > abs(net):
            raise _conflict(
                f"The SHORT leg only has {abs(net)} {payload.symbol} to close"
            )
    elif payload.side is OrderSide.sell and payload.quantity > max(net, ZERO):
        _assert_short_selling_allowed(payload.asset_class, payload.symbol, net)
    _assert_no_flip(payload.side, payload.quantity, net, payload.symbol)


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

    if order_type in (OrderType.stop, OrderType.stop_limit) and not order.get(
        "triggered"
    ):
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
    assert_product_enabled(
        user, pricing.product_for(payload.asset_class, payload.symbol)
    )

    if payload.limit_price is not None:
        _assert_price_band(payload.limit_price, "limit_price", mark)
    if payload.stop_price is not None:
        _assert_price_band(payload.stop_price, "stop_price", mark)
    _assert_stop_direction(payload, mark)

    must_fill_now = payload.type is OrderType.market
    if must_fill_now and not mark.tradable:
        raise _conflict(_closed_detail(mark))

    _assert_quantity(payload.quantity, payload.symbol)

    # The rate is fetched once, here, and travels on the order — see `app.trading.fx` for
    # why settlement must never look it up again. A currency nothing can price against the
    # account currency is a 409 now rather than an order that cannot be funded later.
    fx_rate = await fx.rate_for(mark.currency)

    reserve_price = _reservation_price(payload, mark)
    notional_quote = notional_of(payload.quantity, reserve_price)
    # Bounds now apply to the converted figure, which is the first time they have meant the
    # same thing across markets: the old per-quote-currency band compared INR to USD.
    notional = fx.convert(notional_quote, fx_rate)
    _assert_notional(notional, TRADING_ACCOUNT_CURRENCY)

    if (
        await asyncio.to_thread(repository.count_open_orders, uid)
        >= TRADING_MAX_OPEN_ORDERS
    ):
        raise _conflict(
            f"You already have {TRADING_MAX_OPEN_ORDERS} open orders — cancel one first"
        )

    # What the caller already holds decides what this order commits: stock if it is selling
    # a long, cash in every other case. Read once, here, so placement and settlement agree
    # on which of the two the order is holding.
    position_side = payload.position_side.value if payload.position_side else None
    held = await asyncio.to_thread(
        repository.get_position,
        uid,
        payload.asset_class.value,
        payload.symbol,
        position_side,
    )
    net = _net_quantity(held)
    # Order matters. Any sell bigger than the long behind it ends up net short, so the
    # short-selling gate is asked first — otherwise an equity sell of 10 against 5 held is
    # refused for "flipping through zero", advice the caller cannot act on because there is
    # no other side to open. On a shortable class the flip check is the right refusal and
    # runs next.
    _assert_position_leg(payload, net)

    now = _now()
    # Cash orders lock margin, not the full notional — see `money.margin_of`. A sell against
    # a long locks the units instead, which is what stops the same stock being sold twice.
    if _reserves_units(payload.side, net):
        reserved_amount, reserved_quantity = ZERO, payload.quantity
    else:
        reserved_amount, reserved_quantity = (
            money(margin_of(notional) + fee_for(notional)),
            ZERO,
        )

    doc = {
        "_id": repository.new_id(),
        "uid": uid,
        "client_order_id": payload.client_order_id,
        "asset_class": payload.asset_class.value,
        "symbol": payload.symbol,
        "side": payload.side.value,
        "position_side": position_side,
        "type": payload.type.value,
        "time_in_force": payload.time_in_force.value,
        "status": OrderStatus.open.value,
        "funded": False,
        "currency": mark.currency,
        "account_currency": TRADING_ACCOUNT_CURRENCY,
        "fx_rate": fx_rate,
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
        "liquidation": False,
        "created_at": now,
        "updated_at": now,
        "expires_at": _day_expiry(now)
        if payload.time_in_force is TimeInForce.day
        else None,
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
        return (
            closed
            or await asyncio.to_thread(repository.get_order, uid, order["id"])
            or order
        )

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
    """Lock cash or units, whichever this order committed. Failure rejects the order.

    Which one it is was decided at placement and is recorded in the order's own
    `reserved_amount` / `reserved_quantity`, so this does not re-derive it from the side —
    a sell locks stock when it is closing a long and cash when it is opening a short, and
    guessing again here is how the two halves get out of step.
    """
    uid, order_id = order["uid"], order["id"]

    if quantity > 0:
        position = await asyncio.to_thread(
            repository.reserve_quantity,
            uid,
            order["asset_class"],
            order["symbol"],
            quantity,
            order.get("position_side"),
        )
        if position is None:
            held = await asyncio.to_thread(
                repository.get_position,
                uid,
                order["asset_class"],
                order["symbol"],
                order.get("position_side"),
            )
            free = held["available_quantity"] if held else ZERO
            await _reject(order_id, "Insufficient position")
            raise _conflict(
                f"Selling {quantity} {order['symbol']} needs that many unlocked units and "
                f"you have {free} free. Cancel a resting sell to release some."
            )
        return

    await asyncio.to_thread(repository.ensure_wallet, uid, TRADING_ACCOUNT_CURRENCY)
    if amount <= 0:
        return
    entry = await asyncio.to_thread(
        repository.apply_to_wallet,
        uid,
        TRADING_ACCOUNT_CURRENCY,
        available_delta=-amount,
        reserved_delta=amount,
        kind=LedgerKind.reserve,
        require_available=amount,
        order_id=order_id,
    )
    if entry is None:
        balance = await asyncio.to_thread(
            repository.get_balance, uid, TRADING_ACCOUNT_CURRENCY
        )
        held = balance["available"] if balance else ZERO
        await _reject(order_id, "Insufficient funds")
        raise _conflict(
            f"This order needs {amount} {TRADING_ACCOUNT_CURRENCY} and you have {held} "
            f"available"
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


def _wallet_currency(order: dict) -> str:
    """Which wallet this order's cash lives in.

    Always the account currency for anything placed since the balance became universal.
    Orders written before that reserved cash in the instrument's own quote currency, and
    that is the wallet their reservation has to go back to — releasing it into the account
    currency instead would move value between two wallets and lose it from one of them.
    """
    return order.get("account_currency") or order["currency"]


async def release_reservation(order: dict) -> None:
    """Return an order's reservation. Safe to run twice — the guards are on the balances
    themselves, so a second attempt finds nothing to give back and does nothing. That is
    what lets the sweep re-run a release that a crash interrupted."""
    if order.get("reserved_amount", ZERO) > 0:
        await asyncio.to_thread(
            repository.apply_to_wallet,
            order["uid"],
            _wallet_currency(order),
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
            order.get("position_side"),
        )
    await asyncio.to_thread(repository.clear_reservations, order["id"])


async def cancel_order(uid: str, order_id: str) -> dict:
    assert_enabled()
    order = await asyncio.to_thread(repository.get_order, uid, order_id)
    if order is None:
        # Same answer whether it never existed or belongs to someone else.
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Order not found"
        )
    if order["status"] != OrderStatus.open.value:
        raise _conflict(f"This order is already {order['status']}")

    async with _settlement:
        closed = await asyncio.to_thread(
            repository.claim_close, order_id, OrderStatus.cancelled, uid, None
        )
        if closed is None:
            current = await asyncio.to_thread(repository.get_order, uid, order_id)
            raise _conflict(
                f"This order is already {current['status']}" if current else "Gone"
            )
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
    if (
        order is None
        or order["status"] != OrderStatus.open.value
        or not order.get("funded")
    ):
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
    side = OrderSide(order["side"])
    rate: Decimal = order.get("fx_rate") or ONE

    # Prices are quoted in the instrument's currency; every figure that reaches a balance is
    # in the account currency. The conversion happens once, here, using the rate the order
    # has carried since placement.
    notional_quote = notional_of(quantity, price)
    notional = fx.convert(notional_quote, rate)
    fee = fee_for(notional)

    position = await asyncio.to_thread(
        repository.get_position,
        order["uid"],
        order["asset_class"],
        order["symbol"],
        order.get("position_side"),
    )
    net = _net_quantity(position)
    try:
        effect = apply_fill(
            quantity=net,
            cost_basis=position["cost_basis"] if position else ZERO,
            cost_basis_quote=(position or {}).get("cost_basis_quote", ZERO),
            margin_used=position["margin_used"] if position else ZERO,
            side_sign=1 if side is OrderSide.buy else -1,
            fill_quantity=quantity,
            notional=notional,
            notional_quote=notional_quote,
            fee=fee,
            margin=money(margin_of(notional) + fee),
        )
    except ValueError:
        # The position moved under a resting order until this fill would flip it through
        # zero — a short partly closed by another order, say. Refused for the same reason it
        # is refused at placement, and the caller gets the reservation back.
        return await _reject_and_release(
            order,
            "This order would flip the position through zero — close what is open first",
        )

    # Every fill, not only the cash-reserving ones: a sell that reserved units can still
    # settle a leveraged loss deeper than the margin behind it, and that comes out of cash.
    if not await _fund_cash_leg(order, effect):
        return await _reject_and_release(
            order,
            "Insufficient funds at execution — the market moved past the reserved price",
        )

    claimed = await asyncio.to_thread(
        repository.claim_fill,
        order_id,
        quantity=quantity,
        price=price,
        notional=notional,
        fee=fee,
    )
    if claimed is None:
        return None  # someone else took it between the read and here

    await _settle_fill(claimed, effect)

    trade = await asyncio.to_thread(
        repository.record_trade,
        {
            "_id": repository.new_id(),
            "uid": order["uid"],
            "order_id": order_id,
            "asset_class": order["asset_class"],
            "symbol": order["symbol"],
            "side": side.value,
            "position_side": order.get("position_side"),
            "currency": order["currency"],
            "account_currency": _wallet_currency(order),
            "fx_rate": rate,
            "quantity": quantity,
            "price": price,
            "notional": notional,
            "fee": fee,
            "opened": money(quantity - effect.closed_quantity),
            "closed": effect.closed_quantity,
            # Only the closing part of a fill books P&L. An opening fill reports null
            # rather than zero: "nothing was realized" and "it came out flat" differ.
            "realized_pnl": effect.realized if effect.closed_quantity > 0 else None,
            "liquidation": order.get("liquidation", False),
            "at": _now(),
        },
    )
    logger.info(
        "Filled %s %s %s %s @ %s %s (%s %s), trade %s",
        order["uid"],
        side.value,
        quantity,
        order["symbol"],
        price,
        order["currency"],
        notional,
        _wallet_currency(order),
        trade["id"],
    )

    await asyncio.to_thread(repository.clear_reservations, order_id)
    await _engine_notify()
    return await asyncio.to_thread(repository.get_order_unscoped, order_id)


def _stop_reached(order: dict, mark: Mark) -> bool:
    stop = order["stop_price"]
    return (
        mark.last >= stop if order["side"] == OrderSide.buy.value else mark.last <= stop
    )


async def _fund_cash_leg(order: dict, effect: FillEffect) -> bool:
    """Make sure the wallet can absorb what this fill takes out of it, before it is claimed.

    Three situations produce a shortfall, and they are the same shape:

    * A stop buy reserved at its stop price and the market gapped through it, so the margin
      costs more than was locked.
    * A buy closing a short settles a loss bigger than the collateral posted against it.
    * A **sell closing a long** does the same. That one reserved units, not cash, so it
      looks as though it needs no funding — but under leverage a position can lose far more
      than the margin behind it, and the difference still has to come out of the balance.
      Which is why this runs for every fill and not only the cash-reserving ones.

    An **opening** fill that cannot be covered is rejected: this venue does not lend to open
    a position. A **closing** fill that cannot be covered goes through anyway and drives the
    balance negative, which is a deliberate choice — refusing to close leaves the user
    holding a position that only gets worse, and a negative balance is contained (every
    reservation and withdrawal guards on `require_available`, so nothing can be traded or
    paid out of it). Reaching that point means the margin engine did not get here first, and
    that is what the critical log is for.
    """
    reserved: Decimal = order.get("reserved_amount", ZERO)
    shortfall = cash_shortfall(reserved, effect)
    if shortfall <= 0:
        return True

    entry = await asyncio.to_thread(
        repository.apply_to_wallet,
        order["uid"],
        _wallet_currency(order),
        available_delta=-shortfall,
        reserved_delta=shortfall,
        kind=LedgerKind.reserve,
        require_available=shortfall,
        order_id=order["id"],
    )
    if entry is not None:
        await asyncio.to_thread(repository.add_reservation, order["id"], shortfall)
        order["reserved_amount"] = money(reserved + shortfall)
        return True

    if effect.closed_quantity <= 0:
        return False
    logger.critical(
        "Order %s closes a position at a loss %s beyond what %s can cover — settling into a "
        "negative balance rather than leaving the position open",
        order["id"],
        shortfall,
        order["uid"],
    )
    return True


async def _reject_and_release(order: dict, reason: str) -> dict | None:
    closed = await asyncio.to_thread(
        repository.claim_close, order["id"], OrderStatus.rejected, None, reason
    )
    if closed is None:
        return None
    await release_reservation(closed)
    logger.info("Rejected order %s: %s", order["id"], reason)
    return await asyncio.to_thread(repository.get_order_unscoped, order["id"])


async def _settle_fill(order: dict, effect: FillEffect) -> None:
    """Move the cash, then move the position. One path for every fill.

    There used to be two, `_settle_buy` and `_settle_sell`, and the split is what let a
    leveraged round trip mint money: the buy took only its margin out of the wallet while
    the sell credited the *full* proceeds back in, so buying and selling at one unchanged
    price left the account richer by most of the notional. With a signed position there is
    one formula (`money.apply_fill`) and the wallet moves by what that formula says, which
    is the margin released plus the P&L realized — never the gross proceeds.

    Cash first, position second, deliberately: if this process dies between the two the
    user is out the cash and missing the position, which the trade record can repair. The
    other order would hand out a position nothing was paid for.
    """
    uid, order_id = order["uid"], order["id"]
    currency = _wallet_currency(order)
    reserved: Decimal = order.get("reserved_amount", ZERO)
    available_delta, reserved_delta = wallet_delta(reserved, effect)

    await asyncio.to_thread(repository.ensure_wallet, uid, currency)
    entry = await asyncio.to_thread(
        repository.apply_to_wallet,
        uid,
        currency,
        available_delta=available_delta,
        reserved_delta=reserved_delta,
        kind=LedgerKind.trade_credit
        if effect.cash_delta >= 0
        else LedgerKind.trade_debit,
        require_reserved=reserved if reserved > 0 else None,
        order_id=order_id,
    )
    if entry is None:
        # Unreachable while the settlement lock holds and `_fund_cash_leg` has run. If it
        # ever fires, the order says filled and the cash did not move — loud, not silent.
        logger.critical(
            "Order %s filled but its %s reservation of %s could not be consumed",
            order_id,
            currency,
            reserved,
        )

    await asyncio.to_thread(
        repository.ensure_position,
        uid,
        order["asset_class"],
        order["symbol"],
        order["currency"],
        order.get("position_side"),
    )
    reserved_quantity: Decimal = order.get("reserved_quantity", ZERO)
    applied = await asyncio.to_thread(
        repository.apply_fill_to_position,
        uid,
        order["asset_class"],
        order["symbol"],
        effect,
        position_side=order.get("position_side"),
        require_reserved_quantity=reserved_quantity if reserved_quantity > 0 else None,
    )
    if applied is None:
        logger.critical(
            "Order %s filled but %s units of %s were not reserved on the position",
            order_id,
            reserved_quantity,
            order["symbol"],
        )


# --------------------------------------------------------------------------- #
# Margin liquidation
# --------------------------------------------------------------------------- #


async def liquidate_position(
    uid: str,
    asset_class: AssetClass,
    symbol: str,
    mark: Mark,
    position_side: str | None = None,
) -> dict | None:
    """Force-close a leveraged position whose margin has run out, at the current mark.

    Called by `TradingEngine` when `margin_used + unrealized P&L <= 0` for this holding —
    never by a route, and never on the caller's behalf, which is why this bypasses
    `assert_can_trade`/`assert_product_enabled`/the notional band entirely: those gate a
    user opening or growing a position, not the venue closing one down before it goes
    further underwater. It reuses the ordinary order path end to end (`_reserve_for`,
    `execute`) rather than settling by hand, so a liquidation is accounted exactly like any
    other fill — `apply_fill` releases this position's margin the same way either way.

    Works in both directions: a long is sold out of, a short is bought back. A short is the
    side that needs this most, since its loss is not bounded by the price reaching zero.
    """
    position = await asyncio.to_thread(
        repository.get_position, uid, asset_class.value, symbol, position_side
    )
    if position is None or position["available_quantity"] == 0:
        return None

    # Whichever way the position faces, closing it is an order the other way. A long is
    # sold out of; a short is bought back. `available_quantity` is signed, so its sign is
    # the whole decision and its magnitude is the size.
    free: Decimal = position["available_quantity"]
    closing_side = OrderSide.sell if free > 0 else OrderSide.buy
    quantity = abs(free)

    rate = await fx.rate_for(mark.currency)
    notional = fx.convert(
        notional_of(quantity, mark.execution_price(closing_side)), rate
    )

    now = _now()
    doc = {
        "_id": repository.new_id(),
        "uid": uid,
        "client_order_id": f"liquidation-{repository.new_id()}",
        "asset_class": asset_class.value,
        "symbol": symbol,
        "side": closing_side.value,
        "position_side": position_side,
        "type": OrderType.market.value,
        "time_in_force": TimeInForce.ioc.value,
        "status": OrderStatus.open.value,
        "funded": False,
        "currency": mark.currency,
        "account_currency": TRADING_ACCOUNT_CURRENCY,
        "fx_rate": rate,
        "quantity": quantity,
        "filled_quantity": ZERO,
        "limit_price": None,
        "stop_price": None,
        "triggered": False,
        "average_price": None,
        "filled_notional": None,
        "fee": ZERO,
        # Closing a long promises the stock; closing a short needs cash to buy it back, and
        # the margin already posted is what that cash comes out of.
        "reserved_amount": ZERO
        if closing_side is OrderSide.sell
        else money(margin_of(notional) + fee_for(notional)),
        "reserved_quantity": quantity if closing_side is OrderSide.sell else ZERO,
        "reject_reason": None,
        "liquidation": True,
        "created_at": now,
        "updated_at": now,
        "expires_at": None,
        "closed_at": None,
    }
    order = await asyncio.to_thread(repository.create_order, doc)
    await _reserve_for(order, order["reserved_amount"], order["reserved_quantity"])
    await asyncio.to_thread(repository.mark_funded, order["id"])
    order["funded"] = True

    filled = await execute(order, mark)
    if filled is not None:
        logger.warning(
            "Margin call: liquidated %s %s for %s at %s",
            order["quantity"],
            symbol,
            uid,
            mark.last,
        )
        return filled

    # The mark went stale or untradable between the caller's snapshot and here — the same
    # race `place_order` handles for an ordinary IOC order, closed the same way.
    return await close_and_release(
        order["id"],
        OrderStatus.cancelled,
        "Margin call could not fill against the current price",
    )


# --------------------------------------------------------------------------- #
# Funding
# --------------------------------------------------------------------------- #


def _assert_funding_allowed(user: dict) -> None:
    """Money in and money out sit behind the same gate as trading — whatever that gate
    currently is. When `TRADING_OPEN_ACCESS` is enabled `assert_can_trade` never blocks,
    so a deposit or a withdrawal needs nothing beyond a verified Firebase token, same as an
    order does. With the flag off, this is the anti-money-laundering check it was written
    as: crediting an account before it is identified is exactly what that rule exists to
    prevent, and it costs nothing here to refuse it.
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


async def _move_funds(
    uid: str, payload: FundsRequest, kind: LedgerKind, credit: bool
) -> dict:
    """Idempotent by construction.

    The key is claimed before the balance moves and completed after, so a replay can tell
    "already done" (return the original entry) from "the first attempt never finished"
    (refuse, rather than guess). A retried deposit that credits twice is the one bug in
    this module nobody would notice until the numbers stopped adding up.
    """
    scope = kind.value
    # `FundsRequest` has already refused anything that is not the account currency, so this
    # is the one balance either direction can move.
    currency = payload.currency.value if payload.currency else TRADING_ACCOUNT_CURRENCY
    existing = await asyncio.to_thread(
        repository.claim_key, uid, scope, payload.idempotency_key
    )
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
        # Unconditionally, not just on a credit: a new account's opening balance arrives
        # with the wallet, so a withdrawal can be the first thing it ever does.
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
        await asyncio.to_thread(
            repository.release_key, uid, scope, payload.idempotency_key
        )
        raise

    if entry is None:
        await asyncio.to_thread(
            repository.release_key, uid, scope, payload.idempotency_key
        )
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
    """Every wallet on the account, the account currency first.

    `ensure_wallet` runs here rather than only on the first order, so a brand-new account
    reads back its opening balance instead of an empty list — the balance exists from the
    moment someone looks, which is the only version of "you start with 1000" that a client
    can render without placing a trade first.
    """
    repository.ensure_wallet(uid, TRADING_ACCOUNT_CURRENCY)
    rows = [_balance(doc) for doc in repository.list_balances(uid)]
    rows.sort(key=lambda row: (row.currency != TRADING_ACCOUNT_CURRENCY, row.currency))
    return rows


def _position(doc: dict) -> Position:
    net = money(doc["available_quantity"] + doc["reserved_quantity"])
    basis_quote = doc.get("cost_basis_quote", doc["cost_basis"])
    return Position(
        asset_class=AssetClass(doc["asset_class"]),
        symbol=doc["symbol"],
        currency=doc["currency"],
        # Absent on a position opened before the balance became universal, whose basis is in
        # the instrument's own currency — labelling it USDT would be a quiet lie.
        account_currency=doc.get("account_currency") or doc["currency"],
        position_side=doc.get("position_side"),
        direction=_direction(net),
        quantity=net,
        available_quantity=doc["available_quantity"],
        reserved_quantity=doc["reserved_quantity"],
        # Break-even in the currency the market quotes, so it is comparable with
        # `last_price`. Dividing two signed numbers gives a positive price on both sides.
        average_price=money(basis_quote / net) if net != 0 else None,
        cost_basis=doc["cost_basis"],
        margin_used=doc["margin_used"],
        realized_pnl=doc["realized_pnl"],
        updated_at=doc["updated_at"],
    )


def positions(uid: str, include_flat: bool = False) -> list[Position]:
    return [_position(doc) for doc in repository.list_positions(uid, include_flat)]


def position(
    uid: str, asset_class: str, symbol: str, position_side: str | None = None
) -> Position | None:
    doc = repository.get_position(uid, asset_class, symbol, position_side)
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
    """Positions marked against the live feeds, totalled in the account currency.

    There is a grand total now, and the reason there was not one before has genuinely gone
    away rather than been papered over: every position's cash leg is already converted, so
    `equity` adds numbers that are all in the same unit instead of pretending INR and USDT
    are interchangeable. Each row still reports the price in the currency its market quotes,
    with the `fx_rate` that valued it, so the conversion is visible rather than implied.
    """
    held = await asyncio.to_thread(positions, uid)
    cash_rows = await asyncio.to_thread(balances, uid)

    # Marks and rates in one gather: a portfolio of Indian equities needs one rate, not one
    # per position, and `fx.rate_for` caches so the duplicates collapse.
    marks = await asyncio.gather(
        *(pricing.mark_or_none(p.asset_class, p.symbol) for p in held)
    )
    rates = await asyncio.gather(
        *(_rate_or_none(p.currency) for p in held), return_exceptions=False
    )

    valued: list[PositionValuation] = []
    market_value = ZERO
    unrealized = ZERO
    realized = ZERO
    margin_used = ZERO
    by_currency: dict[str, Decimal] = {}
    unrealized_by_currency: dict[str, Decimal] = {}
    realized_by_currency: dict[str, Decimal] = {}

    for position, mark, rate in zip(held, marks, rates):
        realized = money(realized + position.realized_pnl)
        margin_used = money(margin_used + position.margin_used)
        realized_by_currency[TRADING_ACCOUNT_CURRENCY] = money(
            realized_by_currency.get(TRADING_ACCOUNT_CURRENCY, ZERO)
            + position.realized_pnl
        )
        row = PositionValuation(**position.model_dump())
        if mark is not None and rate is not None:
            # Signed, so a short contributes negative value and summing gives net exposure.
            value = fx.convert(money(position.quantity * mark.last), rate)
            pnl = money(value - position.cost_basis)
            row.last_price = mark.last
            row.fx_rate = rate
            row.market_value = value
            row.unrealized_pnl = pnl
            # Against the cash actually posted, not against the basis: at 200x a 1% move is
            # a 200% swing on what the position tied up, and that is the number that matters.
            row.unrealized_pnl_percent = (
                percent_change(money(position.margin_used + pnl), position.margin_used)
                if position.margin_used > 0
                else None
            )
            row.market_state = mark.market_state
            row.stale = mark.stale
            market_value = money(market_value + value)
            unrealized = money(unrealized + pnl)
            by_currency[TRADING_ACCOUNT_CURRENCY] = money(
                by_currency.get(TRADING_ACCOUNT_CURRENCY, ZERO) + value
            )
            unrealized_by_currency[TRADING_ACCOUNT_CURRENCY] = money(
                unrealized_by_currency.get(TRADING_ACCOUNT_CURRENCY, ZERO) + pnl
            )
        valued.append(row)

    cash = money(
        sum(
            (
                row.total
                for row in cash_rows
                if row.currency == TRADING_ACCOUNT_CURRENCY
            ),
            ZERO,
        )
    )
    free_margin = money(
        sum(
            (
                row.available
                for row in cash_rows
                if row.currency == TRADING_ACCOUNT_CURRENCY
            ),
            ZERO,
        )
    )
    priced = sum(1 for row in valued if row.market_value is not None)
    return Portfolio(
        uid=uid,
        account_currency=TRADING_ACCOUNT_CURRENCY,
        balances=cash_rows,
        positions=valued,
        cash=cash,
        market_value=market_value,
        # Opening a position moves its margin *out* of the wallet — `available` and
        # `reserved` both drop and `margin_used` on the position picks it up — so equity has
        # to add the collateral back before applying what the position has done since.
        # `market_value` is exposure, not ownership: under margin it is many times the cash
        # committed, and adding it here would report an account many times its real size.
        equity=money(cash + margin_used + unrealized),
        unrealized_pnl=unrealized,
        realized_pnl=realized,
        margin_used=margin_used,
        free_margin=free_margin,
        market_value_by_currency=by_currency,
        unrealized_pnl_by_currency=unrealized_by_currency,
        realized_pnl_by_currency=realized_by_currency,
        priced=priced,
        unpriced=len(valued) - priced,
        at=_now(),
    )


async def _rate_or_none(currency: str) -> Decimal | None:
    """Best-effort conversion rate, for valuing a portfolio.

    A position whose currency cannot be priced right now is reported unpriced rather than
    failing the whole request — the same courtesy `pricing.mark_or_none` extends to a feed
    that is down. The holding is real either way; only the valuation is missing.
    """
    try:
        return await fx.rate_for(currency)
    except HTTPException as exc:
        logger.info("No FX rate for %s: %s", currency, exc.detail)
    except Exception as exc:
        logger.warning("Rating %s failed: %s", currency, exc)
    return None


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
