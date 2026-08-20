"""AwesomeAPI public FX access, plus the supported-pair cache everything validates against.

Public endpoints only — no key, no secret. Upstream failures become deliberate status
codes rather than leaking as 500s: a timeout is a `504`, a refusal a `502`, throttling a
`429`, and an unknown pair a `404`.
"""

import asyncio
import logging
import time
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from typing import Any

import httpx
from fastapi import HTTPException, status

from app.core.config import (
    FOREX_PAIRS_TTL_SECONDS,
    FOREX_REST_URL,
    FOREX_STALE_SECONDS,
    FOREX_TIMEOUT_SECONDS,
)
from app.schemas.forex import (
    Candle,
    ForexQuote,
    PairInfo,
    fx_session_state,
    pip_size,
)
from app.schemas.stocks import Interval, Range
# Candles are sourced from Yahoo rather than AwesomeAPI — see `candles()` for why. Reusing the
# equities client keeps one Yahoo integration (its pooling, retries and error mapping) instead
# of a second copy here.
from app.stocks import upstream as yahoo

logger = logging.getLogger(__name__)

_client: httpx.AsyncClient | None = None

_pairs: dict[str, PairInfo] = {}
_pairs_fetched_at: float = 0.0
_pairs_lock = asyncio.Lock()

# The provider keys its responses without the separator: EUR-USD comes back as EURUSD.
def _compact(pair: str) -> str:
    return pair.replace("-", "")


def start() -> None:
    """Open the shared HTTP client. Called once on app startup."""
    global _client
    if _client is None:
        _client = httpx.AsyncClient(
            base_url=FOREX_REST_URL,
            timeout=FOREX_TIMEOUT_SECONDS,
            headers={"Accept": "application/json"},
        )
        logger.info("Forex upstream REST client ready (%s)", FOREX_REST_URL)


async def stop() -> None:
    global _client, _pairs_fetched_at
    if _client is not None:
        await _client.aclose()
        _client = None
    _pairs.clear()
    _pairs_fetched_at = 0.0


def _dec(value: Any) -> Decimal:
    try:
        return Decimal(str(value))
    except (InvalidOperation, TypeError):
        return Decimal(0)


async def _get(path: str) -> Any:
    if _client is None:
        raise RuntimeError("Forex upstream is not started — start() runs on app startup")
    try:
        res = await _client.get(path)
    except httpx.TimeoutException as exc:
        raise HTTPException(
            status_code=status.HTTP_504_GATEWAY_TIMEOUT, detail="Forex upstream timed out"
        ) from exc
    except httpx.HTTPError as exc:
        logger.warning("Forex upstream %s failed: %s", path, exc)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY, detail="Forex upstream unreachable"
        ) from exc

    if res.status_code == 404:
        # The provider says CoinNotExists for a pair it does not carry.
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Unsupported currency pair")
    if res.status_code == 429:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Forex upstream is rate limiting this server — retry shortly",
        )
    if res.status_code >= 400:
        logger.warning("Forex upstream %s -> %s %s", path, res.status_code, res.text[:200])
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Forex upstream rejected the request ({res.status_code})",
        )
    return res.json()


# --------------------------------------------------------------------------- #
# Pair universe
# --------------------------------------------------------------------------- #


async def all_pairs(refresh: bool = False) -> dict[str, PairInfo]:
    """The supported-pair map, refetched when the TTL lapses."""
    global _pairs_fetched_at
    fresh = _pairs and (time.monotonic() - _pairs_fetched_at) < FOREX_PAIRS_TTL_SECONDS
    if fresh and not refresh:
        return _pairs

    async with _pairs_lock:
        if _pairs and not refresh and (time.monotonic() - _pairs_fetched_at) < FOREX_PAIRS_TTL_SECONDS:
            return _pairs
        payload = await _get("/json/available")
        parsed: dict[str, PairInfo] = {}
        for symbol, name in payload.items():
            base, _, quote = symbol.partition("-")
            if not base or not quote:
                continue
            parsed[symbol] = PairInfo(symbol=symbol, base=base, quote=quote, name=name)
        _pairs.clear()
        _pairs.update(parsed)
        _pairs_fetched_at = time.monotonic()
        logger.info("Loaded %d forex pairs from upstream", len(_pairs))
    return _pairs


async def assert_supported(pairs: list[str]) -> None:
    """Reject unsupported pairs before they reach a watchlist or a subscription.

    Subscribing to a pair the provider does not carry would otherwise produce a socket
    that silently never delivers a tick.
    """
    known = await all_pairs()
    unknown = [p for p in pairs if p not in known]
    if unknown:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Unsupported pair(s): {', '.join(sorted(unknown))}",
        )


# --------------------------------------------------------------------------- #
# Quotes
# --------------------------------------------------------------------------- #


def quote_from_row(symbol: str, row: dict, at: datetime | None = None) -> ForexQuote:
    """Map one provider record onto the quote model, deriving what FX needs and the
    provider does not send: mid, spread, spread in pips, and staleness."""
    now = at or datetime.now(timezone.utc)
    bid, ask = _dec(row.get("bid")), _dec(row.get("ask"))
    quoted_at = datetime.fromtimestamp(int(row["timestamp"]), tz=timezone.utc)
    pip = pip_size(symbol)
    spread = ask - bid
    return ForexQuote(
        symbol=symbol,
        bid=bid,
        ask=ask,
        mid=(bid + ask) / 2,
        spread=spread,
        spread_pips=(spread / pip).quantize(Decimal("0.01")),
        pip_size=pip,
        high=_dec(row.get("high")),
        low=_dec(row.get("low")),
        change=_dec(row.get("varBid")),
        change_percent=_dec(row.get("pctChange")),
        quoted_at=quoted_at,
        stale=(now - quoted_at).total_seconds() > FOREX_STALE_SECONDS,
        market_state=fx_session_state(now),
    )


# The provider takes a comma-joined list; keep batches modest so one bad pair does not
# cost the whole request and the URL stays a sane length.
MAX_BATCH = 30


async def quotes(pairs: list[str]) -> list[ForexQuote]:
    """Batch quote lookup — one request covers every pair, which is what lets the hub
    serve any number of subscribers with a single poll."""
    out: list[ForexQuote] = []
    for start_at in range(0, len(pairs), MAX_BATCH):
        chunk = pairs[start_at:start_at + MAX_BATCH]
        payload = await _get("/json/last/" + ",".join(chunk))
        now = datetime.now(timezone.utc)
        for pair in chunk:
            row = payload.get(_compact(pair))
            if not row or "timestamp" not in row:
                continue  # the provider omits pairs it has no data for
            try:
                out.append(quote_from_row(pair, row, now))
            except (KeyError, ValueError, TypeError) as exc:
                logger.warning("Malformed forex row for %s: %s", pair, exc)
    return out


def _yahoo_symbol(pair: str) -> str:
    """`EUR-USD` is `EURUSD=X` in Yahoo's symbology."""
    return f"{_compact(pair)}=X"


# Yahoo's finest FX intervals are price-quantised: an hour of EUR/USD at 1m came back with
# every bar flat (open == high == low == close) and 5m offered barely two distinct price
# levels, because the values are rounded before publication. AwesomeAPI's tick feed is not —
# consecutive ticks read 1.16731, 1.16727, 1.16735, 1.16747 — so for the finest views the bars
# are built from those ticks instead. It only reaches ~77 minutes (100 ticks, ~46s apart),
# which is exactly the span the shortest view needs; everything longer stays on Yahoo.
_TICK_BUCKET_SECONDS = {Interval.m1: 60, Interval.m2: 120, Interval.m5: 300}
_TICK_LIMIT = 100


async def _tick_candles(pair: str, bucket: int) -> list[Candle]:
    """Real OHLC bars aggregated from the tick feed. Newest candle last."""
    rows = await _get(f"/json/{pair}/{_TICK_LIMIT}")
    # The provider returns newest first; bars are built oldest to newest.
    ticks: list[tuple[int, Decimal]] = []
    for row in reversed(rows):
        if "timestamp" not in row:
            continue
        try:
            ticks.append((int(row["timestamp"]), _dec(row.get("bid"))))
        except (KeyError, ValueError, TypeError, InvalidOperation):
            continue

    buckets: dict[int, list[Decimal]] = {}
    for stamp, price in ticks:
        if price is None or price <= 0:
            continue
        buckets.setdefault(stamp - (stamp % bucket), []).append(price)

    out: list[Candle] = []
    for start in sorted(buckets):
        prices = buckets[start]
        open_, close = prices[0], prices[-1]
        change = close - open_
        out.append(
            Candle(
                at=datetime.fromtimestamp(start, tz=timezone.utc),
                open=open_,
                high=max(prices),
                low=min(prices),
                close=close,
                change=change,
                change_percent=(
                    (change / open_ * 100).quantize(Decimal("0.0001")) if open_ else Decimal(0)
                ),
            )
        )
    return out


async def candles(pair: str, interval: Interval, span: Range) -> list[Candle]:
    """Newest candle last.

    **Not from AwesomeAPI.** Its intraday endpoint (`/json/{pair}/{n}`) returns *ticks*, not
    bars: `high` and `low` are the session extremes repeated identically on every row, and
    `varBid` is the change against the session open rather than the previous tick. Building a
    candle from that yields one bar per tick, all sharing the same high, low and open — which
    a candlestick chart draws as a row of identical dashes. It also caps at 100 ticks (~77
    minutes), so it cannot cover a day at any resolution.

    Yahoo quotes FX pairs as `EURUSD=X` with genuine per-bar OHLC, so bars come from there —
    except at the finest intervals, where Yahoo's own values are too coarse to form a body and
    the tick feed is used instead (see `_tick_candles`). Quotes and the live stream stay on
    AwesomeAPI, which publishes a real bid/ask spread that Yahoo does not.
    """
    bucket = _TICK_BUCKET_SECONDS.get(interval)
    if bucket is not None:
        bars = await _tick_candles(pair, bucket)
        # The tick feed can be short or briefly empty; Yahoo is the fallback rather than a gap.
        if len(bars) >= 5:
            return bars

    # One extra decimal past Yahoo's hint: a major's hint is 4, but it trades in fractional
    # pips, and rounding to 4 flattens sub-pip bars into dashes.
    rows, _ = await yahoo.candles(_yahoo_symbol(pair), interval, span, extra_precision=1)
    out: list[Candle] = []
    for row in rows:
        # The FX candle schema carries change/change_percent; with real bars these are the
        # bar's own move, where before they were the whole session's.
        change = row.close - row.open
        percent = (change / row.open * 100) if row.open else Decimal(0)
        out.append(
            Candle(
                at=row.at,
                open=row.open,
                high=row.high,
                low=row.low,
                close=row.close,
                change=change,
                change_percent=percent.quantize(Decimal("0.0001")),
            )
        )
    return out
