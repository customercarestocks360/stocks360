"""The public market overview stream: headline crypto, forex and equity prices.

One unauthenticated socket carrying all three feeds. Everything here is already-public
market data, which is why it needs no token — but "no token" also means there is no
account to attribute abuse to, so the caps below are keyed on the peer address and on the
process as a whole.

**No new upstream cost.** This registers with the same three hubs the authenticated
watchlist streams use, so the headline symbols are reference-counted alongside everyone
else's: a thousand public viewers cost the same upstream subscriptions as one, and when
the last viewer leaves the symbols are dropped unless a watchlist still wants them.

**Why the frames are merged here rather than by the client.** Three hubs mean three
queues. A client should not have to open three sockets and reconcile three protocols to
render one ticker strip, so the three are selected over and normalised into one
`MarketTick` shape on the way out. Only the pump writes to the socket — two tasks writing
concurrently would interleave frames mid-JSON — so the reader queues its replies on a
separate control channel instead of sending them itself.
"""

import asyncio
import contextlib
import logging
from collections import Counter
from datetime import datetime, timezone
from decimal import Decimal

from fastapi import APIRouter, WebSocket, status
from pydantic import ValidationError
from starlette.websockets import WebSocketDisconnect

from app.core.config import (
    CRYPTO_STALE_SECONDS,
    OVERVIEW_CRYPTO_SYMBOLS,
    OVERVIEW_FOREX_SYMBOLS,
    OVERVIEW_HEARTBEAT_SECONDS,
    OVERVIEW_MAX_SOCKETS,
    OVERVIEW_MAX_SOCKETS_PER_IP,
    OVERVIEW_STOCKS_SYMBOLS,
)
from app.core.http import client_ip
from app.crypto.hub import hub as crypto_hub
from app.forex.hub import hub as forex_hub
from app.schemas.crypto import SYMBOL_PATTERN as CRYPTO_SYMBOL_PATTERN
from app.schemas.forex import PAIR_PATTERN
from app.schemas.overview import WS_CLOSE_TOO_MANY, Market, MarketTick, OverviewFrame
from app.schemas.stocks import SYMBOL_PATTERN as STOCK_SYMBOL_PATTERN
from app.schemas.streaming import ClientCommand, StreamFrameType
from app.stocks.hub import hub as stocks_hub
from app.streaming.hub import BaseHub, Subscriber

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/market", tags=["market overview"])


# Every public socket shares one id, so the hubs see a single streamed instance with N
# subscribers rather than N instances. It deliberately does not use the hub's INTERNAL_
# PREFIX: these are real client sockets and should show up in the fan-out diagnostics.
# A real watchlist id is 32 hex characters, so this can never collide with one.
_INSTANCE_ID = "public-overview"

# A misconfigured list would silently subscribe an arbitrary number of symbols on an
# endpoint anyone can open, so the ceiling is enforced rather than documented.
_MAX_SYMBOLS_PER_MARKET = 25


def _validated(market: Market, symbols: list[str], pattern) -> list[str]:
    """Fail at import rather than serving a feed that can never produce a quote.

    A typo in `OVERVIEW_*_SYMBOLS` would otherwise surface as a permanently empty row: the
    hub would hold a subscription no upstream ever answers, and the snapshot would just
    list it as unavailable forever.
    """
    if not symbols:
        raise RuntimeError(f"OVERVIEW_{market.value.upper()}_SYMBOLS resolved to an empty list")
    if len(symbols) > _MAX_SYMBOLS_PER_MARKET:
        raise RuntimeError(
            f"OVERVIEW_{market.value.upper()}_SYMBOLS has {len(symbols)} entries; "
            f"at most {_MAX_SYMBOLS_PER_MARKET} may be streamed on the public socket"
        )
    if len(set(symbols)) != len(symbols):
        raise RuntimeError(f"OVERVIEW_{market.value.upper()}_SYMBOLS repeats a symbol")
    bad = [s for s in symbols if not pattern.match(s)]
    if bad:
        raise RuntimeError(
            f"OVERVIEW_{market.value.upper()}_SYMBOLS contains invalid symbol(s): {', '.join(bad)}"
        )
    return symbols


SYMBOLS: dict[Market, list[str]] = {
    Market.crypto: _validated(Market.crypto, OVERVIEW_CRYPTO_SYMBOLS, CRYPTO_SYMBOL_PATTERN),
    Market.forex: _validated(Market.forex, OVERVIEW_FOREX_SYMBOLS, PAIR_PATTERN),
    Market.stocks: _validated(Market.stocks, OVERVIEW_STOCKS_SYMBOLS, STOCK_SYMBOL_PATTERN),
}

HUBS: dict[Market, BaseHub] = {
    Market.crypto: crypto_hub,
    Market.forex: forex_hub,
    Market.stocks: stocks_hub,
}

# Public sockets currently open, by peer address, plus the process total.
_open_by_ip: Counter[str] = Counter()
_open_total = 0

# Replies the reader produces. Bounded: a client spamming `ping` must not be able to grow
# this without limit, and dropping a pong it asked for too fast is the right failure.
_CONTROL_QUEUE_SIZE = 16


def _now() -> datetime:
    return datetime.now(timezone.utc)


# --------------------------------------------------------------------------- #
# Normalising three quote shapes into one
# --------------------------------------------------------------------------- #


def _from_crypto(quote) -> MarketTick:
    # Binance has no staleness notion of its own — the market never closes, so anything
    # other than a live tick means the connection is degraded. Same rule the matcher uses.
    return MarketTick(
        market=Market.crypto,
        symbol=quote.symbol,
        price=quote.last_price,
        change=quote.price_change,
        change_percent=quote.price_change_percent,
        at=quote.event_time,
        stale=(_now() - quote.event_time).total_seconds() > CRYPTO_STALE_SECONDS,
    )


def _from_forex(quote) -> MarketTick:
    return MarketTick(
        market=Market.forex,
        symbol=quote.symbol,
        # The mid, not the bid: a headline rate should not favour one side of the spread.
        price=quote.mid,
        change=quote.change,
        change_percent=quote.change_percent,
        currency=quote.symbol.split("-")[-1],
        at=quote.quoted_at,
        stale=quote.stale,
        # FX has no central order book (see order-book.tsx) — the real bid/ask/spread is
        # the honest analogue, and the hub already ticks these in real time per quote.
        bid=quote.bid,
        ask=quote.ask,
        spread=quote.spread,
        spread_pips=quote.spread_pips,
    )


def _from_stocks(quote) -> MarketTick:
    return MarketTick(
        market=Market.stocks,
        symbol=quote.symbol,
        price=quote.price,
        change=quote.change,
        change_percent=quote.change_percent,
        currency=quote.currency,
        at=quote.quoted_at,
        stale=quote.stale,
    )


TRANSLATORS = {
    Market.crypto: _from_crypto,
    Market.forex: _from_forex,
    Market.stocks: _from_stocks,
}


def _tick(market: Market, quote) -> MarketTick | None:
    """Translate one upstream quote, refusing to emit a row it cannot price."""
    try:
        tick = TRANSLATORS[market](quote)
    except (AttributeError, TypeError, ValueError, ArithmeticError) as exc:
        # One malformed quote must not take the socket down or, worse, be reported as a
        # price. Skipping it leaves the previous value on screen, which is honest.
        logger.warning("Overview could not normalise %s quote %r: %s", market.value, quote, exc)
        return None
    # A feed that reports a price of zero is reporting "no price", not a free asset.
    if tick.price is None or tick.price <= Decimal(0):
        logger.warning("Overview dropped %s %s: non-positive price %s", market.value, tick.symbol, tick.price)
        return None
    return tick


def _snapshot() -> tuple[list[MarketTick], list[str]]:
    """Whatever the hubs have cached right now, plus the symbols nothing has priced yet.

    Reads the caches only — `register()` has already warmed them, so this costs no upstream
    call and cannot block the handshake behind a provider timeout.
    """
    ticks: list[MarketTick] = []
    missing: list[str] = []
    for market, symbols in SYMBOLS.items():
        hub = HUBS[market]
        priced: set[str] = set()
        for quote in hub.snapshot(symbols):
            tick = _tick(market, quote)
            if tick is not None:
                ticks.append(tick)
                priced.add(tick.symbol)
        missing.extend(f"{market.value}:{s}" for s in symbols if s not in priced)
    return ticks, missing


def _dropped(subs: dict[Market, Subscriber]) -> int:
    """Ticks shed across all three feeds for this socket, so a client can see it fell behind."""
    return sum(sub.dropped for sub in subs.values())


def _translate(market: Market, frame) -> OverviewFrame | None:
    """Turn one hub frame into a public frame, or None if it has no public meaning."""
    if frame.type is StreamFrameType.quote and frame.quote is not None:
        tick = _tick(market, frame.quote)
        return None if tick is None else OverviewFrame(type=StreamFrameType.quote, at=_now(), tick=tick)
    if frame.type is StreamFrameType.upstream:
        return OverviewFrame(
            type=StreamFrameType.upstream, at=_now(), market=market, state=frame.state
        )
    # resynced/deleted belong to the watchlist lifecycle, which this feed does not have.
    return None


# --------------------------------------------------------------------------- #
# The socket
# --------------------------------------------------------------------------- #


async def _send(ws: WebSocket, frame: OverviewFrame) -> None:
    # exclude_none keeps frames small — most fields are irrelevant to any given type.
    await ws.send_text(frame.model_dump_json(exclude_none=True))


def _offer(control: asyncio.Queue, frame: OverviewFrame) -> None:
    """Queue a reader-produced reply. Dropped if the client is outrunning its own socket."""
    with contextlib.suppress(asyncio.QueueFull):
        control.put_nowait(frame)


async def _reader(ws: WebSocket, subs: dict[Market, Subscriber], control: asyncio.Queue) -> None:
    """Handle client commands. Replies are queued, never written here — see module docstring."""
    while True:
        raw = await ws.receive_text()
        try:
            command = ClientCommand.model_validate_json(raw)
        except ValidationError:
            _offer(control, OverviewFrame(
                type=StreamFrameType.error, at=_now(),
                detail='Expected {"action": "ping"} or {"action": "resync"}',
            ))
            continue

        if command.action == "ping":
            _offer(control, OverviewFrame(
                type=StreamFrameType.pong, at=_now(), dropped=_dropped(subs)
            ))
            continue

        # The symbol set is fixed configuration, so there is nothing to re-bind: a resync
        # is simply the current snapshot again.
        ticks, missing = _snapshot()
        _offer(control, OverviewFrame(
            type=StreamFrameType.snapshot, at=_now(),
            symbols={m: list(s) for m, s in SYMBOLS.items()},
            ticks=ticks,
            detail=f"No quote yet for: {', '.join(missing)}" if missing else None,
        ))


async def _pump(ws: WebSocket, subs: dict[Market, Subscriber], control: asyncio.Queue) -> None:
    """Select over the three hub queues plus the control channel, filling silence with
    heartbeats. Backpressure stays in the hub subscriber queues, which already shed the
    oldest tick — no second buffer, so no second shedding policy to keep in step."""
    # task -> the market it reads for, or None for the control channel.
    sources: dict[asyncio.Task, Market | None] = {}

    def arm(market: Market | None) -> None:
        queue = control if market is None else subs[market].queue
        sources[asyncio.create_task(queue.get())] = market

    for market in subs:
        arm(market)
    arm(None)

    try:
        while True:
            done, _pending = await asyncio.wait(
                set(sources),
                timeout=OVERVIEW_HEARTBEAT_SECONDS,
                return_when=asyncio.FIRST_COMPLETED,
            )
            if not done:
                await _send(ws, OverviewFrame(
                    type=StreamFrameType.heartbeat, at=_now(), dropped=_dropped(subs)
                ))
                continue
            for task in done:
                market = sources.pop(task)
                item = task.result()
                arm(market)  # re-arm before writing, so no tick is missed while sending
                frame = item if market is None else _translate(market, item)
                if frame is not None:
                    await _send(ws, frame)
    finally:
        for task in sources:
            task.cancel()


@router.websocket("/overview/stream")
async def overview_stream(ws: WebSocket):
    """Public live prices for the headline crypto, forex and equity symbols.

    Connect to `/market/overview/stream` — **no token required**, this is public market
    data. On success the server sends `subscribed` (the symbol set per market and each
    upstream's connectivity), then a `snapshot` of every cached price, then a `quote` per
    tick, with `heartbeat` frames during quiet periods and `upstream` frames when one of
    the three feeds connects or drops. Send `{"action":"ping"}` for a `pong`, or
    `{"action":"resync"}` for a fresh snapshot.

    Every price is a JSON string, not a number, so no precision is lost in transit. A tick
    carries `stale: true` when it is outside that feed's freshness window — on a weekend
    every forex and equity row is stale, which is the market being closed, not a fault.

    Close codes: 4429 too many open public sockets (per address or process-wide).
    """
    global _open_total

    await ws.accept()
    ip = client_ip(ws) or "unknown"

    # Checked after accept so the client gets a close code and reason it can act on; a
    # pre-accept reject is an opaque handshake failure in the browser.
    if _open_total >= OVERVIEW_MAX_SOCKETS:
        await ws.close(code=WS_CLOSE_TOO_MANY, reason="Public stream is at capacity, retry shortly")
        return
    if _open_by_ip[ip] >= OVERVIEW_MAX_SOCKETS_PER_IP:
        await ws.close(
            code=WS_CLOSE_TOO_MANY,
            reason=f"At most {OVERVIEW_MAX_SOCKETS_PER_IP} public streams per address",
        )
        return

    _open_by_ip[ip] += 1
    _open_total += 1

    subs: dict[Market, Subscriber] = {}
    reader: asyncio.Task | None = None
    control: asyncio.Queue = asyncio.Queue(maxsize=_CONTROL_QUEUE_SIZE)
    try:
        # Registering warms each hub's cache for these symbols, so the snapshot below is a
        # cache read rather than three provider round-trips on every connect.
        for market, hub in HUBS.items():
            subs[market] = await hub.register(_INSTANCE_ID, set(SYMBOLS[market]))

        await _send(ws, OverviewFrame(
            type=StreamFrameType.subscribed, at=_now(),
            symbols={m: list(s) for m, s in SYMBOLS.items()},
            markets={m: h.upstream_connected for m, h in HUBS.items()},
        ))

        ticks, missing = _snapshot()
        await _send(ws, OverviewFrame(
            type=StreamFrameType.snapshot, at=_now(), ticks=ticks,
            detail=f"No quote yet for: {', '.join(missing)}" if missing else None,
        ))

        reader = asyncio.create_task(_reader(ws, subs, control), name="overview-ws-reader")
        pump = asyncio.create_task(_pump(ws, subs, control), name="overview-ws-pump")
        done, pending = await asyncio.wait({reader, pump}, return_when=asyncio.FIRST_COMPLETED)
        for task in pending:
            task.cancel()
        for task in done:
            # Surfaces a genuine bug instead of closing the socket silently.
            with contextlib.suppress(WebSocketDisconnect, asyncio.CancelledError):
                task.result()
    except WebSocketDisconnect:
        pass
    except Exception:
        logger.exception("Public overview stream failed")
        with contextlib.suppress(Exception):
            await ws.close(code=status.WS_1011_INTERNAL_ERROR, reason="Stream error")
    finally:
        if reader is not None:
            reader.cancel()
        for market, sub in subs.items():
            await HUBS[market].unregister(sub)
        _open_total -= 1
        _open_by_ip[ip] -= 1
        # Drop the key rather than leaving a zero behind, so the counter cannot grow one
        # entry per address that has ever connected.
        if _open_by_ip[ip] <= 0:
            del _open_by_ip[ip]
