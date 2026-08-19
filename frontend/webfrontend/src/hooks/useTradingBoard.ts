/**
 * Everything a trading page needs to know about the instruments it can trade.
 *
 * Three layers, in increasing order of how much they know:
 *
 * 1. **The public overview stream** — live prices for five headline symbols per market, and it
 *    announces that set. No token, so a signed-out visitor still sees real ticking prices.
 * 2. **The authenticated quote routes** — bid/ask, session range, volume, the instrument's real
 *    name and its settlement currency. None of that is on either socket, and an order cannot
 *    be sized without the currency.
 * 3. **The user's selected watchlist** — its own authenticated socket, so symbols *they* chose
 *    stream live rather than only the five the deployment advertises. When one is selected it
 *    defines the board; the overview set is the fallback for everyone else.
 *
 * `resolve()` reaches past all three to any symbol the feed supports, which is what lets search
 * work on the full universe.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import { ApiError } from "@/lib/api";
import { currentIdToken } from "@/lib/firebase";
import type { TradeInstrument } from "@/lib/instrument";
import { type OverviewMarket } from "@/lib/market-overview";
import {
  blankInstrument,
  fromCryptoQuote,
  fromForexQuote,
  fromStockQuote,
  withOverviewTick,
} from "@/lib/quote-to-instrument";
import { fetchCryptoQuotes, fetchForexQuotes, fetchStockQuotes } from "@/lib/markets-api";
import type { AssetClass } from "@/lib/trading-api";
import { useMarketOverview } from "@/hooks/useMarketOverview";
import { useWatchlists, type WatchlistsState } from "@/hooks/useWatchlists";

/** Volume and the session range drift; the price itself comes from a socket. */
const REFRESH_INTERVAL_MS = 30_000;

async function fetchQuotes(
  assetClass: AssetClass,
  symbols: readonly string[],
  token: string,
  signal?: AbortSignal,
): Promise<TradeInstrument[]> {
  if (symbols.length === 0) return [];
  if (assetClass === "crypto") {
    const { quotes } = await fetchCryptoQuotes(symbols, token, signal);
    return quotes.map(fromCryptoQuote);
  }
  if (assetClass === "forex") {
    const { quotes } = await fetchForexQuotes(symbols, token, signal);
    return quotes.map(fromForexQuote);
  }
  const { quotes } = await fetchStockQuotes(symbols, token, signal);
  return quotes.map(fromStockQuote);
}

export type TradingBoardState = {
  /** The board: the selected watchlist when there is one, else the streamed headline set. */
  instruments: TradeInstrument[];
  /** True when the rows come from the user's own watchlist rather than the public set. */
  fromWatchlist: boolean;
  /** The public price socket is connected. */
  connected: boolean;
  /** The authenticated watchlist socket is connected, when one is selected. */
  streaming: boolean;
  loading: boolean;
  error: string;
  /** False while signed out — the quote routes are authenticated. */
  enriched: boolean;
  /** Watchlist CRUD + selection, surfaced so the page can render a manager. */
  watchlists: WatchlistsState;
  resolve: (symbol: string) => Promise<TradeInstrument | null>;
};

export function useTradingBoard(assetClass: AssetClass): TradingBoardState {
  const { isLoggedIn, authReady } = useAuth();
  const { ticks, symbols, connected } = useMarketOverview();
  const watchlists = useWatchlists(assetClass);

  const [quotes, setQuotes] = useState<Map<string, TradeInstrument>>(new Map());
  const [extra, setExtra] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const usingWatchlist = watchlists.selected !== null;
  const streamed = symbols[assetClass as OverviewMarket] ?? [];

  /**
   * Which symbols need a REST quote. When a watchlist is selected its own socket supplies
   * prices, but not volume, the 52-week range or the instrument name — so those rows still
   * need enriching. Keyed on the joined string rather than the arrays: the overview feed
   * re-sends an identical list on every `subscribed` frame, and depending on array identity
   * would refetch every quote each time.
   */
  const universeKey = [
    ...new Set([...(usingWatchlist ? (watchlists.selected?.symbols ?? []) : streamed), ...extra]),
  ].join(",");
  const universe = useMemo(() => (universeKey === "" ? [] : universeKey.split(",")), [universeKey]);

  const wantedRef = useRef<string[]>([]);
  wantedRef.current = universe;

  useEffect(() => {
    if (!authReady) return;
    if (!isLoggedIn) {
      setQuotes(new Map());
      setError("");
      setLoading(false);
      return;
    }
    if (wantedRef.current.length === 0) return;

    const controller = new AbortController();
    let cancelled = false;

    const run = async (first: boolean) => {
      if (first) setLoading(true);
      try {
        const resolved = await fetchQuotes(
          assetClass,
          wantedRef.current,
          await currentIdToken(),
          controller.signal,
        );
        if (cancelled) return;
        setQuotes(new Map(resolved.map((i) => [i.symbol, i])));
        setError("");
      } catch (err) {
        if (cancelled || controller.signal.aborted) return;
        setError(
          err instanceof ApiError ? err.message : "Could not load quote details for this market.",
        );
      } finally {
        if (!cancelled && first) setLoading(false);
      }
    };

    void run(true);
    const interval = setInterval(() => {
      if (typeof document === "undefined" || document.visibilityState === "visible")
        void run(false);
    }, REFRESH_INTERVAL_MS);

    return () => {
      cancelled = true;
      controller.abort();
      clearInterval(interval);
    };
  }, [authReady, isLoggedIn, assetClass, universeKey]);

  const resolve = useCallback(
    async (symbol: string): Promise<TradeInstrument | null> => {
      const wanted = symbol.trim().toUpperCase();
      if (!wanted) return null;
      const held = quotes.get(wanted);
      if (held) return held;
      if (!isLoggedIn) return null;
      try {
        const [resolved] = await fetchQuotes(assetClass, [wanted], await currentIdToken());
        if (!resolved) return null;
        setQuotes((prev) => new Map(prev).set(resolved.symbol, resolved));
        setExtra((prev) => (prev.includes(resolved.symbol) ? prev : [...prev, resolved.symbol]));
        return resolved;
      } catch {
        // A 404 here just means the feed has no such instrument; the caller reports it.
        return null;
      }
    },
    [assetClass, isLoggedIn, quotes],
  );

  const instruments = useMemo(() => {
    // A watchlist stream is pushed and authenticated, so it wins on price where it has one;
    // REST fills the columns neither socket carries.
    if (usingWatchlist) {
      const streamed = new Map(watchlists.instruments.map((i) => [i.symbol, i]));
      return universe.map((symbol) => {
        const live = streamed.get(symbol);
        const rest = quotes.get(symbol);
        if (!rest) return live ?? blankInstrument(assetClass, symbol);
        if (!live || live.price === null) return rest;
        // Price/change from the socket, everything else from the richer REST quote.
        return {
          ...rest,
          price: live.price,
          change: live.change ?? rest.change,
          changePercent: live.changePercent ?? rest.changePercent,
          bid: live.bid ?? rest.bid,
          ask: live.ask ?? rest.ask,
          stale: live.stale,
        };
      });
    }

    const tickByKey = new Map(
      ticks.filter((t) => t.market === (assetClass as OverviewMarket)).map((t) => [t.symbol, t]),
    );
    return universe.map((symbol) =>
      withOverviewTick(
        quotes.get(symbol) ?? blankInstrument(assetClass, symbol),
        tickByKey.get(symbol),
      ),
    );
  }, [usingWatchlist, watchlists.instruments, ticks, assetClass, universe, quotes]);

  return {
    instruments,
    fromWatchlist: usingWatchlist,
    connected,
    streaming: watchlists.streaming,
    loading: loading || watchlists.loading,
    error: error || watchlists.error,
    enriched: authReady && isLoggedIn,
    watchlists,
    resolve,
  };
}
