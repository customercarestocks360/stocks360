"""Trading: orders, fills, positions, cash and the ledger.

One order model spans all three feeds. The differences between crypto, forex and equities
are real but they are about *pricing* and *permission*, not about what an order is — so
`asset_class` selects the symbol grammar, the product the caller must hold, and where the
price comes from, and everything downstream of that is identical.

Three shapes worth understanding before reading the fields:

* **Cash is one balance, positions are per instrument.** There is a single wallet per
  account, in `TRADING_ACCOUNT_CURRENCY` (USDT), and it funds every asset class. An
  instrument priced in something else — `EUR-USD` in USD, `RELIANCE.NS` in INR — has its
  notional converted at the live rate (`app.trading.fx`) and its cash leg settles in the
  account currency. So a user has one number to reason about instead of a wallet per
  market, and an instrument is tradable if its quote currency can be *priced* against the
  account currency rather than *held* as a balance.
* **Prices are in the instrument's quote currency, money is in the account currency.**
  `limit_price`, `stop_price`, `average_price` and `last_price` are quoted the way the
  market quotes them. `fee`, `cost_basis`, `realized_pnl`, `market_value` and every balance
  are USDT. Each field says which it is; mixing them is the mistake this split exists to
  make visible.
* **Position quantity is signed.** Positive is long, negative is short, one document per
  instrument either way. A sell with nothing behind it opens a short where the configured
  asset-class policy allows one (all three desks by default).
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

from app.core.config import TRADING_ACCOUNT_CURRENCY
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


class HedgeSide(str, Enum):
    """The independent leg an order acts on when the account uses hedge mode."""

    long = "long"
    short = "short"


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


# The funds-request `currency` field below only ever accepts the one currency this venue
# holds. A single-member enum — not the full pricing-oriented `SettlementCurrency` — keeps
# every other currency, USD included, out of that field's OpenAPI schema: the venue no
# longer merely rejects "USD" at request time, the schema never offers it as a value.
AccountCurrency = Enum(
    "AccountCurrency", {TRADING_ACCOUNT_CURRENCY: TRADING_ACCOUNT_CURRENCY}, type=str
)
AccountCurrencyField = Annotated[AccountCurrency, BeforeValidator(_upper)]


class LedgerKind(str, Enum):
    deposit = "deposit"
    withdrawal = "withdrawal"
    reserve = "reserve"  # available -> reserved, on placing a buy
    release = "release"  # reserved -> available, on cancel or expiry
    trade_debit = "trade_debit"  # reserved -> gone, paying for a buy
    trade_credit = "trade_credit"  # sale proceeds, net of fee
    fee = "fee"
    adjustment = "adjustment"  # explicit, audited staff correction


# --------------------------------------------------------------------------- #
# Constrained types
# --------------------------------------------------------------------------- #

# 8 decimal places is the satoshi-level floor every feed here can express, and the scale
# every stored money and quantity value is quantised to. `max_digits` bounds the value
# hard: a Decimal128 carries 34 significant digits, and a quantity times a price has to
# stay inside that.
Quantity = Annotated[
    Decimal,
    Field(
        gt=0,
        le=Decimal("1000000000"),
        max_digits=18,
        decimal_places=8,
        examples=["0.5"],
    ),
]
Price = Annotated[
    Decimal,
    Field(
        gt=0,
        le=Decimal("1000000000"),
        max_digits=18,
        decimal_places=8,
        examples=["65000.00"],
    ),
]
Money = Annotated[
    Decimal,
    Field(
        gt=0,
        le=Decimal("1000000000"),
        max_digits=18,
        decimal_places=2,
        examples=["10000.00"],
    ),
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
    position_side: HedgeSide | None = Field(
        default=None,
        description="Independent long/short leg. Omit for legacy one-way netting mode.",
    )
    type: OrderType = Field(default=OrderType.market, examples=["limit"])
    quantity: Quantity
    limit_price: Price | None = Field(
        default=None, description="Required for limit and stop_limit"
    )
    stop_price: Price | None = Field(
        default=None, description="Required for stop and stop_limit"
    )
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
            raise ValueError(
                f"`limit_price` does not apply to a {self.type.value} order"
            )
        if wants_stop and self.stop_price is None:
            raise ValueError(f"`stop_price` is required for a {self.type.value} order")
        if not wants_stop and self.stop_price is not None:
            raise ValueError(
                f"`stop_price` does not apply to a {self.type.value} order"
            )

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
    retried deposit that credits twice is the one bug in this file nobody would notice.

    `currency` is optional and defaults to the account currency, because there is only one
    balance to move. It is still accepted so an existing client keeps working — `AccountCurrency`
    only has the one member, so any other value is a plain 422 from the field itself.
    """

    currency: AccountCurrencyField | None = Field(
        default=None,
        description=f"Optional — {TRADING_ACCOUNT_CURRENCY} is the only value this venue holds",
    )
    amount: Money
    idempotency_key: IdempotencyKey
    reference: str | None = Field(
        default=None,
        max_length=128,
        description="Your own note, echoed back on the ledger entry",
    )

    @model_validator(mode="after")
    def _default_currency(self) -> "FundsRequest":
        if self.currency is None:
            self.currency = AccountCurrency(TRADING_ACCOUNT_CURRENCY)
        return self


# --------------------------------------------------------------------------- #
# Responses
# --------------------------------------------------------------------------- #


class Order(BaseModel):
    id: str
    client_order_id: str | None = None
    asset_class: AssetClass
    symbol: str
    side: OrderSide
    position_side: HedgeSide | None = None
    type: OrderType
    time_in_force: TimeInForce
    status: OrderStatus
    currency: str = Field(
        description="Quote currency — what this order's prices are in"
    )
    account_currency: str = Field(
        default="",
        description="What `fee`, `filled_notional` and `reserved_amount` are in. Falls back "
        "to `currency` for an order placed before the balance became universal, which is "
        "the currency that order really did settle in.",
    )
    fx_rate: Amount = Field(
        default=Decimal(1),
        description="Quote currency to `account_currency`, fixed when the order was placed "
        "so the same order cannot settle at two different rates",
    )
    quantity: Amount
    filled_quantity: Amount
    limit_price: Amount | None = None
    stop_price: Amount | None = None
    triggered: bool = Field(
        default=False, description="A stop order whose stop price has been reached"
    )
    average_price: Amount | None = Field(
        default=None, description="Traded price, once filled"
    )
    filled_notional: Amount | None = None
    fee: Amount = Field(
        default=Decimal(0), description="Commission charged, in `currency`"
    )
    reserved_amount: Amount = Field(
        default=Decimal(0), description="Cash still locked by this order"
    )
    reserved_quantity: Amount = Field(
        default=Decimal(0), description="Position units still locked by this order"
    )
    reject_reason: str | None = None
    liquidation: bool = Field(
        default=False,
        description="Forced closed by the engine on a margin breach, not the user",
    )
    created_at: datetime
    updated_at: datetime
    expires_at: datetime | None = Field(
        default=None, description="Set on a `day` order"
    )
    closed_at: datetime | None = Field(
        default=None, description="When it reached a terminal status"
    )

    @model_validator(mode="after")
    def _label_the_settlement_currency(self) -> "Order":
        """Never label a stored amount with a currency it is not in.

        An order written before the balance became universal has no `account_currency` and
        its cash figures are in the instrument's own currency. Defaulting the field to the
        configured account currency would put a USDT label on a number of rupees, which is
        exactly the kind of quiet mislabelling that turns into a wrong figure downstream.
        """
        if not self.account_currency:
            self.account_currency = self.currency
        return self


class Trade(BaseModel):
    """One fill. Immutable — this is the record of what actually happened."""

    id: str
    order_id: str
    asset_class: AssetClass
    symbol: str
    side: OrderSide
    position_side: HedgeSide | None = None
    currency: str = Field(description="Quote currency — what `price` is in")
    account_currency: str = Field(
        default="",
        description="What `notional`, `fee` and P&L are in. Falls back to `currency` for a "
        "fill recorded before the balance became universal.",
    )
    fx_rate: Amount = Field(
        default=Decimal(1), description="Quote currency to `account_currency`"
    )
    quantity: Amount
    price: Amount = Field(
        description="Traded price, in the instrument's quote `currency`"
    )
    notional: Amount = Field(
        description="quantity × price, converted to `account_currency`"
    )
    fee: Amount
    opened: Amount = Field(
        default=Decimal(0),
        description="How much of this fill opened or extended a position, in base units",
    )
    closed: Amount = Field(
        default=Decimal(0), description="How much of it closed an existing one"
    )
    realized_pnl: Amount | None = Field(
        default=None,
        description="Booked by the part of this fill that closed a position, net of the "
        "fee. Null when the fill only opened one.",
    )
    liquidation: bool = Field(
        default=False,
        description="A forced close from a margin breach, not a user-placed order. A long is "
        "sold out of and a short is bought back, so this appears on either side.",
    )
    at: datetime

    @model_validator(mode="after")
    def _label_the_settlement_currency(self) -> "Trade":
        """See `Order`: a pre-migration fill's amounts are in the instrument's currency."""
        if not self.account_currency:
            self.account_currency = self.currency
        return self


class PositionSide(str, Enum):
    """Which way a position is facing, derived from the sign of its quantity. Sent as its
    own field so a client never has to infer direction from a minus sign it might drop."""

    long = "long"
    short = "short"
    flat = "flat"


class Position(BaseModel):
    asset_class: AssetClass
    symbol: str
    currency: str = Field(
        description="The instrument's quote currency — what `average_price` is expressed in"
    )
    account_currency: str = Field(
        default=TRADING_ACCOUNT_CURRENCY,
        description="What every money field below is expressed in. Equals `currency` for a "
        "position opened before the balance became universal, whose basis really is in the "
        "instrument's own currency and cannot be restated without a historical rate.",
    )
    position_side: HedgeSide | None = Field(
        default=None,
        description="Independent hedge leg, or null for a legacy net position",
    )
    direction: PositionSide = PositionSide.flat
    quantity: Amount = Field(
        description="Signed net holding: positive long, negative short. Includes units "
        "locked by open sells."
    )
    available_quantity: Amount = Field(
        description="Signed, and free to trade. Negative means an open short."
    )
    reserved_quantity: Amount = Field(
        description="Units of a long locked by your own resting sell. Never negative — a "
        "short reserves cash, not units."
    )
    average_price: Amount | None = Field(
        default=None,
        description="Break-even per unit in the instrument's quote `currency`, fees "
        "included. Null once flat.",
    )
    cost_basis: Amount = Field(
        description="Signed, fee-inclusive, in `account_currency`. Negative for a short. "
        "`quantity * mark - cost_basis` is the unrealized P&L in both directions."
    )
    margin_used: Amount = Field(
        default=Decimal(0),
        description="Cash actually posted for this holding — full `cost_basis` for a position "
        "opened before leverage shipped, or 1/TRADING_LEVERAGE of it for one opened after. The "
        "position is force-closed once this plus its unrealized P&L reaches zero.",
    )
    realized_pnl: Amount
    updated_at: datetime


class PositionValuation(Position):
    """A position marked against the live feed. The mark fields are null when the feed has
    no usable price right now, which is a different statement from a value of zero."""

    last_price: Amount | None = Field(
        default=None, description="In the instrument's quote `currency`"
    )
    fx_rate: Amount | None = Field(
        default=None,
        description="Quote currency to `account_currency`, used to value this row. 1 when "
        "they are the same.",
    )
    market_value: Amount | None = Field(
        default=None,
        description="Signed, in `account_currency` — negative for a short, which is what "
        "makes summing it across positions give net exposure.",
    )
    unrealized_pnl: Amount | None = None
    unrealized_pnl_percent: Amount | None = Field(
        default=None,
        description="Against the cash posted (`margin_used`), so it is the "
        "return on what the position actually tied up",
    )
    market_state: MarketState = MarketState.unknown
    stale: bool = False


class FxRate(BaseModel):
    """What one unit of an instrument's quote currency is worth in the account balance.

    Exists because placing or pricing an order client-side needs this number before the
    order exists to carry it: `Order.fx_rate` is only readable *after* placement, and by
    then the rate already decided what got funded. A client showing "you need ~X USDT" or
    checking that against the one real balance before submitting has nowhere else to get
    X from — inventing it locally would be exactly the made-up conversion `app.trading.fx`
    exists to avoid.
    """

    currency: str = Field(description="The instrument's quote currency, upper-cased")
    account_currency: str = Field(default=TRADING_ACCOUNT_CURRENCY)
    rate: Amount = Field(
        description="Multiply an amount in `currency` by this to get `account_currency`. "
        "Exactly 1 for the account currency itself and for anything pegged to it."
    )


class Balance(BaseModel):
    currency: str
    available: Amount = Field(description="Free to spend or withdraw")
    reserved: Amount = Field(
        description="Locked by open orders and by pending withdrawal requests. Still "
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
    products: list[Product] = Field(
        description="The products an order here can require"
    )
    enabled: bool
    pending_review: bool = Field(
        default=False,
        description="Requested during onboarding, waiting on the income proof",
    )
    market_state: MarketState = Field(
        description="Feed-wide state. `unknown` for equities, where it is per exchange."
    )
    reason: str | None = Field(
        default=None, description="Why it is not tradable, when it is not"
    )


class Eligibility(BaseModel):
    """What the caller may trade, and why not, without having to place an order to find
    out. The same checks the order endpoint runs, in the same order."""

    uid: str
    onboarding_status: OnboardingStatus
    kyc_tier: KycTier
    can_trade: bool
    base_currency: str | None = Field(
        default=None, description="Declared in the markets step"
    )
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
    """Positions marked to market against one balance, so there is a real grand total.

    There used to be no `equity` here, and the reason was honest: adding INR to USDT needs
    an FX rate. Now that every position's cash leg is converted at placement and the account
    holds one currency, the total is a sum of numbers already in the same unit rather than
    an invented conversion — so it is reported, in `account_currency`.

    `unpriced` is what keeps it honest: a position whose feed is down contributes its cost
    basis to `equity` and nothing to `unrealized_pnl`, and the count says how many.
    """

    uid: str
    account_currency: str = TRADING_ACCOUNT_CURRENCY
    balances: list[Balance]
    positions: list[PositionValuation]
    cash: Amount = Field(description="Available plus reserved, in `account_currency`")
    market_value: Amount = Field(
        description="Net signed value of every priced position — longs less shorts"
    )
    equity: Amount = Field(
        description="What the account is worth: cash plus margin at risk"
    )
    unrealized_pnl: Amount
    realized_pnl: Amount = Field(description="Booked across every position, lifetime")
    margin_used: Amount = Field(
        description="Cash currently posted against open positions"
    )
    free_margin: Amount = Field(
        description="Available cash — what a new position can post"
    )
    market_value_by_currency: dict[str, Amount] = Field(
        description="Kept for clients written against the per-currency shape. With one "
        "account currency this has a single key."
    )
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
