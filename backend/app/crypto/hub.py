"""Crypto upstream: one persistent Binance combined stream for the whole process.

Everything about subscriber bookkeeping and fan-out lives in `streaming.hub.BaseHub`;
this class only knows how to hold the connection and translate its frames.
"""

import asyncio
import json
import logging

import websockets

from app.core.config import BINANCE_WS_URL
from app.crypto import upstream
from app.crypto.upstream import quote_from_stream
from app.schemas.crypto import CryptoFrame
from app.streaming.hub import RECONNECT_DELAYS, BaseHub

logger = logging.getLogger(__name__)


class CryptoHub(BaseHub):
    name = "crypto-market-hub"

    def __init__(self) -> None:
        super().__init__(frame_cls=CryptoFrame)
        self._ws: websockets.ClientConnection | None = None
        self._next_id = 0

    async def _teardown(self) -> None:
        if self._ws is not None:
            try:
                await self._ws.close()
            except Exception:
                pass
            self._ws = None

    async def _fetch(self, symbols: list[str]) -> list:
        return await upstream.tickers(symbols)

    async def _subscribe(self, symbols: set[str]) -> None:
        await self._send("SUBSCRIBE", symbols)

    async def _unsubscribe(self, symbols: set[str]) -> None:
        await self._send("UNSUBSCRIBE", symbols)

    async def _send(self, method: str, symbols: set[str]) -> None:
        """Adjust the upstream subscription. A closed socket needs no message — the
        reconnect resubscribes the whole live set from the refcounts."""
        if not symbols or self._ws is None:
            return
        self._next_id += 1
        payload = {
            "method": method,
            "params": [f"{s.lower()}@ticker" for s in sorted(symbols)],
            "id": self._next_id,
        }
        try:
            await self._ws.send(json.dumps(payload))
        except Exception as exc:  # the read loop will notice and reconnect
            logger.warning("Upstream %s failed: %s", method, exc)

    async def _run(self) -> None:
        attempt = 0
        while not self.stopping:
            try:
                async with websockets.connect(
                    BINANCE_WS_URL, open_timeout=15, ping_interval=20, ping_timeout=20
                ) as ws:
                    self._ws = ws
                    reconnected = attempt > 0
                    attempt = 0
                    logger.info("Upstream market stream connected")

                    # Resubscribe from the refcounts, so a reconnect restores exactly the
                    # symbols still being watched — including any added while it was down.
                    await self._send("SUBSCRIBE", await self.live_symbols())
                    self._mark_connected(reconnected)

                    async for raw in ws:
                        self._handle(raw)
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                logger.warning("Upstream market stream dropped: %s", exc)
            finally:
                self._ws = None
                self._mark_disconnected()

            if self.stopping:
                break
            delay = RECONNECT_DELAYS[min(attempt, len(RECONNECT_DELAYS) - 1)]
            attempt += 1
            logger.info("Reconnecting to upstream market stream in %ss", delay)
            await asyncio.sleep(delay)

    def _handle(self, raw: str | bytes) -> None:
        try:
            event = json.loads(raw)
        except ValueError:
            logger.warning("Unparseable upstream frame: %r", raw[:120])
            return
        if not isinstance(event, dict):
            return
        # Subscribe/unsubscribe acknowledgements look like {"result": null, "id": n}.
        if "result" in event and "id" in event:
            return
        if event.get("e") != "24hrTicker":
            return
        try:
            self._broadcast(quote_from_stream(event))
        except (KeyError, ValueError) as exc:
            logger.warning("Malformed ticker event: %s", exc)


hub = CryptoHub()
