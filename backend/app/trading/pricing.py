"""One price interface over three feeds that agree on almost nothing.

An order needs four things from the market before it can be acted on: what the instrument
settles in, what it is worth, whether the market is open, and whether the number is fresh
enough to trade against. Crypto, forex and equities answer all four differently — different
quote models, different staleness windows, different notions of "closed" — so this module
is where that ends. Everything above it sees a `Mark`.

Prices come from the live hub cache when the symbol is already streaming for someone, and
from the upstream REST API otherwise. That is the same preference the market-data routes
use, and it matters more here: a resting order is only checked when a tick arrives, so the
matcher is reading the cache the ticks are written into.

**Staleness is a hard gate, not a warning.** Filling against a price nobody has refreshed
is how a weekend-old rate ends up as an execution. Each feed's own staleness rule is used:
the forex and equity quotes carry `stale` themselves, and crypto — which has no such
notion because it never closes — is measured against `CRYPTO_STALE_SECONDS`.
"""

import logging
from dataclasses import dataclass
from datetime import datetime, timezone
from decimal import Decimal

from fastapi import HTTPException, status

from app.core.config import CRYPTO_STALE_SECONDS, TRADING_DOMESTIC_SUFFIXES
from app.crypto import upstream as crypto_upstream
from app.crypto.hub import hub as crypto_hub
from app.forex import upstream as forex_upstream
from app.forex.hub import hub as forex_hub
from app.schemas.forex import fx_session_state
from app.schemas.onboarding import Product
from app.schemas.trading import (
    SETTLEMENT_CURRENCIES,
    AssetClass,
    MarketState,
    OrderSide,
)
from app.stocks import upstream as stocks_upstream
from app.stocks.hub import hub as stocks_hub

logger = logging.getLogger(__name__)


def _now() -> datetime:
    return datetime.now(timezone.utc)


@dataclass(frozen=True)
class Mark:
    """A tradable view of one instrument at one moment."""

    asset_class: AssetClass
    symbol: str
    currency: str
    last: Decimal
    bid: Decimal | None
    ask: Decimal | None
    market_state: MarketState
    quoted_at: datetime
    stale: bool

    def execution_price(self, side: OrderSide) -> Decimal:
        """Cross the spread where the feed publishes one.

        Crypto and forex give a two-sided quote, so a buy pays the ask and a sell hits the
        bid — which is the single largest cost this simulation can model honestly. The
        equity feed publishes only a last traded price, so that is what is used; inventing
        a spread there would be inventing the number that matters most.
        """
        if side is OrderSide.buy and self.ask is not None and self.ask > 0:
            return self.ask
        if side is OrderSide.sell and self.bid is not None and self.bid > 0:
            return self.bid
        return self.last

    @property
    def tradable(self) -> bool:
        return self.market_state is MarketState.open and not self.stale


def product_for(asset_class: AssetClass, symbol: str) -> Product:
    """Which onboarding product an order in this instrument needs.

    Equities split on the listing venue: an NSE or BSE ticker is domestic, anything else
    is foreign, and they are separately consented to because they are separately regulated.
    """
    if asset_class is AssetClass.crypto:
        return Product.crypto_spot
    if asset_class is AssetClass.forex:
        return Product.forex
    if symbol.upper().endswith(TRADING_DOMESTIC_SUFFIXES):
        return Product.domestic_equity_delivery
    return Product.foreign_equity


def products_for_class(asset_class: AssetClass) -> list[Product]:
    """Every product an order in this asset class could require."""
    if asset_class is AssetClass.crypto:
        return [Product.crypto_spot]
    if asset_class is AssetClass.forex:
        return [Product.forex]
    return [Product.domestic_equity_delivery, Product.foreign_equity]


def _unsupported_currency(symbol: str, currency: str) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_409_CONFLICT,
        detail=f"{symbol} settles in {currency}, which is not a currency this venue holds",
    )


# --------------------------------------------------------------------------- #
# Per-feed marks
# --------------------------------------------------------------------------- #


async def _crypto_mark(symbol: str) -> Mark:
    known = await crypto_upstream.all_symbols()
    info = known.get(symbol)
    if info is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=f"Unknown symbol: {symbol}"
        )
    if info.quote_asset not in SETTLEMENT_CURRENCIES:
        raise _unsupported_currency(symbol, info.quote_asset)

    quote = crypto_hub.cached(symbol) or await crypto_upstream.ticker(symbol)
    now = _now()
    # The exchange halting a symbol is this market's only version of "closed".
    state = MarketState.open if info.status.value == "TRADING" else MarketState.closed
    return Mark(
        asset_class=AssetClass.crypto,
        symbol=symbol,
        currency=info.quote_asset,
        last=quote.last_price,
        bid=quote.bid,
        ask=quote.ask,
        market_state=state,
        quoted_at=quote.event_time,
        stale=(now - quote.event_time).total_seconds() > CRYPTO_STALE_SECONDS,
    )


async def _forex_mark(symbol: str) -> Mark:
    await forex_upstream.assert_supported([symbol])
    currency = symbol.partition("-")[2]
    if currency not in SETTLEMENT_CURRENCIES:
        raise _unsupported_currency(symbol, currency)

    quote = forex_hub.cached(symbol)
    if quote is None:
        found = await forex_upstream.quotes([symbol])
        if not found:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail=f"No price available for {symbol} right now",
            )
        quote = found[0]
    return Mark(
        asset_class=AssetClass.forex,
        symbol=symbol,
        currency=currency,
        last=quote.mid,
        bid=quote.bid,
        ask=quote.ask,
        market_state=MarketState(quote.market_state.value),
        quoted_at=quote.quoted_at,
        stale=quote.stale,
    )


async def _stocks_mark(symbol: str) -> Mark:
    quote = stocks_hub.cached(symbol)
    if quote is None:
        quote = await stocks_upstream.quote(symbol)
    currency = (quote.currency or "").upper()
    if not currency:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"The feed does not say what currency {symbol} trades in",
        )
    if currency not in SETTLEMENT_CURRENCIES:
        raise _unsupported_currency(symbol, currency)
    return Mark(
        asset_class=AssetClass.stocks,
        symbol=symbol,
        currency=currency,
        last=quote.price,
        # Yahoo's chart endpoint publishes no book, so there is no spread to cross.
        bid=None,
        ask=None,
        market_state=MarketState(quote.market_state.value),
        quoted_at=quote.quoted_at,
        stale=quote.stale,
    )


async def mark(asset_class: AssetClass, symbol: str) -> Mark:
    """Price one instrument, validating it exists on the way.

    Raises the upstream's own status codes — 404 for an unknown symbol, 502/504 when the
    provider fails, 409 when the instrument settles in something unholdable.
    """
    if asset_class is AssetClass.crypto:
        return await _crypto_mark(symbol)
    if asset_class is AssetClass.forex:
        return await _forex_mark(symbol)
    return await _stocks_mark(symbol)


async def mark_or_none(asset_class: AssetClass, symbol: str) -> Mark | None:
    """Best-effort pricing, for valuing a portfolio.

    A position whose feed is down is reported unpriced rather than failing the whole
    request — the holding is still real, only the mark is missing.
    """
    try:
        return await mark(asset_class, symbol)
    except HTTPException as exc:
        logger.info("No mark for %s %s: %s", asset_class.value, symbol, exc.detail)
    except Exception as exc:  # a malformed upstream payload is not worth a 500 here
        logger.warning("Marking %s %s failed: %s", asset_class.value, symbol, exc)
    return None


def cached_mark(asset_class: AssetClass, symbol: str, currency: str) -> Mark | None:
    """The hub's current value for an instrument, without touching the network.

    This is what the matcher runs on: it is called once per tick and per sweep, so it must
    not be able to make an upstream request. The currency comes from the order, which
    recorded it when the instrument was validated at placement.
    """
    hub = {
        AssetClass.crypto: crypto_hub,
        AssetClass.forex: forex_hub,
        AssetClass.stocks: stocks_hub,
    }[asset_class]
    quote = hub.cached(symbol)
    if quote is None:
        return None
    now = _now()

    if asset_class is AssetClass.crypto:
        return Mark(
            asset_class=asset_class,
            symbol=symbol,
            currency=currency,
            last=quote.last_price,
            bid=quote.bid,
            ask=quote.ask,
            market_state=MarketState.open,
            quoted_at=quote.event_time,
            stale=(now - quote.event_time).total_seconds() > CRYPTO_STALE_SECONDS,
        )
    if asset_class is AssetClass.forex:
        return Mark(
            asset_class=asset_class,
            symbol=symbol,
            currency=currency,
            last=quote.mid,
            bid=quote.bid,
            ask=quote.ask,
            market_state=MarketState(quote.market_state.value),
            quoted_at=quote.quoted_at,
            stale=quote.stale,
        )
    return Mark(
        asset_class=asset_class,
        symbol=symbol,
        currency=currency,
        last=quote.price,
        bid=None,
        ask=None,
        market_state=MarketState(quote.market_state.value),
        quoted_at=quote.quoted_at,
        stale=quote.stale,
    )


def feed_state(asset_class: AssetClass) -> MarketState:
    """Feed-wide market state, for the eligibility endpoint.

    Equities have none worth reporting: a watchlist can hold NSE and Nasdaq at once, so
    the state is a property of the symbol, not of the feed.
    """
    if asset_class is AssetClass.crypto:
        return MarketState.open
    if asset_class is AssetClass.forex:
        return MarketState(fx_session_state().value)
    return MarketState.unknown
