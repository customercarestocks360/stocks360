/**
 * A user's watchlists for one market, and the live stream for whichever is selected.
 *
 * This is what makes a trading page complete rather than a demo: the public overview socket
 * streams five fixed headline symbols per market, so before this a user could *search* any
 * instrument but only ever watch those five tick. A watchlist is a real server-side
 * subscription — its own authenticated WebSocket — so anything the feed supports streams.
 *
 * Three things worth knowing about the lifecycle:
 *
 * - **Edits do not need a reconnect.** `PATCH`/add/remove re-bind the open socket server-side
 *   and push a `resynced` frame, so the symbol list and quotes arrive on the existing
 *   connection. The mutations here therefore do not tear the stream down.
 * - **A deletion is pushed, not polled.** The server sends `deleted` and closes with 4410;
 *   that clears the selection here rather than leaving a dead socket retrying.
 * - **One socket at a time.** The per-user cap is 5 per market, so only the selected watchlist
 *   is streamed; switching closes the previous one first.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import { ApiError } from "@/lib/api";
import { currentIdToken } from "@/lib/firebase";
import type { TradeInstrument } from "@/lib/instrument";
import { blankInstrument, fromQuote } from "@/lib/quote-to-instrument";
import type { AssetClass } from "@/lib/trading-api";
import {
  addWatchlistSymbols,
  createWatchlist,
  deleteWatchlist,
  listWatchlists,
  removeWatchlistSymbol,
  updateWatchlist,
  type Watchlist,
} from "@/lib/watchlists-api";
import { openWatchlistStream, type AnyQuote, type WatchlistStream } from "@/lib/watchlist-stream";

/** Remembers which watchlist the user was last looking at, per market. UI preference only. */
const SELECTION_KEY = "stocks360-watchlist-selection";

function readSelection(): Record<string, string> {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(localStorage.getItem(SELECTION_KEY) ?? "{}") as Record<string, string>;
  } catch {
    return {};
  }
}

function writeSelection(assetClass: AssetClass, id: string | null) {
  if (typeof window === "undefined") return;
  const all = readSelection();
  if (id === null) delete all[assetClass];
  else all[assetClass] = id;
  try {
    localStorage.setItem(SELECTION_KEY, JSON.stringify(all));
  } catch {
    // A full or blocked storage quota must not break the feed.
  }
}

export type WatchlistsState = {
  watchlists: Watchlist[];
  selected: Watchlist | null;
  select: (id: string | null) => void;
  /** Live instruments for the selected watchlist, in its own symbol order. */
  instruments: TradeInstrument[];
  /** The authenticated socket for the selected watchlist is open. */
  streaming: boolean;
  /** True until the first list load settles. */
  loading: boolean;
  /** A read or stream failure worth showing. */
  error: string;
  /** False while signed out — every watchlist route is authenticated. */
  ready: boolean;
  reload: () => Promise<void>;
  create: (name: string, symbols: readonly string[]) => Promise<Watchlist>;
  rename: (id: string, name: string) => Promise<Watchlist>;
  addSymbols: (id: string, symbols: readonly string[]) => Promise<Watchlist>;
  removeSymbol: (id: string, symbol: string) => Promise<Watchlist>;
  remove: (id: string) => Promise<void>;
};

export function useWatchlists(assetClass: AssetClass): WatchlistsState {
  const { isLoggedIn, authReady } = useAuth();
  const ready = authReady && isLoggedIn;

  const [watchlists, setWatchlists] = useState<Watchlist[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [quotes, setQuotes] = useState<Map<string, TradeInstrument>>(new Map());
  const [streamSymbols, setStreamSymbols] = useState<string[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const streamRef = useRef<WatchlistStream | null>(null);

  const selected = useMemo(
    () => watchlists.find((w) => w.id === selectedId) ?? null,
    [watchlists, selectedId],
  );

  // ── Load the list, and restore the last selection if it still exists ───────────────────
  const reload = useCallback(async () => {
    if (!ready) return;
    try {
      const token = await currentIdToken();
      const found = await listWatchlists(assetClass, token);
      setWatchlists(found);
      setError("");
      setSelectedId((current) => {
        if (current && found.some((w) => w.id === current)) return current;
        const remembered = readSelection()[assetClass];
        if (remembered && found.some((w) => w.id === remembered)) return remembered;
        return found[0]?.id ?? null;
      });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load your watchlists.");
    }
  }, [ready, assetClass]);

  useEffect(() => {
    if (!authReady) return;
    if (!isLoggedIn) {
      setWatchlists([]);
      setSelectedId(null);
      setQuotes(new Map());
      setStreamSymbols([]);
      setError("");
      setLoading(false);
      return;
    }
    let cancelled = false;
    void (async () => {
      setLoading(true);
      await reload();
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [authReady, isLoggedIn, assetClass, reload]);

  const select = useCallback(
    (id: string | null) => {
      setSelectedId(id);
      writeSelection(assetClass, id);
    },
    [assetClass],
  );

  // ── The stream for the selected watchlist ──────────────────────────────────────────────
  useEffect(() => {
    // Tear down unconditionally first: a symbol-set change arrives as `resynced` on the open
    // socket, so this only runs when the *instance* changes.
    streamRef.current?.close();
    streamRef.current = null;
    setStreaming(false);

    if (!ready || selectedId === null) {
      setQuotes(new Map());
      setStreamSymbols([]);
      return;
    }

    setQuotes(new Map());
    const applyQuotes = (incoming: AnyQuote[]) =>
      setQuotes((prev) => {
        const next = new Map(prev);
        for (const q of incoming) next.set(q.symbol, fromQuote(assetClass, q));
        return next;
      });

    const stream = openWatchlistStream(assetClass, selectedId, currentIdToken, {
      onSubscribed: (symbols) => {
        setStreamSymbols(symbols);
        setError("");
      },
      onSnapshot: (incoming) => applyQuotes(incoming),
      onQuote: (quote) => applyQuotes([quote]),
      onResynced: (symbols, incoming) => {
        // The watchlist was edited; the server re-bound this socket rather than closing it.
        setStreamSymbols(symbols);
        setQuotes(new Map(incoming.map((q) => [q.symbol, fromQuote(assetClass, q)])));
      },
      onDeleted: () => {
        // Pushed by the server, so the list is refreshed from the source of truth rather than
        // patched from a guess about what changed.
        void reload();
      },
      onConnectedChange: setStreaming,
      onFatal: (_code, reason) => setError(reason),
    });
    streamRef.current = stream;

    return () => {
      stream.close();
      if (streamRef.current === stream) streamRef.current = null;
    };
  }, [ready, assetClass, selectedId, reload]);

  /**
   * Rows in the watchlist's own symbol order — preferring the order the *stream* announced,
   * since after an edit that is fresher than the last REST read.
   */
  const instruments = useMemo(() => {
    const order = streamSymbols.length > 0 ? streamSymbols : (selected?.symbols ?? []);
    return order.map((symbol) => quotes.get(symbol) ?? blankInstrument(assetClass, symbol));
  }, [streamSymbols, selected, quotes, assetClass]);

  // ── Mutations. Each re-reads the list; the open socket resyncs itself. ─────────────────
  const withToken = useCallback(async <T>(fn: (token: string) => Promise<T>): Promise<T> => {
    const token = await currentIdToken();
    return fn(token);
  }, []);

  const create = useCallback(
    async (name: string, symbols: readonly string[]) => {
      const created = await withToken((t) => createWatchlist(assetClass, name, symbols, t));
      await reload();
      select(created.id);
      return created;
    },
    [assetClass, reload, select, withToken],
  );

  const rename = useCallback(
    async (id: string, name: string) => {
      const updated = await withToken((t) => updateWatchlist(assetClass, id, { name }, t));
      await reload();
      return updated;
    },
    [assetClass, reload, withToken],
  );

  const addSymbols = useCallback(
    async (id: string, symbols: readonly string[]) => {
      const updated = await withToken((t) => addWatchlistSymbols(assetClass, id, symbols, t));
      await reload();
      return updated;
    },
    [assetClass, reload, withToken],
  );

  const removeSymbol = useCallback(
    async (id: string, symbol: string) => {
      const updated = await withToken((t) => removeWatchlistSymbol(assetClass, id, symbol, t));
      await reload();
      return updated;
    },
    [assetClass, reload, withToken],
  );

  const remove = useCallback(
    async (id: string) => {
      await withToken((t) => deleteWatchlist(assetClass, id, t));
      if (id === selectedId) select(null);
      await reload();
    },
    [assetClass, reload, select, selectedId, withToken],
  );

  return {
    watchlists,
    selected,
    select,
    instruments,
    streaming,
    loading,
    error,
    ready,
    reload,
    create,
    rename,
    addSymbols,
    removeSymbol,
    remove,
  };
}
