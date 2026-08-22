/**
 * The one description of "the thing currently selected on a trading page", shared by the
 * chart, the order ticket, the depth panel and the tables.
 *
 * It replaces the old `OrderAsset`, whose price was a *display string* with a currency glyph
 * baked in (`"$229.87"`, `"₹3,102.40"`). Everything downstream then had to re-derive the
 * number with `parseFloat(p.replace(/[^0-9.]/g, ""))` and guess the currency from the glyph —
 * which read a dollar-quoted US stock as USDT. Here the number is a number and the currency
 * is named, because the backend tells us both.
 *
 * `symbol` is always the feed's own convention — `BTCUSDT`, `EUR-USD`, `RELIANCE.NS` — since
 * that is what every quote, candle and order endpoint validates against. `label` is the
 * human form, and only ever used for display.
 */
import type { AssetClass, MarketState } from "@/lib/trading-api";

export type TradeInstrument = {
  assetClass: AssetClass;
  /** Feed-native symbol, e.g. "BTCUSDT" / "EUR-USD" / "RELIANCE.NS". */
  symbol: string;
  /** Display form, e.g. "BTC/USDT" / "EUR/USD" / "RELIANCE". */
  label: string;
  /** Instrument name where the feed publishes one, else the label. */
  name: string;
  /** `null` when nothing has priced it yet — never substitute 0. */
  price: number | null;
  change: number | null;
  changePercent: number | null;
  /** Settlement/quote currency. `null` only before the first quote resolves. */
  currency: string | null;
  /** Real top-of-book, where the feed publishes it. FX always, crypto usually, equities never. */
  bid: number | null;
  ask: number | null;
  /** FX only: the provider quotes the spread directly, in price terms and in pips. */
  spread: number | null;
  spreadPips: number | null;
  dayLow: number | null;
  dayHigh: number | null;
  /** Equities only. */
  previousClose: number | null;
  /** Share count for equities, quote-asset value for crypto, absent for FX. */
  volume: number | null;
  volumeUnit: string | null;
  marketState: MarketState | null;
  stale: boolean;
};

/** Decimal places that suit a price's magnitude, so an FX rate keeps its pips. */
export function decimalsFor(price: number | null): number {
  if (price === null || !Number.isFinite(price)) return 2;
  const abs = Math.abs(price);
  if (abs >= 100) return 2;
  if (abs >= 1) return 4;
  return 6;
}

export function formatPrice(price: number | null, decimals?: number): string {
  if (price === null || !Number.isFinite(price)) return "—";
  const dp = decimals ?? decimalsFor(price);
  return price.toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp });
}

/** Compact notation for volumes and notionals — "1.24M", not "1,238,411". */
const COMPACT = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 });

export function formatCompact(value: number | null): string {
  return value === null || !Number.isFinite(value) ? "—" : COMPACT.format(value);
}

/**
 * A money amount with its currency named rather than glyphed — "1,204.50 USDT".
 *
 * Named because a glyph is ambiguous — `$` is both USD and a dozen other dollars — and
 * because this app shows two genuinely different currencies side by side on one position: a
 * price is quoted in the instrument's own currency (₹ for an NSE listing), while its market
 * value, cost basis and P&L are already converted into the one balance the account actually
 * holds (`account_currency`, USDT). Naming each amount is what stops those two from being
 * read as the same number — pass whichever currency the specific field you have is really in,
 * never the instrument's by default.
 */
export function formatMoney(value: number | null, currency: string): string {
  if (value === null || !Number.isFinite(value)) return "—";
  const n = value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${n} ${currency}`;
}
