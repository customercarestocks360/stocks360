"""Binance public REST access, plus the tradable-symbol cache everything validates against.

Only public market-data endpoints are used, so there is no key, secret or signing here.
Upstream failures are translated into deliberate status codes rather than leaking through
as 500s: a timeout is a `504`, a refusal is a `502`, and upstream throttling is a `429`.
"""

import asyncio
import logging
import time
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any

import httpx
from fastapi import HTTPException, status

from app.core.config import (
    BINANCE_REST_URL,
    BINANCE_TIMEOUT_SECONDS,
    CRYPTO_SYMBOLS_TTL_SECONDS,
)
from app.schemas.crypto import (
    Kline,
    KlineInterval,
    OrderBook,
    OrderBookLevel,
    Quote,
    SymbolInfo,
    SymbolStatus,
)

logger = logging.getLogger(__name__)

_client: httpx.AsyncClient | None = None

# symbol -> SymbolInfo, refreshed on a TTL. The lock stops a cold cache from firing N
# concurrent exchangeInfo fetches when several requests arrive at once.
_symbols: dict[str, SymbolInfo] = {}
_symbols_fetched_at: float = 0.0
_symbols_lock = asyncio.Lock()


def start() -> None:
    """Open the shared HTTP client. Called once on app startup."""
    global _client
    if _client is None:
        _client = httpx.AsyncClient(
            base_url=BINANCE_REST_URL,
            timeout=BINANCE_TIMEOUT_SECONDS,
            headers={"Accept": "application/json"},
        )
        logger.info("Crypto upstream REST client ready (%s)", BINANCE_REST_URL)


async def stop() -> None:
    global _client, _symbols_fetched_at
    if _client is not None:
        await _client.aclose()
        _client = None
    _symbols.clear()
    _symbols_fetched_at = 0.0


def _ms(value: Any) -> datetime:
    return datetime.fromtimestamp(int(value) / 1000, tz=timezone.utc)


def _dec(value: Any) -> Decimal:
    return Decimal(str(value))


async def _get(path: str, params: dict | None = None) -> Any:
    if _client is None:
        raise RuntimeError("Crypto upstream is not started — start() runs on app startup")
    try:
        res = await _client.get(path, params=params)
    except httpx.TimeoutException as exc:
        raise HTTPException(
            status_code=status.HTTP_504_GATEWAY_TIMEOUT, detail="Market data upstream timed out"
        ) from exc
    except httpx.HTTPError as exc:
        logger.warning("Upstream %s failed: %s", path, exc)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY, detail="Market data upstream unreachable"
        ) from exc

    if res.status_code in (418, 429):
        # Binance bans an IP that keeps hammering after a 429, so surface it honestly
        # instead of retrying into a ban.
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Market data upstream is rate limiting this server — retry shortly",
        )
    if res.status_code >= 400:
        logger.warning("Upstream %s -> %s %s", path, res.status_code, res.text[:200])
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Market data upstream rejected the request ({res.status_code})",
        )
    return res.json()


# --------------------------------------------------------------------------- #
# Symbol universe
# --------------------------------------------------------------------------- #


async def all_symbols(refresh: bool = False) -> dict[str, SymbolInfo]:
    """The tradable-symbol map, refetched when the TTL lapses."""
    global _symbols_fetched_at
    fresh = _symbols and (time.monotonic() - _symbols_fetched_at) < CRYPTO_SYMBOLS_TTL_SECONDS
    if fresh and not refresh:
        return _symbols

    async with _symbols_lock:
        # Another waiter may have refreshed it while this one queued.
        if _symbols and not refresh and (time.monotonic() - _symbols_fetched_at) < CRYPTO_SYMBOLS_TTL_SECONDS:
            return _symbols
        payload = await _get("/api/v3/exchangeInfo", {"permissions": "SPOT"})
        parsed: dict[str, SymbolInfo] = {}
        for entry in payload.get("symbols", []):
            try:
                symbol_status = SymbolStatus(entry.get("status", ""))
            except ValueError:
                # Binance has more states than we model (PRE_TRADING, DELISTED, …); they
                # all mean "not streamable", which is what SymbolStatus.other conveys.
                symbol_status = SymbolStatus.other
            parsed[entry["symbol"]] = SymbolInfo(
                symbol=entry["symbol"],
                base_asset=entry["baseAsset"],
                quote_asset=entry["quoteAsset"],
                status=symbol_status,
                base_precision=int(entry.get("baseAssetPrecision", 8)),
                quote_precision=int(entry.get("quoteAssetPrecision", 8)),
            )
        _symbols.clear()
        _symbols.update(parsed)
        _symbols_fetched_at = time.monotonic()
        logger.info("Loaded %d spot symbols from upstream", len(_symbols))
    return _symbols


async def assert_tradable(symbols: list[str]) -> None:
    """Reject unknown or halted symbols before they reach a watchlist or a subscription.

    Subscribing to a symbol the exchange does not stream would otherwise produce a socket
    that silently never delivers a tick.
    """
    known = await all_symbols()
    unknown = [s for s in symbols if s not in known]
    if unknown:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Unknown symbol(s): {', '.join(sorted(unknown))}",
        )
    halted = [s for s in symbols if known[s].status is not SymbolStatus.trading]
    if halted:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Not currently trading: {', '.join(sorted(halted))}",
        )


# --------------------------------------------------------------------------- #
# Market data
# --------------------------------------------------------------------------- #


def quote_from_rest(row: dict) -> Quote:
    """Map a /ticker/24hr row. The stream sends the same fields under short keys, and both
    land on the same model so clients only learn one shape."""
    return Quote(
        symbol=row["symbol"],
        last_price=_dec(row["lastPrice"]),
        price_change=_dec(row["priceChange"]),
        price_change_percent=_dec(row["priceChangePercent"]),
        high=_dec(row["highPrice"]),
        low=_dec(row["lowPrice"]),
        open_price=_dec(row["openPrice"]),
        volume=_dec(row["volume"]),
        quote_volume=_dec(row["quoteVolume"]),
        bid=_dec(row["bidPrice"]) if row.get("bidPrice") else None,
        ask=_dec(row["askPrice"]) if row.get("askPrice") else None,
        trades=int(row["count"]) if row.get("count") is not None else None,
        event_time=_ms(row["closeTime"]),
    )


def quote_from_stream(event: dict) -> Quote:
    """Map a `<symbol>@ticker` payload."""
    return Quote(
        symbol=event["s"],
        last_price=_dec(event["c"]),
        price_change=_dec(event["p"]),
        price_change_percent=_dec(event["P"]),
        high=_dec(event["h"]),
        low=_dec(event["l"]),
        open_price=_dec(event["o"]),
        volume=_dec(event["v"]),
        quote_volume=_dec(event["q"]),
        bid=_dec(event["b"]) if event.get("b") else None,
        ask=_dec(event["a"]) if event.get("a") else None,
        trades=int(event["n"]) if event.get("n") is not None else None,
        event_time=_ms(event["E"]),
    )


async def ticker(symbol: str) -> Quote:
    return quote_from_rest(await _get("/api/v3/ticker/24hr", {"symbol": symbol}))


async def tickers(symbols: list[str]) -> list[Quote]:
    """Batch form. Binance wants a JSON array literal in the query string."""
    raw = await _get("/api/v3/ticker/24hr", {"symbols": '["' + '","'.join(symbols) + '"]'})
    rows = raw if isinstance(raw, list) else [raw]
    return [quote_from_rest(row) for row in rows]


def _level(pair: list) -> OrderBookLevel:
    return OrderBookLevel(price=_dec(pair[0]), quantity=_dec(pair[1]))


async def order_book(symbol: str, limit: int) -> OrderBook:
    payload = await _get("/api/v3/depth", {"symbol": symbol, "limit": limit})
    return OrderBook(
        symbol=symbol,
        last_update_id=payload["lastUpdateId"],
        bids=[_level(p) for p in payload["bids"]],
        asks=[_level(p) for p in payload["asks"]],
        at=datetime.now(timezone.utc),
    )


async def klines(symbol: str, interval: KlineInterval, limit: int) -> list[Kline]:
    rows = await _get(
        "/api/v3/klines", {"symbol": symbol, "interval": interval.value, "limit": limit}
    )
    return [
        Kline(
            open_time=_ms(r[0]),
            open=_dec(r[1]),
            high=_dec(r[2]),
            low=_dec(r[3]),
            close=_dec(r[4]),
            volume=_dec(r[5]),
            close_time=_ms(r[6]),
            quote_volume=_dec(r[7]),
            trades=int(r[8]),
        )
        for r in rows
    ]
