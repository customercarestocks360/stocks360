"""Concurrency and degraded-mode checks for the shared forex cache."""

import asyncio
import time
from datetime import datetime, timezone
from decimal import Decimal

from fastapi import HTTPException

from app.core.config import FOREX_QUOTE_CACHE_SECONDS
from app.forex import upstream
from app.schemas.forex import Candle
from app.schemas.stocks import Interval, Range


def _row(symbol: str = "EURUSD") -> dict:
    return {
        "code": symbol,
        "bid": "1.1000",
        "ask": "1.1002",
        "high": "1.1050",
        "low": "1.0950",
        "varBid": "0.0010",
        "pctChange": "0.09",
        "timestamp": str(int(time.time())),
    }


def test_concurrent_quote_requests_are_one_upstream_flight(monkeypatch):
    calls = 0
    upstream._quotes.clear()

    async def fake_get(path: str):
        nonlocal calls
        calls += 1
        await asyncio.sleep(0.01)
        return {"EURUSD": _row()}

    monkeypatch.setattr(upstream, "_get", fake_get)

    async def scenario():
        results = await asyncio.gather(
            *(upstream.quotes(["EUR-USD"]) for _ in range(1000))
        )
        assert all(rows[0].symbol == "EUR-USD" for rows in results)

    asyncio.run(scenario())
    assert calls == 1


def test_recent_quote_survives_provider_rate_limit(monkeypatch):
    upstream._quotes.clear()
    quote = upstream.quote_from_row("EUR-USD", _row())
    upstream._quotes["EUR-USD"] = (
        quote,
        time.monotonic() - FOREX_QUOTE_CACHE_SECONDS - 1,
    )

    async def rate_limited(_path: str):
        raise HTTPException(status_code=429, detail="limited")

    monkeypatch.setattr(upstream, "_get", rate_limited)
    rows = asyncio.run(upstream.quotes(["EUR-USD"]))
    assert rows == [quote]


def test_concurrent_candle_requests_are_one_upstream_flight(monkeypatch):
    calls = 0
    upstream._candle_cache.clear()
    upstream._candle_locks.clear()
    candle = Candle(
        at=datetime.now(timezone.utc),
        open=Decimal("1.1"),
        high=Decimal("1.2"),
        low=Decimal("1.0"),
        close=Decimal("1.15"),
        change=Decimal("0.05"),
        change_percent=Decimal("4.5455"),
    )

    async def fake_candles(_pair: str, _interval: Interval, _span: Range):
        nonlocal calls
        calls += 1
        await asyncio.sleep(0.01)
        return [candle]

    monkeypatch.setattr(upstream, "_candles_uncached", fake_candles)

    async def scenario():
        results = await asyncio.gather(
            *(
                upstream.candles("EUR-USD", Interval.m1, Range.d1)
                for _ in range(1000)
            )
        )
        assert all(rows == [candle] for rows in results)

    asyncio.run(scenario())
    assert calls == 1
