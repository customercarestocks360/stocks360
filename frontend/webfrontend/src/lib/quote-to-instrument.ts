/**
 * The one place a provider quote becomes a `TradeInstrument`.
 *
 * Three feeds, three quote shapes: crypto reports a 24 h rolling window with base and quote
 * volume, FX reports a session with a real bid/ask/spread and no volume at all, and equities
 * report against a previous close with a share count and a 52-week range. Every screen that
 * shows an instrument needs the same normalised view of that, and the mapping is subtle enough
 * — mid vs last, quote volume vs base volume, which fields a market genuinely lacks — that
 * having two copies would guarantee they drift.
 *
 * Shared by the overview-backed board and the authenticated watchlist stream.
 */
import type { TradeInstrument } from "@/lib/instrument";
import {
  cryptoQuoteAsset,
  formatOverviewLabel,
  type OverviewMarket,
  type OverviewTick,
} from "@/lib/market-overview";
import type { CryptoQuote, ForexQuote, StockQuote } from "@/lib/markets-api";
import type { AssetClass } from "@/lib/trading-api";

/** `Number("")` is 0, which would read as a real zero rather than an absent field. */
export function num(raw: string | number | null | undefined): number | null {
  if (raw === null || raw === undefined || raw === "") return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

/** A row that exists but has not been priced yet — never a zero-filled instrument. */
export function blankInstrument(assetClass: AssetClass, symbol: string): TradeInstrument {
  const label = formatOverviewLabel(assetClass as OverviewMarket, symbol);
  return {
    assetClass,
    symbol,
    label,
    name: label,
    price: null,
    change: null,
    changePercent: null,
    // A crypto pair names its own settlement currency in the symbol, so this much is knowable
    // before any quote arrives.
    currency: assetClass === "crypto" ? cryptoQuoteAsset(symbol) : null,
    bid: null,
    ask: null,
    spread: null,
    spreadPips: null,
    dayLow: null,
    dayHigh: null,
    previousClose: null,
    volume: null,
    volumeUnit: null,
    marketState: null,
    stale: false,
  };
}

export function fromCryptoQuote(q: CryptoQuote): TradeInstrument {
  const quoteAsset = cryptoQuoteAsset(q.symbol);
  return {
    ...blankInstrument("crypto", q.symbol),
    price: num(q.last_price),
    change: num(q.price_change),
    changePercent: num(q.price_change_percent),
    currency: quoteAsset,
    bid: num(q.bid),
    ask: num(q.ask),
    dayLow: num(q.low),
    dayHigh: num(q.high),
    previousClose: num(q.open_price),
    // Quote-asset volume: "how much was traded" only compares across pairs in the currency it
    // settled in.
    volume: num(q.quote_volume),
    volumeUnit: quoteAsset,
    // Crypto never closes; a degraded feed shows up as staleness, not as a closed market.
    marketState: "open",
  };
}

export function fromForexQuote(q: ForexQuote): TradeInstrument {
  return {
    ...blankInstrument("forex", q.symbol),
    // The mid, not the bid: a headline rate should not favour one side of the spread.
    price: num(q.mid),
    change: num(q.change),
    changePercent: num(q.change_percent),
    currency: q.symbol.split("-")[1] ?? null,
    bid: num(q.bid),
    ask: num(q.ask),
    spread: num(q.spread),
    spreadPips: num(q.spread_pips),
    dayLow: num(q.low),
    dayHigh: num(q.high),
    marketState: q.market_state,
    stale: q.stale,
  };
}

export function fromStockQuote(q: StockQuote): TradeInstrument {
  const base = blankInstrument("stocks", q.symbol);
  return {
    ...base,
    name: q.name?.trim() || base.label,
    price: num(q.price),
    change: num(q.change),
    changePercent: num(q.change_percent),
    currency: q.currency,
    dayLow: num(q.day_low),
    dayHigh: num(q.day_high),
    previousClose: num(q.previous_close),
    volume: num(q.volume),
    volumeUnit: "shares",
    marketState: q.market_state,
    stale: q.stale,
  };
}

/**
 * Dispatches on asset class. The three quote shapes have no discriminant field of their own,
 * so the caller — which always knows which endpoint it called — supplies it.
 */
export function fromQuote(
  assetClass: AssetClass,
  quote: CryptoQuote | ForexQuote | StockQuote,
): TradeInstrument {
  if (assetClass === "crypto") return fromCryptoQuote(quote as CryptoQuote);
  if (assetClass === "forex") return fromForexQuote(quote as ForexQuote);
  return fromStockQuote(quote as StockQuote);
}

/** The symbol on any of the three quote shapes — all three spell it `symbol`. */
export function quoteSymbol(quote: CryptoQuote | ForexQuote | StockQuote): string {
  return quote.symbol;
}

/**
 * Overlays a public-overview tick on a REST-derived instrument. The tick always wins on price:
 * it is the newer of the two by construction, since REST is polled and the socket is pushed.
 */
export function withOverviewTick(
  base: TradeInstrument,
  tick: OverviewTick | undefined,
): TradeInstrument {
  if (!tick) return base;
  return {
    ...base,
    price: Number.isFinite(tick.priceValue) ? tick.priceValue : base.price,
    change: tick.change ?? base.change,
    changePercent: tick.changePercent ?? base.changePercent,
    currency: base.currency ?? tick.currency,
    stale: tick.stale,
    // Forex only — the tick carries the real bid/ask/spread live; other markets never set
    // these on the overview socket, so `base` (REST, or nothing yet) still wins for them.
    bid: tick.bid ?? base.bid,
    ask: tick.ask ?? base.ask,
    spread: tick.spread ?? base.spread,
    spreadPips: tick.spreadPips ?? base.spreadPips,
  };
}
