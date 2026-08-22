"""Forex pairs, quotes and watchlist streams.

Shaped to match `schemas/crypto.py` wherever the markets agree, and to differ honestly
where they do not:

* **No order book.** FX is over-the-counter — there is no central limit order book to
  publish. The real analogue of depth is the bid/ask spread, so every quote carries it in
  price terms and in pips.
* **24/5, not 24/7.** A pair that has not moved since Friday's close is not a broken feed,
  so `market_state` and `stale` are part of the quote rather than something a client has
  to infer from timestamps.
"""

import re
from datetime import datetime, timezone
from decimal import Decimal
from enum import Enum
from typing import Annotated, Any

from pydantic import (
    BaseModel,
    BeforeValidator,
    ConfigDict,
    Field,
    StringConstraints,
    model_validator,
)

from app.core.config import FOREX_MAX_SYMBOLS_PER_WATCHLIST
from app.schemas.common import ErrorResponse
from app.schemas.streaming import StreamFrame


def normalize_pair(value: Any) -> Any:
    """Accept `EURUSD`, `EUR/USD`, `eur_usd` or `EUR-USD` and settle on `EUR-USD`.

    The hyphenated form is canonical because currency codes are not always three
    characters (the provider lists `BRLT`), which makes splitting a compact string
    ambiguous in general — only the unambiguous 6-character case is split.
    """
    if not isinstance(value, str):
        return value
    v = value.strip().upper().replace("/", "-").replace("_", "-").replace(" ", "")
    if "-" not in v and len(v) == 6:
        v = f"{v[:3]}-{v[3:]}"
    return v


# Constraints first so the pattern survives into the OpenAPI schema, normaliser second so
# it runs against the raw input. Same ordering lesson as schemas/onboarding.py.
Pair = Annotated[
    str,
    StringConstraints(pattern=r"^[A-Z]{3,4}-[A-Z]{3,4}$"),
    BeforeValidator(normalize_pair),
    Field(description="Currency pair, base-quote", examples=["EUR-USD"]),
]

WatchlistId = Annotated[
    str,
    StringConstraints(pattern=r"^[0-9a-f]{32}$"),
    Field(examples=["9f2c1e7b4a8d4f1e9c3b5a7d2e6f0b14"]),
]

PAIR_PATTERN = re.compile(r"^[A-Z]{3,4}-[A-Z]{3,4}$")


def split_pairs(values: list[str]) -> list[str]:
    """Flatten `?symbols=EUR-USD,GBP-USD` and repeated `?symbols=` into one list.

    Applied by hand in the endpoint: FastAPI validates a list query param item by item, so
    a BeforeValidator on the list never runs and cannot split a comma-joined value.
    """
    out: list[str] = []
    for value in values:
        out.extend(
            normalize_pair(part) for part in value.replace(",", " ").split() if part
        )
    return out


# Pip size by convention: JPY-quoted pairs and the metals quote to two decimals, the rest
# to four. Getting this wrong makes every spread reading off by two orders of magnitude.
_TWO_DECIMAL_QUOTES = frozenset({"JPY"})
_METALS = frozenset({"XAU", "XAG", "XPT", "XPD"})


def pip_size(pair: str) -> Decimal:
    base, _, quote = pair.partition("-")
    if quote in _TWO_DECIMAL_QUOTES or base in _METALS:
        return Decimal("0.01")
    return Decimal("0.0001")


class MarketState(str, Enum):
    open = "open"
    closed = "closed"


def fx_session_state(at: datetime | None = None) -> MarketState:
    """The interbank week runs Sunday 21:00 UTC to Friday 21:00 UTC.

    Holidays are not modelled — `stale` on the quote covers those, since a holiday looks
    exactly like a weekend from the data's point of view.
    """
    at = at or datetime.now(timezone.utc)
    weekday, hour = at.weekday(), at.hour  # Monday is 0
    if weekday == 5:  # Saturday
        return MarketState.closed
    if weekday == 6 and hour < 21:  # Sunday before the Sydney open
        return MarketState.closed
    if weekday == 4 and hour >= 21:  # Friday after the New York close
        return MarketState.closed
    return MarketState.open


class CandleSeriesKind(str, Enum):
    daily = "daily"  # one candle per trading day
    intraday = "intraday"  # the provider's most recent snapshots


# --------------------------------------------------------------------------- #
# Market data
# --------------------------------------------------------------------------- #


class PairInfo(BaseModel):
    symbol: str = Field(examples=["EUR-USD"])
    base: str = Field(examples=["EUR"])
    quote: str = Field(examples=["USD"])
    name: str = Field(description="Provider description of the pair")


class ForexQuote(BaseModel):
    """Prices are `Decimal` and serialise as JSON strings, so an FX rate carrying five
    decimal places never gets rounded by a float round-trip."""

    symbol: str
    bid: Decimal
    ask: Decimal
    mid: Decimal = Field(description="(bid + ask) / 2")
    spread: Decimal = Field(description="ask - bid, in quote-currency terms")
    spread_pips: Decimal = Field(description="Spread expressed in pips for this pair")
    pip_size: Decimal
    high: Decimal
    low: Decimal
    change: Decimal = Field(description="Change in the bid over the session")
    change_percent: Decimal
    quoted_at: datetime = Field(description="Provider timestamp, not receipt time")
    stale: bool = Field(description="No update within the staleness window")
    market_state: MarketState


class Candle(BaseModel):
    """`open` is derived as `close - change`: the provider publishes high, low, the
    closing bid and the change, but no explicit open."""

    at: datetime
    open: Decimal
    high: Decimal
    low: Decimal
    close: Decimal
    change: Decimal
    change_percent: Decimal


class CandleSeries(BaseModel):
    symbol: str
    series: CandleSeriesKind
    count: int
    candles: list[Candle]


class SessionInfo(BaseModel):
    market_state: MarketState
    at: datetime
    detail: str


# --------------------------------------------------------------------------- #
# Watchlists — the "instance" that owns a socket
# --------------------------------------------------------------------------- #


class _Strict(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")


def _unique(symbols: list[str]) -> None:
    if len(set(symbols)) != len(symbols):
        raise ValueError("`symbols` must not repeat a pair")


class WatchlistCreate(_Strict):
    name: str = Field(min_length=1, max_length=64, examples=["Majors"])
    symbols: list[Pair] = Field(
        min_length=1, max_length=FOREX_MAX_SYMBOLS_PER_WATCHLIST
    )

    @model_validator(mode="after")
    def _no_duplicates(self) -> "WatchlistCreate":
        _unique(self.symbols)
        return self


class WatchlistUpdate(_Strict):
    """PATCH — omit a field to leave it alone. Sending neither is a no-op and rejected."""

    name: str | None = Field(default=None, min_length=1, max_length=64)
    symbols: list[Pair] | None = Field(
        default=None, min_length=1, max_length=FOREX_MAX_SYMBOLS_PER_WATCHLIST
    )

    @model_validator(mode="after")
    def _something_to_do(self) -> "WatchlistUpdate":
        if self.name is None and self.symbols is None:
            raise ValueError("Provide `name`, `symbols`, or both")
        if self.symbols is not None:
            _unique(self.symbols)
        return self


class WatchlistSymbolsAdd(_Strict):
    symbols: list[Pair] = Field(
        min_length=1, max_length=FOREX_MAX_SYMBOLS_PER_WATCHLIST
    )

    @model_validator(mode="after")
    def _no_duplicates(self) -> "WatchlistSymbolsAdd":
        _unique(self.symbols)
        return self


class Watchlist(BaseModel):
    id: str
    name: str
    symbols: list[str]
    version: int = Field(
        description="Bumped on every mutation; live sockets re-bind on a bump"
    )
    stream_url: str = Field(
        description="Relative WebSocket path for this instance",
        examples=["/forex/watchlists/9f2c1e7b4a8d4f1e9c3b5a7d2e6f0b14/stream"],
    )
    created_at: datetime
    updated_at: datetime


class WatchlistQuotes(BaseModel):
    id: str
    name: str
    version: int
    market_state: MarketState
    quotes: list[ForexQuote]
    unavailable: list[str] = Field(
        default_factory=list, description="Pairs with no quote available right now"
    )
    at: datetime


ForexFrame = StreamFrame[ForexQuote]


# Reusable OpenAPI blocks for this feature's failure modes.
UPSTREAM_ERROR = {
    502: {
        "model": ErrorResponse,
        "description": "Upstream market data rejected or failed the request",
    },
    504: {"model": ErrorResponse, "description": "Upstream market data timed out"},
}
RATE_LIMITED = {
    429: {
        "model": ErrorResponse,
        "description": "Rate limited — by this API's per-user caps or by the upstream",
    }
}
UNKNOWN_PAIR = {
    404: {"model": ErrorResponse, "description": "Unknown or unsupported currency pair"}
}
WATCHLIST_CONFLICT = {
    409: {
        "model": ErrorResponse,
        "description": "Duplicate watchlist name, or the per-user watchlist cap is reached",
    }
}
