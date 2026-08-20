"""Crypto market data, watchlist instances, and one WebSocket per instance.

Every route is `async def` because the upstream calls are async, which means the blocking
pymongo calls have to be pushed to a thread explicitly — a bare `repository.get()` here
would stall the event loop, and with it every other socket this process is serving.
"""

import asyncio
import contextlib
import logging
from collections import Counter
from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Response, WebSocket, status
from pydantic import ValidationError
from pymongo.errors import DuplicateKeyError
from starlette.websockets import WebSocketDisconnect

from app.auth.dependencies import get_current_user
from app.core.config import (
    CRYPTO_HEARTBEAT_SECONDS,
    CRYPTO_MAX_SOCKETS_PER_USER,
    CRYPTO_MAX_SYMBOLS_PER_WATCHLIST,
    CRYPTO_MAX_WATCHLISTS,
)
from app.crypto import repository, upstream
from app.crypto.hub import hub
from app.schemas.common import NOT_FOUND, UNAUTHORIZED, UNAVAILABLE
from app.streaming.ws_auth import accepted_subprotocol, authenticate
from app.schemas.streaming import (
    WS_CLOSE_DELETED,
    WS_CLOSE_NOT_FOUND,
    WS_CLOSE_TOO_MANY,
    ClientCommand,
    StreamFrameType,
    StreamStats,
)
from app.streaming.hub import Subscriber
from app.schemas.crypto import (
    RATE_LIMITED,
    SYMBOL_PATTERN,
    UNKNOWN_SYMBOL,
    UPSTREAM_ERROR,
    WATCHLIST_CONFLICT,
    CryptoFrame,
    KlineInterval,
    KlineSeries,
    OrderBook,
    OrderBookDepth,
    Quote,
    SymbolInfo,
    Watchlist,
    WatchlistCreate,
    WatchlistId,
    WatchlistQuotes,
    WatchlistSymbolsAdd,
    WatchlistUpdate,
    split_symbols,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/crypto", tags=["crypto"])

# Live socket count per uid, so one account cannot pin every worker slot.
_open_sockets: Counter[str] = Counter()


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _stream_path(watchlist_id: str) -> str:
    return f"/crypto/watchlists/{watchlist_id}/stream"


def _as_watchlist(doc: dict) -> Watchlist:
    return Watchlist(
        id=doc["id"],
        name=doc["name"],
        symbols=doc["symbols"],
        version=doc["version"],
        stream_url=_stream_path(doc["id"]),
        created_at=doc["created_at"],
        updated_at=doc["updated_at"],
    )


async def _load(uid: str, watchlist_id: str) -> dict:
    doc = await asyncio.to_thread(repository.get, uid, watchlist_id)
    if doc is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Watchlist not found")
    return doc


# --------------------------------------------------------------------------- #
# Market data
# --------------------------------------------------------------------------- #


@router.get(
    "/symbols",
    response_model=list[SymbolInfo],
    responses={**UNAUTHORIZED, **UPSTREAM_ERROR, **RATE_LIMITED},
    summary="Tradable spot symbols",
    description="The symbol universe every watchlist is validated against, cached server-side. "
    "Filter by quote asset or substring.",
)
async def list_symbols(
    _: dict = Depends(get_current_user),
    quote_asset: str | None = Query(default=None, min_length=2, max_length=16, examples=["USDT"]),
    search: str | None = Query(default=None, min_length=1, max_length=16, examples=["btc"]),
    tradable_only: bool = Query(default=True, description="Exclude halted and delisted symbols"),
    limit: int = Query(200, ge=1, le=2000),
):
    known = await upstream.all_symbols()
    needle = search.upper() if search else None
    wanted = quote_asset.upper() if quote_asset else None
    out = [
        info
        for info in known.values()
        if (not tradable_only or info.status.value == "TRADING")
        and (wanted is None or info.quote_asset == wanted)
        and (needle is None or needle in info.symbol)
    ]
    out.sort(key=lambda i: i.symbol)
    return out[:limit]


@router.get(
    "/ticker/{symbol}",
    response_model=Quote,
    responses={**UNAUTHORIZED, **UNKNOWN_SYMBOL, **UPSTREAM_ERROR, **RATE_LIMITED},
    summary="24h ticker for one symbol",
    description="Served from the live stream cache when the symbol is already being "
    "streamed for someone, otherwise fetched from the upstream REST API.",
)
async def get_ticker(symbol: str, _: dict = Depends(get_current_user)):
    symbol = symbol.upper()
    await upstream.assert_tradable([symbol])
    cached = hub.cached(symbol)
    return cached if cached is not None else await upstream.ticker(symbol)


_MAX_BATCH_SYMBOLS = 50


def _parse_symbols(values: list[str]) -> list[str]:
    """Normalise a batch symbol param, rejecting nonsense before it reaches upstream."""
    symbols = sorted(set(split_symbols(values)))
    if not symbols:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="`symbols` is empty"
        )
    if len(symbols) > _MAX_BATCH_SYMBOLS:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"At most {_MAX_BATCH_SYMBOLS} symbols per call, got {len(symbols)}",
        )
    malformed = [s for s in symbols if not SYMBOL_PATTERN.match(s)]
    if malformed:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Malformed symbol(s): {', '.join(malformed)}",
        )
    return symbols


@router.get(
    "/tickers",
    response_model=list[Quote],
    responses={**UNAUTHORIZED, **UNKNOWN_SYMBOL, **UPSTREAM_ERROR, **RATE_LIMITED},
    summary="24h tickers for several symbols",
    description="`?symbols=BTCUSDT,ETHUSDT` or repeated `?symbols=` params — both work. "
    f"Capped at {_MAX_BATCH_SYMBOLS} per call to stay inside the upstream request weight.",
)
async def get_tickers(
    symbols: Annotated[list[str], Query(min_length=1, max_length=_MAX_BATCH_SYMBOLS)],
    _: dict = Depends(get_current_user),
):
    parsed = _parse_symbols(symbols)
    await upstream.assert_tradable(parsed)
    return await upstream.tickers(parsed)


@router.get(
    "/orderbook/{symbol}",
    response_model=OrderBook,
    responses={**UNAUTHORIZED, **UNKNOWN_SYMBOL, **UPSTREAM_ERROR, **RATE_LIMITED},
    summary="Order book depth",
    description="`limit` is restricted to the depths the upstream actually accepts.",
)
async def get_order_book(
    symbol: str,
    _: dict = Depends(get_current_user),
    limit: OrderBookDepth = Query(OrderBookDepth.d100),
):
    symbol = symbol.upper()
    await upstream.assert_tradable([symbol])
    return await upstream.order_book(symbol, int(limit))


@router.get(
    "/klines/{symbol}",
    response_model=KlineSeries,
    # No UNAUTHORIZED: this route is public, so it can never answer 401.
    responses={**UNKNOWN_SYMBOL, **UPSTREAM_ERROR, **RATE_LIMITED},
    summary="Candlesticks",
    description="Newest candle last. **No token required** — this is public market data, the "
    "same stance `/market/overview/stream` takes. `interval` accepts the standard set from "
    "1m to 1M.",
)
async def get_klines(
    symbol: str,
    interval: KlineInterval = Query(KlineInterval.h1),
    limit: int = Query(200, ge=1, le=1000),
):
    symbol = symbol.upper()
    await upstream.assert_tradable([symbol])
    candles = await upstream.klines(symbol, interval, limit)
    return KlineSeries(symbol=symbol, interval=interval, count=len(candles), klines=candles)


@router.get(
    "/stream/stats",
    response_model=StreamStats,
    responses={**UNAUTHORIZED},
    summary="Fan-out diagnostics",
    description="Upstream connectivity and how many sockets, watchlists and symbols this "
    "process is currently serving. Per-process, like the hub itself.",
)
async def stream_stats(claims: dict = Depends(get_current_user)):
    return StreamStats(
        **hub.stats(), your_open_sockets=_open_sockets.get(claims["uid"], 0), at=_now()
    )


# --------------------------------------------------------------------------- #
# Watchlists
# --------------------------------------------------------------------------- #


@router.post(
    "/watchlists",
    response_model=Watchlist,
    status_code=status.HTTP_201_CREATED,
    responses={**UNAUTHORIZED, **UNKNOWN_SYMBOL, **WATCHLIST_CONFLICT, **UPSTREAM_ERROR, **UNAVAILABLE},
    summary="Create a watchlist instance",
    description="Each watchlist gets its own WebSocket, returned as `stream_url`. Symbols "
    "are validated against the live symbol universe, so a socket can never be opened on "
    "something the exchange will not stream.",
)
async def create_watchlist(payload: WatchlistCreate, claims: dict = Depends(get_current_user)):
    uid = claims["uid"]
    await upstream.assert_tradable(payload.symbols)
    if await asyncio.to_thread(repository.count_for_user, uid) >= CRYPTO_MAX_WATCHLISTS:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Watchlist limit reached ({CRYPTO_MAX_WATCHLISTS}) — delete one first",
        )
    try:
        doc = await asyncio.to_thread(repository.create, uid, payload.name, payload.symbols)
    except DuplicateKeyError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"You already have a watchlist named {payload.name!r}",
        ) from exc
    return _as_watchlist(doc)


@router.get(
    "/watchlists",
    response_model=list[Watchlist],
    responses={**UNAUTHORIZED, **UNAVAILABLE},
    summary="List your watchlists",
    description="Newest first.",
)
async def list_watchlists(
    claims: dict = Depends(get_current_user),
    limit: int = Query(50, ge=1, le=200),
):
    docs = await asyncio.to_thread(repository.list_for_user, claims["uid"], limit)
    return [_as_watchlist(doc) for doc in docs]


@router.get(
    "/watchlists/{watchlist_id}",
    response_model=Watchlist,
    responses={**UNAUTHORIZED, **NOT_FOUND, **UNAVAILABLE},
    summary="One watchlist",
)
async def get_watchlist(watchlist_id: WatchlistId, claims: dict = Depends(get_current_user)):
    return _as_watchlist(await _load(claims["uid"], watchlist_id))


@router.get(
    "/watchlists/{watchlist_id}/quotes",
    response_model=WatchlistQuotes,
    responses={**UNAUTHORIZED, **NOT_FOUND, **UPSTREAM_ERROR, **RATE_LIMITED, **UNAVAILABLE},
    summary="Current quotes for a watchlist",
    description="The same snapshot a socket receives on connect, for clients that want to "
    "render before opening one.",
)
async def watchlist_quotes(watchlist_id: WatchlistId, claims: dict = Depends(get_current_user)):
    doc = await _load(claims["uid"], watchlist_id)
    quotes, stale = await _snapshot(doc["symbols"])
    return WatchlistQuotes(
        id=doc["id"], name=doc["name"], version=doc["version"],
        quotes=quotes, stale=stale, at=_now(),
    )


@router.patch(
    "/watchlists/{watchlist_id}",
    response_model=Watchlist,
    responses={**UNAUTHORIZED, **NOT_FOUND, **UNKNOWN_SYMBOL, **WATCHLIST_CONFLICT, **UPSTREAM_ERROR, **UNAVAILABLE},
    summary="Rename a watchlist or replace its symbols",
    description="Any open socket for this instance is re-bound in place and sent a "
    "`resynced` frame — no reconnect needed.",
)
async def patch_watchlist(
    watchlist_id: WatchlistId,
    payload: WatchlistUpdate,
    claims: dict = Depends(get_current_user),
):
    uid = claims["uid"]
    await _load(uid, watchlist_id)  # 404 before touching the upstream
    changes: dict = {}
    if payload.name is not None:
        changes["name"] = payload.name
    if payload.symbols is not None:
        await upstream.assert_tradable(payload.symbols)
        changes["symbols"] = payload.symbols
    try:
        doc = await asyncio.to_thread(repository.update, uid, watchlist_id, changes)
    except DuplicateKeyError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"You already have a watchlist named {payload.name!r}",
        ) from exc
    if doc is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Watchlist not found")
    if payload.symbols is not None:
        await hub.rebind(watchlist_id, set(doc["symbols"]), doc["version"])
    return _as_watchlist(doc)


@router.post(
    "/watchlists/{watchlist_id}/symbols",
    response_model=Watchlist,
    responses={**UNAUTHORIZED, **NOT_FOUND, **UNKNOWN_SYMBOL, **WATCHLIST_CONFLICT, **UPSTREAM_ERROR, **UNAVAILABLE},
    summary="Add symbols to a watchlist",
    description="Idempotent — re-adding a symbol already held is a no-op, not an error.",
)
async def add_watchlist_symbols(
    watchlist_id: WatchlistId,
    payload: WatchlistSymbolsAdd,
    claims: dict = Depends(get_current_user),
):
    uid = claims["uid"]
    doc = await _load(uid, watchlist_id)
    await upstream.assert_tradable(payload.symbols)
    combined = set(doc["symbols"]) | set(payload.symbols)
    if len(combined) > CRYPTO_MAX_SYMBOLS_PER_WATCHLIST:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"That would hold {len(combined)} symbols; the cap is "
            f"{CRYPTO_MAX_SYMBOLS_PER_WATCHLIST}",
        )
    updated = await asyncio.to_thread(repository.add_symbols, uid, watchlist_id, payload.symbols)
    if updated is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Watchlist not found")
    await hub.rebind(watchlist_id, set(updated["symbols"]), updated["version"])
    return _as_watchlist(updated)


@router.delete(
    "/watchlists/{watchlist_id}/symbols/{symbol}",
    response_model=Watchlist,
    responses={**UNAUTHORIZED, **NOT_FOUND, **WATCHLIST_CONFLICT, **UNAVAILABLE},
    summary="Remove one symbol from a watchlist",
    description="A watchlist must keep at least one symbol, since an empty one has nothing "
    "to stream — removing the last symbol is a `409`. Delete the watchlist instead.",
)
async def remove_watchlist_symbol(
    watchlist_id: WatchlistId,
    symbol: str,
    claims: dict = Depends(get_current_user),
):
    uid = claims["uid"]
    symbol = symbol.upper()
    doc = await _load(uid, watchlist_id)
    if symbol not in doc["symbols"]:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"{symbol} is not in this watchlist",
        )
    if len(doc["symbols"]) == 1:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A watchlist must keep at least one symbol — delete the watchlist instead",
        )
    updated = await asyncio.to_thread(repository.remove_symbol, uid, watchlist_id, symbol)
    if updated is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Watchlist not found")
    await hub.rebind(watchlist_id, set(updated["symbols"]), updated["version"])
    return _as_watchlist(updated)


@router.delete(
    "/watchlists/{watchlist_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    responses={**UNAUTHORIZED, **NOT_FOUND, **UNAVAILABLE},
    summary="Delete a watchlist",
    description=f"Any open socket for it is told and then closed with {WS_CLOSE_DELETED}.",
)
async def delete_watchlist(watchlist_id: WatchlistId, claims: dict = Depends(get_current_user)):
    deleted = await asyncio.to_thread(repository.delete, claims["uid"], watchlist_id)
    if not deleted:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Watchlist not found")
    hub.notify_deleted(watchlist_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


async def _snapshot(symbols: list[str]) -> tuple[list[Quote], list[str]]:
    """Prefer the hub's live cache, fill the rest from REST.

    A freshly subscribed symbol has no cached tick until the exchange next publishes one,
    which for a quiet pair can be seconds — long enough to look broken. One REST call on
    connect avoids handing the client an empty screen.
    """
    quotes = {q.symbol: q for q in hub.snapshot(symbols)}
    missing = [s for s in symbols if s not in quotes]
    if missing:
        try:
            for quote in await upstream.tickers(missing):
                quotes[quote.symbol] = quote
        except HTTPException as exc:
            logger.warning("Snapshot fill failed for %s: %s", missing, exc.detail)
    ordered = [quotes[s] for s in sorted(symbols) if s in quotes]
    return ordered, sorted(s for s in symbols if s not in quotes)


# --------------------------------------------------------------------------- #
# The per-instance WebSocket
# --------------------------------------------------------------------------- #


async def _send(ws: WebSocket, frame: CryptoFrame) -> None:
    # exclude_none keeps frames small — most fields are irrelevant to any given type.
    await ws.send_text(frame.model_dump_json(exclude_none=True))


async def _reader(ws: WebSocket, sub: Subscriber, uid: str) -> None:
    """Handle client commands. Only the pump writes to the socket, so everything this
    produces is queued rather than sent — two tasks writing concurrently would interleave
    frames on the wire."""
    while True:
        raw = await ws.receive_text()
        try:
            command = ClientCommand.model_validate_json(raw)
        except ValidationError:
            sub.offer(CryptoFrame(
                type=StreamFrameType.error, at=_now(),
                detail='Expected {"action": "ping"} or {"action": "resync"}',
            ))
            continue

        if command.action == "ping":
            sub.offer(CryptoFrame(type=StreamFrameType.pong, at=_now(), dropped=sub.dropped))
            continue

        doc = await asyncio.to_thread(repository.get, uid, sub.watchlist_id)
        if doc is None:
            sub.offer(CryptoFrame(
                type=StreamFrameType.deleted, at=_now(),
                watchlist_id=sub.watchlist_id, detail="Watchlist deleted",
            ))
            continue
        # rebind covers the changed case; when nothing changed, answer with the snapshot
        # the client asked for anyway.
        if set(doc["symbols"]) != sub.symbols:
            await hub.rebind(sub.watchlist_id, set(doc["symbols"]), doc["version"])
        else:
            quotes, _stale = await _snapshot(doc["symbols"])
            sub.offer(CryptoFrame(
                type=StreamFrameType.resynced, at=_now(), watchlist_id=doc["id"],
                version=doc["version"], symbols=sorted(doc["symbols"]), quotes=quotes,
            ))


async def _pump(ws: WebSocket, sub: Subscriber) -> None:
    """Drain the subscriber queue to the wire, filling silence with heartbeats."""
    while True:
        try:
            frame = await asyncio.wait_for(sub.queue.get(), timeout=CRYPTO_HEARTBEAT_SECONDS)
        except asyncio.TimeoutError:
            frame = CryptoFrame(
                type=StreamFrameType.heartbeat, at=_now(),
                watchlist_id=sub.watchlist_id, dropped=sub.dropped,
            )
        await _send(ws, frame)
        if frame.type is StreamFrameType.deleted:
            await ws.close(code=WS_CLOSE_DELETED, reason="Watchlist deleted")
            return


@router.websocket("/watchlists/{watchlist_id}/stream")
async def watchlist_stream(
    ws: WebSocket,
    watchlist_id: WatchlistId,
    token: Annotated[str | None, Query(min_length=20, max_length=8192)] = None,
):
    """Live quotes for one watchlist instance.

    Connect to `/crypto/watchlists/{id}/stream?token=<firebase id token>`. On success the
    server sends `subscribed`, then a `snapshot`, then a `quote` per tick, with
    `heartbeat` frames during quiet periods. Editing the watchlist over REST pushes a
    `resynced` frame; deleting it pushes `deleted` and closes.

    Close codes: 4401 unauthenticated, 4404 no such watchlist for this user,
    4429 too many open sockets, 4410 watchlist deleted.
    """
    await ws.accept(subprotocol=accepted_subprotocol(ws))

    claims = await authenticate(ws, token)
    if claims is None:
        return
    uid = claims["uid"]

    doc = await asyncio.to_thread(repository.get, uid, watchlist_id)
    if doc is None:
        # Same response whether it does not exist or belongs to someone else.
        await ws.close(code=WS_CLOSE_NOT_FOUND, reason="Watchlist not found")
        return

    if _open_sockets[uid] >= CRYPTO_MAX_SOCKETS_PER_USER:
        await ws.close(
            code=WS_CLOSE_TOO_MANY,
            reason=f"At most {CRYPTO_MAX_SOCKETS_PER_USER} open streams per user",
        )
        return

    _open_sockets[uid] += 1
    sub = await hub.register(watchlist_id, set(doc["symbols"]))
    reader: asyncio.Task | None = None
    try:
        await _send(ws, CryptoFrame(
            type=StreamFrameType.subscribed, at=_now(), watchlist_id=doc["id"],
            version=doc["version"], symbols=sorted(doc["symbols"]),
            state="connected" if hub.upstream_connected else "disconnected",
        ))
        quotes, stale = await _snapshot(doc["symbols"])
        await _send(ws, CryptoFrame(
            type=StreamFrameType.snapshot, at=_now(), watchlist_id=doc["id"],
            version=doc["version"], quotes=quotes,
            detail=f"No quote yet for: {', '.join(stale)}" if stale else None,
        ))

        reader = asyncio.create_task(_reader(ws, sub, uid), name=f"crypto-ws-reader-{doc['id']}")
        pump = asyncio.create_task(_pump(ws, sub), name=f"crypto-ws-pump-{doc['id']}")
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
        logger.exception("Watchlist stream %s failed", watchlist_id)
        with contextlib.suppress(Exception):
            await ws.close(code=status.WS_1011_INTERNAL_ERROR, reason="Stream error")
    finally:
        if reader is not None:
            reader.cancel()
        await hub.unregister(sub)
        _open_sockets[uid] -= 1
        if _open_sockets[uid] <= 0:
            del _open_sockets[uid]
