"""Price simulation.

Each market walks as geometric Brownian motion with a per-asset volatility and drift,
which is the cheapest model that still produces the two things a trading simulator has
to get right: prices are always positive, and returns compound rather than add.

Execution is not free. A market order crosses half the spread and then pays impact
proportional to its own notional, so a 50k order fills worse than a 500 one. Limit
orders that rest and get hit pay no slippage at all -- that difference is the whole
reason a strategy prefers one over the other, so it is modelled rather than assumed away.
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import ROUND_DOWN, ROUND_UP, Decimal
from random import Random

from .config import MARKETS, SECONDS_PER_YEAR, TICK_SECONDS
from .models import NotFound, Side
from .money import bps_between, to_tick, usdt

_HALF = Decimal("0.5")
_PER_100K = Decimal(100_000)
_BPS = Decimal(10_000)
_PEG_PULL = Decimal("0.25")


@dataclass
class Market:
    symbol: str
    base: str
    price: Decimal
    annual_vol: Decimal
    annual_drift: Decimal
    spread_bps: int
    impact_bps: int
    tick_size: Decimal
    step_size: Decimal
    min_quantity: Decimal
    quote: str = "USDT"


def normalise_symbol(symbol: str) -> str:
    """Accept `BTC/USDT`, `USDT/BTC`, `BTCUSDT` or `btc` and return `BTC/USDT`.

    The quote asset is always USDT here, so `USDT/BTC` is read as the same market
    rather than rejected -- but it is normalised, because a pair whose name can be
    spelled two ways is a position-keying bug waiting to happen.
    """
    text = (symbol or "").upper().replace("-", "/").replace("_", "/").strip()
    if "/" in text:
        left, _, right = text.partition("/")
        base = right if left == "USDT" else left
    elif text.endswith("USDT"):
        base = text[: -len("USDT")]
    else:
        base = text
    return f"{base}/USDT"


class PriceFeed:
    """Mutable set of markets plus the USDT/USD rate. Seed it for a reproducible run."""

    def __init__(self, seed: int | None = None):
        self._rng = Random(seed)
        self.markets: dict[str, Market] = {m["symbol"]: Market(**m) for m in MARKETS}
        self.usdt_usd = Decimal("1.0000")
        self.ticks = 0

    # --- lookup ---
    def market(self, symbol: str) -> Market:
        key = normalise_symbol(symbol)
        try:
            return self.markets[key]
        except KeyError:
            raise NotFound(f"unknown market '{symbol}', have {', '.join(self.markets)}") from None

    def mid(self, symbol: str) -> Decimal:
        return self.market(symbol).price

    def bid(self, symbol: str) -> Decimal:
        market = self.market(symbol)
        return to_tick(market.price - self._half_spread(market), market.tick_size, ROUND_DOWN)

    def ask(self, symbol: str) -> Decimal:
        market = self.market(symbol)
        return to_tick(market.price + self._half_spread(market), market.tick_size, ROUND_UP)

    def quote(self, symbol: str) -> dict:
        market = self.market(symbol)
        return {
            "symbol": market.symbol,
            "base": market.base,
            "quote": market.quote,
            "mid": market.price,
            "bid": self.bid(market.symbol),
            "ask": self.ask(market.symbol),
            "spread_bps": market.spread_bps,
            "min_quantity": market.min_quantity,
            "step_size": market.step_size,
            "tick_size": market.tick_size,
        }

    # --- movement ---
    def tick(self, steps: int = 1) -> None:
        """Advance every market `steps` five-minute bars."""
        dt = Decimal(TICK_SECONDS) / SECONDS_PER_YEAR
        sqrt_dt = dt.sqrt()
        for _ in range(max(0, steps)):
            self.ticks += 1
            for market in self.markets.values():
                sigma = market.annual_vol
                shock = Decimal(repr(self._rng.gauss(0.0, 1.0)))
                drift = (market.annual_drift - sigma * sigma * _HALF) * dt
                exponent = drift + sigma * sqrt_dt * shock
                market.price = to_tick(market.price * exponent.exp(), market.tick_size)
            self._drift_peg()

    def shock(self, symbol: str, percent: Decimal | str) -> Decimal:
        """Move one market by a fixed percentage -- the news-headline case.

        Also what the example script uses to guarantee both a winning and a losing
        trade, instead of hoping a random walk cooperates.
        """
        market = self.market(symbol)
        factor = Decimal(1) + Decimal(percent) / Decimal(100)
        market.price = max(market.tick_size, to_tick(market.price * factor, market.tick_size))
        return market.price

    def _drift_peg(self) -> None:
        """USDT is pegged, not fixed: it wanders a few bps and gets pulled back."""
        noise = Decimal(repr(self._rng.gauss(0.0, 0.0004)))
        rate = self.usdt_usd + (Decimal(1) - self.usdt_usd) * _PEG_PULL + noise
        pegged = min(Decimal("1.005"), max(Decimal("0.995"), rate))
        self.usdt_usd = pegged.quantize(Decimal("0.0001"))

    # --- execution ---
    def _half_spread(self, market: Market) -> Decimal:
        return market.price * Decimal(market.spread_bps) / (_BPS * 2)

    def fill_price(self, symbol: str, side: Side, quantity: Decimal) -> tuple[Decimal, Decimal]:
        """Taker fill price and the slippage it cost, in bps against the trader."""
        market = self.market(symbol)
        mid = market.price
        impact = mid * Decimal(market.impact_bps) * (quantity * mid / _PER_100K) / _BPS
        edge = self._half_spread(market) + impact
        if side is Side.BUY:
            price = to_tick(mid + edge, market.tick_size, ROUND_UP)
            return price, bps_between(price, mid)
        price = max(market.tick_size, to_tick(mid - edge, market.tick_size, ROUND_DOWN))
        return price, bps_between(mid, price)

    def to_usd(self, amount_usdt: Decimal) -> Decimal:
        return usdt(amount_usdt * self.usdt_usd)
