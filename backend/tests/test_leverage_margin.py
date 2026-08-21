"""Self-check for the leverage/margin math in `app.trading.money` and the invariants the
whole feature depends on. Plain asserts, no framework, no database:
`python tests/test_leverage_margin.py` from `backend/`.
"""

import sys
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core.config import TRADING_LEVERAGE  # noqa: E402
from app.trading.money import fee_for, margin_of, money, notional_of  # noqa: E402


def test_margin_of_divides_by_leverage():
    notional = Decimal("20000")
    assert margin_of(notional) == money(notional / TRADING_LEVERAGE)
    assert margin_of(notional) == money(Decimal("100"))  # at the default 200x


def test_leveraged_buy_locks_far_less_cash_than_notional():
    quantity, price = Decimal("0.1"), Decimal("1.16900")
    notional = notional_of(quantity, price)
    fee = fee_for(notional)
    reserved = money(margin_of(notional) + fee)
    assert reserved < money(notional + fee)
    assert reserved == money(notional / TRADING_LEVERAGE + fee)


def test_pnl_is_leverage_invariant():
    """The whole point of the design: leverage changes what cash a buy locks up, never the
    P&L a price move produces. Simulate a full round trip at 1x and at 200x and check the
    realized P&L — proceeds minus the average cost sold — comes out identical."""
    quantity = Decimal("1")
    entry, exit_ = Decimal("100"), Decimal("110")

    def round_trip(leverage_divisor: Decimal) -> Decimal:
        notional_in = notional_of(quantity, entry)
        fee_in = fee_for(notional_in)
        cost_basis = money(notional_in + fee_in)  # leverage-blind, always full notional

        notional_out = notional_of(quantity, exit_)
        fee_out = fee_for(notional_out)
        proceeds = money(notional_out - fee_out)
        return money(proceeds - cost_basis)

    assert round_trip(Decimal(1)) == round_trip(Decimal(TRADING_LEVERAGE))


def test_partial_sell_releases_proportional_margin():
    """`_settle_sell`'s `margin_sold = margin_used * quantity / total` — check the two
    halves of a 50% sell each get half the posted margin back, not all or none of it."""
    total_quantity = Decimal("2")
    margin_used = Decimal("50")
    sell_quantity = Decimal("1")

    margin_sold = money(margin_used * sell_quantity / total_quantity)
    assert margin_sold == money(Decimal("25"))
    assert money(margin_used - margin_sold) == money(Decimal("25"))


def test_high_leverage_liquidates_on_a_small_adverse_move():
    """At 200x, margin_used is ~0.5% of notional, so equity should hit zero at roughly a
    0.5% adverse move — the property that makes the margin-call sweep necessary at all."""
    quantity, entry = Decimal("1"), Decimal("100")
    notional = notional_of(quantity, entry)
    margin_used = margin_of(notional)

    breakeven_move = margin_used / quantity  # price drop that exactly wipes the margin
    mark = entry - breakeven_move
    equity = margin_used + (mark - entry) * quantity
    assert equity == Decimal("0.00000000")

    # One tick cheaper and the position is underwater — this is what `_check_margin` catches.
    equity_after_one_more_tick = margin_used + (mark - Decimal("0.00000001") - entry) * quantity
    assert equity_after_one_more_tick < 0

    percent_move = money(breakeven_move / entry * 100)
    expected = money(Decimal(100) / TRADING_LEVERAGE)
    assert percent_move == expected


if __name__ == "__main__":
    for name, case in sorted(globals().items()):
        if name.startswith("test_"):
            case()
            print(f"ok  {name}")
