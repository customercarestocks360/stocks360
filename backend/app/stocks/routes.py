"""Equity market data, watchlist instances, and one WebSocket per instance.

The route surface mirrors `/crypto` and `/forex` so a client learns one shape. Where it
differs, equities differ: `/stocks/instruments` is a search rather than a downloadable
universe, and market state is per symbol because a watchlist can hold NSE and Nasdaq at
once.

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
from app.auth.service import verify_token
from app.core.config import (
    STOCKS_HEARTBEAT_SECONDS,
    STOCKS_MAX_SOCKETS_PER_USER,
    STOCKS_MAX_SYMBOLS_PER_WATCHLIST,
    STOCKS_MAX_WATCHLISTS,
)
from app.schemas.common import NOT_FOUND, UNAUTHORIZED, UNAVAILABLE
from app.schemas.stocks import (
    RATE_LIMITED,
    SYMBOL_PATTERN,
    UNKNOWN_SYMBOL,
    UPSTREAM_ERROR,
    WATCHLIST_CONFLICT,
    CandleSeries,
    Instrument,
    Interval,
    Range,
    StockFrame,
    StockQuote,
    Symbol,
    Watchlist,
    WatchlistCreate,
    WatchlistId,
    WatchlistQuotes,
    WatchlistSymbolsAdd,
    WatchlistUpdate,
    split_symbols,
)
from app.schemas.streaming import (
    WS_CLOSE_DELETED,
    WS_CLOSE_NOT_FOUND,
    WS_CLOSE_TOO_MANY,
    WS_CLOSE_UNAUTHENTICATED,
    ClientCommand,
    StreamFrameType,
    StreamStats,
)
from app.stocks import repository, upstream
from app.stocks.hub import hub
from app.streaming.hub import Subscriber

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/stocks", tags=["stocks"])

# Live socket count per uid, so one account cannot pin every worker slot.
_open_sockets: Counter[str] = Counter()

# One request per ticker upstream, so batches stay small on purpose.
_MAX_BATCH_SYMBOLS = 20


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _stream_path(watchlist_id: str) -> str:
    return f"/stocks/watchlists/{watchlist_id}/stream"


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


def _parse_symbols(values: list[str]) -> list[str]:
    symbols = sorted(set(split_symbols(values)))
    if not symbols:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="`symbols` is empty"
        )
    if len(symbols) > _MAX_BATCH_SYMBOLS:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"At most {_MAX_BATCH_SYMBOLS} tickers per call, got {len(symbols)}",
        )
    malformed = [s for s in symbols if not SYMBOL_PATTERN.match(s)]
    if malformed:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Malformed ticker(s): {', '.join(malformed)}",
        )
    return symbols


async def _snapshot(symbols: list[str]) -> tuple[list[StockQuote], list[str]]:
    """Prefer the hub's cache, fill the rest from upstream. A freshly subscribed ticker has
    no cached quote until the next poll, which at a 15s interval is long enough to look
    broken."""
    quotes = {q.symbol: q for q in hub.snapshot(symbols)}
    missing = [s for s in symbols if s not in quotes]
    if missing:
        try:
            for quote in await upstream.quotes(missing):
                quotes[quote.symbol] = quote
        except HTTPException as exc:
            logger.warning("Snapshot fill failed for %s: %s", missing, exc.detail)
    ordered = [quotes[s] for s in sorted(symbols) if s in quotes]
    return ordered, sorted(s for s in symbols if s not in quotes)


# --------------------------------------------------------------------------- #
# Instruments and market data
# --------------------------------------------------------------------------- #


@router.get(
    "/instruments",
    response_model=list[Instrument],
    responses={**UNAUTHORIZED, **UPSTREAM_ERROR, **RATE_LIMITED},
    summary="Search the instrument master",
    description="A search rather than a downloadable list: the equity universe spans every "
    "exchange and is far too large to cache the way the crypto and forex universes are. "
    "Covers NSE/BSE, US and other listings — `RELIANCE.NS`, `TCS.BO`, `AAPL`.",
)
async def search_instruments(
    _: dict = Depends(get_current_user),
    search: str = Query(min_length=1, max_length=64, examples=["reliance"]),
    limit: int = Query(20, ge=1, le=50),
):
    return await upstream.search(search, limit)


@router.get(
    "/quote/{symbol}",
    response_model=StockQuote,
    responses={**UNAUTHORIZED, **UNKNOWN_SYMBOL, **UPSTREAM_ERROR, **RATE_LIMITED},
    summary="Quote for one ticker",
    description="Served from the poll cache when the ticker is already streaming for "
    "someone, otherwise fetched upstream. `market_state` comes from that symbol's own "
    "exchange session, so NSE and Nasdaq report independently.",
)
async def get_quote(symbol: Symbol, _: dict = Depends(get_current_user)):
    cached = hub.cached(symbol)
    return cached if cached is not None else await upstream.quote(symbol)


@router.get(
    "/quotes",
    response_model=list[StockQuote],
    responses={**UNAUTHORIZED, **UNKNOWN_SYMBOL, **UPSTREAM_ERROR, **RATE_LIMITED},
    summary="Quotes for several tickers",
    description="`?symbols=AAPL,RELIANCE.NS` or repeated `?symbols=` params. Capped at "
    f"{_MAX_BATCH_SYMBOLS} because each one costs a separate upstream request.",
)
async def get_quotes(
    symbols: Annotated[list[str], Query(min_length=1, max_length=_MAX_BATCH_SYMBOLS)],
    _: dict = Depends(get_current_user),
):
    parsed = _parse_symbols(symbols)
    found = await upstream.quotes(parsed)
    if not found:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"No quotes available for: {', '.join(parsed)}",
        )
    return found


@router.get(
    "/candles/{symbol}",
    response_model=CandleSeries,
    responses={**UNAUTHORIZED, **UNKNOWN_SYMBOL, **UPSTREAM_ERROR, **RATE_LIMITED},
    summary="Candles",
    description="Newest candle last. The upstream limits how far back fine intervals go — "
    "roughly a week for `1m` — and answers a `502` when the combination is not allowed.",
)
async def get_candles(
    symbol: Symbol,
    _: dict = Depends(get_current_user),
    interval: Interval = Query(Interval.d1),
    range: Range = Query(Range.mo6),
):
    rows, currency = await upstream.candles(symbol, interval, range)
    return CandleSeries(
        symbol=symbol, interval=interval, range=range, currency=currency,
        count=len(rows), candles=rows,
    )


@router.get(
    "/stream/stats",
    response_model=StreamStats,
    responses={**UNAUTHORIZED},
    summary="Fan-out diagnostics",
    description="Upstream health and how many sockets, watchlists and tickers this process "
    "is currently serving. Per-process, like the hub itself.",
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
    description="Each watchlist gets its own WebSocket, returned as `stream_url`. Tickers "
    "are resolved upstream first, so a socket can never be opened on something that will "
    "never quote.",
)
async def create_watchlist(payload: WatchlistCreate, claims: dict = Depends(get_current_user)):
    uid = claims["uid"]
    await upstream.assert_tradable(payload.symbols)
    if await asyncio.to_thread(repository.count_for_user, uid) >= STOCKS_MAX_WATCHLISTS:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Watchlist limit reached ({STOCKS_MAX_WATCHLISTS}) — delete one first",
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
    quotes, unavailable = await _snapshot(doc["symbols"])
    return WatchlistQuotes(
        id=doc["id"], name=doc["name"], version=doc["version"],
        quotes=quotes, unavailable=unavailable, at=_now(),
    )


@router.patch(
    "/watchlists/{watchlist_id}",
    response_model=Watchlist,
    responses={**UNAUTHORIZED, **NOT_FOUND, **UNKNOWN_SYMBOL, **WATCHLIST_CONFLICT, **UPSTREAM_ERROR, **UNAVAILABLE},
    summary="Rename a watchlist or replace its tickers",
    description="Any open socket for this instance is re-bound in place and sent a "
    "`resynced` frame — no reconnect needed.",
)
async def patch_watchlist(
    watchlist_id: WatchlistId,
    payload: WatchlistUpdate,
    claims: dict = Depends(get_current_user),
):
    uid = claims["uid"]
    await _load(uid, watchlist_id)
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
    summary="Add tickers to a watchlist",
    description="Idempotent — re-adding a ticker already held is a no-op, not an error.",
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
    if len(combined) > STOCKS_MAX_SYMBOLS_PER_WATCHLIST:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"That would hold {len(combined)} tickers; the cap is "
            f"{STOCKS_MAX_SYMBOLS_PER_WATCHLIST}",
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
    summary="Remove one ticker from a watchlist",
    description="A watchlist must keep at least one ticker, since an empty one has nothing "
    "to stream — removing the last is a `409`. Delete the watchlist instead.",
)
async def remove_watchlist_symbol(
    watchlist_id: WatchlistId,
    symbol: Symbol,
    claims: dict = Depends(get_current_user),
):
    uid = claims["uid"]
    doc = await _load(uid, watchlist_id)
    if symbol not in doc["symbols"]:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"{symbol} is not in this watchlist",
        )
    if len(doc["symbols"]) == 1:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A watchlist must keep at least one ticker — delete the watchlist instead",
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


# --------------------------------------------------------------------------- #
# The per-instance WebSocket
# --------------------------------------------------------------------------- #


async def _send(ws: WebSocket, frame: StockFrame) -> None:
    await ws.send_text(frame.model_dump_json(exclude_none=True))


async def _authenticate(ws: WebSocket, token: str | None) -> dict | None:
    """Browsers cannot set headers on a WebSocket, so the token comes by query param;
    non-browser clients may still send the usual bearer header."""
    if token is None:
        header = ws.headers.get("authorization", "")
        if header.lower().startswith("bearer "):
            token = header.split(" ", 1)[1]
    if not token:
        await ws.close(code=WS_CLOSE_UNAUTHENTICATED, reason="Missing token")
        return None
    try:
        return await asyncio.to_thread(verify_token, token, True)
    except HTTPException as exc:
        code = (
            WS_CLOSE_UNAUTHENTICATED
            if exc.status_code == status.HTTP_401_UNAUTHORIZED
            else status.WS_1011_INTERNAL_ERROR
        )
        await ws.close(code=code, reason=str(exc.detail)[:120])
        return None


async def _reader(ws: WebSocket, sub: Subscriber, uid: str) -> None:
    """Handle client commands. Only the pump writes to the socket, so everything this
    produces is queued rather than sent — two tasks writing concurrently would interleave
    frames on the wire."""
    while True:
        raw = await ws.receive_text()
        try:
            command = ClientCommand.model_validate_json(raw)
        except ValidationError:
            sub.offer(StockFrame(
                type=StreamFrameType.error, at=_now(),
                detail='Expected {"action": "ping"} or {"action": "resync"}',
            ))
            continue

        if command.action == "ping":
            sub.offer(StockFrame(type=StreamFrameType.pong, at=_now(), dropped=sub.dropped))
            continue

        doc = await asyncio.to_thread(repository.get, uid, sub.watchlist_id)
        if doc is None:
            sub.offer(StockFrame(
                type=StreamFrameType.deleted, at=_now(),
                watchlist_id=sub.watchlist_id, detail="Watchlist deleted",
            ))
            continue
        if set(doc["symbols"]) != sub.symbols:
            await hub.rebind(sub.watchlist_id, set(doc["symbols"]), doc["version"])
        else:
            quotes, _missing = await _snapshot(doc["symbols"])
            sub.offer(StockFrame(
                type=StreamFrameType.resynced, at=_now(), watchlist_id=doc["id"],
                version=doc["version"], symbols=sorted(doc["symbols"]), quotes=quotes,
            ))


async def _pump(ws: WebSocket, sub: Subscriber) -> None:
    """Drain the subscriber queue to the wire, filling silence with heartbeats.

    Outside market hours the silence is the normal case — heartbeats are the only thing
    distinguishing a shut exchange from a dead socket.
    """
    while True:
        try:
            frame = await asyncio.wait_for(sub.queue.get(), timeout=STOCKS_HEARTBEAT_SECONDS)
        except asyncio.TimeoutError:
            frame = StockFrame(
                type=StreamFrameType.heartbeat, at=_now(),
                watchlist_id=sub.watchlist_id, dropped=sub.dropped,
                state="connected" if hub.upstream_connected else "disconnected",
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
    """Live quotes for one equity watchlist instance.

    Connect to `/stocks/watchlists/{id}/stream?token=<firebase id token>`. On success the
    server sends `subscribed`, then a `snapshot`, then a `quote` per change, with
    `heartbeat` frames during quiet periods. Editing the watchlist over REST pushes a
    `resynced` frame; deleting it pushes `deleted` and closes.

    The upstream is polled and delayed, so a `quote` frame means the price actually moved.
    Expect none while the exchange is shut.

    Close codes: 4401 unauthenticated, 4404 no such watchlist for this user,
    4429 too many open sockets, 4410 watchlist deleted.
    """
    await ws.accept()

    claims = await _authenticate(ws, token)
    if claims is None:
        return
    uid = claims["uid"]

    doc = await asyncio.to_thread(repository.get, uid, watchlist_id)
    if doc is None:
        await ws.close(code=WS_CLOSE_NOT_FOUND, reason="Watchlist not found")
        return

    if _open_sockets[uid] >= STOCKS_MAX_SOCKETS_PER_USER:
        await ws.close(
            code=WS_CLOSE_TOO_MANY,
            reason=f"At most {STOCKS_MAX_SOCKETS_PER_USER} open streams per user",
        )
        return

    _open_sockets[uid] += 1
    sub = await hub.register(watchlist_id, set(doc["symbols"]))
    reader: asyncio.Task | None = None
    try:
        await _send(ws, StockFrame(
            type=StreamFrameType.subscribed, at=_now(), watchlist_id=doc["id"],
            version=doc["version"], symbols=sorted(doc["symbols"]),
            state="connected" if hub.upstream_connected else "disconnected",
        ))
        quotes, unavailable = await _snapshot(doc["symbols"])
        await _send(ws, StockFrame(
            type=StreamFrameType.snapshot, at=_now(), watchlist_id=doc["id"],
            version=doc["version"], quotes=quotes,
            detail=f"No quote for: {', '.join(unavailable)}" if unavailable else None,
        ))

        reader = asyncio.create_task(_reader(ws, sub, uid), name=f"stocks-ws-reader-{doc['id']}")
        pump = asyncio.create_task(_pump(ws, sub), name=f"stocks-ws-pump-{doc['id']}")
        done, pending = await asyncio.wait({reader, pump}, return_when=asyncio.FIRST_COMPLETED)
        for task in pending:
            task.cancel()
        for task in done:
            with contextlib.suppress(WebSocketDisconnect, asyncio.CancelledError):
                task.result()
    except WebSocketDisconnect:
        pass
    except Exception:
        logger.exception("Stock watchlist stream %s failed", watchlist_id)
        with contextlib.suppress(Exception):
            await ws.close(code=status.WS_1011_INTERNAL_ERROR, reason="Stream error")
    finally:
        if reader is not None:
            reader.cancel()
        await hub.unregister(sub)
        _open_sockets[uid] -= 1
        if _open_sockets[uid] <= 0:
            del _open_sockets[uid]
