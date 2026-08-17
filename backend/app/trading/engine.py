"""The matcher: what turns a resting order into a fill.

A market order is easy — the request that places it also fills it. Everything else has to
wait for the market to come to it, and something has to be watching. That something is
this.

**It watches by subscribing, not by polling.** The engine registers with each market hub
as an ordinary subscriber, under a reserved watchlist id, holding exactly the symbols that
have resting orders. That buys three things for free: the hub's reference counting keeps
those symbols subscribed upstream for as long as an order needs them and drops them the
moment the last one closes; every tick arrives as a frame in a bounded queue; and a
resting order on a symbol nobody is watching still gets a live price, which a matcher
built on the quote cache alone would not.

**A sweep runs alongside it.** Ticks do the real work, but a tick is not the only thing
that can change an order's fate: a `day` order expires with no tick involved, an order
placed while a price was already past its trigger has no new tick to wake it, and a crash
between closing an order and releasing its reservation leaves value stranded. The sweep
covers those three, and it re-reads state rather than trusting anything it remembers.

**Fills never happen against a stale or closed market.** The condition is checked on the
`Mark`, not on the frame, so a cached price from before the weekend cannot execute
anything. This is the single most important rule in the file.

Like the hubs it rides on, this is **per process**. Two workers would each run a matcher
over the same orders; the atomic claim in `claim_fill()` means they cannot both fill the
same one, but the settlement lock does not span processes, so run one worker until this
moves behind a shared queue.
"""

import asyncio
import contextlib
import logging
from datetime import datetime, timezone

from app.core.config import TRADING_ENABLED, TRADING_SWEEP_SECONDS
from app.crypto.hub import hub as crypto_hub
from app.forex.hub import hub as forex_hub
from app.schemas.streaming import StreamFrameType
from app.schemas.trading import AssetClass, OrderStatus
from app.stocks.hub import hub as stocks_hub
from app.streaming.hub import INTERNAL_PREFIX, BaseHub, Subscriber
from app.trading import pricing, repository, service

logger = logging.getLogger(__name__)

# The hubs key subscribers by watchlist id. This one is not a watchlist and cannot collide
# with one: every real id is 32 hex characters. The `__` prefix is what keeps it out of the
# fan-out diagnostics — see INTERNAL_PREFIX in streaming/hub.py.
ENGINE_SUBSCRIPTION_ID = f"{INTERNAL_PREFIX}trading_engine{INTERNAL_PREFIX}"

# An open order whose reservation never completed is a crash artefact. Given a generous
# margin over any plausible request, anything older than this is safe to reap.
_UNFUNDED_GRACE_SECONDS = 120


def _now() -> datetime:
    return datetime.now(timezone.utc)


class TradingEngine:
    def __init__(self) -> None:
        self._hubs: dict[AssetClass, BaseHub] = {
            AssetClass.crypto: crypto_hub,
            AssetClass.forex: forex_hub,
            AssetClass.stocks: stocks_hub,
        }
        self._subs: dict[AssetClass, Subscriber] = {}
        self._tasks: list[asyncio.Task] = []
        self._version = 0
        self._refresh_lock = asyncio.Lock()
        self._running = False

    # ----------------------------------------------------------- lifecycle ---
    async def start(self) -> None:
        if self._running or not TRADING_ENABLED:
            return
        self._running = True
        for asset_class, hub in self._hubs.items():
            self._subs[asset_class] = await hub.register(ENGINE_SUBSCRIPTION_ID, set())
        service.set_engine_notifier(self.refresh)
        await self.refresh()
        for asset_class in self._hubs:
            self._tasks.append(
                asyncio.create_task(
                    self._watch(asset_class), name=f"trading-matcher-{asset_class.value}"
                )
            )
        self._tasks.append(asyncio.create_task(self._sweeper(), name="trading-sweeper"))
        logger.info("Trading engine started")

    async def stop(self) -> None:
        self._running = False
        service.set_engine_notifier(None)
        for task in self._tasks:
            task.cancel()
        for task in self._tasks:
            with contextlib.suppress(asyncio.CancelledError):
                await task
        self._tasks.clear()
        for asset_class, sub in self._subs.items():
            await self._hubs[asset_class].unregister(sub)
        self._subs.clear()

    # -------------------------------------------------------- subscriptions ---
    async def refresh(self) -> None:
        """Re-point every subscription at the symbols that currently have resting orders.

        Recomputed from the database rather than tracked incrementally: a counter that
        drifts would either leak upstream subscriptions or stop feeding a live order, and
        this query is cheap next to either failure.
        """
        if not self._running:
            return
        async with self._refresh_lock:
            wanted: dict[AssetClass, set[str]] = {ac: set() for ac in self._hubs}
            for asset_class, symbol in await asyncio.to_thread(repository.resting_instruments):
                try:
                    wanted[AssetClass(asset_class)].add(symbol)
                except ValueError:
                    logger.warning("Resting order on unknown asset class %r", asset_class)

            self._version += 1
            for asset_class, symbols in wanted.items():
                sub = self._subs.get(asset_class)
                if sub is None or sub.symbols == symbols:
                    continue
                # rebind acquires and releases the hub's refcounts and warms the cache for
                # anything new, which is exactly what a freshly rested order needs.
                await self._hubs[asset_class].rebind(
                    ENGINE_SUBSCRIPTION_ID, symbols, self._version
                )

    # --------------------------------------------------------------- ticks ---
    async def _watch(self, asset_class: AssetClass) -> None:
        """Drain one feed's frames and try the orders each tick could have moved."""
        sub = self._subs[asset_class]
        while True:
            frame = await sub.queue.get()
            if getattr(frame, "type", None) is not StreamFrameType.quote:
                continue  # snapshots, heartbeats and upstream notices change nothing here
            quote = frame.quote
            if quote is None:
                continue
            try:
                await self._match_symbol(asset_class, quote.symbol)
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.exception("Matching %s %s failed", asset_class.value, quote.symbol)

    async def _match_symbol(self, asset_class: AssetClass, symbol: str) -> None:
        orders = [
            order
            for order in await asyncio.to_thread(repository.resting_orders, asset_class.value)
            if order["symbol"] == symbol
        ]
        await self._try_all(orders)

    async def _try_all(self, orders: list[dict]) -> None:
        """Oldest first, which is the only fair tie-break available without a real book."""
        for order in orders:
            mark = pricing.cached_mark(
                AssetClass(order["asset_class"]), order["symbol"], order["currency"]
            )
            if mark is None or not mark.tradable:
                continue
            filled = await service.execute(order, mark)
            if filled is not None and filled["status"] == OrderStatus.filled.value:
                logger.info("Matcher filled order %s", order["id"])

    # --------------------------------------------------------------- sweep ---
    async def _sweeper(self) -> None:
        while True:
            await asyncio.sleep(TRADING_SWEEP_SECONDS)
            try:
                await self._sweep()
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.exception("Trading sweep failed")

    async def _sweep(self) -> None:
        now = _now()

        for order in await asyncio.to_thread(repository.expiring_orders, now):
            closed = await service.close_and_release(
                order["id"], OrderStatus.expired, "Day order reached the end of the session"
            )
            if closed is not None:
                logger.info("Expired order %s", order["id"])

        # Orders whose reservation never completed, and reservations whose release never
        # completed: the two halves of the same crash window, cleaned from both ends.
        cutoff = now.timestamp() - _UNFUNDED_GRACE_SECONDS
        for order in await asyncio.to_thread(
            repository.unfunded_orders, datetime.fromtimestamp(cutoff, tz=timezone.utc)
        ):
            await service.close_and_release(
                order["id"], OrderStatus.rejected, "Order was never funded"
            )
            logger.warning("Reaped unfunded order %s", order["id"])

        for order in await asyncio.to_thread(repository.stranded_reservations):
            logger.warning("Releasing stranded reservation on order %s", order["id"])
            await service.release_reservation(order)

        # Finally, re-try everything resting. A tick is the usual trigger, but an order
        # placed while the price was already past its trigger has no tick coming.
        await self._try_all(await asyncio.to_thread(repository.resting_orders))
        await self.refresh()


engine = TradingEngine()
