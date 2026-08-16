"""Crypto market data and watchlist streams.

Prices are `Decimal`, and pydantic serialises those to JSON *strings* — the same way the
upstream reports them. A float round-trip would quietly lose precision on satoshi-level
increments, and a price is never something to do arithmetic on by accident.
"""

import re
from datetime import datetime
from decimal import Decimal
from enum import Enum, IntEnum
from typing import Annotated, Any

from pydantic import (
    BaseModel,
    BeforeValidator,
    ConfigDict,
    Field,
    StringConstraints,
    model_validator,
)

from app.core.config import CRYPTO_MAX_SYMBOLS_PER_WATCHLIST
from app.schemas.common import ErrorResponse
from app.schemas.streaming import StreamFrame


def _upper(value: Any) -> Any:
    return value.upper() if isinstance(value, str) else value


# Constraints first so the pattern survives into the OpenAPI schema, normaliser second so
# it runs against the raw input. See the same note in schemas/onboarding.py.
Symbol = Annotated[
    str,
    StringConstraints(strip_whitespace=True, pattern=r"^[A-Z0-9]{2,32}$"),
    BeforeValidator(_upper),
    Field(description="Exchange symbol, e.g. BTCUSDT", examples=["BTCUSDT"]),
]

WatchlistId = Annotated[
    str, StringConstraints(pattern=r"^[0-9a-f]{32}$"), Field(examples=["9f2c1e7b4a8d4f1e9c3b5a7d2e6f0b14"])
]


# Applied by hand to query params: FastAPI validates a list query param item by item, so
# a BeforeValidator on the list never runs and cannot split a comma-joined value.
SYMBOL_PATTERN = re.compile(r"^[A-Z0-9]{2,32}$")


def split_symbols(values: list[str]) -> list[str]:
    """Flatten `?symbols=BTCUSDT,ETHUSDT` and repeated `?symbols=` into one upper-cased
    list. Both forms are natural to write by hand, so neither should be a 422."""
    out: list[str] = []
    for value in values:
        out.extend(part.upper() for part in value.replace(",", " ").split() if part)
    return out


class KlineInterval(str, Enum):
    m1 = "1m"
    m3 = "3m"
    m5 = "5m"
    m15 = "15m"
    m30 = "30m"
    h1 = "1h"
    h2 = "2h"
    h4 = "4h"
    h6 = "6h"
    h8 = "8h"
    h12 = "12h"
    d1 = "1d"
    d3 = "3d"
    w1 = "1w"
    M1 = "1M"


class OrderBookDepth(IntEnum):
    """The only depths the upstream accepts. An IntEnum rather than a Literal because
    pydantic will not coerce a query string into a `Literal[5, 10, ...]`."""

    d5 = 5
    d10 = 10
    d20 = 20
    d50 = 50
    d100 = 100
    d500 = 500
    d1000 = 1000


class SymbolStatus(str, Enum):
    trading = "TRADING"
    halt = "HALT"
    break_ = "BREAK"
    other = "OTHER"


# --------------------------------------------------------------------------- #
# Market data
# --------------------------------------------------------------------------- #


class SymbolInfo(BaseModel):
    symbol: str = Field(examples=["BTCUSDT"])
    base_asset: str = Field(examples=["BTC"])
    quote_asset: str = Field(examples=["USDT"])
    status: SymbolStatus
    base_precision: int
    quote_precision: int


class Quote(BaseModel):
    """A 24h rolling ticker. Identical shape whether it came from REST or the stream, so a
    client renders a snapshot and a live tick with the same code."""

    symbol: str
    last_price: Decimal
    price_change: Decimal
    price_change_percent: Decimal
    high: Decimal
    low: Decimal
    open_price: Decimal
    volume: Decimal = Field(description="Base-asset volume over the window")
    quote_volume: Decimal = Field(description="Quote-asset volume over the window")
    bid: Decimal | None = None
    ask: Decimal | None = None
    trades: int | None = None
    event_time: datetime = Field(description="Upstream event time, not receipt time")


class OrderBookLevel(BaseModel):
    price: Decimal
    quantity: Decimal


class OrderBook(BaseModel):
    symbol: str
    last_update_id: int
    bids: list[OrderBookLevel] = Field(description="Highest first")
    asks: list[OrderBookLevel] = Field(description="Lowest first")
    at: datetime


class Kline(BaseModel):
    open_time: datetime
    open: Decimal
    high: Decimal
    low: Decimal
    close: Decimal
    volume: Decimal
    close_time: datetime
    quote_volume: Decimal
    trades: int


class KlineSeries(BaseModel):
    symbol: str
    interval: KlineInterval
    count: int
    klines: list[Kline]


# --------------------------------------------------------------------------- #
# Watchlists — the "instance" that owns a socket
# --------------------------------------------------------------------------- #


class _Strict(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")


def _unique(symbols: list[str], field: str = "symbols") -> list[str]:
    if len(set(symbols)) != len(symbols):
        raise ValueError(f"`{field}` must not repeat a symbol")
    return symbols


class WatchlistCreate(_Strict):
    name: str = Field(min_length=1, max_length=64, examples=["Majors"])
    symbols: list[Symbol] = Field(min_length=1, max_length=CRYPTO_MAX_SYMBOLS_PER_WATCHLIST)

    @model_validator(mode="after")
    def _no_duplicates(self) -> "WatchlistCreate":
        _unique(self.symbols)
        return self


class WatchlistUpdate(_Strict):
    """PATCH — omit a field to leave it alone. Sending neither is a no-op and rejected."""

    name: str | None = Field(default=None, min_length=1, max_length=64)
    symbols: list[Symbol] | None = Field(
        default=None, min_length=1, max_length=CRYPTO_MAX_SYMBOLS_PER_WATCHLIST
    )

    @model_validator(mode="after")
    def _something_to_do(self) -> "WatchlistUpdate":
        if self.name is None and self.symbols is None:
            raise ValueError("Provide `name`, `symbols`, or both")
        if self.symbols is not None:
            _unique(self.symbols)
        return self


class WatchlistSymbolsAdd(_Strict):
    symbols: list[Symbol] = Field(min_length=1, max_length=CRYPTO_MAX_SYMBOLS_PER_WATCHLIST)

    @model_validator(mode="after")
    def _no_duplicates(self) -> "WatchlistSymbolsAdd":
        _unique(self.symbols)
        return self


class Watchlist(BaseModel):
    id: str
    name: str
    symbols: list[str]
    # Bumped on every mutation. Live sockets are re-bound on a bump, and a client can use
    # it to tell an expected resync from an unexpected one.
    version: int
    stream_url: str = Field(
        description="Relative WebSocket path for this instance",
        examples=["/crypto/watchlists/9f2c1e7b4a8d4f1e9c3b5a7d2e6f0b14/stream"],
    )
    created_at: datetime
    updated_at: datetime


class WatchlistQuotes(BaseModel):
    id: str
    name: str
    version: int
    quotes: list[Quote]
    stale: list[str] = Field(
        default_factory=list, description="Symbols with no quote available right now"
    )
    at: datetime


# The frame contract itself is shared with every other feed — see schemas/streaming.py.
CryptoFrame = StreamFrame[Quote]


# Reusable OpenAPI blocks for this feature's failure modes.
UPSTREAM_ERROR = {
    502: {"model": ErrorResponse, "description": "Upstream market data rejected or failed the request"},
    504: {"model": ErrorResponse, "description": "Upstream market data timed out"},
}
RATE_LIMITED = {
    429: {"model": ErrorResponse, "description": "Rate limited — by this API's per-user caps or by the upstream"}
}
UNKNOWN_SYMBOL = {404: {"model": ErrorResponse, "description": "Unknown or non-tradable symbol"}}
WATCHLIST_CONFLICT = {
    409: {"model": ErrorResponse, "description": "Duplicate watchlist name, or the per-user watchlist cap is reached"}
}
