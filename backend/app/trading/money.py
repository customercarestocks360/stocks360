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

from decimal import Decimal, ROUND_HALF_UP, ROUND_UP

from app.core.config import TRADING_FEE_BPS

PLACES = Decimal("0.00000001")
ZERO = Decimal("0.00000000")

_BPS_DIVISOR = Decimal(10_000)


def money(value: Decimal) -> Decimal:
    """The canonical scale for anything stored as an amount or a quantity."""
    return value.quantize(PLACES, rounding=ROUND_HALF_UP)


def fee_for(notional: Decimal) -> Decimal:
    """Commission on a notional, in the instrument's quote currency."""
    if TRADING_FEE_BPS == 0:
        return ZERO
    return (notional * Decimal(TRADING_FEE_BPS) / _BPS_DIVISOR).quantize(PLACES, rounding=ROUND_UP)


def notional_of(quantity: Decimal, price: Decimal) -> Decimal:
    return money(quantity * price)


def percent_change(value: Decimal, reference: Decimal) -> Decimal | None:
    """Signed percentage move from `reference` to `value`, to three places."""
    if reference == 0:
        return None
    return ((value - reference) / reference * 100).quantize(Decimal("0.001"), rounding=ROUND_HALF_UP)
