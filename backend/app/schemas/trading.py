"""Trading: orders, fills, positions, cash and the ledger.

One order model spans all three feeds. The differences between crypto, forex and equities
are real but they are about *pricing* and *permission*, not about what an order is — so
`asset_class` selects the symbol grammar, the product the caller must hold, and where the
price comes from, and everything downstream of that is identical.

Two shapes worth understanding before reading the fields:

* **Cash is per settlement currency, positions are per instrument.** Buying `BTCUSDT`
  spends USDT and gives you a position in `BTCUSDT` measured in base units; selling it
  gives the USDT back. So a wallet currency is only ever an instrument's *quote* currency,
  which is why an instrument settled in something this venue does not hold is refused.
* **Money is `Decimal` end to end** and serialises as a JSON string, the same as every
  price elsewhere in this API. A float round-trip on a balance is not a rounding
  inconvenience, it is a wrong number in someone's account.
"""

from datetime import datetime
from decimal import Decimal
from enum import Enum
from typing import Annotated, Any

from pydantic import (
    BaseModel,
    BeforeValidator,
    ConfigDict,
    Field,
    PlainSerializer,
    StringConstraints,
    model_validator,
)

from app.schemas.common import ErrorResponse
from app.schemas.crypto import SYMBOL_PATTERN as _CRYPTO_SYMBOL_PATTERN
from app.schemas.forex import PAIR_PATTERN as _FOREX_PAIR_PATTERN, normalize_pair
from app.schemas.onboarding import KycTier, OnboardingStatus, Product
from app.schemas.stocks import SYMBOL_PATTERN as _STOCK_SYMBOL_PATTERN
from app.schemas.stocks import normalize_symbol as _normalize_stock_symbol

# --------------------------------------------------------------------------- #
# Enums — every choice a client may send is closed, so an unknown value is a 422
# --------------------------------------------------------------------------- #


class AssetClass(str, Enum):
    crypto = "crypto"
    forex = "forex"
    stocks = "stocks"


class OrderSide(str, Enum):
    buy = "buy"
    sell = "sell"


class OrderType(str, Enum):
    market = "market"
    limit = "limit"
    stop = "stop"
    stop_limit = "stop_limit"


class TimeInForce(str, Enum):
    """`fok` is deliberately absent: this venue fills an order in full or not at all, so
    fill-or-kill and immediate-or-cancel would be the same instruction under two names."""

    gtc = "gtc"  # rests until filled or cancelled
    day = "day"  # rests until the session it was placed in ends
    ioc = "ioc"  # fills against the current price or is cancelled on the spot


class OrderStatus(str, Enum):
    """There is no `partially_filled`: a fill takes the whole order at one price, because
    simulating anything else means inventing depth the feed does not publish."""

    open = "open"
    filled = "filled"
    cancelled = "cancelled"
    expired = "expired"
    rejected = "rejected"


class MarketState(str, Enum):
    open = "open"
    closed = "closed"
    unknown = "unknown"


class SettlementCurrency(str, Enum):
    """What this venue will hold as cash.

    An instrument is tradable only if its quote currency is in this set, which is what
    keeps a wallet from accumulating some illiquid asset as though it were money — a pair
    quoted in BTC is a perfectly good market and still not somewhere to keep a balance.
    """

    USD = "USD"
    EUR = "EUR"
    GBP = "GBP"
    JPY = "JPY"
    CHF = "CHF"
    AUD = "AUD"
    CAD = "CAD"
    NZD = "NZD"
    INR = "INR"
    AED = "AED"
    SGD = "SGD"
    HKD = "HKD"
    CNY = "CNY"
    ZAR = "ZAR"
    BRL = "BRL"
    USDT = "USDT"
    USDC = "USDC"


SETTLEMENT_CURRENCIES: frozenset[str] = frozenset(c.value for c in SettlementCurrency)


def _upper(value: Any) -> Any:
    """Normalise before the enum is matched, so `usdt` is accepted as `USDT` — the same
    courtesy the onboarding country codes extend."""
    return value.strip().upper() if isinstance(value, str) else value


# A currency the caller names, rather than one the venue derived from an instrument.
Settles = Annotated[SettlementCurrency, BeforeValidator(_upper)]


class LedgerKind(str, Enum):
    deposit = "deposit"
    withdrawal = "withdrawal"
    reserve = "reserve"          # available -> reserved, on placing a buy
    release = "release"          # reserved -> available, on cancel or expiry
    trade_debit = "trade_debit"  # reserved -> gone, paying for a buy
    trade_credit = "trade_credit"  # sale proceeds, net of fee
    fee = "fee"


# --------------------------------------------------------------------------- #
# Constrained types
# --------------------------------------------------------------------------- #

# 8 decimal places is the satoshi-level floor every feed here can express, and the scale
# every stored money and quantity value is quantised to. `max_digits` bounds the value
# hard: a Decimal128 carries 34 significant digits, and a quantity times a price has to
# stay inside that.
Quantity = Annotated[
    Decimal,
    Field(gt=0, le=Decimal("1000000000"), max_digits=18, decimal_places=8, examples=["0.05"]),
]
Price = Annotated[
    Decimal,
    Field(gt=0, le=Decimal("1000000000"), max_digits=18, decimal_places=8, examples=["65000.00"]),
]
Money = Annotated[
    Decimal,
    Field(gt=0, le=Decimal("1000000000"), max_digits=18, decimal_places=2, examples=["10000.00"]),
]

OrderId = Annotated[
    str,
    StringConstraints(pattern=r"^[0-9a-f]{32}$"),
    Field(examples=["3d7f1a5c8e2b4f6a9c0d1e2f3a4b5c6d"]),
]
# Client-chosen, so it has to be long enough to be worth deduplicating on and narrow
# enough that it cannot smuggle anything into a log line or an id.
IdempotencyKey = Annotated[
    str,
    StringConstraints(strip_whitespace=True, pattern=r"^[A-Za-z0-9_-]{8,64}$"),
    Field(description="Unique per user; replaying it returns the original outcome"),
]


def _plain(value: Decimal) -> str:
    """Serialise an amount in positional notation, always.

    `str()` on a `Decimal` follows the exponent, so a quantised zero comes out as `0E-8`
    and a one-satoshi fee as `1E-8`. Both are correct decimal literals and both look like
    a bug in an account balance — and a client parsing them by hand rather than through a
    decimal library can easily make them one.
    """
    return format(value, "f")


# Every money and quantity field in a response. Inputs keep their own constrained types;
# this is purely about what goes out on the wire.
Amount = Annotated[Decimal, PlainSerializer(_plain, return_type=str, when_used="json")]


def normalize_symbol(asset_class: AssetClass, symbol: str) -> str:
    """Apply the feed's own symbol grammar, so one order endpoint stays as strict as the
    three market-data endpoints it sits in front of."""
    raw = symbol.strip()
    if asset_class is AssetClass.crypto:
        canonical, pattern = raw.upper(), _CRYPTO_SYMBOL_PATTERN
    elif asset_class is AssetClass.forex:
        canonical, pattern = normalize_pair(raw), _FOREX_PAIR_PATTERN
    else:
        canonical, pattern = _normalize_stock_symbol(raw), _STOCK_SYMBOL_PATTERN
    if not pattern.match(canonical):
        raise ValueError(f"{canonical!r} is not a valid {asset_class.value} symbol")
    return canonical


class _Strict(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")


# --------------------------------------------------------------------------- #
# Requests
# --------------------------------------------------------------------------- #


class OrderRequest(_Strict):
    """The price fields are the only numbers a client gets to choose. Everything else a
    fill depends on — the traded price, the fee, the currency — comes from the server."""

    asset_class: AssetClass
    symbol: str = Field(min_length=2, max_length=32, examples=["BTCUSDT"])
    side: OrderSide
    type: OrderType = Field(default=OrderType.market, examples=["limit"])
    quantity: Quantity
    limit_price: Price | None = Field(default=None, description="Required for limit and stop_limit")
    stop_price: Price | None = Field(default=None, description="Required for stop and stop_limit")
    time_in_force: TimeInForce | None = Field(
        default=None,
        description="Defaults to `ioc` for a market order and `gtc` for anything that can rest",
    )
    client_order_id: str | None = Field(
        default=None,
        pattern=r"^[A-Za-z0-9_-]{8,64}$",
        description="Your own id for this order. Sending the same one twice is a 409 rather "
        "than a second order — the safe thing to do when a placement times out.",
    )

    @model_validator(mode="after")
    def _coherent(self) -> "OrderRequest":
        self.symbol = normalize_symbol(self.asset_class, self.symbol)

        wants_limit = self.type in (OrderType.limit, OrderType.stop_limit)
        wants_stop = self.type in (OrderType.stop, OrderType.stop_limit)
        if wants_limit and self.limit_price is None:
            raise ValueError(f"`limit_price` is required for a {self.type.value} order")
        if not wants_limit and self.limit_price is not None:
            raise ValueError(f"`limit_price` does not apply to a {self.type.value} order")
        if wants_stop and self.stop_price is None:
            raise ValueError(f"`stop_price` is required for a {self.type.value} order")
        if not wants_stop and self.stop_price is not None:
            raise ValueError(f"`stop_price` does not apply to a {self.type.value} order")

        # A market order never rests, so the only time-in-force it can honestly carry is
        # the one that says so. Resolving the default here means the stored order always
        # has a concrete value and nothing downstream has to re-derive it.
        if self.type is OrderType.market:
            if self.time_in_force not in (None, TimeInForce.ioc):
                raise ValueError(
                    "A market order fills immediately or not at all — omit `time_in_force` "
                    "or send `ioc`"
                )
            self.time_in_force = TimeInForce.ioc
        elif self.time_in_force is None:
            self.time_in_force = TimeInForce.gtc

        # A stop is refused unless it sits on the side of the market it can be reached
        # from, so an immediate-or-cancel stop could only ever cancel on arrival.
        if wants_stop and self.time_in_force is TimeInForce.ioc:
            raise ValueError(
                "A stop order waits for its trigger, so `ioc` would cancel it before it "
                "could ever fire"
            )
        return self


class FundsRequest(_Strict):
    """A simulated funding movement. `idempotency_key` is required, not optional: a
    retried deposit that credits twice is the one bug in this file nobody would notice."""

    currency: Settles
    amount: Money
    idempotency_key: IdempotencyKey
    reference: str | None = Field(
        default=None, max_length=128, description="Your own note, echoed back on the ledger entry"
    )


# --------------------------------------------------------------------------- #
# Responses
# --------------------------------------------------------------------------- #


class Order(BaseModel):
    id: str
    client_order_id: str | None = None
    asset_class: AssetClass
    symbol: str
    side: OrderSide
    type: OrderType
    time_in_force: TimeInForce
    status: OrderStatus
    currency: str = Field(description="Quote currency — what the order settles in")
    quantity: Amount
    filled_quantity: Amount
    limit_price: Amount | None = None
    stop_price: Amount | None = None
    triggered: bool = Field(
        default=False, description="A stop order whose stop price has been reached"
    )
    average_price: Amount | None = Field(default=None, description="Traded price, once filled")
    filled_notional: Amount | None = None
    fee: Amount = Field(default=Decimal(0), description="Commission charged, in `currency`")
    reserved_amount: Amount = Field(
        default=Decimal(0), description="Cash still locked by this order"
    )
    reserved_quantity: Amount = Field(
        default=Decimal(0), description="Position units still locked by this order"
    )
    reject_reason: str | None = None
    created_at: datetime
    updated_at: datetime
    expires_at: datetime | None = Field(default=None, description="Set on a `day` order")
    closed_at: datetime | None = Field(
        default=None, description="When it reached a terminal status"
    )


class Trade(BaseModel):
    """One fill. Immutable — this is the record of what actually happened."""

    id: str
    order_id: str
    asset_class: AssetClass
    symbol: str
    side: OrderSide
    currency: str
    quantity: Amount
    price: Amount
    notional: Amount
    fee: Amount
    realized_pnl: Amount | None = Field(
        default=None, description="On a sell: proceeds net of fee, less the average cost sold"
    )
    at: datetime


class Position(BaseModel):
    asset_class: AssetClass
    symbol: str
    currency: str
    quantity: Amount = Field(description="Total held, including units locked by open sells")
    available_quantity: Amount
    reserved_quantity: Amount
    average_price: Amount | None = Field(
        default=None, description="Cost basis per unit, fees included. Null once flat."
    )
    cost_basis: Amount
    realized_pnl: Amount
    updated_at: datetime


class PositionValuation(Position):
    """A position marked against the live feed. The mark fields are null when the feed has
    no usable price right now, which is a different statement from a value of zero."""

    last_price: Amount | None = None
    market_value: Amount | None = None
    unrealized_pnl: Amount | None = None
    unrealized_pnl_percent: Amount | None = None
    market_state: MarketState = MarketState.unknown
    stale: bool = False


class Balance(BaseModel):
    currency: str
    available: Amount = Field(description="Free to spend or withdraw")
    reserved: Amount = Field(
        description="Locked by open buy orders and by pending withdrawal requests. Still "
        "yours, and not spendable until whatever holds it closes."
    )
    total: Amount


class LedgerEntry(BaseModel):
    id: str
    currency: str
    kind: LedgerKind
    amount: Amount = Field(description="Signed, from the point of view of `available`")
    available_after: Amount
    reserved_after: Amount
    order_id: str | None = None
    trade_id: str | None = None
    reference: str | None = None
    at: datetime


class AssetClassEligibility(BaseModel):
    asset_class: AssetClass
    products: list[Product] = Field(description="The products an order here can require")
    enabled: bool
    pending_review: bool = Field(
        default=False, description="Requested during onboarding, waiting on the income proof"
    )
    market_state: MarketState = Field(
        description="Feed-wide state. `unknown` for equities, where it is per exchange."
    )
    reason: str | None = Field(default=None, description="Why it is not tradable, when it is not")


class Eligibility(BaseModel):
    """What the caller may trade, and why not, without having to place an order to find
    out. The same checks the order endpoint runs, in the same order."""

    uid: str
    onboarding_status: OnboardingStatus
    kyc_tier: KycTier
    can_trade: bool
    base_currency: str | None = Field(default=None, description="Declared in the markets step")
    asset_classes: list[AssetClassEligibility]
    at: datetime


class Account(BaseModel):
    uid: str
    base_currency: str | None = None
    onboarding_status: OnboardingStatus
    kyc_tier: KycTier
    enabled_products: list[Product]
    pending_products: list[Product]
    balances: list[Balance]
    open_orders: int
    positions: int
    at: datetime


class Portfolio(BaseModel):
    """Positions marked to market, with cash totalled per currency.

    There is no single grand total, because adding INR to USDT would need an FX rate this
    API does not have a licensed source for. Totals are per currency and honest.
    """

    uid: str
    balances: list[Balance]
    positions: list[PositionValuation]
    market_value_by_currency: dict[str, Amount]
    unrealized_pnl_by_currency: dict[str, Amount]
    realized_pnl_by_currency: dict[str, Amount]
    priced: int = Field(description="Positions the feed could mark right now")
    unpriced: int
    at: datetime


# Reusable OpenAPI blocks for this feature's failure modes.
NOT_ELIGIBLE = {
    403: {
        "model": ErrorResponse,
        "description": "Onboarding incomplete, or the product this instrument needs is not enabled",
    }
}
ORDER_REJECTED = {
    409: {
        "model": ErrorResponse,
        "description": "Insufficient funds or position, market closed, duplicate id, or the "
        "order is no longer open",
    }
}
NO_PRICE = {
    503: {
        "model": ErrorResponse,
        "description": "No usable price for this instrument right now — nothing was placed",
    }
}
