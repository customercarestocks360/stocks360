"""Venue parameters. Everything tunable about the simulated exchange lives here.

The numbers are picked to match what a real USDT venue charges and enforces, so a
strategy tested here does not get a nasty surprise about fees or minimums later.
"""

from decimal import Decimal

# --- fees -------------------------------------------------------------------
TAKER_FEE_BPS = 10  # 0.10%, Binance/OKX spot taker
MAKER_FEE_BPS = 5   # 0.05%, resting limit orders pay less

# --- deposits ---------------------------------------------------------------
DEFAULT_CHAIN = "TRC20"
CHAINS = ("TRC20", "ERC20")
REQUIRED_CONFIRMATIONS = {"TRC20": 20, "ERC20": 12}
MIN_DEPOSIT_USDT = Decimal("1")

# --- withdrawals ------------------------------------------------------------
WITHDRAWAL_FEE_USDT = {"TRC20": Decimal("1"), "ERC20": Decimal("8")}
MIN_WITHDRAWAL_USDT = Decimal("10")
# Broadcasts do fail: bad memo, node rejection, chain congestion. 8% keeps the
# failure path exercised instead of decorative.
WITHDRAWAL_FAILURE_RATE = 0.08

# --- markets ----------------------------------------------------------------
# spread_bps is the full bid/ask spread; impact_bps is extra slippage per 100k
# USDT of notional, which is what makes a big market order fill worse than a small one.
MARKETS = (
    {
        "symbol": "BTC/USDT",
        "base": "BTC",
        "price": Decimal("64000.00"),
        "annual_vol": Decimal("0.55"),
        "annual_drift": Decimal("0.10"),
        "spread_bps": 2,
        "impact_bps": 12,
        "tick_size": Decimal("0.01"),
        "step_size": Decimal("0.00001"),
        "min_quantity": Decimal("0.00010"),
    },
    {
        "symbol": "ETH/USDT",
        "base": "ETH",
        "price": Decimal("3100.00"),
        "annual_vol": Decimal("0.70"),
        "annual_drift": Decimal("0.05"),
        "spread_bps": 3,
        "impact_bps": 20,
        "tick_size": Decimal("0.01"),
        "step_size": Decimal("0.0001"),
        "min_quantity": Decimal("0.0010"),
    },
)

# One tick of the price feed is five minutes of market time.
TICK_SECONDS = 300
SECONDS_PER_YEAR = Decimal(365 * 24 * 3600)
