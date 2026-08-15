"""Forex market data, watchlist instances, and one WebSocket per instance.

The route surface mirrors `/crypto` so a client learns one shape, minus the order book —
FX is over-the-counter and has no central book to publish — and plus `/forex/session`,
because a 24/5 market needs to say when it is shut.

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
    FOREX_HEARTBEAT_SECONDS,
    FOREX_MAX_SOCKETS_PER_USER,
    FOREX_MAX_SYMBOLS_PER_WATCHLIST,
    FOREX_MAX_WATCHLISTS,
)
from app.forex import repository, upstream
from app.forex.hub import hub
from app.schemas.common import NOT_FOUND, UNAUTHORIZED, UNAVAILABLE
from app.schemas.forex import (
    PAIR_PATTERN,
    RATE_LIMITED,
    UNKNOWN_PAIR,
    UPSTREAM_ERROR,
    WATCHLIST_CONFLICT,
    CandleSeries,
    CandleSeriesKind,
    ForexFrame,
    ForexQuote,
    PairInfo,
    SessionInfo,
    Pair,
    Watchlist,
    WatchlistCreate,
    WatchlistId,
    WatchlistQuotes,
    WatchlistSymbolsAdd,
    WatchlistUpdate,
    fx_session_state,
    split_pairs,
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
from app.streaming.hub import Subscriber

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/forex", tags=["forex"])

# Live socket count per uid, so one account cannot pin every worker slot.
_open_sockets: Counter[str] = Counter()

_MAX_BATCH_PAIRS = 30


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _stream_path(watchlist_id: str) -> str:
    return f"/forex/watchlists/{watchlist_id}/stream"


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


def _parse_pairs(values: list[str]) -> list[str]:
    """Normalise a batch symbol param, rejecting nonsense before it reaches upstream."""
    pairs = sorted(set(split_pairs(values)))
    if not pairs:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="`symbols` is empty"
        )
    if len(pairs) > _MAX_BATCH_PAIRS:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"At most {_MAX_BATCH_PAIRS} pairs per call, got {len(pairs)}",
        )
    malformed = [p for p in pairs if not PAIR_PATTERN.match(p)]
    if malformed:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Malformed pair(s): {', '.join(malformed)}",
        )
    return pairs


async def _snapshot(pairs: list[str]) -> tuple[list[ForexQuote], list[str]]:
    """Prefer the hub's live cache, fill the rest from REST.

    A freshly subscribed pair has no cached tick until the next poll, which on a quiet or
    closed market may be a long wait — long enough to look broken.
    """
    quotes = {q.symbol: q for q in hub.snapshot(pairs)}
    missing = [p for p in pairs if p not in quotes]
    if missing:
        try:
            for quote in await upstream.quotes(missing):
                quotes[quote.symbol] = quote
        except HTTPException as exc:
            logger.warning("Forex snapshot fill failed for %s: %s", missing, exc.detail)
    ordered = [quotes[p] for p in sorted(pairs) if p in quotes]
    return ordered, sorted(p for p in pairs if p not in quotes)


# --------------------------------------------------------------------------- #
# Market data
# --------------------------------------------------------------------------- #


@router.get(
    "/pairs",
    response_model=list[PairInfo],
    responses={**UNAUTHORIZED, **UPSTREAM_ERROR, **RATE_LIMITED},
    summary="Supported currency pairs",
    description="The pair universe every watchlist is validated against, cached "
    "server-side. Filter by base, quote or substring.",
)
async def list_pairs(
    _: dict = Depends(get_current_user),
    base: str | None = Query(default=None, min_length=3, max_length=4, examples=["EUR"]),
    quote: str | None = Query(default=None, min_length=3, max_length=4, examples=["USD"]),
    search: str | None = Query(default=None, min_length=1, max_length=16, examples=["jpy"]),
    limit: int = Query(200, ge=1, le=1000),
):
    known = await upstream.all_pairs()
    want_base = base.upper() if base else None
    want_quote = quote.upper() if quote else None
    needle = search.upper() if search else None
    out = [
        info
        for info in known.values()
        if (want_base is None or info.base == want_base)
        and (want_quote is None or info.quote == want_quote)
        and (needle is None or needle in info.symbol)
    ]
    out.sort(key=lambda i: i.symbol)
    return out[:limit]


@router.get(
    "/session",
    response_model=SessionInfo,
    responses={**UNAUTHORIZED},
    summary="Whether the FX market is open",
    description="The interbank week runs Sunday 21:00 UTC to Friday 21:00 UTC. Holidays "
    "are not modelled — a holiday shows up as `stale` on the quotes instead.",
)
async def market_session(_: dict = Depends(get_current_user)):
    at = _now()
    state = fx_session_state(at)
    return SessionInfo(
        market_state=state,
        at=at,
        detail=(
            "Interbank market open"
            if state.value == "open"
            else "Interbank market closed — quotes hold Friday's close until Sunday 21:00 UTC"
        ),
    )


@router.get(
    "/quote/{pair}",
    response_model=ForexQuote,
    responses={**UNAUTHORIZED, **UNKNOWN_PAIR, **UPSTREAM_ERROR, **RATE_LIMITED},
    summary="Quote for one pair",
    description="Served from the live poll cache when the pair is already being streamed "
    "for someone, otherwise fetched from the upstream. Carries bid, ask, mid, and the "
    "spread in both price terms and pips.",
)
async def get_quote(pair: Pair, _: dict = Depends(get_current_user)):
    # `Pair` normalises then pattern-checks, so a malformed shape is a 422 here and only a
    # well-formed but unsupported pair reaches the 404 below.
    await upstream.assert_supported([pair])
    cached = hub.cached(pair)
    if cached is not None:
        return cached
    found = await upstream.quotes([pair])
    if not found:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=f"No quote available for {pair}"
        )
    return found[0]


@router.get(
    "/quotes",
    response_model=list[ForexQuote],
    responses={**UNAUTHORIZED, **UNKNOWN_PAIR, **UPSTREAM_ERROR, **RATE_LIMITED},
    summary="Quotes for several pairs",
    description="`?symbols=EUR-USD,GBP-USD` or repeated `?symbols=` params — both work, "
    f"and `EURUSD` / `EUR/USD` are accepted too. Capped at {_MAX_BATCH_PAIRS} per call.",
)
async def get_quotes(
    symbols: Annotated[list[str], Query(min_length=1, max_length=_MAX_BATCH_PAIRS)],
    _: dict = Depends(get_current_user),
):
    pairs = _parse_pairs(symbols)
    await upstream.assert_supported(pairs)
    return await upstream.quotes(pairs)


@router.get(
    "/candles/{pair}",
    response_model=CandleSeries,
    responses={**UNAUTHORIZED, **UNKNOWN_PAIR, **UPSTREAM_ERROR, **RATE_LIMITED},
    summary="Candles",
    description="Newest candle last. `daily` gives one candle per trading day; "
    "`intraday` gives the provider's most recent snapshots.",
)
async def get_candles(
    pair: Pair,
    _: dict = Depends(get_current_user),
    series: CandleSeriesKind = Query(CandleSeriesKind.daily),
    limit: int = Query(90, ge=1, le=360),
):
    await upstream.assert_supported([pair])
    rows = await upstream.candles(pair, series, limit)
    return CandleSeries(symbol=pair, series=series, count=len(rows), candles=rows)


@router.get(
    "/stream/stats",
    response_model=StreamStats,
    responses={**UNAUTHORIZED},
    summary="Fan-out diagnostics",
    description="Upstream health and how many sockets, watchlists and pairs this process "
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
    responses={**UNAUTHORIZED, **UNKNOWN_PAIR, **WATCHLIST_CONFLICT, **UPSTREAM_ERROR, **UNAVAILABLE},
    summary="Create a watchlist instance",
    description="Each watchlist gets its own WebSocket, returned as `stream_url`. Pairs "
    "are validated against the live pair universe, so a socket can never be opened on "
    "something the provider will not quote.",
)
async def create_watchlist(payload: WatchlistCreate, claims: dict = Depends(get_current_user)):
    uid = claims["uid"]
    await upstream.assert_supported(payload.symbols)
    if await asyncio.to_thread(repository.count_for_user, uid) >= FOREX_MAX_WATCHLISTS:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Watchlist limit reached ({FOREX_MAX_WATCHLISTS}) — delete one first",
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
        market_state=fx_session_state(), quotes=quotes, unavailable=unavailable, at=_now(),
    )


@router.patch(
    "/watchlists/{watchlist_id}",
    response_model=Watchlist,
    responses={**UNAUTHORIZED, **NOT_FOUND, **UNKNOWN_PAIR, **WATCHLIST_CONFLICT, **UPSTREAM_ERROR, **UNAVAILABLE},
    summary="Rename a watchlist or replace its pairs",
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
        await upstream.assert_supported(payload.symbols)
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
    responses={**UNAUTHORIZED, **NOT_FOUND, **UNKNOWN_PAIR, **WATCHLIST_CONFLICT, **UPSTREAM_ERROR, **UNAVAILABLE},
    summary="Add pairs to a watchlist",
    description="Idempotent — re-adding a pair already held is a no-op, not an error.",
)
async def add_watchlist_symbols(
    watchlist_id: WatchlistId,
    payload: WatchlistSymbolsAdd,
    claims: dict = Depends(get_current_user),
):
    uid = claims["uid"]
    doc = await _load(uid, watchlist_id)
    await upstream.assert_supported(payload.symbols)
    combined = set(doc["symbols"]) | set(payload.symbols)
    if len(combined) > FOREX_MAX_SYMBOLS_PER_WATCHLIST:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"That would hold {len(combined)} pairs; the cap is "
            f"{FOREX_MAX_SYMBOLS_PER_WATCHLIST}",
        )
    updated = await asyncio.to_thread(repository.add_symbols, uid, watchlist_id, payload.symbols)
    if updated is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Watchlist not found")
    await hub.rebind(watchlist_id, set(updated["symbols"]), updated["version"])
    return _as_watchlist(updated)


@router.delete(
    "/watchlists/{watchlist_id}/symbols/{pair}",
    response_model=Watchlist,
    responses={**UNAUTHORIZED, **NOT_FOUND, **WATCHLIST_CONFLICT, **UNAVAILABLE},
    summary="Remove one pair from a watchlist",
    description="A watchlist must keep at least one pair, since an empty one has nothing "
    "to stream — removing the last pair is a `409`. Delete the watchlist instead.",
)
async def remove_watchlist_symbol(
    watchlist_id: WatchlistId,
    pair: Pair,
    claims: dict = Depends(get_current_user),
):
    uid = claims["uid"]
    doc = await _load(uid, watchlist_id)
    if pair not in doc["symbols"]:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"{pair} is not in this watchlist",
        )
    if len(doc["symbols"]) == 1:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A watchlist must keep at least one pair — delete the watchlist instead",
        )
    updated = await asyncio.to_thread(repository.remove_symbol, uid, watchlist_id, pair)
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


async def _send(ws: WebSocket, frame: ForexFrame) -> None:
    # exclude_none keeps frames small — most fields are irrelevant to any given type.
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
        # verify_token is blocking (it may call Firebase), so keep it off the loop.
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
            sub.offer(ForexFrame(
                type=StreamFrameType.error, at=_now(),
                detail='Expected {"action": "ping"} or {"action": "resync"}',
            ))
            continue

        if command.action == "ping":
            sub.offer(ForexFrame(type=StreamFrameType.pong, at=_now(), dropped=sub.dropped))
            continue

        doc = await asyncio.to_thread(repository.get, uid, sub.watchlist_id)
        if doc is None:
            sub.offer(ForexFrame(
                type=StreamFrameType.deleted, at=_now(),
                watchlist_id=sub.watchlist_id, detail="Watchlist deleted",
            ))
            continue
        if set(doc["symbols"]) != sub.symbols:
            await hub.rebind(sub.watchlist_id, set(doc["symbols"]), doc["version"])
        else:
            quotes, _missing = await _snapshot(doc["symbols"])
            sub.offer(ForexFrame(
                type=StreamFrameType.resynced, at=_now(), watchlist_id=doc["id"],
                version=doc["version"], symbols=sorted(doc["symbols"]), quotes=quotes,
            ))


async def _pump(ws: WebSocket, sub: Subscriber) -> None:
    """Drain the subscriber queue to the wire, filling silence with heartbeats.

    On a closed FX market the silence is the normal case: nothing ticks from Friday
    evening to Sunday evening, so heartbeats are the only thing distinguishing a shut
    market from a dead socket.
    """
    while True:
        try:
            frame = await asyncio.wait_for(sub.queue.get(), timeout=FOREX_HEARTBEAT_SECONDS)
        except asyncio.TimeoutError:
            frame = ForexFrame(
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
    """Live quotes for one forex watchlist instance.

    Connect to `/forex/watchlists/{id}/stream?token=<firebase id token>`. On success the
    server sends `subscribed`, then a `snapshot`, then a `quote` per change, with
    `heartbeat` frames during quiet periods. Editing the watchlist over REST pushes a
    `resynced` frame; deleting it pushes `deleted` and closes.

    Because the upstream is polled rather than pushed, a `quote` frame means the price
    actually moved — an unchanged poll broadcasts nothing. Expect none at all while the
    market is closed.

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
        # Same response whether it does not exist or belongs to someone else.
        await ws.close(code=WS_CLOSE_NOT_FOUND, reason="Watchlist not found")
        return

    if _open_sockets[uid] >= FOREX_MAX_SOCKETS_PER_USER:
        await ws.close(
            code=WS_CLOSE_TOO_MANY,
            reason=f"At most {FOREX_MAX_SOCKETS_PER_USER} open streams per user",
        )
        return

    _open_sockets[uid] += 1
    sub = await hub.register(watchlist_id, set(doc["symbols"]))
    reader: asyncio.Task | None = None
    try:
        await _send(ws, ForexFrame(
            type=StreamFrameType.subscribed, at=_now(), watchlist_id=doc["id"],
            version=doc["version"], symbols=sorted(doc["symbols"]),
            state="connected" if hub.upstream_connected else "disconnected",
            detail=f"FX market is {fx_session_state().value}",
        ))
        quotes, unavailable = await _snapshot(doc["symbols"])
        await _send(ws, ForexFrame(
            type=StreamFrameType.snapshot, at=_now(), watchlist_id=doc["id"],
            version=doc["version"], quotes=quotes,
            detail=f"No quote for: {', '.join(unavailable)}" if unavailable else None,
        ))

        reader = asyncio.create_task(_reader(ws, sub, uid), name=f"forex-ws-reader-{doc['id']}")
        pump = asyncio.create_task(_pump(ws, sub), name=f"forex-ws-pump-{doc['id']}")
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
        logger.exception("Forex watchlist stream %s failed", watchlist_id)
        with contextlib.suppress(Exception):
            await ws.close(code=status.WS_1011_INTERNAL_ERROR, reason="Stream error")
    finally:
        if reader is not None:
            reader.cancel()
        await hub.unregister(sub)
        _open_sockets[uid] -= 1
        if _open_sockets[uid] <= 0:
            del _open_sockets[uid]
