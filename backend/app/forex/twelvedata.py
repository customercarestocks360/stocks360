"""Twelve Data (https://twelvedata.com) — a second forex candle source, used only when
`FOREX_TWELVEDATA_API_KEY` is set.

Why a second source at all, when `upstream.py` already builds candles from AwesomeAPI ticks
and Yahoo: both are measurably short of real intraday FX data. AwesomeAPI's tick endpoint is
hard-capped at 100 rows per call regardless of what is asked for (probed directly — requesting
1000 still returns exactly 100), which is only ~77 minutes at its own ~46s tick spacing. Yahoo's
FX bars degrade at fine intervals because the venue rounds before publishing: probed directly,
EUR/USD's 1-minute bars came back **100% `open == high == low == close`** — every bar a flat
dash — and 5-minute ~18% flat. Twelve Data publishes genuine OHLC at every interval this app
uses, confirmed the same way (real, distinct bodies at 1-minute, 1000 bars per call).

That candle quality is also why this file exists rather than pointing everyone at Twelve
Data's own `demo` key: it is documented as being "only used for initial familiarity" and,
tested directly, 401s every pair except its two showcase ones (EUR/USD, USD/JPY) — fine for
trying the API, not a stand-in for a real key on a multi-pair watchlist. A real key is free
and takes about ten seconds at https://twelvedata.com/pricing; until one is set in
`FOREX_TWELVEDATA_API_KEY`, `enabled()` is false and `upstream.candles()` never calls this
module at all — the existing AwesomeAPI/Yahoo path is the whole story, same as before.
"""

import logging
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from typing import Any

import httpx

from app.core.config import (
    FOREX_TIMEOUT_SECONDS,
    FOREX_TWELVEDATA_API_KEY,
    FOREX_TWELVEDATA_URL,
)
from app.schemas.forex import Candle
from app.schemas.stocks import Interval

logger = logging.getLogger(__name__)

_client: httpx.AsyncClient | None = None

# This app's interval enum -> Twelve Data's own interval strings. `2m` has no Twelve Data
# equivalent (their finest steps are 1min/5min/15min/30min/45min/1h/2h/4h/1day/1week/1month)
# and is left out on purpose: nothing in this app requests it for forex, and `candles()`
# below returns `None` for anything not in this map so the caller falls back cleanly.
_INTERVAL_MAP: dict[Interval, str] = {
    Interval.m1: "1min",
    Interval.m5: "5min",
    Interval.m15: "15min",
    Interval.m30: "30min",
    Interval.m60: "1h",
    Interval.d1: "1day",
    Interval.wk1: "1week",
    Interval.mo1: "1month",
}

# Twelve Data's own per-request ceiling on the free plan — the most one call can return.
_OUTPUT_SIZE = 1000


def enabled() -> bool:
    return bool(FOREX_TWELVEDATA_API_KEY)


def start() -> None:
    """Opens the client only when a key is configured — the whole point is that this is
    optional, so an unconfigured deployment should not carry an idle connection pool for it."""
    global _client
    if _client is None and enabled():
        _client = httpx.AsyncClient(
            base_url=FOREX_TWELVEDATA_URL,
            timeout=FOREX_TIMEOUT_SECONDS,
            headers={"Accept": "application/json"},
        )
        logger.info("Forex Twelve Data client ready (%s)", FOREX_TWELVEDATA_URL)


async def stop() -> None:
    global _client
    if _client is not None:
        await _client.aclose()
        _client = None


def _dec(value: Any) -> Decimal:
    try:
        return Decimal(str(value))
    except (InvalidOperation, TypeError):
        return Decimal(0)


def _at(raw: str) -> datetime:
    # `1day`/`1week`/`1month` come back as a bare date; everything intraday carries a time.
    fmt = "%Y-%m-%d" if len(raw) <= 10 else "%Y-%m-%d %H:%M:%S"
    return datetime.strptime(raw, fmt).replace(tzinfo=timezone.utc)


async def candles(pair: str, interval: Interval) -> list[Candle] | None:
    """Real OHLC bars from Twelve Data, oldest first, or `None`.

    `None` covers every "try the other provider instead" case on purpose — an interval this
    module does not map, a pair Twelve Data does not carry, a bad key, an exhausted quota, a
    network hiccup — none of which is the caller's problem to surface as a `502`, since
    `upstream.candles()` has a working fallback for all of them.
    """
    td_interval = _INTERVAL_MAP.get(interval)
    if td_interval is None or _client is None:
        return None

    try:
        res = await _client.get(
            "/time_series",
            params={
                "symbol": pair.replace("-", "/"),
                "interval": td_interval,
                "outputsize": _OUTPUT_SIZE,
                "order": "ASC",
                "timezone": "UTC",
                "apikey": FOREX_TWELVEDATA_API_KEY,
            },
        )
    except httpx.HTTPError as exc:
        logger.warning("Twelve Data request failed for %s: %s", pair, exc)
        return None

    if res.status_code != 200:
        logger.warning("Twelve Data %s -> %s %s", pair, res.status_code, res.text[:200])
        return None

    payload = res.json()
    values = payload.get("values")
    if payload.get("status") == "error" or not values:
        logger.info(
            "Twelve Data has no %s series for %s: %s",
            td_interval, pair, payload.get("message", "no `values`"),
        )
        return None

    out: list[Candle] = []
    for row in values:
        try:
            open_ = _dec(row["open"])
            close = _dec(row["close"])
            change = close - open_
            out.append(
                Candle(
                    at=_at(row["datetime"]),
                    open=open_,
                    high=_dec(row["high"]),
                    low=_dec(row["low"]),
                    close=close,
                    change=change,
                    change_percent=(
                        (change / open_ * 100).quantize(Decimal("0.0001")) if open_ else Decimal(0)
                    ),
                )
            )
        except (KeyError, ValueError, InvalidOperation):
            continue
    return out or None
