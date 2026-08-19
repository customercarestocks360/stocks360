/**
 * The authenticated per-watchlist WebSocket: live ticks for the symbols a user actually chose.
 *
 * **Token goes in the subprotocol, not the query string.** A browser cannot set an
 * `Authorization` header on a handshake, so the backend accepts three sources — and prefers
 * `Sec-WebSocket-Protocol: bearer, <token>`, because a `?token=` lands in access logs, proxy
 * logs and browser history as a live credential (RFC 6750 §2.3 advises against it). Browsers
 * *can* set the subprotocol, via `new WebSocket(url, ["bearer", token])`, so that is what this
 * uses; the server echoes `bearer` back on accept.
 *
 * **One socket per watchlist instance, not a singleton.** Unlike the public overview feed —
 * where every viewer wants the identical symbol set and a module-level singleton is right —
 * each watchlist is a different subscription. The per-user cap is 5 sockets per market, so a
 * caller opens one at a time and closes it when the selection changes.
 *
 * **Frames are the shared streaming protocol** (`backend/app/schemas/streaming.py`), the same
 * one the overview feed speaks, plus two this one has and that one does not: `resynced` when
 * the watchlist is edited over REST, and `deleted` immediately before the socket closes.
 */
import { WS_BASE_URL } from "@/lib/config";
import type { CryptoQuote, ForexQuote, StockQuote } from "@/lib/markets-api";
import type { AssetClass } from "@/lib/trading-api";

/** Application-range close codes, so a client can react without parsing text. */
export const WS_CLOSE_UNAUTHENTICATED = 4401;
export const WS_CLOSE_NOT_FOUND = 4404;
export const WS_CLOSE_TOO_MANY = 4429;
export const WS_CLOSE_DELETED = 4410;

export type StreamFrameType =
  | "subscribed"
  | "snapshot"
  | "quote"
  | "resynced"
  | "deleted"
  | "heartbeat"
  | "upstream"
  | "error"
  | "pong";

/** Any of the three markets' quote shapes — the caller knows which by its asset class. */
export type AnyQuote = CryptoQuote | ForexQuote | StockQuote;

export type StreamFrame = {
  type: StreamFrameType;
  at: string;
  watchlist_id?: string | null;
  version?: number | null;
  symbols?: string[] | null;
  quote?: AnyQuote | null;
  quotes?: AnyQuote[] | null;
  state?: "connected" | "disconnected" | "reconnected" | null;
  /** Ticks shed for this socket because the client fell behind. */
  dropped?: number | null;
  detail?: string | null;
};

export type WatchlistStreamHandlers = {
  /** Handshake accepted; carries the symbol set and the upstream's connectivity. */
  onSubscribed?: (symbols: string[], version: number, upstreamConnected: boolean) => void;
  /** Full snapshot — on connect, and again after a `resync` or an edit. */
  onSnapshot?: (quotes: AnyQuote[], version: number, detail: string | null) => void;
  onQuote?: (quote: AnyQuote) => void;
  /** The watchlist was edited over REST; the server re-bound this socket in place. */
  onResynced?: (symbols: string[], quotes: AnyQuote[], version: number) => void;
  /** The watchlist was deleted. The socket closes with 4410 right after this. */
  onDeleted?: (detail: string | null) => void;
  onUpstream?: (state: "connected" | "disconnected" | "reconnected") => void;
  /** Terminal failures the caller should surface rather than silently retry. */
  onFatal?: (code: number, reason: string) => void;
  onConnectedChange?: (connected: boolean) => void;
};

const MAX_RECONNECT_DELAY_MS = 30_000;
const INITIAL_RECONNECT_DELAY_MS = 1_000;

/**
 * Close codes that must not be retried: retrying only burns the per-user socket cap and, for
 * a revoked token, hammers Firebase. A deleted or missing watchlist will never come back on
 * this id, and an unauthenticated socket needs a fresh token from the caller.
 */
const TERMINAL_CODES = new Set([
  WS_CLOSE_UNAUTHENTICATED,
  WS_CLOSE_NOT_FOUND,
  WS_CLOSE_DELETED,
  WS_CLOSE_TOO_MANY,
]);

const TERMINAL_REASONS: Record<number, string> = {
  [WS_CLOSE_UNAUTHENTICATED]: "Your session expired — sign in again to resume the live feed.",
  [WS_CLOSE_NOT_FOUND]: "That watchlist no longer exists.",
  [WS_CLOSE_DELETED]: "That watchlist was deleted.",
  [WS_CLOSE_TOO_MANY]: "Too many live streams open on this account — close another tab.",
};

export type WatchlistStream = {
  /** Idempotent; safe to call from a React cleanup that may run twice. */
  close: () => void;
  /** Asks the server for a fresh snapshot. No-op while the socket is not open. */
  resync: () => void;
};

/**
 * Opens a stream for one watchlist and keeps it open, reconnecting with exponential backoff
 * on a transport drop but never on a terminal close code.
 *
 * `getToken` is called per connection attempt rather than captured once, so a reconnect after
 * a long backoff uses a fresh ID token instead of an expired one.
 */
export function openWatchlistStream(
  assetClass: AssetClass,
  watchlistId: string,
  getToken: () => Promise<string>,
  handlers: WatchlistStreamHandlers,
): WatchlistStream {
  let ws: WebSocket | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let delayMs = INITIAL_RECONNECT_DELAY_MS;
  let disposed = false;

  const url = `${WS_BASE_URL}/${assetClass}/watchlists/${watchlistId}/stream`;

  const handle = (raw: string) => {
    let frame: StreamFrame;
    try {
      frame = JSON.parse(raw) as StreamFrame;
    } catch {
      return;
    }
    switch (frame.type) {
      case "subscribed":
        handlers.onSubscribed?.(
          frame.symbols ?? [],
          frame.version ?? 0,
          frame.state !== "disconnected",
        );
        return;
      case "snapshot":
        handlers.onSnapshot?.(frame.quotes ?? [], frame.version ?? 0, frame.detail ?? null);
        return;
      case "quote":
        if (frame.quote) handlers.onQuote?.(frame.quote);
        return;
      case "resynced":
        handlers.onResynced?.(frame.symbols ?? [], frame.quotes ?? [], frame.version ?? 0);
        return;
      case "deleted":
        // Not retried: the close that follows carries 4410, which is terminal.
        handlers.onDeleted?.(frame.detail ?? null);
        return;
      case "upstream":
        if (frame.state) handlers.onUpstream?.(frame.state);
        return;
      default:
        // heartbeat / error / pong carry nothing a price view needs to act on.
        return;
    }
  };

  const connect = async () => {
    if (disposed || typeof window === "undefined") return;
    if (ws !== null && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING))
      return;

    let token: string;
    try {
      token = await getToken();
    } catch {
      // Could not mint a token — treat as a transport problem and back off.
      scheduleReconnect();
      return;
    }
    if (disposed) return;

    // ["bearer", token] becomes `Sec-WebSocket-Protocol: bearer, <token>`, keeping the
    // credential out of the URL and therefore out of every log that records one.
    const socket = new WebSocket(url, ["bearer", token]);
    ws = socket;

    socket.addEventListener("open", () => {
      delayMs = INITIAL_RECONNECT_DELAY_MS;
      handlers.onConnectedChange?.(true);
    });
    socket.addEventListener("message", (event) => handle(event.data as string));
    socket.addEventListener("close", (event) => {
      // Drop the reference before deciding what to do next. The reconnect guard below tests
      // `ws` for an already-live socket, and leaving a closed one in place would make that
      // guard depend on the browser having moved `readyState` to CLOSED before dispatching
      // this event. It does, per spec — but a retry path should not rest on that ordering.
      if (ws === socket) ws = null;
      handlers.onConnectedChange?.(false);
      if (disposed) return;
      if (TERMINAL_CODES.has(event.code)) {
        handlers.onFatal?.(
          event.code,
          TERMINAL_REASONS[event.code] ?? event.reason ?? "The live feed closed.",
        );
        return;
      }
      scheduleReconnect();
    });
    // An error is always followed by a close, which is where the retry decision lives.
  };

  function scheduleReconnect() {
    if (disposed || reconnectTimer !== null) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      void connect();
    }, delayMs);
    delayMs = Math.min(delayMs * 2, MAX_RECONNECT_DELAY_MS);
  }

  void connect();

  return {
    close() {
      disposed = true;
      if (reconnectTimer !== null) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      ws?.close();
      ws = null;
    },
    resync() {
      if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ action: "resync" }));
    },
  };
}
