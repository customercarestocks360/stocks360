/**
 * The markets table's data source: the public price stream, enriched with whatever the
 * authenticated quote routes can add.
 *
 * Two sources, deliberately:
 *
 * - **`WS /market/overview/stream`** is public, so *every* visitor gets live prices and a
 *   change percentage. It also announces the symbol universe, which is what lets a row
 *   exist before its first tick arrives instead of the table popping in piecemeal.
 * - **`GET /{crypto,forex,stocks}` batch quotes** are authenticated, and carry the columns
 *   the stream does not: volume, the day and 52-week ranges, an instrument's real name and
 *   quote currency. Signed out, those cells stay empty — an unsourced number in a
 *   fundamentals column is worse than a blank one.
 *
 * The two never fight over price: a live tick always wins, and the REST price is only a
 * placeholder for a symbol the socket has not sent yet.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import { ApiError } from "@/lib/api";
import { currentIdToken } from "@/lib/firebase";
import {
  cryptoQuoteAsset,
  formatOverviewLabel,
  formatOverviewPrice,
  OVERVIEW_MARKETS,
  type OverviewMarket,
  type OverviewTick,
} from "@/lib/market-overview";
import {
  fetchCryptoQuotes,
  fetchForexQuotes,
  fetchStockQuotes,
  type MarketState,
} from "@/lib/markets-api";
import { useMarketOverview } from "@/hooks/useMarketOverview";

/**
 * Volume means something different per feed, so it is carried with its unit rather than as
 * a bare number that invites the wrong comparison. Equities report a share count; crypto
 * reports traded value in the pair's quote asset; the FX provider reports no volume at all.
 */
export type VolumeKind = "shares" | "value";

export type MarketRow = {
  market: OverviewMarket;
  symbol: string;
  /** "BTC/USDT", "EUR/USD", "RELIANCE". */
  label: string;
  /** The instrument's real name once REST has loaded, else its ticker. */
  name: string;
  /** Locale-formatted, ready to render. `null` when nothing has priced this symbol yet. */
  price: string | null;
  priceValue: number | null;
  change: number | null;
  changePercent: number | null;
  currency: string | null;
  /** Outside this feed's freshness window — a closed market, not a fault. */
  stale: boolean;
  /** True while the price is arriving over the socket rather than from the REST snapshot. */
  live: boolean;
  volume: number | null;
  volumeKind: VolumeKind | null;
  /** Unit the volume is denominated in — the quote asset for crypto, else null. */
  volumeUnit: string | null;
  dayLow: number | null;
  dayHigh: number | null;
  /** Equities only: neither the FX nor the crypto provider publishes a 52-week range. */
  low52w: number | null;
  high52w: number | null;
  marketState: MarketState | null;
};

/** What the fundamentals half of the table is doing, so the UI can explain an empty column. */
export type FundamentalsStatus = "signed-out" | "idle" | "loading" | "loaded" | "partial" | "error";

type Fundamentals = {
  name?: string | null;
  currency?: string | null;
  price?: number | null;
  change?: number | null;
  changePercent?: number | null;
  volume?: number | null;
  volumeKind?: VolumeKind | null;
  volumeUnit?: string | null;
  dayLow?: number | null;
  dayHigh?: number | null;
  low52w?: number | null;
  high52w?: number | null;
  marketState?: MarketState | null;
  stale?: boolean;
};

/**
 * Volume and the 52-week range drift over a session, so they are re-read periodically
 * rather than only on mount. Kept deliberately slow: unlike the socket, every one of these
 * calls is a live upstream round trip per market, and the price column — the part that
 * actually needs to be current — is already coming from the stream.
 */
const REFRESH_INTERVAL_MS = 60_000;

/** `Number("")` is 0, which would read as a real zero rather than an absent field. */
function num(raw: string | number | null | undefined): number | null {
  if (raw === null || raw === undefined || raw === "") return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

async function loadFundamentals(
  symbols: Record<OverviewMarket, string[]>,
  token: string,
  signal: AbortSignal,
): Promise<{ byKey: Map<string, Fundamentals>; failed: number }> {
  const byKey = new Map<string, Fundamentals>();

  const [crypto, forex, stocks] = await Promise.all([
    fetchCryptoQuotes(symbols.crypto, token, signal),
    fetchForexQuotes(symbols.forex, token, signal),
    fetchStockQuotes(symbols.stocks, token, signal),
  ]);

  for (const q of crypto.quotes) {
    byKey.set(`crypto:${q.symbol}`, {
      price: num(q.last_price),
      change: num(q.price_change),
      changePercent: num(q.price_change_percent),
      // Quote-asset volume, not base: "how much was traded" is comparable across pairs
      // only in the currency it settled in.
      volume: num(q.quote_volume),
      volumeKind: "value",
      volumeUnit: cryptoQuoteAsset(q.symbol),
      dayLow: num(q.low),
      dayHigh: num(q.high),
      currency: cryptoQuoteAsset(q.symbol),
    });
  }

  for (const q of forex.quotes) {
    byKey.set(`forex:${q.symbol}`, {
      // The mid, not the bid: a headline rate should not favour one side of the spread —
      // the same choice the overview stream makes.
      price: num(q.mid),
      change: num(q.change),
      changePercent: num(q.change_percent),
      dayLow: num(q.low),
      dayHigh: num(q.high),
      currency: q.symbol.split("-")[1] ?? null,
      marketState: q.market_state,
      stale: q.stale,
    });
  }

  for (const q of stocks.quotes) {
    byKey.set(`stocks:${q.symbol}`, {
      name: q.name,
      currency: q.currency,
      price: num(q.price),
      change: num(q.change),
      changePercent: num(q.change_percent),
      volume: num(q.volume),
      volumeKind: "shares",
      dayLow: num(q.day_low),
      dayHigh: num(q.day_high),
      low52w: num(q.fifty_two_week_low),
      high52w: num(q.fifty_two_week_high),
      marketState: q.market_state,
      stale: q.stale,
    });
  }

  return { byKey, failed: crypto.failed + forex.failed + stocks.failed };
}

function buildRow(
  market: OverviewMarket,
  symbol: string,
  tick: OverviewTick | undefined,
  extra: Fundamentals | undefined,
): MarketRow {
  const label = tick?.label ?? formatOverviewLabel(market, symbol);
  // A live tick always wins; REST only fills a symbol the socket has not sent yet.
  const priceValue = tick?.priceValue ?? extra?.price ?? null;
  const hasLivePrice = tick !== undefined && Number.isFinite(tick.priceValue);

  return {
    market,
    symbol,
    label,
    name: extra?.name?.trim() || label,
    price:
      priceValue !== null && Number.isFinite(priceValue) ? formatOverviewPrice(priceValue) : null,
    priceValue: priceValue !== null && Number.isFinite(priceValue) ? priceValue : null,
    change: tick?.change ?? extra?.change ?? null,
    changePercent: tick?.changePercent ?? extra?.changePercent ?? null,
    currency: tick?.currency ?? extra?.currency ?? null,
    stale: tick?.stale ?? extra?.stale ?? false,
    live: hasLivePrice,
    volume: extra?.volume ?? null,
    volumeKind: extra?.volumeKind ?? null,
    volumeUnit: extra?.volumeUnit ?? null,
    dayLow: extra?.dayLow ?? null,
    dayHigh: extra?.dayHigh ?? null,
    low52w: extra?.low52w ?? null,
    high52w: extra?.high52w ?? null,
    marketState: extra?.marketState ?? null,
  };
}

export type MarketTableState = {
  rows: MarketRow[];
  /** The public price socket is connected. */
  connected: boolean;
  /** Per-market upstream connectivity, as the stream reports it. */
  markets: Record<OverviewMarket, boolean>;
  fundamentalsStatus: FundamentalsStatus;
  fundamentalsError: string;
  refreshFundamentals: () => void;
  /**
   * Brings a symbol the public stream does not carry into the table. Returns false when it
   * cannot be attempted at all — signed out, since resolving a symbol needs a token.
   */
  addSymbol: (market: OverviewMarket, symbol: string) => boolean;
};

export function useMarketTable(): MarketTableState {
  const { isLoggedIn, authReady } = useAuth();
  const { ticks, connected, symbols, markets } = useMarketOverview();

  const [fundamentals, setFundamentals] = useState<Map<string, Fundamentals>>(new Map());
  const [status, setStatus] = useState<FundamentalsStatus>("idle");
  const [error, setError] = useState("");
  // Bumped to force a refetch; the effect below depends on it.
  const [refreshToken, setRefreshToken] = useState(0);
  /**
   * Symbols pulled in beyond the streamed headline set — from search, or from a watchlist.
   * They have no public tick, so their price comes from the polled quote instead; that is why
   * `buildRow` treats a missing tick as "use the REST price" rather than "unpriced".
   */
  const [extraSymbols, setExtraSymbols] = useState<Record<OverviewMarket, string[]>>({
    crypto: [],
    forex: [],
    stocks: [],
  });

  const refreshFundamentals = useCallback(() => setRefreshToken((n) => n + 1), []);

  /** The streamed set plus anything search or a watchlist added. */
  const universe = useMemo(() => {
    const merged = {} as Record<OverviewMarket, string[]>;
    for (const m of OVERVIEW_MARKETS) {
      merged[m] = [...new Set([...symbols[m], ...extraSymbols[m]])];
    }
    return merged;
  }, [symbols, extraSymbols]);

  /**
   * The universe as a stable string, so the fetch effect re-runs when the symbol set actually
   * changes rather than on every `subscribed` frame that repeats it.
   */
  const universeKey = useMemo(
    () => OVERVIEW_MARKETS.map((m) => `${m}:${universe[m].join(",")}`).join("|"),
    [universe],
  );
  const totalSymbols = useMemo(
    () => OVERVIEW_MARKETS.reduce((sum, m) => sum + universe[m].length, 0),
    [universe],
  );

  // Read inside the effect without making it a dependency — re-running on every tick would
  // refetch constantly.
  const symbolsRef = useRef(universe);
  symbolsRef.current = universe;

  /**
   * Adds a symbol the stream does not carry. Resolving it is left to the quote poll below —
   * if the feed has no such instrument the row simply never gains a price, and the caller is
   * told by `addSymbol` returning false only when it cannot even try.
   */
  const addSymbol = useCallback(
    (market: OverviewMarket, symbol: string): boolean => {
      const wanted = symbol.trim().toUpperCase();
      if (!wanted || !isLoggedIn) return false;
      setExtraSymbols((prev) =>
        prev[market].includes(wanted) || symbols[market].includes(wanted)
          ? prev
          : { ...prev, [market]: [...prev[market], wanted] },
      );
      return true;
    },
    [isLoggedIn, symbols],
  );

  useEffect(() => {
    if (!authReady) return;
    if (!isLoggedIn) {
      setFundamentals(new Map());
      setStatus("signed-out");
      setError("");
      return;
    }
    // The stream has not named its universe yet; nothing to enrich.
    if (totalSymbols === 0) return;

    const controller = new AbortController();
    let cancelled = false;

    const run = async () => {
      setStatus((prev) => (prev === "idle" || prev === "signed-out" ? "loading" : prev));
      setError("");
      try {
        const token = await currentIdToken();
        const { byKey, failed } = await loadFundamentals(
          symbolsRef.current,
          token,
          controller.signal,
        );
        if (cancelled) return;
        setFundamentals(byKey);
        setStatus(failed > 0 ? "partial" : "loaded");
      } catch (err) {
        if (cancelled || controller.signal.aborted) return;
        setStatus("error");
        setError(
          err instanceof ApiError
            ? err.message
            : "Could not load volume and range data. Live prices are unaffected.",
        );
      }
    };

    void run();

    // Skipped while the tab is hidden: a background tab does not need a fresh volume
    // column, and each pass is a real upstream call per market.
    const interval = setInterval(() => {
      if (typeof document === "undefined" || document.visibilityState === "visible") void run();
    }, REFRESH_INTERVAL_MS);

    return () => {
      cancelled = true;
      controller.abort();
      clearInterval(interval);
    };
  }, [authReady, isLoggedIn, universeKey, totalSymbols, refreshToken]);

  const rows = useMemo(() => {
    const tickByKey = new Map(ticks.map((t) => [`${t.market}:${t.symbol}`, t]));

    // Every streamed symbol becomes a row, in the server's own per-market order, so the
    // table is stable while ticks trickle in. Before the handshake lands there is no
    // universe to iterate, so fall back to whatever has already ticked.
    if (totalSymbols === 0) {
      return ticks.map((t) =>
        buildRow(t.market, t.symbol, t, fundamentals.get(`${t.market}:${t.symbol}`)),
      );
    }

    return OVERVIEW_MARKETS.flatMap((market) =>
      universe[market].map((symbol) => {
        const key = `${market}:${symbol}`;
        return buildRow(market, symbol, tickByKey.get(key), fundamentals.get(key));
      }),
    );
  }, [ticks, universe, totalSymbols, fundamentals]);

  return {
    rows,
    connected,
    markets,
    fundamentalsStatus: status,
    fundamentalsError: error,
    refreshFundamentals,
    addSymbol,
  };
}
