/**
 * Watchlists — the per-user, per-market instances that own an authenticated live stream.
 *
 * **Why this matters beyond persistence.** The public overview socket streams a fixed set of
 * headline symbols (`OVERVIEW_*_SYMBOLS`, five per market). A watchlist is how a user gets
 * live ticks for symbols *they* chose: each instance has its own WebSocket, so any symbol the
 * feed supports can stream instead of only the five the deployment happens to advertise.
 *
 * The three markets expose a byte-identical route shape under different prefixes, so these
 * wrappers take the asset class rather than being written out three times. What genuinely
 * differs is the quote payload and the "could not price these" field name — crypto calls it
 * `stale`, forex and equities call it `unavailable`, and forex adds a feed-wide
 * `market_state`. `WatchlistQuotes` below models all three honestly rather than pretending
 * they agree.
 *
 * Mirrors the `Watchlist*` models in `backend/app/schemas/{crypto,forex,stocks}.py`.
 */
import { apiFetch } from "@/lib/api";
import type { CryptoQuote, ForexQuote, MarketState, StockQuote } from "@/lib/markets-api";
import type { AssetClass } from "@/lib/trading-api";

/** Route prefix per asset class. `stocks` is the odd one out only in its plural. */
const PREFIX: Record<AssetClass, string> = {
  crypto: "/crypto",
  forex: "/forex",
  stocks: "/stocks",
};

/**
 * Per-market symbol caps, from `backend/app/core/config.py`. Exceeding one is a `409` from
 * the add-symbols route, so the UI can refuse before asking.
 */
export const MAX_SYMBOLS_PER_WATCHLIST: Record<AssetClass, number> = {
  crypto: 50,
  forex: 30,
  stocks: 25,
};

/** How many watchlists a user may hold per market. */
export const MAX_WATCHLISTS = 20;

/** Concurrent authenticated streams per user, per market. */
export const MAX_SOCKETS_PER_USER = 5;

export type Watchlist = {
  /** 32 hex characters. */
  id: string;
  name: string;
  symbols: string[];
  /** Bumped on every mutation; a live socket re-binds on a bump. */
  version: number;
  /** Server-computed path for this instance's stream, e.g. `/crypto/watchlists/{id}/stream`. */
  stream_url: string;
  created_at: string;
  updated_at: string;
};

/**
 * The snapshot a socket would send on connect, for a client that wants to render first.
 * `quotes` is that market's own quote shape; the unpriced-symbol list is named differently
 * per market, so both spellings are optional here and `unpricedSymbols()` reads either.
 */
export type WatchlistQuotes = {
  id: string;
  name: string;
  version: number;
  quotes: (CryptoQuote | ForexQuote | StockQuote)[];
  /** Crypto's name for symbols with no quote yet. */
  stale?: string[];
  /** Forex's and equities' name for the same thing. */
  unavailable?: string[];
  /** Forex only — the interbank session is feed-wide rather than per symbol. */
  market_state?: MarketState;
  at: string;
};

/** Symbols the server could not price, whichever field name this market uses. */
export function unpricedSymbols(snapshot: WatchlistQuotes): string[] {
  return snapshot.stale ?? snapshot.unavailable ?? [];
}

// --------------------------------------------------------------------------------------- //
// CRUD
// --------------------------------------------------------------------------------------- //

/** `GET /{market}/watchlists` — newest first. */
export function listWatchlists(
  assetClass: AssetClass,
  token: string,
  limit = 50,
  signal?: AbortSignal,
): Promise<Watchlist[]> {
  return apiFetch<Watchlist[]>(`${PREFIX[assetClass]}/watchlists?limit=${limit}`, {
    token,
    ...(signal ? { signal } : {}),
  });
}

export function getWatchlist(
  assetClass: AssetClass,
  id: string,
  token: string,
  signal?: AbortSignal,
): Promise<Watchlist> {
  return apiFetch<Watchlist>(`${PREFIX[assetClass]}/watchlists/${id}`, {
    token,
    ...(signal ? { signal } : {}),
  });
}

/**
 * `POST /{market}/watchlists` — `201`. Symbols are validated against the live universe, so a
 * socket can never be opened on something the exchange will not stream.
 *
 * `409` when the watchlist cap is reached or the name is already taken; `404`/`422` when a
 * symbol is not tradable or malformed.
 */
export function createWatchlist(
  assetClass: AssetClass,
  name: string,
  symbols: readonly string[],
  token: string,
  signal?: AbortSignal,
): Promise<Watchlist> {
  return apiFetch<Watchlist>(`${PREFIX[assetClass]}/watchlists`, {
    method: "POST",
    token,
    body: { name, symbols: [...symbols] },
    ...(signal ? { signal } : {}),
  });
}

/**
 * `PATCH /{market}/watchlists/{id}` — rename, replace symbols, or both. Sending neither is a
 * `422`. Any open socket for this instance is re-bound in place and sent a `resynced` frame,
 * so there is no need to reconnect after this.
 */
export function updateWatchlist(
  assetClass: AssetClass,
  id: string,
  changes: { name?: string; symbols?: readonly string[] },
  token: string,
  signal?: AbortSignal,
): Promise<Watchlist> {
  const body: Record<string, unknown> = {};
  if (changes.name !== undefined) body["name"] = changes.name;
  if (changes.symbols !== undefined) body["symbols"] = [...changes.symbols];
  return apiFetch<Watchlist>(`${PREFIX[assetClass]}/watchlists/${id}`, {
    method: "PATCH",
    token,
    body,
    ...(signal ? { signal } : {}),
  });
}

/** `POST /{market}/watchlists/{id}/symbols` — idempotent; re-adding a held symbol is a no-op. */
export function addWatchlistSymbols(
  assetClass: AssetClass,
  id: string,
  symbols: readonly string[],
  token: string,
  signal?: AbortSignal,
): Promise<Watchlist> {
  return apiFetch<Watchlist>(`${PREFIX[assetClass]}/watchlists/${id}/symbols`, {
    method: "POST",
    token,
    body: { symbols: [...symbols] },
    ...(signal ? { signal } : {}),
  });
}

/**
 * `DELETE /{market}/watchlists/{id}/symbols/{symbol}` — returns the updated watchlist.
 *
 * A watchlist must keep at least one symbol, since an empty one has nothing to stream:
 * removing the last is a `409`, and deleting the watchlist is the right move instead.
 */
export function removeWatchlistSymbol(
  assetClass: AssetClass,
  id: string,
  symbol: string,
  token: string,
  signal?: AbortSignal,
): Promise<Watchlist> {
  return apiFetch<Watchlist>(
    `${PREFIX[assetClass]}/watchlists/${id}/symbols/${encodeURIComponent(symbol)}`,
    { method: "DELETE", token, ...(signal ? { signal } : {}) },
  );
}

/** `DELETE /{market}/watchlists/{id}` — `204`. Any open socket is told, then closed with 4410. */
export function deleteWatchlist(
  assetClass: AssetClass,
  id: string,
  token: string,
  signal?: AbortSignal,
): Promise<void> {
  return apiFetch<void>(`${PREFIX[assetClass]}/watchlists/${id}`, {
    method: "DELETE",
    token,
    ...(signal ? { signal } : {}),
  });
}

/** `GET /{market}/watchlists/{id}/quotes` — the same snapshot a socket sends on connect. */
export function fetchWatchlistQuotes(
  assetClass: AssetClass,
  id: string,
  token: string,
  signal?: AbortSignal,
): Promise<WatchlistQuotes> {
  return apiFetch<WatchlistQuotes>(`${PREFIX[assetClass]}/watchlists/${id}/quotes`, {
    token,
    ...(signal ? { signal } : {}),
  });
}

// --------------------------------------------------------------------------------------- //
// Session state (forex only)
// --------------------------------------------------------------------------------------- //

export type SessionInfo = {
  market_state: MarketState;
  at: string;
  detail: string;
};

/**
 * `GET /forex/session` — whether the interbank market is open. FX has no exchange calendar
 * per symbol the way equities do; the whole feed is open or closed together, which is why
 * this is one call rather than a field on every quote.
 */
export function fetchForexSession(token: string, signal?: AbortSignal): Promise<SessionInfo> {
  return apiFetch<SessionInfo>("/forex/session", { token, ...(signal ? { signal } : {}) });
}
