"""Domain types and errors.

These are pydantic models rather than plain dataclasses on purpose: the REST layer
reuses them verbatim as `response_model`, so there is exactly one definition of what
an order or a deposit is. Decimals serialise to JSON strings, which is what you want
for money -- a float round-trip is how a balance quietly loses a satoshi.
"""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from enum import Enum

from pydantic import BaseModel, Field, computed_field

from .money import ZERO, usdt


# --- errors -----------------------------------------------------------------
class SimError(Exception):
    """Base for every error this package raises on purpose."""

    status_code = 400


class InsufficientFunds(SimError):
    pass


class InvalidAddress(SimError):
    pass


class OrderRejected(SimError):
    pass


class NotFound(SimError):
    status_code = 404


# --- enums ------------------------------------------------------------------
class Side(str, Enum):
    BUY = "buy"
    SELL = "sell"


class OrderType(str, Enum):
    MARKET = "market"
    LIMIT = "limit"


class OrderStatus(str, Enum):
    OPEN = "open"
    PARTIALLY_FILLED = "partially_filled"
    FILLED = "filled"
    CANCELLED = "cancelled"
    REJECTED = "rejected"


class DepositStatus(str, Enum):
    PENDING = "pending"          # seen on chain, not enough confirmations yet
    CREDITED = "credited"        # confirmed and added to the available balance
    ORPHANED = "orphaned"        # reorged away before crediting


class WithdrawalStatus(str, Enum):
    PENDING = "pending"          # requested, funds locked
    PROCESSING = "processing"    # handed to the (simulated) broadcaster
    COMPLETED = "completed"
    FAILED = "failed"


class Liquidity(str, Enum):
    TAKER = "taker"
    MAKER = "maker"


# --- trading ----------------------------------------------------------------
class Fill(BaseModel):
    id: str
    order_id: str
    symbol: str
    side: Side
    quantity: Decimal
    price: Decimal
    notional_usdt: Decimal
    fee_usdt: Decimal
    liquidity: Liquidity
    slippage_bps: Decimal
    realized_pnl_usdt: Decimal | None = None
    timestamp: datetime


class Order(BaseModel):
    id: str
    symbol: str
    side: Side
    type: OrderType
    quantity: Decimal
    limit_price: Decimal | None = None
    status: OrderStatus
    filled_quantity: Decimal = ZERO
    avg_fill_price: Decimal | None = None
    fee_usdt: Decimal = ZERO
    locked_usdt: Decimal = ZERO
    locked_quantity: Decimal = ZERO
    reduce_only: bool = False
    reject_reason: str | None = None
    created_at: datetime
    updated_at: datetime
    fills: list[Fill] = Field(default_factory=list)


class Position(BaseModel):
    """A long spot position: base asset bought and held, priced in USDT.

    `cost_basis_usdt` is what was actually paid for the open quantity, entry fees
    included, so `avg_entry_price` is the real break-even and unrealized P/L is
    already net of the fee that opened it.
    """

    symbol: str
    base: str
    quantity: Decimal
    locked_quantity: Decimal = ZERO
    cost_basis_usdt: Decimal
    realized_pnl_usdt: Decimal = ZERO
    fees_paid_usdt: Decimal = ZERO
    opened_at: datetime

    @computed_field
    @property
    def free_quantity(self) -> Decimal:
        return self.quantity - self.locked_quantity

    @computed_field
    @property
    def avg_entry_price(self) -> Decimal:
        if self.quantity == 0:
            return ZERO
        return usdt(self.cost_basis_usdt / self.quantity)


# --- chain movements --------------------------------------------------------
class Deposit(BaseModel):
    tx_hash: str
    address: str
    chain: str
    amount_usdt: Decimal
    confirmations: int
    required_confirmations: int
    status: DepositStatus
    created_at: datetime
    credited_at: datetime | None = None


class Withdrawal(BaseModel):
    id: str
    address: str
    chain: str
    amount_usdt: Decimal
    fee_usdt: Decimal
    status: WithdrawalStatus
    created_at: datetime
    tx_hash: str | None = None
    completed_at: datetime | None = None
    failure_reason: str | None = None

    @computed_field
    @property
    def total_debit_usdt(self) -> Decimal:
        return self.amount_usdt + self.fee_usdt


# --- audit ------------------------------------------------------------------
class Event(BaseModel):
    """One append-only line of the audit trail.

    `type` is a dotted string (`deposit.credited`, `order.filled`, `error`) so history
    can be filtered by prefix without an enum that needs editing for every new event.
    """

    seq: int
    timestamp: datetime
    type: str
    details: dict = Field(default_factory=dict)


# --- reporting --------------------------------------------------------------
class Balance(BaseModel):
    available_balance_usdt: Decimal
    locked_balance_usdt: Decimal
    total_balance_usdt: Decimal
    total_deposited_usdt: Decimal
    total_withdrawn_usdt: Decimal
    withdrawal_fees_usdt: Decimal
    net_deposited_usdt: Decimal
    deposit_address: str
    chain: str


class PositionSummary(BaseModel):
    symbol: str
    base: str
    quantity: Decimal
    locked_quantity: Decimal
    avg_entry_price: Decimal
    mark_price: Decimal
    cost_basis_usdt: Decimal
    market_value_usdt: Decimal
    unrealized_pnl_usdt: Decimal
    unrealized_pnl_pct: Decimal
    realized_pnl_usdt: Decimal
    fees_paid_usdt: Decimal


class Portfolio(BaseModel):
    usdt_usd_rate: Decimal
    cash_usdt: Decimal
    positions_value_usdt: Decimal
    equity_usdt: Decimal
    equity_usd: Decimal
    unrealized_pnl_usdt: Decimal
    realized_pnl_usdt: Decimal
    fees_paid_usdt: Decimal
    net_deposited_usdt: Decimal
    total_pnl_usdt: Decimal
    total_pnl_usd: Decimal
    total_pnl_pct: Decimal
    positions: list[PositionSummary]
