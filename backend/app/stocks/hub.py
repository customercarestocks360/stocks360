"""Equities upstream: a poller, like forex, because Yahoo publishes no usable stream.

Unlike forex there is no batch endpoint either, so a poll costs one request per distinct
symbol. Reference counting is what keeps that affordable: a hundred sockets watching
RELIANCE.NS still cost one request per cycle, and the poll interval defaults to 15s
because this data is delayed anyway — polling harder would buy nothing but a ban.

Only real changes are broadcast. Outside market hours every poll returns Friday's close,
and re-sending it would flood clients with frames carrying no news.
"""

import asyncio
import logging
import time

from app.core.config import STOCKS_POLL_SECONDS
from app.schemas.stocks import StockFrame
from app.stocks import upstream
from app.streaming.hub import RECONNECT_DELAYS, BaseHub

logger = logging.getLogger(__name__)

# Polled when nobody is subscribed, purely so `upstream_connected` means something.
_CANARY = "AAPL"
_CANARY_EVERY_SECONDS = 60


class StocksHub(BaseHub):
    name = "stocks-market-hub"

    def __init__(self) -> None:
        super().__init__(frame_cls=StockFrame)
        self._last_canary = 0.0
        self._had_connection = False

    async def _fetch(self, symbols: list[str]) -> list:
        return await upstream.quotes(symbols)

    async def _run(self) -> None:
        failures = 0
        while not self.stopping:
            try:
                symbols = sorted(await self.live_symbols())
                if symbols:
                    await self._poll(symbols)
                elif time.monotonic() - self._last_canary > _CANARY_EVERY_SECONDS:
                    self._last_canary = time.monotonic()
                    await upstream.quote(_CANARY)
                    self._mark_connected(reconnected=self._had_connection)
                    self._had_connection = True
                    failures = 0
                await asyncio.sleep(STOCKS_POLL_SECONDS)
                continue
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                logger.warning("Stocks poll failed: %s", exc)
                self._mark_disconnected()

            if self.stopping:
                break
            delay = RECONNECT_DELAYS[min(failures, len(RECONNECT_DELAYS) - 1)]
            failures += 1
            await asyncio.sleep(delay)

    async def _poll(self, symbols: list[str]) -> None:
        rows = await upstream.quotes(symbols)
        if not rows:
            # Every ticker failed: that is an upstream problem, not a quiet market.
            raise RuntimeError(f"no quotes returned for {len(symbols)} symbols")
        self._mark_connected(reconnected=self._had_connection)
        self._had_connection = True
        for quote in rows:
            previous = self.cached(quote.symbol)
            if previous is not None and (
                previous.quoted_at == quote.quoted_at and previous.price == quote.price
            ):
                continue
            self._broadcast(quote)


hub = StocksHub()
