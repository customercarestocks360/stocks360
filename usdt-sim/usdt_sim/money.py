"""Decimal scales. No float ever touches a balance in this package.

Two scales, because the chain has two: USDT is a 6-decimal token on both TRC-20 and
ERC-20, while base assets get 8 decimals like BTC. Quantising at the boundary keeps
`10` and `10.000000` from being two different-looking versions of the same balance.

Fees round **up**, everything else half-up. Rounding a commission down is the venue
paying the user a fraction of a cent to trade, and it compounds.
"""

from decimal import ROUND_DOWN, ROUND_HALF_UP, ROUND_UP, Decimal

USDT_PLACES = Decimal("0.000001")
QTY_PLACES = Decimal("0.00000001")
ZERO = Decimal("0")
_BPS_DIVISOR = Decimal(10_000)


def usdt(value) -> Decimal:
    """The canonical scale for any USDT amount."""
    return _zero_or(Decimal(value).quantize(USDT_PLACES, rounding=ROUND_HALF_UP))


def qty(value) -> Decimal:
    """The canonical scale for a base-asset quantity."""
    return _zero_or(Decimal(value).quantize(QTY_PLACES, rounding=ROUND_HALF_UP))


def _zero_or(value: Decimal) -> Decimal:
    """Collapse quantised zeros so a flat balance reads `0`, not `0E-8`."""
    return ZERO if value == 0 else value


def fee_of(notional: Decimal, fee_bps: int) -> Decimal:
    """Commission on a notional, in USDT, rounded up."""
    if fee_bps == 0:
        return ZERO
    return (notional * Decimal(fee_bps) / _BPS_DIVISOR).quantize(USDT_PLACES, rounding=ROUND_UP)


def to_step(value: Decimal, step: Decimal) -> Decimal:
    """Round a quantity *down* to the market's lot size, the way an exchange does."""
    return (value / step).to_integral_value(rounding=ROUND_DOWN) * step


def to_tick(value: Decimal, tick: Decimal, rounding=ROUND_HALF_UP) -> Decimal:
    """Snap a price to the market's tick size."""
    return (value / tick).to_integral_value(rounding=rounding) * tick


def bps_between(price: Decimal, reference: Decimal) -> Decimal:
    """Signed basis-point difference of `price` from `reference`."""
    if reference == 0:
        return ZERO
    return ((price - reference) / reference * _BPS_DIVISOR).quantize(Decimal("0.01"))
