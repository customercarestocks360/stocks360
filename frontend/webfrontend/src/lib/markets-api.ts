/**
 * Typed wrappers over the backend's per-market REST endpoints — the batch quote calls that
 * fill the columns the public overview stream does not carry.
 *
 * **Why both a socket and these calls.** `WS /market/overview/stream` is a headline ticker
 * feed and deliberately narrow: its `MarketTick` carries a price, a change and a staleness
 * flag, and nothing else. Volume, the day and 52-week ranges, an instrument's real name and
 * its quote currency live on the per-market quote routes, and every one of those is
 * authenticated. So a public view renders live prices from the socket for anyone, and fills
 * the remaining columns in once a token is available — rather than inventing values for
 * columns it cannot source.
 *
 * Every type here mirrors `backend/app/schemas/{crypto,forex,stocks}.py` field-for-field.
 * Prices arrive as JSON **strings**, not numbers: the backend keeps them as `Decimal` so
 * they never take a float round-trip in transit. They are left as strings here and parsed
 * at the point of use, so this module stays a faithful description of the wire.
 */
import { apiFetch } from "@/lib/api";

export type MarketState = "open" | "closed" | "unknown";

// --------------------------------------------------------------------------------------- //
// Wire shapes
// --------------------------------------------------------------------------------------- //

/** `GET /crypto/tickers` — Binance 24h rolling window. */
export type CryptoQuote = {
  symbol: string;
  last_price: string;
  price_change: string;
  price_change_percent: string;
  high: string;
  low: string;
  open_price: string;
  /** Base-asset volume over the window. */
  volume: string;
  /** Quote-asset volume over the window — the comparable "traded value". */
  quote_volume: string;
  bid: string | null;
  ask: string | null;
  trades: number | null;
  event_time: string;
};

/** `GET /forex/quotes` — session window. No 52-week range: the provider does not publish one. */
export type ForexQuote = {
  symbol: string;
  bid: string;
  ask: string;
  mid: string;
  spread: string;
  spread_pips: string;
  pip_size: string;
  high: string;
  low: string;
  change: string;
  change_percent: string;
  quoted_at: string;
  stale: boolean;
  market_state: MarketState;
};

/** `GET /stocks/quotes` — the richest of the three; change is measured against previous close. */
export type StockQuote = {
  symbol: string;
  name: string | null;
  exchange: string | null;
  currency: string | null;
  price: string;
  previous_close: string | null;
  change: string | null;
  change_percent: string | null;
  day_high: string | null;
  day_low: string | null;
  /** Share count, so a JSON number rather than a decimal string. */
  volume: number | null;
  fifty_two_week_high: string | null;
  fifty_two_week_low: string | null;
  market_state: MarketState;
  session_start: string | null;
  session_end: string | null;
  quoted_at: string;
  stale: boolean;
};

export type Instrument = {
  symbol: string;
  name: string | null;
  exchange: string | null;
  full_exchange: string | null;
  /** EQUITY, ETF, INDEX, … */
  type: string | null;
  currency: string | null;
};

export type PairInfo = {
  symbol: string;
  base: string;
  quote: string;
  /** Provider description of the pair. */
  name: string;
};

export type CryptoSymbolInfo = {
  symbol: string;
  base_asset: string;
  quote_asset: string;
  status: string;
  base_precision: number;
  quote_precision: number;
};

// --------------------------------------------------------------------------------------- //
// Candles — one shape per feed, because each provider publishes a different one
// --------------------------------------------------------------------------------------- //

/** `GET /crypto/klines/{symbol}` intervals, exactly what the upstream accepts. */
export const CRYPTO_INTERVALS = [
  "1m",
  "3m",
  "5m",
  "15m",
  "30m",
  "1h",
  "2h",
  "4h",
  "6h",
  "8h",
  "12h",
  "1d",
  "3d",
  "1w",
  "1M",
] as const;
export type CryptoInterval = (typeof CRYPTO_INTERVALS)[number];

export const STOCK_INTERVALS = ["1m", "2m", "5m", "15m", "30m", "60m", "1d", "1wk", "1mo"] as const;
export type StockInterval = (typeof STOCK_INTERVALS)[number];

export const STOCK_RANGES = [
  "1d",
  "5d",
  "1mo",
  "3mo",
  "6mo",
  "1y",
  "2y",
  "5y",
  "ytd",
  "max",
] as const;
export type StockRange = (typeof STOCK_RANGES)[number];

/** Forex candles come as whole trading days or as the provider's recent snapshots. */
export const FOREX_SERIES_KINDS = ["daily", "intraday"] as const;
export type ForexSeriesKind = (typeof FOREX_SERIES_KINDS)[number];

export type CryptoKline = {
  open_time: string;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
  close_time: string;
  quote_volume: string;
  trades: number;
};

export type StockCandle = {
  at: string;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: number | null;
};

/** Forex candles carry a per-candle change and, notably, **no volume** — FX has no venue volume. */
export type ForexCandle = {
  at: string;
  open: string;
  high: string;
  low: string;
  close: string;
  change: string;
  change_percent: string;
};

export type CryptoKlineSeries = {
  symbol: string;
  interval: CryptoInterval;
  count: number;
  klines: CryptoKline[];
};

export type StockCandleSeries = {
  symbol: string;
  interval: StockInterval;
  range: StockRange;
  currency: string | null;
  count: number;
  candles: StockCandle[];
};

export type ForexCandleSeries = {
  symbol: string;
  series: ForexSeriesKind;
  count: number;
  candles: ForexCandle[];
};

// --------------------------------------------------------------------------------------- //
// Crypto order book — the only real depth in this system
// --------------------------------------------------------------------------------------- //

/** The only depths the upstream accepts. */
export const ORDER_BOOK_DEPTHS = [5, 10, 20, 50, 100, 500, 1000] as const;
export type OrderBookDepth = (typeof ORDER_BOOK_DEPTHS)[number];

export type OrderBookLevel = { price: string; quantity: string };

/**
 * Real exchange depth, crypto only. The forex and equity providers publish no book at all,
 * which is why there is no equivalent for them — and why inventing one would be a lie
 * rather than a gap.
 */
export type CryptoOrderBook = {
  symbol: string;
  last_update_id: number;
  /** Highest first. */
  bids: OrderBookLevel[];
  /** Lowest first. */
  asks: OrderBookLevel[];
  at: string;
};

// --------------------------------------------------------------------------------------- //
// Batch quotes
// --------------------------------------------------------------------------------------- //

/**
 * Per-call symbol caps, from the endpoints themselves (`_MAX_BATCH_SYMBOLS` /
 * `_MAX_BATCH_PAIRS`). Each is a `422` when exceeded, so a symbol list longer than the cap
 * is split across calls rather than being sent and rejected.
 *
 * These are not theoretical: the public overview allows up to 25 symbols per market
 * (`_MAX_SYMBOLS_PER_MARKET`), which is above the equity cap of 20, so a deployment that
 * configures a long `OVERVIEW_STOCKS_SYMBOLS` would otherwise 422 every request.
 */
const BATCH_CAPS = { crypto: 50, forex: 30, stocks: 20 } as const;

function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Repeated `?symbols=` params — unambiguous, and what every one of these routes accepts. */
function symbolsQuery(symbols: readonly string[]): string {
  const params = new URLSearchParams();
  for (const symbol of symbols) params.append("symbols", symbol);
  return params.toString();
}

/**
 * Runs one batch request per chunk and concatenates the results.
 *
 * A chunk that fails is *not* allowed to fail the whole call: these feeds are independent
 * upstreams and a `502`/`404` for one group of symbols should still let the rest render.
 * The rejection reason is returned alongside so a caller can surface "some rows could not
 * be loaded" instead of silently showing a short list.
 */
async function fetchBatched<T>(
  path: string,
  symbols: readonly string[],
  cap: number,
  token: string,
  signal?: AbortSignal,
): Promise<{ quotes: T[]; failed: number }> {
  if (symbols.length === 0) return { quotes: [], failed: 0 };

  const groups = chunk(symbols, cap);
  const settled = await Promise.allSettled(
    groups.map((group) =>
      apiFetch<T[]>(`${path}?${symbolsQuery(group)}`, {
        token,
        ...(signal ? { signal } : {}),
      }),
    ),
  );

  const quotes: T[] = [];
  let failed = 0;
  settled.forEach((result, i) => {
    if (result.status === "fulfilled") quotes.push(...result.value);
    else failed += groups[i]!.length;
  });
  return { quotes, failed };
}

export function fetchCryptoQuotes(
  symbols: readonly string[],
  token: string,
  signal?: AbortSignal,
): Promise<{ quotes: CryptoQuote[]; failed: number }> {
  return fetchBatched<CryptoQuote>("/crypto/tickers", symbols, BATCH_CAPS.crypto, token, signal);
}

export function fetchForexQuotes(
  pairs: readonly string[],
  token: string,
  signal?: AbortSignal,
): Promise<{ quotes: ForexQuote[]; failed: number }> {
  return fetchBatched<ForexQuote>("/forex/quotes", pairs, BATCH_CAPS.forex, token, signal);
}

export function fetchStockQuotes(
  symbols: readonly string[],
  token: string,
  signal?: AbortSignal,
): Promise<{ quotes: StockQuote[]; failed: number }> {
  return fetchBatched<StockQuote>("/stocks/quotes", symbols, BATCH_CAPS.stocks, token, signal);
}

/**
 * `GET /stocks/instruments` — a search, not a downloadable list: the equity universe spans
 * every exchange and is far too large to cache the way the crypto and forex universes are.
 */
export function searchInstruments(
  search: string,
  token: string,
  limit = 20,
  signal?: AbortSignal,
): Promise<Instrument[]> {
  const params = new URLSearchParams({ search, limit: String(limit) });
  return apiFetch<Instrument[]>(`/stocks/instruments?${params.toString()}`, {
    token,
    ...(signal ? { signal } : {}),
  });
}

/** `GET /forex/pairs` — the cached pair universe, filterable by substring. */
export function searchPairs(
  search: string,
  token: string,
  limit = 20,
  signal?: AbortSignal,
): Promise<PairInfo[]> {
  const params = new URLSearchParams({ search, limit: String(limit) });
  return apiFetch<PairInfo[]>(`/forex/pairs?${params.toString()}`, {
    token,
    ...(signal ? { signal } : {}),
  });
}

/** `GET /crypto/symbols` — the cached spot universe. `tradable_only` drops halted listings. */
export function searchCryptoSymbols(
  search: string,
  token: string,
  limit = 20,
  signal?: AbortSignal,
): Promise<CryptoSymbolInfo[]> {
  const params = new URLSearchParams({ search, limit: String(limit), tradable_only: "true" });
  return apiFetch<CryptoSymbolInfo[]>(`/crypto/symbols?${params.toString()}`, {
    token,
    ...(signal ? { signal } : {}),
  });
}

// --------------------------------------------------------------------------------------- //
// Candle fetchers — newest candle last in all three
// --------------------------------------------------------------------------------------- //

export function fetchCryptoKlines(
  symbol: string,
  token: string,
  options: { interval?: CryptoInterval; limit?: number } = {},
  signal?: AbortSignal,
): Promise<CryptoKlineSeries> {
  const params = new URLSearchParams({
    interval: options.interval ?? "1h",
    limit: String(options.limit ?? 200),
  });
  return apiFetch<CryptoKlineSeries>(
    `/crypto/klines/${encodeURIComponent(symbol)}?${params.toString()}`,
    { token, ...(signal ? { signal } : {}) },
  );
}

/**
 * The upstream limits how far back fine intervals reach — roughly a week for `1m` — and
 * answers a `502` when the interval/range combination is not allowed.
 */
export function fetchStockCandles(
  symbol: string,
  token: string,
  options: { interval?: StockInterval; range?: StockRange } = {},
  signal?: AbortSignal,
): Promise<StockCandleSeries> {
  const params = new URLSearchParams({
    interval: options.interval ?? "1d",
    range: options.range ?? "6mo",
  });
  return apiFetch<StockCandleSeries>(
    `/stocks/candles/${encodeURIComponent(symbol)}?${params.toString()}`,
    { token, ...(signal ? { signal } : {}) },
  );
}

/**
 * FX candles take an interval/range pair, exactly like equities: both now come from the same
 * upstream. The FX provider's own intraday endpoint returns ticks whose high/low are session
 * extremes repeated on every row, which drew as a row of identical dashes rather than candles.
 */
export function fetchForexCandles(
  pair: string,
  token: string,
  options: { interval?: StockInterval; range?: StockRange } = {},
  signal?: AbortSignal,
): Promise<ForexCandleSeries> {
  const params = new URLSearchParams({
    interval: options.interval ?? "1d",
    range: options.range ?? "3mo",
  });
  return apiFetch<ForexCandleSeries>(
    `/forex/candles/${encodeURIComponent(pair)}?${params.toString()}`,
    { token, ...(signal ? { signal } : {}) },
  );
}

/** `GET /crypto/orderbook/{symbol}` — real exchange depth. Crypto only; see `CryptoOrderBook`. */
export function fetchCryptoOrderBook(
  symbol: string,
  token: string,
  limit: OrderBookDepth = 20,
  signal?: AbortSignal,
): Promise<CryptoOrderBook> {
  const params = new URLSearchParams({ limit: String(limit) });
  return apiFetch<CryptoOrderBook>(
    `/crypto/orderbook/${encodeURIComponent(symbol)}?${params.toString()}`,
    { token, ...(signal ? { signal } : {}) },
  );
}
