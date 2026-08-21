"""REST surface over a single in-process `Exchange`.

Request bodies are bounded on every numeric field. An exchange API is the definition of
a trust boundary -- an unbounded amount is how you end up with a 10^40 USDT order that
overflows a Decimal context three layers down instead of getting a 422 at the door.

Responses reuse the domain models from `models.py` directly, so there is one definition
of an order and no hand-written serialisation to drift out of sync.

    uvicorn usdt_sim.api:app --reload
"""

from __future__ import annotations

import os
from decimal import Decimal
from typing import Literal

from fastapi import FastAPI, Path, Query, status
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from .config import CHAINS, DEFAULT_CHAIN
from .exchange import Exchange
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

Chain = Literal["TRC20", "ERC20"]
assert set(CHAINS) == {"TRC20", "ERC20"}, "Chain literal is out of step with config.CHAINS"

_MAX_USDT = Decimal("100000000")
_MAX_QTY = Decimal("1000000")
_MAX_PRICE = Decimal("100000000")

app = FastAPI(
    title="USDT Exchange Simulator",
    version="1.0.0",
    summary="Deposits, spot trading, P/L and withdrawals against a simulated USDT venue.",
)

# One process, one exchange, all in memory. Seed it for a reproducible session.
_seed = os.environ.get("USDT_SIM_SEED")
exchange = Exchange(seed=int(_seed) if _seed else None)


@app.exception_handler(SimError)
async def _handle_sim_error(_request, error: SimError) -> JSONResponse:
    return JSONResponse(
        status_code=error.status_code,
        content={"error": type(error).__name__, "detail": str(error)},
    )


# --- request bodies ---------------------------------------------------------
class DepositRequest(BaseModel):
    amount_usdt: Decimal = Field(gt=0, le=_MAX_USDT)
    chain: Chain = DEFAULT_CHAIN
    auto_confirm: bool = Field(
        default=True,
        description="False leaves the deposit pending until POST /deposits/{tx_hash}/confirm",
    )


class ConfirmRequest(BaseModel):
    blocks: int = Field(default=1, ge=1, le=10_000)


class OrderRequest(BaseModel):
    symbol: str = Field(min_length=2, max_length=20, examples=["BTC/USDT"])
    side: Side
    type: OrderType = OrderType.MARKET
    quantity: Decimal | None = Field(default=None, gt=0, le=_MAX_QTY)
    quote_amount: Decimal | None = Field(
        default=None, gt=0, le=_MAX_USDT, description="Size a buy in USDT instead of base units"
    )
    limit_price: Decimal | None = Field(default=None, gt=0, le=_MAX_PRICE)


class CloseRequest(BaseModel):
    type: OrderType = OrderType.MARKET
    limit_price: Decimal | None = Field(default=None, gt=0, le=_MAX_PRICE)
    quantity: Decimal | None = Field(
        default=None, gt=0, le=_MAX_QTY, description="Omit to close the whole position"
    )


class WithdrawRequest(BaseModel):
    address: str = Field(min_length=26, max_length=64)
    amount_usdt: Decimal = Field(gt=0, le=_MAX_USDT)
    chain: Chain | None = Field(default=None, description="Inferred from the address if omitted")


class TickRequest(BaseModel):
    steps: int = Field(default=1, ge=1, le=10_000, description="One step is five minutes")


# --- response bodies --------------------------------------------------------
class DepositAddressResponse(BaseModel):
    address: str
    chain: str
    asset: str
    min_deposit_usdt: Decimal
    required_confirmations: int
    qr_payload: str
    qr_svg_data_uri: str


class MarketQuote(BaseModel):
    symbol: str
    base: str
    quote: str
    mid: Decimal
    bid: Decimal
    ask: Decimal
    spread_bps: int
    min_quantity: Decimal
    step_size: Decimal
    tick_size: Decimal


class TickResponse(BaseModel):
    ticks: int
    markets: list[MarketQuote]
    filled_orders: list[Order]


# --- funding ----------------------------------------------------------------
@app.get("/balance", response_model=Balance, tags=["funding"])
def get_balance(chain: Chain = DEFAULT_CHAIN) -> Balance:
    return exchange.balance(chain)


@app.get("/deposit/address", response_model=DepositAddressResponse, tags=["funding"])
def get_deposit_address(chain: Chain = DEFAULT_CHAIN, rotate: bool = False) -> dict:
    """The deposit address plus a scannable QR code as an inline SVG data URI."""
    if rotate:
        exchange.deposit_address(chain, rotate=True)
    return exchange.deposit_qr(chain)


@app.post(
    "/deposit", response_model=Deposit, status_code=status.HTTP_201_CREATED, tags=["funding"]
)
def create_deposit(body: DepositRequest) -> Deposit:
    """Mock an inbound USDT transfer to our deposit address."""
    return exchange.deposit(body.amount_usdt, body.chain, auto_confirm=body.auto_confirm)


@app.post("/deposits/{tx_hash}/confirm", response_model=Deposit, tags=["funding"])
def confirm_deposit(
    body: ConfirmRequest, tx_hash: str = Path(min_length=8, max_length=66)
) -> Deposit:
    """Add block confirmations; the balance is credited when the threshold is reached."""
    return exchange.confirm_deposit(tx_hash, body.blocks)


@app.get("/deposits", response_model=list[Deposit], tags=["funding"])
def list_deposits() -> list[Deposit]:
    return exchange.deposits()


@app.post(
    "/withdraw", response_model=Withdrawal, status_code=status.HTTP_201_CREATED, tags=["funding"]
)
def create_withdrawal(body: WithdrawRequest) -> Withdrawal:
    """Validate the destination address and lock amount + network fee."""
    return exchange.withdraw(body.address, body.amount_usdt, body.chain)


@app.post("/withdrawals/process", response_model=list[Withdrawal], tags=["funding"])
def process_withdrawals(
    withdrawal_id: str | None = Query(default=None, max_length=32),
    until_settled: bool = False,
) -> list[Withdrawal]:
    """Advance the queue one stage (pending -> processing -> completed/failed)."""
    return exchange.process_withdrawals(withdrawal_id, until_settled=until_settled)


@app.get("/withdrawals", response_model=list[Withdrawal], tags=["funding"])
def list_withdrawals() -> list[Withdrawal]:
    return exchange.withdrawals()


# --- market data ------------------------------------------------------------
@app.get("/markets", response_model=list[MarketQuote], tags=["market"])
def list_markets() -> list[dict]:
    return exchange.markets()


@app.post("/tick", response_model=TickResponse, tags=["market"])
def advance_market(body: TickRequest) -> dict:
    """Move prices forward and fill any resting limit order the market went through."""
    filled = exchange.tick(body.steps)
    return {"ticks": exchange.feed.ticks, "markets": exchange.markets(), "filled_orders": filled}


# --- trading ----------------------------------------------------------------
@app.post("/order", response_model=Order, status_code=status.HTTP_201_CREATED, tags=["trading"])
def create_order(body: OrderRequest) -> Order:
    return exchange.place_order(
        body.symbol,
        body.side,
        quantity=body.quantity,
        order_type=body.type,
        limit_price=body.limit_price,
        quote_amount=body.quote_amount,
    )


@app.get("/orders", response_model=list[Order], tags=["trading"])
def list_orders(
    order_status: OrderStatus | None = Query(default=None, alias="status"),
) -> list[Order]:
    return exchange.orders(order_status)


@app.delete("/order/{order_id}", response_model=Order, tags=["trading"])
def cancel_order(order_id: str = Path(min_length=3, max_length=32)) -> Order:
    return exchange.cancel_order(order_id)


@app.get("/positions", response_model=list[PositionSummary], tags=["trading"])
def list_positions() -> list[PositionSummary]:
    """Open positions marked at the bid, with unrealized P/L net of the entry fee."""
    return exchange.positions()


@app.post(
    "/positions/{symbol:path}/close",
    response_model=Order,
    status_code=status.HTTP_201_CREATED,
    tags=["trading"],
)
def close_position(body: CloseRequest, symbol: str = Path(min_length=2, max_length=20)) -> Order:
    return exchange.close_position(
        symbol, order_type=body.type, limit_price=body.limit_price, quantity=body.quantity
    )


@app.get("/trades", response_model=list[Fill], tags=["trading"])
def list_trades() -> list[Fill]:
    return exchange.trades()


@app.get("/portfolio", response_model=Portfolio, tags=["trading"])
def get_portfolio() -> Portfolio:
    """Equity, realized and unrealized P/L in both USDT and USD."""
    return exchange.portfolio()


# --- audit ------------------------------------------------------------------
@app.get("/history", response_model=list[Event], tags=["audit"])
def get_history(
    kind: str | None = Query(
        default=None,
        max_length=40,
        description="Filter by event type or dotted prefix: deposit, order, withdrawal, error",
    ),
    limit: int = Query(default=200, ge=1, le=2000),
) -> list[Event]:
    """The audit trail, oldest first."""
    return exchange.history(kind, limit)
