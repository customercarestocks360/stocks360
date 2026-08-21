"""Converting an instrument's quote currency into the one currency this venue holds.

The account balance is a single number in `TRADING_ACCOUNT_CURRENCY` (USDT). Instruments
are not: `BTCUSDT` is priced in USDT, `EUR-USD` in USD, `RELIANCE.NS` in INR. So every
order has a cash leg in one currency and a balance in another, and something has to be the
one place that bridges them. This is it.

**A rate is fetched once, at placement, and stored on the order.** Two reasons, and the
second is the load-bearing one:

* A conversion rate is not a traded price. It scales a notional; it is not what the order
  fills at. Re-deriving it at settlement would make the same order cost different amounts
  depending on which code path filled it.
* The matcher fills resting orders from the quote cache and must never make a network
  request — see `engine.py`. An order that carried no rate could not be settled there at
  all. Carrying it means settlement is pure arithmetic.

`ponytail: a GTC order resting for days settles at the rate from when it was placed. The
rate is on the order document, so the number is explainable rather than merely wrong.
Upgrade path: re-read from the forex hub cache in `service._execute_locked` and fall back
to the stored rate, which keeps the matcher network-free.`

**Pegged currencies convert 1:1.** USDT is pegged to the dollar, not fixed to it, and this
API has no licensed source for the deviation. A made-up basis point of drift would be
worse than the honest simplification, so `TRADING_PEGGED_CURRENCIES` convert at exactly
one and the docstring says so out loud.
"""

import asyncio
import logging
from decimal import Decimal
from time import monotonic

from fastapi import HTTPException, status

from app.core.config import (
    TRADING_ACCOUNT_CURRENCY,
    TRADING_FX_TTL_SECONDS,
    TRADING_PEGGED_CURRENCIES,
)
from app.forex import upstream as forex_upstream
from app.forex.hub import hub as forex_hub
from app.trading.money import money

logger = logging.getLogger(__name__)

ONE = Decimal(1)

# currency -> (rate, fetched_at). One process, one dict: the same shape the hubs use, and
# the same caveat — see the readme on running a single worker.
_cache: dict[str, tuple[Decimal, float]] = {}
_lock = asyncio.Lock()


def _pegged(currency: str) -> bool:
    """Whether `currency` and the account currency are both inside the peg, so 1:1 holds.

    Both halves matter. USD converts to USDT at one because both are pegged to the dollar;
    if the account currency were EUR, neither would.
    """
    return (
        currency in TRADING_PEGGED_CURRENCIES
        and TRADING_ACCOUNT_CURRENCY in TRADING_PEGGED_CURRENCIES
    )


def _unconvertible(currency: str) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_409_CONFLICT,
        detail=f"This venue holds {TRADING_ACCOUNT_CURRENCY} and has no rate to value "
        f"{currency} against it, so an order settled in {currency} cannot be funded",
    )


async def _pair_mid(pair: str) -> Decimal | None:
    """The mid for one FX pair, cache first, then upstream. None if it is not a real pair.

    Cache-then-upstream is the same preference `pricing.py` uses, and it matters for the
    same reason: if someone is already streaming `USD-INR`, its rate is already here.
    """
    cached = forex_hub.cached(pair)
    if cached is not None and cached.mid > 0:
        return cached.mid
    try:
        await forex_upstream.assert_supported([pair])
    except HTTPException:
        return None
    found = await forex_upstream.quotes([pair])
    if not found or found[0].mid <= 0:
        return None
    return found[0].mid


async def _fetch_rate(currency: str) -> Decimal:
    """How many units of the account currency one unit of `currency` buys.

    Tried in both directions because the provider carries one or the other, not both:
    `EUR-USD` is quoted as EUR-per-USD's inverse, `USD-INR` the other way round. Anchoring
    on USD rather than on USDT is deliberate — no provider quotes USDT pairs, and the peg
    is what lets a USD rate stand in for a USDT one.
    """
    direct = await _pair_mid(f"{currency}-USD")
    if direct is not None:
        return direct
    inverse = await _pair_mid(f"USD-{currency}")
    if inverse is not None and inverse > 0:
        return ONE / inverse
    raise _unconvertible(currency)


async def rate_for(currency: str) -> Decimal:
    """The multiplier taking an amount in `currency` to the account currency.

    Always positive. Raises 409 for a currency nothing can price, which is a placement-time
    refusal rather than a half-funded order.
    """
    currency = (currency or "").strip().upper()
    if not currency:
        raise _unconvertible(currency)
    if currency == TRADING_ACCOUNT_CURRENCY or _pegged(currency):
        return ONE

    now = monotonic()
    hit = _cache.get(currency)
    if hit is not None and now - hit[1] < TRADING_FX_TTL_SECONDS:
        return hit[0]

    # One in-flight fetch per currency at a time. Without the lock, ten orders on Indian
    # equities arriving together become ten identical upstream calls.
    async with _lock:
        hit = _cache.get(currency)
        if hit is not None and monotonic() - hit[1] < TRADING_FX_TTL_SECONDS:
            return hit[0]
        rate = await _fetch_rate(currency)
        if rate <= 0:
            raise _unconvertible(currency)
        _cache[currency] = (rate, monotonic())
        logger.info("FX rate %s -> %s is %s", currency, TRADING_ACCOUNT_CURRENCY, rate)
        return rate


def cached_rate(currency: str) -> Decimal | None:
    """A rate without touching the network, for the matcher and the margin sweep.

    Those run once per tick, so they cannot await an upstream call — the same constraint
    `pricing.cached_mark` lives under. The TTL is deliberately ignored here: a rate a few
    minutes old is a far better basis for a margin check than skipping the check, and the
    alternative to a stale rate is no liquidation at all.

    Returns None only when nothing has ever priced this currency, in which case the caller
    skips that position rather than guessing.
    """
    currency = (currency or "").strip().upper()
    if not currency:
        return None
    if currency == TRADING_ACCOUNT_CURRENCY or _pegged(currency):
        return ONE
    hit = _cache.get(currency)
    if hit is not None:
        return hit[0]
    # Nothing fetched yet, but the pair may be streaming for someone else.
    for pair, invert in ((f"{currency}-USD", False), (f"USD-{currency}", True)):
        quote = forex_hub.cached(pair)
        if quote is not None and quote.mid > 0:
            return ONE / quote.mid if invert else quote.mid
    return None


def convert(amount: Decimal, rate: Decimal) -> Decimal:
    """Apply a stored rate. Separate from `rate_for` so settlement never awaits anything."""
    return money(amount * rate)


def unconvert(amount: Decimal, rate: Decimal) -> Decimal:
    """Account currency back to the instrument's own, for reporting a quote-currency figure."""
    if rate <= 0:
        return money(amount)
    return money(amount / rate)


def reset_cache() -> None:
    """Drop every cached rate. For tests, and for a deployment that just changed provider."""
    _cache.clear()
