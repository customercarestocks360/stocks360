"""Market data fan-out, shared by every feed.

One upstream serves every connected client. Symbols are reference-counted, so a hundred
sockets watching the same symbol cost one upstream subscription, and it is dropped the
moment the last interested socket goes away.

The alternative — one upstream connection per client watchlist — would multiply the
provider's connection limits by our user count and get the server banned. It also makes a
network blip one reconnect instead of N.

Subclasses supply only the upstream strategy:

* `_run()` — the connection or polling loop, which calls `_broadcast()` per tick.
* `_subscribe()` / `_unsubscribe()` — optional, for upstreams that need to be told which
  symbols to send. A polling upstream reads `live_symbols()` each tick and needs neither.

This state is **per process**. Under multiple uvicorn workers each worker keeps its own
upstream and its own subscriber set, which is correct but not shared: a watchlist edit
handled by worker A cannot re-bind a socket held by worker B. Run a single worker, or move
this to Redis pub/sub, before scaling out.
"""

import asyncio
import contextlib
import logging
from collections import Counter
from datetime import datetime, timezone
from typing import Any

from app.schemas.streaming import StreamFrame, StreamFrameType

logger = logging.getLogger(__name__)

# Bounded so one stalled client cannot grow memory without limit. When it fills we shed
# the oldest tick: for a quote feed the newest price is the only one that matters, and a
# slow consumer wants current data, not a backlog.
_QUEUE_SIZE = 64

RECONNECT_DELAYS = (1, 2, 5, 10, 20, 30)

# Not every subscriber is a client socket. The trading matcher registers here too, so that
# a resting order keeps its symbol subscribed upstream — but it is not someone's browser,
# and counting it as one would make the fan-out diagnostics report a connection that does
# not exist. Ids under this prefix are internal; a real watchlist id is 32 hex characters.
INTERNAL_PREFIX = "__"


def now() -> datetime:
    return datetime.now(timezone.utc)


class Subscriber:
    """One connected client socket's view of the hub."""

    def __init__(self, watchlist_id: str, symbols: set[str]) -> None:
        self.watchlist_id = watchlist_id
        self.symbols = symbols
        self.queue: asyncio.Queue = asyncio.Queue(maxsize=_QUEUE_SIZE)
        self.dropped = 0

    def offer(self, frame: Any) -> None:
        """Non-blocking hand-off; the hub must never wait on a slow client."""
        try:
            self.queue.put_nowait(frame)
        except asyncio.QueueFull:
            with contextlib.suppress(asyncio.QueueEmpty):
                self.queue.get_nowait()
            self.dropped += 1
            with contextlib.suppress(asyncio.QueueFull):
                self.queue.put_nowait(frame)


class BaseHub:
    """Subscriber bookkeeping and fan-out. The upstream itself is a subclass's job."""

    name = "hub"

    def __init__(self, frame_cls: type = StreamFrame) -> None:
        self._frame = frame_cls
        self._subscribers: set[Subscriber] = set()
        self._by_watchlist: dict[str, set[Subscriber]] = {}
        self._refcount: Counter[str] = Counter()
        self._last: dict[str, Any] = {}
        self._task: asyncio.Task | None = None
        self._lock = asyncio.Lock()
        self._connected = asyncio.Event()
        self._stopping = False

    # ----------------------------------------------------------- lifecycle ---
    async def start(self) -> None:
        if self._task is None:
            self._stopping = False
            self._task = asyncio.create_task(self._run(), name=f"{self.name}-loop")
            logger.info("%s started", self.name)

    async def stop(self) -> None:
        self._stopping = True
        if self._task is not None:
            self._task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._task
            self._task = None
        await self._teardown()
        self._subscribers.clear()
        self._by_watchlist.clear()
        self._refcount.clear()
        self._last.clear()
        self._connected.clear()

    async def _teardown(self) -> None:
        """Release any upstream resource held by the subclass."""

    @property
    def upstream_connected(self) -> bool:
        return self._connected.is_set()

    @property
    def stopping(self) -> bool:
        return self._stopping

    def stats(self) -> dict:
        """Client-facing fan-out numbers. Internal subscribers are excluded, so these stay
        a measure of who is connected rather than of what the process is doing."""
        return {
            "upstream_connected": self.upstream_connected,
            "subscribers": sum(
                1 for s in self._subscribers if not s.watchlist_id.startswith(INTERNAL_PREFIX)
            ),
            "watchlists": sum(
                1 for wid in self._by_watchlist if not wid.startswith(INTERNAL_PREFIX)
            ),
            "symbols": len(self._refcount),
            "cached_quotes": len(self._last),
        }

    async def live_symbols(self) -> set[str]:
        async with self._lock:
            return set(self._refcount)

    # --------------------------------------------------------- registration ---
    async def register(self, watchlist_id: str, symbols: set[str]) -> Subscriber:
        sub = Subscriber(watchlist_id, set(symbols))
        async with self._lock:
            self._subscribers.add(sub)
            self._by_watchlist.setdefault(watchlist_id, set()).add(sub)
            added = self._acquire(sub.symbols)
        await self._subscribe(added)
        # Seed the cache before the first tick can arrive. Without this the connect-time
        # snapshot is fetched outside the hub, so the first poll sees no prior value and
        # re-broadcasts a price the client was just given — and on a polled feed a quote
        # frame is supposed to mean the price actually moved. It also saves the caller a
        # second upstream call, since its snapshot now hits the cache.
        await self._warm(set(symbols))
        return sub

    async def unregister(self, sub: Subscriber) -> None:
        async with self._lock:
            if sub not in self._subscribers:
                return
            self._subscribers.discard(sub)
            peers = self._by_watchlist.get(sub.watchlist_id)
            if peers is not None:
                peers.discard(sub)
                if not peers:
                    self._by_watchlist.pop(sub.watchlist_id, None)
            removed = self._release(sub.symbols)
        await self._unsubscribe(removed)

    async def rebind(self, watchlist_id: str, symbols: set[str], version: int) -> None:
        """Point every live socket for a watchlist at a new symbol set.

        This is what makes an edit through the REST API show up on an already-open socket
        instead of requiring a reconnect.
        """
        async with self._lock:
            subs = list(self._by_watchlist.get(watchlist_id, ()))
            if not subs:
                return
            added: set[str] = set()
            removed: set[str] = set()
            for sub in subs:
                added |= self._acquire(symbols - sub.symbols)
                removed |= self._release(sub.symbols - symbols)
                sub.symbols = set(symbols)
        await self._subscribe(added)
        await self._unsubscribe(removed)

        # A just-added symbol has no cached tick yet, so without this its slot in the
        # resync frame would be empty until the upstream next publishes it. On a closed
        # market that is never, which would leave the client showing a priceless row.
        await self._warm(symbols)

        frame = self._frame(
            type=StreamFrameType.resynced,
            at=now(),
            watchlist_id=watchlist_id,
            version=version,
            symbols=sorted(symbols),
            quotes=self.snapshot(symbols),
        )
        for sub in subs:
            sub.offer(frame)

    def notify_deleted(self, watchlist_id: str) -> list[Subscriber]:
        """Tell live sockets their watchlist is gone. The handlers do the closing."""
        subs = list(self._by_watchlist.get(watchlist_id, ()))
        frame = self._frame(
            type=StreamFrameType.deleted,
            at=now(),
            watchlist_id=watchlist_id,
            detail="Watchlist deleted",
        )
        for sub in subs:
            sub.offer(frame)
        return subs

    # Both helpers must be called with the lock held.
    def _acquire(self, symbols: set[str]) -> set[str]:
        newly = {s for s in symbols if self._refcount[s] == 0}
        self._refcount.update(symbols)
        return newly

    def _release(self, symbols: set[str]) -> set[str]:
        dropped = set()
        for symbol in symbols:
            self._refcount[symbol] -= 1
            if self._refcount[symbol] <= 0:
                del self._refcount[symbol]
                self._last.pop(symbol, None)
                dropped.add(symbol)
        return dropped

    # ------------------------------------------------------------ snapshots ---
    def snapshot(self, symbols: set[str] | list[str]) -> list[Any]:
        """Whatever the hub has cached for these symbols, newest value per symbol."""
        return [self._last[s] for s in sorted(symbols) if s in self._last]

    def cached(self, symbol: str) -> Any | None:
        return self._last.get(symbol)

    # -------------------------------------------------------------- fan-out ---
    def _broadcast(self, quote: Any) -> None:
        self._last[quote.symbol] = quote
        frame = self._frame(type=StreamFrameType.quote, at=now(), quote=quote)
        for sub in self._subscribers:
            if quote.symbol in sub.symbols:
                sub.offer(frame)

    def _announce(self, state: str) -> None:
        frame = self._frame(type=StreamFrameType.upstream, at=now(), state=state)
        for sub in self._subscribers:
            sub.offer(frame)

    def _mark_connected(self, reconnected: bool = False) -> None:
        """Announce only on the transition. A polling upstream calls this on every
        successful poll, and clients must not get an `upstream` frame every few seconds."""
        if self._connected.is_set():
            return
        self._connected.set()
        self._announce("reconnected" if reconnected else "connected")

    def _mark_disconnected(self) -> None:
        if self._connected.is_set():
            self._connected.clear()
            self._announce("disconnected")

    # ------------------------------------------------- upstream (subclasses) ---
    async def _run(self) -> None:
        raise NotImplementedError

    async def _subscribe(self, symbols: set[str]) -> None:
        """Tell the upstream to start sending these. No-op for a polling upstream."""

    async def _unsubscribe(self, symbols: set[str]) -> None:
        """Tell the upstream to stop sending these. No-op for a polling upstream."""

    async def _fetch(self, symbols: list[str]) -> list[Any]:
        """One-shot quote lookup, used to fill gaps the stream has not covered yet."""
        return []

    async def _warm(self, symbols: set[str]) -> None:
        """Populate the cache for symbols it has never seen, without broadcasting —
        the caller is about to put them in a frame of its own."""
        missing = [s for s in symbols if s not in self._last]
        if not missing:
            return
        try:
            for quote in await self._fetch(missing):
                self._last[quote.symbol] = quote
        except Exception as exc:
            # A cold slot is a degraded frame, not a failed rebind.
            logger.warning("%s could not warm %s: %s", self.name, missing, exc)
