"""The stream contract shared by every market feed.

Crypto and forex differ in where prices come from and what a quote holds, but the frames
a client sees are identical, so a front-end learns one protocol. `StreamFrame` is generic
over the quote type; each feature aliases it with its own.
"""

from datetime import datetime
from enum import Enum
from typing import Generic, Literal, TypeVar

from pydantic import BaseModel, ConfigDict, Field

Q = TypeVar("Q")


class StreamFrameType(str, Enum):
    subscribed = "subscribed"  # handshake accepted, carries the symbol set
    snapshot = "snapshot"  # every symbol's current quote, sent once on connect/resync
    quote = "quote"  # one live tick
    resynced = "resynced"  # the watchlist changed; symbols/snapshot follow
    deleted = "deleted"  # the watchlist is gone; the socket closes right after
    heartbeat = "heartbeat"  # sent after a quiet interval
    upstream = "upstream"  # upstream connectivity changed
    error = "error"  # client sent something invalid; socket stays open
    pong = "pong"


class StreamFrame(BaseModel, Generic[Q]):
    """Every frame the server sends is one of these, discriminated by `type`."""

    type: StreamFrameType
    at: datetime
    watchlist_id: str | None = None
    version: int | None = None
    symbols: list[str] | None = None
    quote: Q | None = None
    quotes: list[Q] | None = None
    state: Literal["connected", "disconnected", "reconnected"] | None = None
    dropped: int | None = Field(
        default=None,
        description="Ticks shed for this socket because the client fell behind",
    )
    detail: str | None = None


class ClientCommand(BaseModel):
    """The only messages a client may send. Anything else comes back as an `error` frame."""

    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")

    action: Literal["ping", "resync"]


class StreamStats(BaseModel):
    """Fan-out diagnostics. Per-process, since the hub is per-process."""

    upstream_connected: bool
    subscribers: int = Field(description="Open client sockets on this process")
    watchlists: int = Field(description="Distinct watchlist instances being streamed")
    symbols: int = Field(description="Distinct symbols subscribed upstream")
    cached_quotes: int
    your_open_sockets: int
    at: datetime


# Close codes in the application range, so a client can react without parsing text.
WS_CLOSE_UNAUTHENTICATED = 4401
WS_CLOSE_NOT_FOUND = 4404
WS_CLOSE_TOO_MANY = 4429
WS_CLOSE_DELETED = 4410
