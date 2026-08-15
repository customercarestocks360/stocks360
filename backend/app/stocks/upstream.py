"""Yahoo Finance access for equities.

These endpoints are undocumented and unsanctioned. They are isolated here on purpose: the
rest of the feature talks in `Instrument`, `StockQuote` and `Candle`, so replacing Yahoo
with a licensed provider means rewriting this file and nothing else.

Two Yahoo facts that shape the code:

* **A browser user agent is mandatory.** Without one the request fails outright, which
  does not look like an auth problem when you hit it.
* **`/v7/finance/quote` now returns 401** without a session crumb, so there is no working
  unauthenticated batch quote. One quote costs one `/v8/finance/chart` request, which is
  why the hub polls gently and with bounded concurrency.
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
    STOCKS_INSTRUMENT_TTL_SECONDS,
    STOCKS_POLL_CONCURRENCY,
    STOCKS_STALE_SECONDS,
    STOCKS_TIMEOUT_SECONDS,
    YAHOO_REST_URL,
    YAHOO_USER_AGENT,
)
from app.schemas.stocks import (
    Candle,
    Instrument,
    Interval,
    MarketState,
    Range,
    StockQuote,
)

logger = logging.getLogger(__name__)

_client: httpx.AsyncClient | None = None
_gate = asyncio.Semaphore(STOCKS_POLL_CONCURRENCY)

# symbol -> (Instrument, fetched_at). Resolving is what validates a ticker exists.
_instruments: dict[str, tuple[Instrument, float]] = {}


def start() -> None:
    global _client
    if _client is None:
        _client = httpx.AsyncClient(
            base_url=YAHOO_REST_URL,
            timeout=STOCKS_TIMEOUT_SECONDS,
            headers={"Accept": "application/json", "User-Agent": YAHOO_USER_AGENT},
            follow_redirects=True,
        )
        logger.info("Stocks upstream REST client ready (%s)", YAHOO_REST_URL)


async def stop() -> None:
    global _client
    if _client is not None:
        await _client.aclose()
        _client = None
    _instruments.clear()


def _dec(value: Any) -> Decimal | None:
    if value is None:
        return None
    try:
        return Decimal(str(value))
    except (InvalidOperation, TypeError):
        return None


def _ts(value: Any) -> datetime | None:
    return datetime.fromtimestamp(int(value), tz=timezone.utc) if value else None


def _round(value: Decimal | None, hint: int) -> Decimal | None:
    """Trim IEEE noise using the instrument's own price precision.

    Yahoo rounds the headline figures but ships candle arrays as raw floats, so a close of
    305.93 arrives as 305.92999267578125. `priceHint` is the provider's own decimal count,
    which is why it is used instead of a fixed 2 — a penny stock legitimately needs more.
    """
    if value is None:
        return None
    return value.quantize(Decimal(1).scaleb(-hint))


async def _get(path: str, params: dict | None = None, *, symbol: str | None = None) -> Any:
    if _client is None:
        raise RuntimeError("Stocks upstream is not started — start() runs on app startup")
    try:
        async with _gate:
            res = await _client.get(path, params=params)
    except httpx.TimeoutException as exc:
        raise HTTPException(
            status_code=status.HTTP_504_GATEWAY_TIMEOUT, detail="Market data upstream timed out"
        ) from exc
    except httpx.HTTPError as exc:
        logger.warning("Stocks upstream %s failed: %s", path, exc)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY, detail="Market data upstream unreachable"
        ) from exc

    if res.status_code == 404:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Unknown or delisted ticker: {symbol}" if symbol else "Not found upstream",
        )
    if res.status_code == 429:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Market data upstream is rate limiting this server — retry shortly",
        )
    if res.status_code == 401:
        # Yahoo gates some endpoints behind a session crumb; treat it as our problem.
        logger.warning("Stocks upstream %s -> 401 (endpoint now requires a session)", path)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Market data upstream refused the request",
        )
    if res.status_code >= 400:
        logger.warning("Stocks upstream %s -> %s %s", path, res.status_code, res.text[:200])
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Market data upstream rejected the request ({res.status_code})",
        )
    return res.json()


# --------------------------------------------------------------------------- #
# Instruments
# --------------------------------------------------------------------------- #


def _relevance(instrument: Instrument, needle: str) -> int:
    """Lower is better. An exact ticker match outranks a company whose name merely
    mentions the word."""
    symbol = instrument.symbol.upper()
    base = symbol.split(".")[0]          # RELIANCE.NS -> RELIANCE
    name = (instrument.name or "").upper()
    if needle in (symbol, base):
        return 0
    if base.startswith(needle) or symbol.startswith(needle):
        return 1
    if name.startswith(needle):
        return 2
    if needle in name:
        return 3
    return 4


async def search(query: str, limit: int) -> list[Instrument]:
    """The instrument master is a search, not a downloadable list — the equity universe is
    far too large to cache the way the crypto and forex universes are.

    The upstream's own ranking is unreliable at small counts: asking it for five matches on
    "reliance" can leave out RELIANCE.NS entirely. So over-fetch and re-rank here, which is
    the difference between this endpoint being useful and being a curiosity.
    """
    wanted = min(50, max(limit * 4, 20))
    payload = await _get(
        "/v1/finance/search",
        {"q": query, "quotesCount": wanted, "newsCount": 0, "listsCount": 0},
    )
    rows: list[Instrument] = []
    for row in payload.get("quotes", []):
        symbol = row.get("symbol")
        if not symbol:
            continue
        rows.append(
            Instrument(
                symbol=symbol,
                name=row.get("longname") or row.get("shortname"),
                exchange=row.get("exchange"),
                full_exchange=row.get("exchDisp"),
                type=row.get("quoteType"),
                currency=row.get("currency"),
            )
        )
    needle = query.strip().upper()
    # Index as the tiebreak keeps the upstream's order within a relevance tier.
    ranked = [i for _, i in sorted(enumerate(rows),
                                   key=lambda pair: (_relevance(pair[1], needle), pair[0]))]

    # The upstream's search is not deterministic: asking it for "reliance" can come back
    # without RELIANCE.NS entirely, and re-ranking cannot recover a row that is absent. So
    # when nothing in the result is a strong ticker match, try resolving the obvious
    # candidates directly and put whatever exists at the front.
    if not ranked or _relevance(ranked[0], needle) > 1:
        found = await _resolve_candidates(needle)
        seen = {i.symbol for i in found}
        ranked = found + [i for i in ranked if i.symbol not in seen]
    return ranked[:limit]


# Tried in order when the search misses; the Indian suffixes are here because this is an
# India-first platform and NSE/BSE listings are exactly what the search drops most often.
_SUFFIXES = ("", ".NS", ".BO")


async def _resolve_candidates(needle: str) -> list[Instrument]:
    """Best-effort direct lookup of `<QUERY>`, `<QUERY>.NS` and `<QUERY>.BO`.

    Bounded to three requests and only reached when the search returned nothing strong, so
    a typo costs three cheap 404s rather than a silent "no such company".
    """
    base = needle.replace(" ", "").replace(".", "")
    if not base.isalnum() or not 1 <= len(base) <= 12:
        return []

    async def try_one(suffix: str) -> Instrument | None:
        try:
            return await resolve(base + suffix)
        except HTTPException:
            return None
        except Exception:  # a malformed payload is not worth failing the search over
            return None

    results = await asyncio.gather(*(try_one(s) for s in _SUFFIXES))
    out: list[Instrument] = []
    for instrument in results:
        if instrument is not None and instrument.symbol not in {i.symbol for i in out}:
            out.append(instrument)
    return out


def _instrument_from_meta(meta: dict) -> Instrument:
    return Instrument(
        symbol=meta["symbol"],
        name=meta.get("longName") or meta.get("shortName"),
        exchange=meta.get("exchangeName"),
        full_exchange=meta.get("fullExchangeName"),
        type=meta.get("instrumentType"),
        currency=meta.get("currency"),
    )


async def resolve(symbol: str) -> Instrument:
    """Validate a ticker by fetching it. Raises 404 when Yahoo has no such symbol."""
    hit = _instruments.get(symbol)
    if hit and (time.monotonic() - hit[1]) < STOCKS_INSTRUMENT_TTL_SECONDS:
        return hit[0]
    meta = (await _chart(symbol, Interval.d1, Range.d5))["meta"]
    instrument = _instrument_from_meta(meta)
    _instruments[symbol] = (instrument, time.monotonic())
    return instrument


async def assert_tradable(symbols: list[str]) -> None:
    """Reject tickers the upstream does not carry, before they reach a watchlist or a
    subscription — otherwise the socket would silently never deliver a tick."""
    unknown: list[str] = []
    for symbol in symbols:
        try:
            await resolve(symbol)
        except HTTPException as exc:
            if exc.status_code == status.HTTP_404_NOT_FOUND:
                unknown.append(symbol)
            else:
                raise
    if unknown:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Unknown ticker(s): {', '.join(sorted(unknown))}",
        )


# --------------------------------------------------------------------------- #
# Quotes and candles
# --------------------------------------------------------------------------- #


async def _chart(symbol: str, interval: Interval, span: Range) -> dict:
    payload = await _get(
        f"/v8/finance/chart/{symbol}",
        {"interval": interval.value, "range": span.value},
        symbol=symbol,
    )
    chart = payload.get("chart") or {}
    if chart.get("error"):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"{symbol}: {chart['error'].get('description', 'no data')}",
        )
    results = chart.get("result") or []
    if not results:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=f"No data for {symbol}"
        )
    return results[0]


def _market_state(meta: dict, now: datetime) -> tuple[MarketState, datetime | None, datetime | None]:
    """Derived from the exchange's own regular session rather than a hand-built calendar —
    a watchlist can hold NSE and Nasdaq at once, and they keep different hours."""
    regular = (meta.get("currentTradingPeriod") or {}).get("regular") or {}
    start, end = _ts(regular.get("start")), _ts(regular.get("end"))
    if start is None or end is None:
        return MarketState.unknown, start, end
    return (MarketState.open if start <= now <= end else MarketState.closed), start, end


def quote_from_chart(result: dict, now: datetime | None = None) -> StockQuote:
    now = now or datetime.now(timezone.utc)
    meta = result["meta"]
    hint = min(8, max(0, int(meta.get("priceHint") or 2)))
    price = _round(_dec(meta.get("regularMarketPrice")), hint)
    if price is None:
        raise ValueError(f"{meta.get('symbol')}: upstream returned no price")
    previous = _round(_dec(meta.get("chartPreviousClose")) or _dec(meta.get("previousClose")), hint)
    change = (price - previous) if previous is not None else None
    state, start, end = _market_state(meta, now)
    quoted_at = _ts(meta.get("regularMarketTime")) or now
    return StockQuote(
        symbol=meta["symbol"],
        name=meta.get("longName") or meta.get("shortName"),
        exchange=meta.get("fullExchangeName") or meta.get("exchangeName"),
        currency=meta.get("currency"),
        price=price,
        previous_close=previous,
        change=change,
        change_percent=(
            (change / previous * 100).quantize(Decimal("0.001"))
            if change is not None and previous
            else None
        ),
        day_high=_round(_dec(meta.get("regularMarketDayHigh")), hint),
        day_low=_round(_dec(meta.get("regularMarketDayLow")), hint),
        volume=int(meta["regularMarketVolume"]) if meta.get("regularMarketVolume") is not None else None,
        fifty_two_week_high=_dec(meta.get("fiftyTwoWeekHigh")),
        fifty_two_week_low=_dec(meta.get("fiftyTwoWeekLow")),
        market_state=state,
        session_start=start,
        session_end=end,
        quoted_at=quoted_at,
        stale=(now - quoted_at).total_seconds() > STOCKS_STALE_SECONDS,
    )


async def quote(symbol: str) -> StockQuote:
    result = await _chart(symbol, Interval.d1, Range.d5)
    cached = _instrument_from_meta(result["meta"])
    _instruments[symbol] = (cached, time.monotonic())
    return quote_from_chart(result)


async def quotes(symbols: list[str]) -> list[StockQuote]:
    """No working unauthenticated batch endpoint exists, so this fans out — bounded by the
    shared semaphore so a large watchlist cannot burst at the upstream. A failure on one
    ticker drops that ticker, not the whole poll."""
    async def one(symbol: str) -> StockQuote | None:
        try:
            return await quote(symbol)
        except HTTPException as exc:
            logger.warning("Quote failed for %s: %s", symbol, exc.detail)
        except (KeyError, ValueError, TypeError) as exc:
            logger.warning("Malformed quote for %s: %s", symbol, exc)
        return None

    results = await asyncio.gather(*(one(s) for s in symbols))
    return [q for q in results if q is not None]


async def candles(symbol: str, interval: Interval, span: Range) -> tuple[list[Candle], str | None]:
    result = await _chart(symbol, interval, span)
    stamps = result.get("timestamp") or []
    series = ((result.get("indicators") or {}).get("quote") or [{}])[0]
    opens, highs = series.get("open") or [], series.get("high") or []
    lows, closes = series.get("low") or [], series.get("close") or []
    volumes = series.get("volume") or []
    hint = min(8, max(0, int(result["meta"].get("priceHint") or 2)))

    out: list[Candle] = []
    for i, stamp in enumerate(stamps):
        close = _round(_dec(closes[i] if i < len(closes) else None), hint)
        if close is None:
            continue  # Yahoo pads gaps (holidays, halts) with nulls
        out.append(
            Candle(
                at=datetime.fromtimestamp(int(stamp), tz=timezone.utc),
                open=_round(_dec(opens[i] if i < len(opens) else None), hint) or close,
                high=_round(_dec(highs[i] if i < len(highs) else None), hint) or close,
                low=_round(_dec(lows[i] if i < len(lows) else None), hint) or close,
                close=close,
                volume=int(volumes[i]) if i < len(volumes) and volumes[i] is not None else None,
            )
        )
    return out, result["meta"].get("currency")
