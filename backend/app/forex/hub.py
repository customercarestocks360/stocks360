"""Forex upstream: a poller, because the provider offers no WebSocket.

The fan-out, refcounting and re-binding all come from `streaming.hub.BaseHub`; only the
way ticks arrive differs. One batched request covers every subscribed pair, so the
one-upstream-for-everyone property holds exactly as it does for the crypto socket — the
cost is one request per interval regardless of how many clients are connected.

Two things a poller has to get right that a push feed gets for free:

* **Only broadcast real changes.** Every poll returns the current quote whether or not it
  moved; re-broadcasting it would flood clients with identical frames. Ticks are emitted
  only when the provider's timestamp or the bid actually changes.
* **Say something when idle.** With no subscribers there is nothing to poll, so upstream
  health would be unknowable. A slow canary poll keeps the indicator honest.
"""

import asyncio
import logging
import time

from app.core.config import FOREX_POLL_SECONDS
from app.forex import upstream
from app.schemas.forex import ForexFrame
from app.streaming.hub import RECONNECT_DELAYS, BaseHub

logger = logging.getLogger(__name__)

# Polled when nobody is subscribed, purely so `upstream_connected` means something.
_CANARY = "EUR-USD"
_CANARY_EVERY_SECONDS = 30


class ForexHub(BaseHub):
    name = "forex-market-hub"

    def __init__(self) -> None:
        super().__init__(frame_cls=ForexFrame)
        self._last_canary = 0.0
        # Distinguishes the first ever connection from a recovery, so clients are told
        # "reconnected" only when something actually came back.
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
                    await upstream.quotes([_CANARY])
                    self._mark_connected(reconnected=self._had_connection)
                    self._had_connection = True
                    failures = 0
                await asyncio.sleep(FOREX_POLL_SECONDS)
                continue
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                logger.warning("Forex poll failed: %s", exc)
                self._mark_disconnected()

            if self.stopping:
                break
            # Back off on repeated failure rather than hammering a struggling provider.
            delay = RECONNECT_DELAYS[min(failures, len(RECONNECT_DELAYS) - 1)]
            failures += 1
            await asyncio.sleep(delay)

    async def _poll(self, symbols: list[str]) -> None:
        rows = await upstream.quotes(symbols)
        self._mark_connected(reconnected=self._had_connection)
        self._had_connection = True
        for quote in rows:
            previous = self.cached(quote.symbol)
            if previous is not None and (
                previous.quoted_at == quote.quoted_at and previous.bid == quote.bid
            ):
                # Unchanged since the last poll — broadcast nothing. On a closed market
                # this is every pair, every poll, which is why heartbeats exist.
                continue
            self._broadcast(quote)


hub = ForexHub()
