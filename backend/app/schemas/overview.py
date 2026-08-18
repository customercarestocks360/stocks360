"""The public market overview: one normalised tick shape across all three feeds.

Crypto, forex and equity quotes each carry different fields — `last_price` vs `mid` vs
`price`, `price_change_percent` vs `change_percent` — because each mirrors its provider.
A public headline ticker wants none of that: it wants a price and a percentage per row,
and one shape it can render in a single loop. `MarketTick` is that shape, and the
per-market translation lives in `overview/routes.py` rather than leaking into clients.

Prices stay `Decimal`, so they serialise as JSON strings exactly like every other feed
here and never take a float round-trip.
"""

from datetime import datetime
from decimal import Decimal
from enum import Enum
from typing import Literal

from pydantic import BaseModel, Field

from app.schemas.streaming import StreamFrameType


class Market(str, Enum):
    crypto = "crypto"
    forex = "forex"
    stocks = "stocks"


class MarketTick(BaseModel):
    """One symbol's headline price, normalised across feeds."""

    market: Market
    symbol: str = Field(examples=["BTCUSDT"])
    price: Decimal = Field(description="Last traded price; the mid rate for forex")
    change: Decimal | None = Field(default=None, description="Absolute move over the feed's window")
    change_percent: Decimal | None = Field(
        default=None, description="Percent move over the feed's window; null when unavailable"
    )
    currency: str | None = Field(default=None, examples=["INR"])
    at: datetime = Field(description="Upstream quote time, not receipt time")
    stale: bool = Field(description="Outside this feed's freshness window")


class OverviewFrame(BaseModel):
    """Every frame the public socket sends, discriminated by `type`.

    Deliberately a separate model from `StreamFrame`: this feed spans three upstreams at
    once, so it needs `market` and `markets` and has no use for `watchlist_id`, `version`
    or the resync/delete lifecycle a watchlist socket has.
    """

    type: StreamFrameType
    at: datetime
    symbols: dict[Market, list[str]] | None = Field(
        default=None, description="The streamed symbols per market, sent on the handshake"
    )
    markets: dict[Market, bool] | None = Field(
        default=None, description="Upstream connectivity per market, sent on the handshake"
    )
    market: Market | None = Field(default=None, description="Which feed an `upstream` frame refers to")
    state: Literal["connected", "disconnected", "reconnected"] | None = None
    tick: MarketTick | None = Field(default=None, description="Set on a `quote` frame")
    ticks: list[MarketTick] | None = Field(default=None, description="Set on a `snapshot` frame")
    dropped: int | None = Field(
        default=None, description="Ticks shed for this socket because the client fell behind"
    )
    detail: str | None = None


# Close codes in the application range, matching the authenticated streams' convention.
WS_CLOSE_TOO_MANY = 4429
