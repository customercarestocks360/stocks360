"""Trading endpoints: funding, orders, fills, positions and the portfolio.

Every route is authenticated and every query is scoped to the caller's uid, so an order id
belonging to someone else reads as a plain `404` rather than a `403` — the same rule the
watchlists follow, for the same reason: a 403 confirms the thing exists.

Every route is `async def` because pricing is async, which means the blocking pymongo work
has to be pushed to a thread explicitly. A bare repository call here would stall the event
loop, and with it every market-data socket this process is serving.

`TRADING_ENABLED=false` stops new activity — orders, deposits, withdrawals — and leaves
the reads working. Being unable to place an order is a policy decision; being unable to
see your own balance while one is disabled is just a broken account page.
"""

import asyncio
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from starlette import status

from app.auth.dependencies import get_current_user
from app.core.config import (
    TRADING_FEE_BPS,
    TRADING_MAX_OPEN_ORDERS,
    TRADING_PRICE_BAND_PERCENT,
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
    FundsRequest,
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
from app.trading import repository, service

router = APIRouter(prefix="/trading", tags=["trading"])


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
    summary="Cash by currency",
    description="`reserved` is locked by open buy orders and cannot be spent or withdrawn "
    "until they fill or are cancelled.",
)
async def get_balances(claims: dict = Depends(get_current_user)):
    return await asyncio.to_thread(service.balances, claims["uid"])


# --------------------------------------------------------------------------- #
# Funding
# --------------------------------------------------------------------------- #


@router.post(
    "/deposits",
    response_model=LedgerEntry,
    status_code=status.HTTP_201_CREATED,
    responses={**UNAUTHORIZED, **NOT_ELIGIBLE, **ORDER_REJECTED, **UNAVAILABLE},
    summary="Credit the account (simulated)",
    description="**This moves no real money.** There is no payment provider behind it — it "
    "credits book money so the rest of the system can be exercised. It is gated behind "
    "completed onboarding anyway, because crediting an unidentified account is the exact "
    "step the KYC funnel exists to prevent.\n\n"
    "`idempotency_key` is required. Replaying one returns the original ledger entry "
    "instead of crediting twice, which is what makes a timed-out request safe to retry.",
)
async def create_deposit(payload: FundsRequest, claims: dict = Depends(get_current_user)):
    return await service.deposit(claims["uid"], payload)


@router.post(
    "/withdrawals",
    response_model=LedgerEntry,
    status_code=status.HTTP_201_CREATED,
    responses={**UNAUTHORIZED, **NOT_ELIGIBLE, **ORDER_REJECTED, **UNAVAILABLE},
    summary="Debit the account (simulated)",
    description="The mirror of a deposit, and equally simulated — nothing is paid out. "
    "Only `available` cash can be withdrawn; funds reserved against open orders are not "
    "available until those orders close.",
)
async def create_withdrawal(payload: FundsRequest, claims: dict = Depends(get_current_user)):
    return await service.withdraw(claims["uid"], payload)


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
    currency: str | None = Query(default=None, min_length=2, max_length=10, examples=["USDT"]),
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

**What is checked, in order.** Onboarding complete and KYC tier reached; the instrument
exists on that feed and settles in a currency this venue holds; the product it needs
(`crypto_spot`, `forex`, `domestic_equity_delivery` or `foreign_equity`) is enabled on
your account; any price you supplied is within {TRADING_PRICE_BAND_PERCENT}% of the last
trade and a stop sits on the side it can be reached from; the notional is inside the
per-order bounds; and finally the cash or the units are locked, atomically, which is where
insufficient funds is reported.

**Execution.** Fills are all-or-nothing at one price — simulating anything else would mean
inventing depth the feeds do not publish. A buy pays the ask and a sell hits the bid where
the feed publishes both (crypto and forex); the equity feed publishes only a last traded
price, so that is what is used. Commission is {TRADING_FEE_BPS} bps of notional, charged
in the quote currency.

**Nothing fills against a closed or stale market.** A market order into one is a `409`; a
resting order simply waits, which is why a limit order may be placed out of hours.

**Selling is bounded by what you hold.** This is long-only spot: there is no short selling
and no margin, so a sell reserves units from your position exactly as a buy reserves cash.

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
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Order not found")
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
    description="Quantities are in base units — `BTCUSDT` counts BTC, `EUR-USD` counts "
    "EUR — and `average_price` is the cost basis per unit with the entry commission "
    "included, so it is the real break-even rather than the price on the ticket. Closed "
    "positions are hidden unless you ask for them with `?include_flat=true`.",
)
async def list_positions(
    claims: dict = Depends(get_current_user),
    include_flat: bool = Query(default=False, description="Include positions sold down to zero"),
):
    return await asyncio.to_thread(service.positions, claims["uid"], include_flat)


@router.get(
    "/positions/{asset_class}/{symbol}",
    response_model=Position,
    responses={**UNAUTHORIZED, **NOT_FOUND, **UNAVAILABLE},
    summary="One position",
)
async def get_position(
    asset_class: AssetClass, symbol: str, claims: dict = Depends(get_current_user)
):
    found = await asyncio.to_thread(
        service.position, claims["uid"], asset_class.value, _normalized(asset_class, symbol)
    )
    if found is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No such position")
    return found


@router.get(
    "/portfolio",
    response_model=Portfolio,
    responses={**UNAUTHORIZED, **UNAVAILABLE},
    summary="Positions marked to market",
    description="Everything you hold, valued against the live feeds, with cash alongside. "
    "A position whose feed is down comes back unpriced rather than failing the request — "
    "the holding is still real, only the mark is missing.\n\n"
    "Totals are **per currency**, and there is deliberately no grand total: adding INR to "
    "USDT needs an FX rate this API has no licensed source for, and a made-up total is "
    "worse than none.",
)
async def get_portfolio(claims: dict = Depends(get_current_user)):
    return await service.portfolio(claims["uid"])
