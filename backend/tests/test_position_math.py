"""Self-check for the signed-position fill arithmetic in `app.trading.money`.

Plain asserts, no framework, no database: `python tests/test_position_math.py` from
`backend/`.

These are the numbers the whole feature rests on. The invariant that catches the most is
the round-trip one: open a position and close it at the same price, and the account must be
out exactly the two commissions — no more (the user was overcharged) and no less (the venue
minted cash, which is what an unguarded leveraged round trip actually did before this).
"""

import sys
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core.config import TRADING_LEVERAGE  # noqa: E402
from app.trading.money import (  # noqa: E402
    ZERO,
    apply_fill,
    fee_for,
    margin_of,
    money,
    notional_of,
    sign_of,
)

BUY, SELL = 1, -1


def _open(side_sign: int, quantity: Decimal, price: Decimal):
    """Open a position from flat, returning (effect, position-after)."""
    notional = notional_of(quantity, price)
    fee = fee_for(notional)
    effect = apply_fill(
        quantity=ZERO,
        cost_basis=ZERO,
        cost_basis_quote=ZERO,
        margin_used=ZERO,
        side_sign=side_sign,
        fill_quantity=quantity,
        notional=notional,
        notional_quote=notional,
        fee=fee,
        margin=money(margin_of(notional) + fee),
    )
    return effect, {
        "quantity": effect.quantity_delta,
        "cost_basis": effect.basis_delta,
        "cost_basis_quote": effect.basis_quote_delta,
        "margin_used": effect.margin_delta,
    }


def _close(position: dict, side_sign: int, quantity: Decimal, price: Decimal):
    notional = notional_of(quantity, price)
    fee = fee_for(notional)
    effect = apply_fill(
        quantity=position["quantity"],
        cost_basis=position["cost_basis"],
        cost_basis_quote=position["cost_basis_quote"],
        margin_used=position["margin_used"],
        side_sign=side_sign,
        fill_quantity=quantity,
        notional=notional,
        notional_quote=notional,
        fee=fee,
        margin=money(margin_of(notional) + fee),
    )
    after = {
        "quantity": money(position["quantity"] + effect.quantity_delta),
        "cost_basis": money(position["cost_basis"] + effect.basis_delta),
        "cost_basis_quote": money(position["cost_basis_quote"] + effect.basis_quote_delta),
        "margin_used": money(position["margin_used"] + effect.margin_delta),
    }
    return effect, after


def test_sign_of():
    assert sign_of(Decimal("0")) == 0
    assert sign_of(Decimal("0.00000001")) == 1
    assert sign_of(Decimal("-0.00000001")) == -1


def test_long_round_trip_costs_exactly_two_commissions():
    """The invariant that was broken before this: a leveraged buy locked a fraction of
    notional and the matching sell credited the *full* proceeds, so a flat round trip
    handed the user most of the notional as profit. Cash out must be the fees, nothing else.
    """
    quantity, price = Decimal("1"), Decimal("100")
    opened, position = _open(BUY, quantity, price)
    fee_in = fee_for(notional_of(quantity, price))

    closed, after = _close(position, SELL, quantity, price)
    fee_out = fee_for(notional_of(quantity, price))

    cash = money(opened.cash_delta + closed.cash_delta)
    assert cash == money(-(fee_in + fee_out)), f"flat round trip moved {cash}, not the fees"
    assert after["quantity"] == 0 and after["margin_used"] == 0
    assert after["cost_basis"] == 0, "closing out left basis behind"


def test_short_round_trip_costs_exactly_two_commissions():
    quantity, price = Decimal("1"), Decimal("100")
    opened, position = _open(SELL, quantity, price)
    assert position["quantity"] < 0, "a sell from flat did not open a short"
    assert position["cost_basis"] < 0, "a short's basis is not signed"

    closed, after = _close(position, BUY, quantity, price)
    fees = money(fee_for(notional_of(quantity, price)) * 2)
    cash = money(opened.cash_delta + closed.cash_delta)
    assert cash == money(-fees), f"flat short round trip moved {cash}, not the fees"
    assert after["quantity"] == 0 and after["margin_used"] == 0 and after["cost_basis"] == 0


def test_short_profits_when_the_price_falls():
    quantity, entry, exit_ = Decimal("1"), Decimal("100"), Decimal("90")
    opened, position = _open(SELL, quantity, entry)
    closed, _ = _close(position, BUY, quantity, exit_)

    gross = money((entry - exit_) * quantity)
    fees = money(fee_for(notional_of(quantity, entry)) + fee_for(notional_of(quantity, exit_)))
    assert closed.realized == money(gross - fees), "short P&L is not (entry - exit) less fees"
    assert closed.realized > 0
    assert money(opened.cash_delta + closed.cash_delta) == closed.realized


def test_short_loses_when_the_price_rises():
    quantity, entry, exit_ = Decimal("1"), Decimal("100"), Decimal("115")
    _, position = _open(SELL, quantity, entry)
    closed, _ = _close(position, BUY, quantity, exit_)
    assert closed.realized < 0, "a short did not lose on a rally"
    gross = money((entry - exit_) * quantity)
    fees = money(fee_for(notional_of(quantity, entry)) + fee_for(notional_of(quantity, exit_)))
    assert closed.realized == money(gross - fees)


def test_long_and_short_are_mirror_images():
    """The same price move must pay a long and a short the same magnitude, opposite sign."""
    quantity, entry, exit_ = Decimal("2"), Decimal("50"), Decimal("55")
    _, long_position = _open(BUY, quantity, entry)
    long_close, _ = _close(long_position, SELL, quantity, exit_)
    _, short_position = _open(SELL, quantity, entry)
    short_close, _ = _close(short_position, BUY, quantity, exit_)

    fees = money(fee_for(notional_of(quantity, entry)) + fee_for(notional_of(quantity, exit_)))
    # Both carry the same two commissions, so adding the fees back must cancel exactly.
    assert money(long_close.realized + fees) == money(-(short_close.realized + fees))


def test_break_even_price_carries_the_entry_fee():
    quantity, price = Decimal("4"), Decimal("25")
    _, position = _open(BUY, quantity, price)
    break_even = money(position["cost_basis"] / position["quantity"])
    assert break_even > price, "average entry does not include the fee that opened it"

    # Selling exactly at break-even must land at zero less the exit commission.
    closed, _ = _close(position, SELL, quantity, break_even)
    assert closed.realized == money(-fee_for(notional_of(quantity, break_even)))


def test_unrealized_formula_holds_for_both_directions():
    """`quantity * mark - cost_basis` must agree with what closing at that mark realizes,
    up to the exit fee that closing also charges."""
    quantity = Decimal("3")
    for side_sign, entry, mark in ((BUY, Decimal("10"), Decimal("12")),
                                  (SELL, Decimal("10"), Decimal("8")),
                                  (BUY, Decimal("10"), Decimal("7")),
                                  (SELL, Decimal("10"), Decimal("13"))):
        _, position = _open(side_sign, quantity, entry)
        unrealized = money(position["quantity"] * mark - position["cost_basis"])
        closed, _ = _close(position, -side_sign, quantity, mark)
        exit_fee = fee_for(notional_of(quantity, mark))
        assert closed.realized == money(unrealized - exit_fee), (
            f"{side_sign=} {entry=} {mark=}: unrealized {unrealized} does not match "
            f"realized {closed.realized}"
        )


def test_partial_close_releases_its_share_and_no_more():
    quantity, entry = Decimal("10"), Decimal("20")
    _, position = _open(BUY, quantity, entry)
    basis, margin = position["cost_basis"], position["margin_used"]

    closed, after = _close(position, SELL, Decimal("4"), entry)
    assert after["quantity"] == Decimal("6")
    assert after["cost_basis"] == money(basis * Decimal("0.6")), "basis relief is not pro rata"
    assert after["margin_used"] == money(margin * Decimal("0.6")), "margin relief is not pro rata"
    assert closed.closed_quantity == Decimal("4")

    # Closing the rest must zero out both, with no dust left behind.
    _, flat = _close(after, SELL, Decimal("6"), entry)
    assert flat["quantity"] == 0
    assert abs(flat["cost_basis"]) <= Decimal("0.00000001")
    assert abs(flat["margin_used"]) <= Decimal("0.00000001")


def test_adding_to_a_position_averages_in():
    quantity = Decimal("1")
    _, position = _open(BUY, quantity, Decimal("100"))
    effect, after = _close(position, BUY, quantity, Decimal("200"))  # same side -> extends
    assert effect.realized == 0, "extending a position realized P&L"
    assert effect.closed_quantity == 0
    assert after["quantity"] == Decimal("2")
    average = money(after["cost_basis"] / after["quantity"])
    assert Decimal("150") < average < Decimal("151"), f"average entry {average} is not ~150"


def test_extending_a_short_averages_in_too():
    quantity = Decimal("1")
    _, position = _open(SELL, quantity, Decimal("100"))
    effect, after = _close(position, SELL, quantity, Decimal("200"))
    assert effect.realized == 0 and after["quantity"] == Decimal("-2")
    average = money(after["cost_basis"] / after["quantity"])
    assert Decimal("149") < average < Decimal("150"), f"average entry {average} is not ~150"


def test_a_fill_through_zero_is_refused():
    _, position = _open(BUY, Decimal("1"), Decimal("100"))
    try:
        _close(position, SELL, Decimal("3"), Decimal("100"))
    except ValueError as error:
        assert "through zero" in str(error)
    else:
        raise AssertionError("a fill that flips the position through zero was accepted")


def test_leverage_shrinks_the_cash_not_the_pnl():
    """Leverage must change what an open locks up and nothing about what a move pays."""
    quantity, entry, exit_ = Decimal("1"), Decimal("100"), Decimal("110")
    opened, position = _open(BUY, quantity, entry)
    notional = notional_of(quantity, entry)
    assert opened.cash_delta == money(-(margin_of(notional) + fee_for(notional)))
    if TRADING_LEVERAGE > 1:
        assert abs(opened.cash_delta) < notional, "a leveraged open locked the full notional"

    closed, _ = _close(position, SELL, quantity, exit_)
    gross = money((exit_ - entry) * quantity)
    fees = money(fee_for(notional) + fee_for(notional_of(quantity, exit_)))
    assert closed.realized == money(gross - fees), "leverage changed the realized P&L"


def test_quote_basis_tracks_separately_from_account_basis():
    """A position in an INR name keeps two bases: one in the currency the wallet is in, one
    in the currency the screen quotes. Neither is derived from the other by a stored rate,
    so `average_price` stays exact in quote terms."""
    quantity, price_inr, rate = Decimal("10"), Decimal("2400"), Decimal("0.012")
    notional_quote = notional_of(quantity, price_inr)
    notional = money(notional_quote * rate)
    fee = fee_for(notional)
    effect = apply_fill(
        quantity=ZERO,
        cost_basis=ZERO,
        cost_basis_quote=ZERO,
        margin_used=ZERO,
        side_sign=BUY,
        fill_quantity=quantity,
        notional=notional,
        notional_quote=notional_quote,
        fee=fee,
        margin=money(margin_of(notional) + fee),
    )
    assert effect.basis_quote_delta == notional_quote
    assert money(effect.basis_quote_delta / quantity) == price_inr, "quote average drifted"
    assert effect.basis_delta == money(notional + fee)


def main() -> int:
    tests = [value for name, value in sorted(globals().items()) if name.startswith("test_")]
    failures = 0
    for test in tests:
        try:
            test()
            print(f"PASS  {test.__name__}")
        except AssertionError as error:
            failures += 1
            print(f"FAIL  {test.__name__}: {error}")
    print(f"\n{len(tests) - failures}/{len(tests)} passed")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
