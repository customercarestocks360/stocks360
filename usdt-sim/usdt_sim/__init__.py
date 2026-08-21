"""A USDT exchange simulation: deposits, balances, orders, P/L, withdrawals, audit trail.

    from usdt_sim import Exchange

    ex = Exchange(seed=7)
    ex.deposit("1000")
    ex.place_order("BTC/USDT", "buy", quote_amount="500")
    ex.tick(10)
    print(ex.portfolio())
"""

from .exchange import Exchange
from .models import (
    Balance,
    Deposit,
    DepositStatus,
    Event,
    Fill,
    InsufficientFunds,
    InvalidAddress,
    NotFound,
    Order,
    OrderRejected,
    OrderStatus,
    OrderType,
    Portfolio,
    Position,
    PositionSummary,
    Side,
    SimError,
    Withdrawal,
    WithdrawalStatus,
)

__all__ = [
    "Balance",
    "Deposit",
    "DepositStatus",
    "Event",
    "Exchange",
    "Fill",
    "InsufficientFunds",
    "InvalidAddress",
    "NotFound",
    "Order",
    "OrderRejected",
    "OrderStatus",
    "OrderType",
    "Portfolio",
    "Position",
    "PositionSummary",
    "Side",
    "SimError",
    "Withdrawal",
    "WithdrawalStatus",
]
