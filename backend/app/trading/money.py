"""Decimal helpers shared by everything that touches a balance.

Every stored money and quantity value is quantised to eight decimal places before it
reaches Mongo. Two reasons, and both have teeth:

* A `Decimal128` holds 34 significant digits. A quantity multiplied by a price is the
  widest number this system produces, and quantising the result is what keeps it inside
  that envelope instead of raising on the way in.
* An unquantised `Decimal` carries its own scale, so `10` and `10.00000000` are equal but
  not identical. Round-tripping those through the ledger makes two correct balances look
  different, which turns every reconciliation into an argument about formatting.

Fees round **up**, everything else rounds half-up. Rounding a commission down is the venue
paying the user a fraction of a cent to trade, which is small, wrong, and compounds.
"""

from dataclasses import dataclass
from decimal import Decimal, ROUND_HALF_UP, ROUND_UP

from app.core.config import TRADING_FEE_BPS, TRADING_LEVERAGE

PLACES = Decimal("0.00000001")
ZERO = Decimal("0.00000000")
ONE = Decimal(1)

_BPS_DIVISOR = Decimal(10_000)


def money(value: Decimal) -> Decimal:
    """The canonical scale for anything stored as an amount or a quantity."""
    return value.quantize(PLACES, rounding=ROUND_HALF_UP)


def fee_for(notional: Decimal) -> Decimal:
    """Commission on a notional, in the account currency the notional was converted to."""
    if TRADING_FEE_BPS == 0:
        return ZERO
    return (notional * Decimal(TRADING_FEE_BPS) / _BPS_DIVISOR).quantize(PLACES, rounding=ROUND_UP)


def notional_of(quantity: Decimal, price: Decimal) -> Decimal:
    return money(quantity * price)


def margin_of(notional: Decimal) -> Decimal:
    """The cash a leveraged buy actually has to lock up: 1/`TRADING_LEVERAGE` of notional.

    Only the reservation shrinks. A position's cost basis stays full-notional (see
    `service._settle_fill`), so unrealized P&L is unaffected by leverage — it is still
    `(mark - avg_price) * quantity` either way.
    """
    return money(notional / TRADING_LEVERAGE)


def percent_change(value: Decimal, reference: Decimal) -> Decimal | None:
    """Signed percentage move from `reference` to `value`, to three places."""
    if reference == 0:
        return None
    return ((value - reference) / reference * 100).quantize(Decimal("0.001"), rounding=ROUND_HALF_UP)


# --------------------------------------------------------------------------- #
# What one fill does to a position
# --------------------------------------------------------------------------- #
#
# A position's quantity is **signed**: positive is long, negative is short, and one
# document per instrument holds either. That single choice is what lets a sell mean
# "reduce my long" and "open a short" without two code paths, and it is why the arithmetic
# below has one formula instead of four.
#
# `cost_basis` is signed the same way and carries the fee that opened the position, so
# `cost_basis / quantity` is the true break-even on both sides and
#
#     unrealized = quantity * mark - cost_basis
#
# is correct for a long (value less cost) and for a short (a falling mark makes the
# negative `quantity * mark` rise against a negative basis) with no branch.
#
# `margin_used` is the cash actually posted, fee included. On an open it grows by what the
# wallet paid; on a close it is released pro rata. Keeping the fee *inside* both the basis
# and the margin is what makes a flat round trip cost exactly the two commissions — charge
# it to the wallet separately as well and the entry fee is billed twice, once as cash and
# once inside the realized figure.


@dataclass(frozen=True)
class FillEffect:
    """The complete consequence of one fill, in account currency. Every field is a delta
    except `closed_quantity`, so a caller applies them without re-deriving anything."""

    quantity_delta: Decimal      # signed, added to the position's quantity
    basis_delta: Decimal         # signed, added to cost_basis (account currency)
    basis_quote_delta: Decimal   # the same, in the instrument's own quote currency
    margin_delta: Decimal        # signed, added to margin_used
    realized: Decimal            # P&L this fill booked, net of its own fee
    cash_delta: Decimal          # signed, what the wallet gains once its reservation is back
    closed_quantity: Decimal     # how much of the existing position this fill closed


def sign_of(value: Decimal) -> int:
    return 0 if value == 0 else (1 if value > 0 else -1)


def cash_shortfall(reserved: Decimal, effect: FillEffect) -> Decimal:
    """Extra cash this fill needs beyond what the order already reserved. Never negative.

    Two situations produce one: a stop that reserved at its stop price and then gapped, and
    a buy closing a short at a loss bigger than the collateral posted against it. Topping
    this up *before* the order is claimed is what makes `wallet_delta` unconditionally safe
    to apply afterwards.
    """
    return max(ZERO, money(-(reserved + effect.cash_delta)))


def wallet_delta(reserved: Decimal, effect: FillEffect) -> tuple[Decimal, Decimal]:
    """`(available_delta, reserved_delta)` for settling a fill, as one movement.

    The reservation comes back and the fill's own cash effect lands in the same operation,
    so there is no instant where the money is in neither place. Once `cash_shortfall` has
    been covered, `available_delta` is never negative — which is why settlement needs no
    second balance guard that could fail after the order already says filled.
    """
    return money(reserved + effect.cash_delta), money(-reserved)


def apply_fill(
    *,
    quantity: Decimal,
    cost_basis: Decimal,
    cost_basis_quote: Decimal,
    margin_used: Decimal,
    side_sign: int,
    fill_quantity: Decimal,
    notional: Decimal,
    notional_quote: Decimal,
    fee: Decimal,
    margin: Decimal,
) -> FillEffect:
    """Work out what a fill does to a position, without touching the database.

    `quantity` / `cost_basis` / `margin_used` are the position as it stands. `side_sign` is
    +1 for a buy and -1 for a sell. `notional` and `fee` are in account currency; `margin`
    is the cash an *opening* fill locks up (`margin_of(notional) + fee`).

    Raises `ValueError` on a fill that would carry the position through zero and out the
    other side. That is refused rather than modelled: splitting one fee across a close and
    an open makes both halves approximate, and "close it, then open the other way" is two
    orders the caller can already place.
    """
    position_sign = sign_of(quantity)
    held = abs(quantity)
    opening = position_sign == 0 or position_sign == side_sign

    if opening:
        return FillEffect(
            quantity_delta=money(side_sign * fill_quantity),
            basis_delta=money(side_sign * notional + fee),
            basis_quote_delta=money(side_sign * notional_quote),
            margin_delta=money(margin),
            realized=ZERO,
            cash_delta=money(-margin),
            closed_quantity=ZERO,
        )

    if fill_quantity > held:
        raise ValueError(
            f"a fill of {fill_quantity} would take a position of {quantity} through zero"
        )

    share = fill_quantity / held
    basis_released = money(cost_basis * share)
    basis_quote_released = money(cost_basis_quote * share)
    margin_released = money(margin_used * share)
    # `-side_sign` is the position's own sign: closing a long is a sell, so the slice is
    # worth +notional to the holder; closing a short is a buy, so it costs -notional.
    realized = money(-side_sign * notional - basis_released - fee)
    return FillEffect(
        quantity_delta=money(side_sign * fill_quantity),
        basis_delta=money(-basis_released),
        basis_quote_delta=money(-basis_quote_released),
        margin_delta=money(-margin_released),
        realized=realized,
        cash_delta=money(margin_released + realized),
        closed_quantity=money(fill_quantity),
    )
