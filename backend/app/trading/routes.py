# ruff: noqa: B008
"""Trading endpoints: orders, fills, positions and the portfolio.

Every route is authenticated and every query is scoped to the caller's uid, so an order id
belonging to someone else reads as a plain `404` rather than a `403` — the same rule the
watchlists follow, for the same reason: a 403 confirms the thing exists.

Every route is `async def` because pricing is async, which means the blocking pymongo work
has to be pushed to a thread explicitly. A bare repository call here would stall the event
loop, and with it every market-data socket this process is serving.

`TRADING_ENABLED=false` stops new order activity and leaves
the reads working. Being unable to place an order is a policy decision; being unable to
see your own balance while one is disabled is just a broken account page.
"""

import asyncio
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from starlette import status

from app.auth.dependencies import get_current_user
from app.core.config import (
    TRADING_ACCOUNT_CURRENCY,
    TRADING_FEE_BPS,
    TRADING_INITIAL_BALANCE,
    TRADING_LEVERAGE,
    TRADING_MAX_OPEN_ORDERS,
    TRADING_MIN_QUANTITY,
    TRADING_OPEN_ACCESS,
    TRADING_PRICE_BAND_PERCENT,
    TRADING_SHORT_SELLING_CLASSES,
)
from app.schemas.common import NOT_FOUND, UNAUTHORIZED, UNAVAILABLE
from app.schemas.trading import (
    NO_PRICE,
    NOT_ELIGIBLE,
    ORDER_REJECTED,
    Account,
    AssetClass,
    Balance,
    Eligibility,
    FxRate,
    HedgeSide,
    LedgerEntry,
    LedgerKind,
    Order,
    OrderId,
    OrderRequest,
    OrderStatus,
    Portfolio,
    Position,
    Trade,
    normalize_symbol,
)
from app.trading import fx, repository, service

router = APIRouter(prefix="/trading", tags=["trading"])

# Rendered into the route descriptions below, so the docs name the asset classes that can
# actually be shorted rather than a list somebody has to remember to update here too.
SHORT_SELLING_LIST = ", ".join(sorted(TRADING_SHORT_SELLING_CLASSES))

# Same idea for the account-level gate: the docs describe whichever mode this deployment is
# actually running, rather than a fixed claim that drifts the moment the env var flips.
if TRADING_OPEN_ACCESS:
    ORDER_CHECKS_INTRO = "The instrument exists on that feed"
    OPEN_ACCESS_NOTE = (
        "`TRADING_OPEN_ACCESS` is on: any authenticated account may place an "
        "order in any instrument on any of the three feeds. Neither onboarding completion, "
        "KYC tier nor a per-product grant is checked — a verified Firebase token is the only "
        "requirement, and it always has been, since every route here sits behind one."
    )
else:
    ORDER_CHECKS_INTRO = (
        "Onboarding complete and KYC tier reached; the product it needs (`crypto_spot`, "
        "`forex`, `domestic_equity_delivery` or `foreign_equity`) is enabled on your "
        "account; the instrument exists on that feed"
    )
    OPEN_ACCESS_NOTE = (
        "This deployment has `TRADING_OPEN_ACCESS=false`, so an instrument is only tradable "
        "if the product it needs was granted or requested during onboarding — see "
        "`GET /trading/eligibility` for what is enabled and why not."
    )


def _normalized(asset_class: AssetClass, symbol: str) -> str:
    try:
        return normalize_symbol(asset_class, symbol)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)
        ) from exc


def _symbol_filter(asset_class: AssetClass | None, symbol: str | None) -> str | None:
    """Stored symbols are canonical, so a filter has to be canonicalised to match one.

    Which grammar applies depends on the asset class; without one, upper-casing is the
    most that can be said, and it is enough for the two feeds whose canonical form is
    already upper case.
    """
    if symbol is None:
        return None
    return _normalized(asset_class, symbol) if asset_class else symbol.strip().upper()


# --------------------------------------------------------------------------- #
# Account
# --------------------------------------------------------------------------- #


@router.get(
    "/account",
    response_model=Account,
    responses={**UNAUTHORIZED, **UNAVAILABLE},
    summary="Account summary",
    description="Who you are to the trading system: the onboarding outcome that decides "
    "what you may trade, every currency balance, and how much is currently open.",
)
async def get_account(claims: dict = Depends(get_current_user)):
    return await asyncio.to_thread(service.account, claims["uid"])


@router.get(
    "/eligibility",
    response_model=Eligibility,
    responses={**UNAUTHORIZED, **UNAVAILABLE},
    summary="What you may trade, and why not",
    description="The same gates `POST /trading/orders` applies, answered up front so a "
    "client can disable a button instead of discovering a `403` when the user presses it. "
    "A product under review is reported separately from one never requested — only one of "
    "those is worth waiting for.",
)
async def get_eligibility(claims: dict = Depends(get_current_user)):
    return await asyncio.to_thread(service.eligibility, claims["uid"])


@router.get(
    "/balances",
    response_model=list[Balance],
    responses={**UNAUTHORIZED, **UNAVAILABLE},
    summary="Your cash balance",
    description=f"""
One balance, in {TRADING_ACCOUNT_CURRENCY}, and it funds every asset class — an order in an
INR- or USD-priced instrument is converted at the live rate and settles here. A new account
opens with {TRADING_INITIAL_BALANCE} {TRADING_ACCOUNT_CURRENCY}, credited the first time
this is read, and it appears in the ledger as an `Opening balance` deposit so the balance
reconciles against the ledger from its very first row.

`reserved` is locked by open orders and by pending withdrawal requests, and cannot be spent
or withdrawn until whatever holds it closes.

The response is a list rather than a single object, and the account currency comes first. A
deployment that ran an older build may still hold a wallet in another currency; those stay
readable and withdrawable rather than being orphaned, but nothing new settles into them.
""",
)
async def get_balances(claims: dict = Depends(get_current_user)):
    return await asyncio.to_thread(service.balances, claims["uid"])


@router.get(
    "/fx-rate",
    response_model=FxRate,
    responses={**UNAUTHORIZED, 409: {"description": "Nothing prices this currency"}},
    summary="Convert a currency into the account balance",
    description=f"""
What one unit of `currency` is worth in {TRADING_ACCOUNT_CURRENCY}, at the same rate an
order in that currency would be funded at right now — this is `app.trading.fx.rate_for`,
the exact function `POST /trading/orders` calls when it prices an instrument that does not
settle in {TRADING_ACCOUNT_CURRENCY}.

It exists for the moment before an order does: `Order.fx_rate` only exists once an order has
been placed, and by then the rate already decided what got funded. A client pricing an INR
equity or a USD forex pair against the one real balance — to show "this needs ~such-and-such
{TRADING_ACCOUNT_CURRENCY}" or to grey out a submit button honestly — has nowhere else to
get that number, and approximating it locally would be exactly the invented conversion this
venue's whole FX design exists to avoid.

Exactly `1` for {TRADING_ACCOUNT_CURRENCY} itself and for anything in
`TRADING_PEGGED_CURRENCIES`, with no network call behind it. A `409` means nothing prices
`currency` against the balance at all — the same refusal placing an order in it would hit.
""",
)
async def get_fx_rate(
    currency: str = Query(min_length=2, max_length=10, examples=["INR"]),
) -> FxRate:
    rate = await fx.rate_for(currency)
    return FxRate(currency=currency.strip().upper(), rate=rate)


@router.get(
    "/ledger",
    response_model=list[LedgerEntry],
    responses={**UNAUTHORIZED, **UNAVAILABLE},
    summary="Cash ledger",
    description="Every movement of every balance, newest first — deposits, withdrawals, "
    "the reservation an order takes, the release when it is cancelled, and each side of a "
    "fill. `amount` is signed from the point of view of `available`, so a reservation "
    "reads as negative even though the money is still yours.",
)
async def get_ledger(
    claims: dict = Depends(get_current_user),
    currency: str | None = Query(
        default=None, min_length=2, max_length=10, examples=["USDT"]
    ),
    kind: LedgerKind | None = Query(default=None),
    limit: int = Query(50, ge=1, le=200),
):
    return await asyncio.to_thread(
        repository.list_ledger,
        claims["uid"],
        limit,
        currency.upper() if currency else None,
        kind.value if kind else None,
    )


# --------------------------------------------------------------------------- #
# Orders
# --------------------------------------------------------------------------- #


@router.post(
    "/orders",
    response_model=Order,
    status_code=status.HTTP_201_CREATED,
    responses={
        **UNAUTHORIZED,
        **NOT_ELIGIBLE,
        404: {"description": "No such instrument on that feed"},
        **ORDER_REJECTED,
        **NO_PRICE,
    },
    summary="Place an order",
    description=f"""
Places an order on one of the three feeds. The response is the order in whatever state it
reached: a market order comes back `filled` or not at all, a limit order that is already
marketable comes back `filled`, and anything else comes back `open` and waits.

**What is checked, in order.** {ORDER_CHECKS_INTRO} and can be priced against your
{TRADING_ACCOUNT_CURRENCY} balance; any price you supplied is within
{TRADING_PRICE_BAND_PERCENT}% of the last trade and a stop sits on the side it can be
reached from; the notional is inside the per-order bounds; short selling is permitted on
that asset class if the order would open a short; and finally the cash or the units are
locked, atomically, which is where insufficient funds is reported.

**Every instrument on all three feeds is tradable — nothing is held back per account.**
{OPEN_ACCESS_NOTE}

**One balance funds everything.** Your account holds a single
{TRADING_ACCOUNT_CURRENCY} balance. An instrument priced in something else — `EUR-USD` in
USD, `RELIANCE.NS` in INR — has its notional converted at the live rate, which is fixed
when the order is placed and returned on the order as `fx_rate` so the same order can never
settle at two different rates. `limit_price`, `stop_price` and `average_price` are in the
instrument's own `currency`; `fee`, `filled_notional` and every balance are in
`account_currency`.

**Execution.** Fills are all-or-nothing at one price — simulating anything else would mean
inventing depth the feeds do not publish. A buy pays the ask and a sell hits the bid where
the feed publishes both (crypto and forex); the equity feed publishes only a last traded
price, so that is what is used. Commission is {TRADING_FEE_BPS} bps of the converted
notional.

**Nothing fills against a closed or stale market.** A market order into one is a `409`; a
resting order simply waits, which is why a limit order may be placed out of hours.

**Both directions, where the market allows one.** A position's `quantity` is signed:
positive long, negative short. A sell against a long reduces it and reserves the units; a
sell with nothing behind it opens a short and reserves cash instead. Shorting is available
on **{SHORT_SELLING_LIST}** and refused on anything else. An order that would carry a position
*through* zero is a `409`: close what is open, then open the other side, so each fill
prices one thing.

**Hedge mode.** Send `position_side=long` or `position_side=short` to target an independent
leg. Buy opens/increases LONG and sell closes it; sell opens/increases SHORT and buy closes
it. Both legs may remain open on the same instrument. Omit the field for legacy one-way
netting behavior.

**Leverage is fixed at {TRADING_LEVERAGE}:1**, every asset class alike and both
directions. Opening locks `notional / {TRADING_LEVERAGE}` plus the fee as margin rather
than the full notional; the cost basis and P&L stay full-notional either way. Closing
returns that margin plus whatever the position realized — never the gross proceeds, which
is what would let a round trip at an unchanged price come back richer than it went in. A
margin-backed position can reach zero equity before the price does, and a short's loss is
not even bounded by the price reaching zero, so the engine watches both and force-closes
what breaches, tagged `liquidation: true` on the order and the trade.

Quantity must be at least {TRADING_MIN_QUANTITY}.

At most {TRADING_MAX_OPEN_ORDERS} orders may rest at once.
""",
)
async def place_order(payload: OrderRequest, claims: dict = Depends(get_current_user)):
    return await service.place_order(claims["uid"], payload)


@router.get(
    "/orders",
    response_model=list[Order],
    responses={**UNAUTHORIZED, **UNAVAILABLE},
    summary="List your orders",
    description="Newest first. Repeat `?status=` to combine states, e.g. "
    "`?status=open&status=filled`.",
)
async def list_orders(
    claims: dict = Depends(get_current_user),
    # Shadows the `status` module inside this function only; nothing here needs it.
    status: Annotated[list[OrderStatus] | None, Query()] = None,
    asset_class: AssetClass | None = Query(default=None),
    symbol: str | None = Query(default=None, min_length=2, max_length=32),
    limit: int = Query(50, ge=1, le=200),
):
    return await asyncio.to_thread(
        repository.list_orders,
        claims["uid"],
        limit,
        [s.value for s in status] if status else None,
        asset_class.value if asset_class else None,
        _symbol_filter(asset_class, symbol),
    )


@router.get(
    "/orders/{order_id}",
    response_model=Order,
    responses={**UNAUTHORIZED, **NOT_FOUND, **UNAVAILABLE},
    summary="One order",
)
async def get_order(order_id: OrderId, claims: dict = Depends(get_current_user)):
    order = await asyncio.to_thread(repository.get_order, claims["uid"], order_id)
    if order is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Order not found"
        )
    return order


@router.delete(
    "/orders/{order_id}",
    response_model=Order,
    responses={**UNAUTHORIZED, **NOT_FOUND, **ORDER_REJECTED, **UNAVAILABLE},
    summary="Cancel an open order",
    description="Returns the cancelled order, with its reservation released. Only an open "
    "order can be cancelled — one that filled a moment earlier is a `409`, not a silent "
    "success, because those are very different outcomes for whoever is watching.",
)
async def cancel_order(order_id: OrderId, claims: dict = Depends(get_current_user)):
    return await service.cancel_order(claims["uid"], order_id)


@router.get(
    "/trades",
    response_model=list[Trade],
    responses={**UNAUTHORIZED, **UNAVAILABLE},
    summary="Your fills",
    description="One record per execution, newest first. `realized_pnl` is present on "
    "sells: proceeds net of commission, less the average cost of the units sold.",
)
async def list_trades(
    claims: dict = Depends(get_current_user),
    asset_class: AssetClass | None = Query(default=None),
    symbol: str | None = Query(default=None, min_length=2, max_length=32),
    limit: int = Query(50, ge=1, le=200),
):
    return await asyncio.to_thread(
        repository.list_trades,
        claims["uid"],
        limit,
        asset_class.value if asset_class else None,
        _symbol_filter(asset_class, symbol),
    )


# --------------------------------------------------------------------------- #
# Positions
# --------------------------------------------------------------------------- #


@router.get(
    "/positions",
    response_model=list[Position],
    responses={**UNAUTHORIZED, **UNAVAILABLE},
    summary="What you hold",
    description=f"""
Quantities are in base units — `BTCUSDT` counts BTC, `EUR-USD` counts EUR — and they are
**signed**: positive is long, negative is short, with `direction` saying which so nothing
has to infer it from a minus sign. Hedge-mode accounts can have separate LONG and SHORT rows
for one instrument; `position_side` identifies the leg.

`average_price` is the cost basis per unit with the entry commission included, in the
instrument's own `currency`, so it is the real break-even and it compares directly against
the price on the screen. `cost_basis`, `margin_used` and `realized_pnl` are in
`account_currency` ({TRADING_ACCOUNT_CURRENCY}).

`reserved_quantity` is units of a long locked by your own resting sell, and is never
negative — a short reserves cash, not stock.

Closed positions are hidden unless you ask for them with `?include_flat=true`.
""",
)
async def list_positions(
    claims: dict = Depends(get_current_user),
    include_flat: bool = Query(
        default=False, description="Include positions sold down to zero"
    ),
):
    return await asyncio.to_thread(service.positions, claims["uid"], include_flat)


@router.get(
    "/positions/{asset_class}/{symbol}",
    response_model=Position,
    responses={**UNAUTHORIZED, **NOT_FOUND, **UNAVAILABLE},
    summary="One position",
)
async def get_position(
    asset_class: AssetClass,
    symbol: str,
    claims: dict = Depends(get_current_user),
    position_side: HedgeSide | None = Query(default=None),
):
    found = await asyncio.to_thread(
        service.position,
        claims["uid"],
        asset_class.value,
        _normalized(asset_class, symbol),
        position_side.value if position_side else None,
    )
    if found is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="No such position"
        )
    return found


@router.get(
    "/portfolio",
    response_model=Portfolio,
    responses={**UNAUTHORIZED, **UNAVAILABLE},
    summary="Positions marked to market",
    description=f"""
Everything you hold, valued against the live feeds, with cash alongside. A position whose
feed or FX rate is unavailable comes back unpriced rather than failing the request — the
holding is still real, only the mark is missing, and `unpriced` counts them.

There **is** a grand total now, in {TRADING_ACCOUNT_CURRENCY}. It used not to exist for an
honest reason — adding INR to USDT needs a rate — and that reason has gone rather than been
papered over: every position's cash leg is converted when the order is placed, so `equity`
adds numbers already in one unit. Each row still carries the `fx_rate` that valued it.

* `cash` — available plus reserved.
* `margin_used` — collateral posted against open positions. Opening a position moves this
  *out* of `cash`, which is why `equity` adds it back.
* `equity` — `cash + margin_used + unrealized_pnl`: what the account is actually worth.
* `market_value` — net signed exposure, longs less shorts. Under {TRADING_LEVERAGE}:1 this
  is many times the cash committed, so it is **not** part of `equity`.
* `free_margin` — available cash, which is what a new position can post.

`*_by_currency` is kept for clients written against the old per-currency shape and now has
a single key.
""",
)
async def get_portfolio(claims: dict = Depends(get_current_user)):
    return await service.portfolio(claims["uid"])
