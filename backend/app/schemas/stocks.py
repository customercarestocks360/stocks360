"""Equities — the instrument master, quotes, candles and watchlist streams.

Shaped to match `schemas/crypto.py` and `schemas/forex.py` wherever the markets agree, and
to differ where equities genuinely do:

* **The instrument universe is searched, not downloaded.** Crypto and forex publish a full
  list this app caches; the equity universe is millions of listings across every exchange,
  so `GET /stocks/instruments` is a search and symbols are validated by resolving them.
* **Market hours come from the exchange, per symbol.** A watchlist can hold NSE and Nasdaq
  side by side, and they are open at different times, so `market_state` is per quote rather
  than a property of the feed.
"""

import re
from datetime import datetime
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

from app.core.config import STOCKS_MAX_SYMBOLS_PER_WATCHLIST
from app.schemas.common import ErrorResponse
from app.schemas.streaming import StreamFrame


def normalize_symbol(value: Any) -> Any:
    """Yahoo tickers are upper case and may carry an exchange suffix (`RELIANCE.NS`), a
    class marker (`BRK-B`) or an index caret (`^NSEI`)."""
    return value.strip().upper() if isinstance(value, str) else value


# Constraints first so the pattern reaches OpenAPI, normaliser second so it runs on the
# raw input. Same ordering lesson as the other feeds.
Symbol = Annotated[
    str,
    StringConstraints(pattern=r"^[A-Z0-9^][A-Z0-9.\-=^]{0,19}$"),
    BeforeValidator(normalize_symbol),
    Field(description="Ticker, with an exchange suffix outside the US", examples=["RELIANCE.NS"]),
]

WatchlistId = Annotated[
    str, StringConstraints(pattern=r"^[0-9a-f]{32}$"), Field(examples=["9f2c1e7b4a8d4f1e9c3b5a7d2e6f0b14"])
]

SYMBOL_PATTERN = re.compile(r"^[A-Z0-9^][A-Z0-9.\-=^]{0,19}$")


def split_symbols(values: list[str]) -> list[str]:
    """Flatten `?symbols=AAPL,RELIANCE.NS` and repeated `?symbols=` into one list.

    Applied by hand in the endpoint: FastAPI validates a list query param item by item, so
    a BeforeValidator on the list never runs and cannot split a comma-joined value.
    """
    out: list[str] = []
    for value in values:
        out.extend(normalize_symbol(part) for part in value.replace(",", " ").split() if part)
    return out


class MarketState(str, Enum):
    open = "open"
    closed = "closed"
    unknown = "unknown"


class Interval(str, Enum):
    m1 = "1m"
    m2 = "2m"
    m5 = "5m"
    m15 = "15m"
    m30 = "30m"
    m60 = "60m"
    d1 = "1d"
    wk1 = "1wk"
    mo1 = "1mo"


class Range(str, Enum):
    d1 = "1d"
    d5 = "5d"
    mo1 = "1mo"
    mo3 = "3mo"
    mo6 = "6mo"
    y1 = "1y"
    y2 = "2y"
    y5 = "5y"
    ytd = "ytd"
    max = "max"


# --------------------------------------------------------------------------- #
# Market data
# --------------------------------------------------------------------------- #


class Instrument(BaseModel):
    symbol: str = Field(examples=["RELIANCE.NS"])
    name: str | None = None
    exchange: str | None = Field(default=None, examples=["NSI"])
    full_exchange: str | None = Field(default=None, examples=["NSE"])
    type: str | None = Field(default=None, description="EQUITY, ETF, INDEX, …")
    currency: str | None = Field(default=None, examples=["INR"])


class StockQuote(BaseModel):
    """Prices are `Decimal` and serialise as JSON strings, so no float round-trip."""

    symbol: str
    name: str | None = None
    exchange: str | None = None
    currency: str | None = None
    price: Decimal
    previous_close: Decimal | None = None
    change: Decimal | None = None
    change_percent: Decimal | None = None
    day_high: Decimal | None = None
    day_low: Decimal | None = None
    volume: int | None = None
    fifty_two_week_high: Decimal | None = None
    fifty_two_week_low: Decimal | None = None
    market_state: MarketState
    session_start: datetime | None = Field(
        default=None, description="Current regular session for this symbol's exchange"
    )
    session_end: datetime | None = None
    quoted_at: datetime = Field(description="Exchange time of the last trade, not receipt time")
    stale: bool = Field(description="No trade within the staleness window")


class Candle(BaseModel):
    at: datetime
    open: Decimal
    high: Decimal
    low: Decimal
    close: Decimal
    volume: int | None = None


class CandleSeries(BaseModel):
    symbol: str
    interval: Interval
    range: Range
    currency: str | None = None
    count: int
    candles: list[Candle]


# --------------------------------------------------------------------------- #
# Watchlists — the "instance" that owns a socket
# --------------------------------------------------------------------------- #


class _Strict(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")


def _unique(symbols: list[str]) -> None:
    if len(set(symbols)) != len(symbols):
        raise ValueError("`symbols` must not repeat a ticker")


class WatchlistCreate(_Strict):
    name: str = Field(min_length=1, max_length=64, examples=["Nifty picks"])
    symbols: list[Symbol] = Field(min_length=1, max_length=STOCKS_MAX_SYMBOLS_PER_WATCHLIST)

    @model_validator(mode="after")
    def _no_duplicates(self) -> "WatchlistCreate":
        _unique(self.symbols)
        return self


class WatchlistUpdate(_Strict):
    """PATCH — omit a field to leave it alone. Sending neither is a no-op and rejected."""

    name: str | None = Field(default=None, min_length=1, max_length=64)
    symbols: list[Symbol] | None = Field(
        default=None, min_length=1, max_length=STOCKS_MAX_SYMBOLS_PER_WATCHLIST
    )

    @model_validator(mode="after")
    def _something_to_do(self) -> "WatchlistUpdate":
        if self.name is None and self.symbols is None:
            raise ValueError("Provide `name`, `symbols`, or both")
        if self.symbols is not None:
            _unique(self.symbols)
        return self


class WatchlistSymbolsAdd(_Strict):
    symbols: list[Symbol] = Field(min_length=1, max_length=STOCKS_MAX_SYMBOLS_PER_WATCHLIST)

    @model_validator(mode="after")
    def _no_duplicates(self) -> "WatchlistSymbolsAdd":
        _unique(self.symbols)
        return self


class Watchlist(BaseModel):
    id: str
    name: str
    symbols: list[str]
    version: int = Field(description="Bumped on every mutation; live sockets re-bind on a bump")
    stream_url: str = Field(
        description="Relative WebSocket path for this instance",
        examples=["/stocks/watchlists/9f2c1e7b4a8d4f1e9c3b5a7d2e6f0b14/stream"],
    )
    created_at: datetime
    updated_at: datetime


class WatchlistQuotes(BaseModel):
    id: str
    name: str
    version: int
    quotes: list[StockQuote]
    unavailable: list[str] = Field(
        default_factory=list, description="Tickers with no quote available right now"
    )
    at: datetime


StockFrame = StreamFrame[StockQuote]


# Reusable OpenAPI blocks for this feature's failure modes.
UPSTREAM_ERROR = {
    502: {"model": ErrorResponse, "description": "Upstream market data rejected or failed the request"},
    504: {"model": ErrorResponse, "description": "Upstream market data timed out"},
}
RATE_LIMITED = {
    429: {"model": ErrorResponse, "description": "Rate limited — by this API's per-user caps or by the upstream"}
}
UNKNOWN_SYMBOL = {404: {"model": ErrorResponse, "description": "Unknown, delisted or unsupported ticker"}}
WATCHLIST_CONFLICT = {
    409: {"model": ErrorResponse, "description": "Duplicate watchlist name, or the per-user watchlist cap is reached"}
}
