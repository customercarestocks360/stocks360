/**
 * One shared connection to the backend's public `WS /market/overview/stream`, for
 * everything on the page that wants live headline prices (the ticker strips and the
 * markets table render the same feed).
 *
 * A module-level singleton rather than a per-component connection: `TickerBar` mounts
 * twice per page (top and bottom), and the backend's per-IP socket cap
 * (`OVERVIEW_MAX_SOCKETS_PER_IP`, default 4) means a naive one-socket-per-component
 * design would burn a quarter of that budget on a single browser tab. Every subscriber
 * shares one connection instead; the socket opens on the first subscriber and closes on
 * the last, matching the external-store pattern React's `useSyncExternalStore` expects.
 *
 * The endpoint is unauthenticated public market data — no token, no `Authorization`
 * header, nothing to attach.
 */
import { WS_BASE_URL } from "@/lib/config";

export type OverviewMarket = "crypto" | "forex" | "stocks";

export const OVERVIEW_MARKETS: readonly OverviewMarket[] = ["crypto", "forex", "stocks"];

export type OverviewTick = {
  market: OverviewMarket;
  symbol: string;
  /** Display-ready, e.g. "BTC/USDT", "EUR/USD", "RELIANCE". */
  label: string;
  /** Display-ready, already locale-formatted — never re-parse this for math. */
  price: string;
  /**
   * The same price as a number, for sorting and range arithmetic. Parsed once here so
   * render code never has to un-format `price` (which carries locale group separators).
   */
  priceValue: number;
  /** Absolute move over the feed's window. `null` when the upstream has not reported one. */
  change: number | null;
  /** `null` when the upstream has not reported a change yet. */
  changePercent: number | null;
  /** Quote currency, when the feed names one. Crypto ticks carry the quote asset in the symbol. */
  currency: string | null;
  /** Outside the feed's freshness window — a closed weekend market, not a fault. */
  stale: boolean;
};

export type OverviewState = {
  /** In first-seen order, so the strip doesn't reshuffle itself as ticks arrive. */
  ticks: OverviewTick[];
  connected: boolean;
  /**
   * The streamed universe per market, from the `subscribed` handshake. The server owns
   * this list (`OVERVIEW_*_SYMBOLS`), so clients read it off the wire instead of keeping a
   * second copy that can drift out of step with the deployment.
   */
  symbols: Record<OverviewMarket, string[]>;
  /** Per-market upstream connectivity, from the handshake and later `upstream` frames. */
  markets: Record<OverviewMarket, boolean>;
};

const EMPTY_SYMBOLS: Record<OverviewMarket, string[]> = { crypto: [], forex: [], stocks: [] };
const EMPTY_MARKETS: Record<OverviewMarket, boolean> = {
  crypto: false,
  forex: false,
  stocks: false,
};

export const EMPTY_OVERVIEW_STATE: OverviewState = {
  ticks: [],
  connected: false,
  symbols: EMPTY_SYMBOLS,
  markets: EMPTY_MARKETS,
};

// A symbol carries its own quote asset (BTC**USDT**), not a fixed decimal count, so the
// suffix has to be split off before formatting rather than assumed.
const CRYPTO_QUOTE_ASSETS = ["USDT", "USDC", "FDUSD", "BUSD", "BTC", "ETH", "BNB"];

/** The quote asset of a crypto pair, or null when the suffix is not one we know. */
export function cryptoQuoteAsset(symbol: string): string | null {
  return CRYPTO_QUOTE_ASSETS.find((q) => symbol.length > q.length && symbol.endsWith(q)) ?? null;
}

export function formatOverviewLabel(market: OverviewMarket, symbol: string): string {
  if (market === "crypto") {
    const quote = cryptoQuoteAsset(symbol);
    return quote ? `${symbol.slice(0, -quote.length)}/${quote}` : symbol;
  }
  if (market === "forex") return symbol.replace("-", "/");
  // Equities: the exchange suffix (Yahoo's convention for Indian listings) is noise on a
  // headline ticker — a foreign symbol without one passes through unchanged.
  return symbol.replace(/\.(NS|BO)$/i, "");
}

export function formatOverviewPrice(value: number): string {
  if (!Number.isFinite(value)) return "—";
  // More headroom for a sub-$1 price (most forex pairs, some altcoins) than a four-digit
  // one (BTC) needs, so neither loses the precision that actually distinguishes it.
  const maximumFractionDigits = value >= 100 ? 2 : value >= 1 ? 4 : 6;
  return value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits });
}

type RawTick = {
  market: OverviewMarket;
  symbol: string;
  price: string;
  change: string | null;
  change_percent: string | null;
  currency: string | null;
  stale: boolean;
};

type RawFrame = {
  type?: string;
  tick?: RawTick;
  ticks?: RawTick[];
  symbols?: Partial<Record<OverviewMarket, string[]>>;
  markets?: Partial<Record<OverviewMarket, boolean>>;
  market?: OverviewMarket;
  state?: "connected" | "disconnected" | "reconnected";
};

/** Keys in first-seen order; `tickByKey` is the same set, keyed for O(1) update on a `quote` frame. */
const order: string[] = [];
const tickByKey = new Map<string, OverviewTick>();

let state: OverviewState = EMPTY_OVERVIEW_STATE;
let connected = false;
let symbols: Record<OverviewMarket, string[]> = EMPTY_SYMBOLS;
let markets: Record<OverviewMarket, boolean> = EMPTY_MARKETS;
let ws: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectDelayMs = 1000;
const MAX_RECONNECT_DELAY_MS = 30_000;

const listeners = new Set<() => void>();

function emit(): void {
  state = { ticks: order.map((key) => tickByKey.get(key)!), connected, symbols, markets };
  listeners.forEach((listener) => listener());
}

/** `null` for an absent field; `Number("")` is 0, which would read as a real zero price. */
function toNumber(raw: string | null | undefined): number | null {
  if (raw === null || raw === undefined || raw === "") return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

function applyTick(raw: RawTick): void {
  const key = `${raw.market}:${raw.symbol}`;
  if (!tickByKey.has(key)) order.push(key);
  const priceValue = toNumber(raw.price) ?? Number.NaN;
  tickByKey.set(key, {
    market: raw.market,
    symbol: raw.symbol,
    label: formatOverviewLabel(raw.market, raw.symbol),
    price: formatOverviewPrice(priceValue),
    priceValue,
    change: toNumber(raw.change),
    changePercent: toNumber(raw.change_percent),
    currency: raw.currency ?? null,
    stale: raw.stale,
  });
}

function handleMessage(event: MessageEvent): void {
  let frame: RawFrame;
  try {
    frame = JSON.parse(event.data as string) as RawFrame;
  } catch {
    return;
  }

  switch (frame.type) {
    case "subscribed":
      // The handshake carries the universe and each upstream's connectivity. Symbols the
      // feed knows about but has not priced yet appear here before any tick does, which is
      // what lets a table render every row instead of only the ones that happen to be live.
      if (frame.symbols) symbols = { ...EMPTY_SYMBOLS, ...frame.symbols };
      if (frame.markets) markets = { ...EMPTY_MARKETS, ...frame.markets };
      emit();
      return;
    case "snapshot":
      if (frame.symbols) symbols = { ...EMPTY_SYMBOLS, ...frame.symbols };
      frame.ticks?.forEach(applyTick);
      emit();
      return;
    case "quote":
      if (frame.tick) {
        applyTick(frame.tick);
        emit();
      }
      return;
    case "upstream":
      // One feed dropped or came back; the other two keep streaming.
      if (frame.market) {
        markets = { ...markets, [frame.market]: frame.state !== "disconnected" };
        emit();
      }
      return;
    default:
      // heartbeat/error/pong carry nothing a price view needs to react to.
      return;
  }
}

function scheduleReconnect(): void {
  if (reconnectTimer !== null) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, reconnectDelayMs);
  reconnectDelayMs = Math.min(reconnectDelayMs * 2, MAX_RECONNECT_DELAY_MS);
}

function connect(): void {
  if (typeof window === "undefined") return;
  if (ws !== null && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING))
    return;

  ws = new WebSocket(`${WS_BASE_URL}/market/overview/stream`);
  ws.addEventListener("open", () => {
    reconnectDelayMs = 1000; // a clean connect forgives however long the last backoff had grown
    connected = true;
    emit();
  });
  ws.addEventListener("message", handleMessage);
  ws.addEventListener("close", () => {
    connected = false;
    // Connectivity is unknown once the socket is gone — reporting the last known state
    // would claim knowledge this client no longer has.
    markets = EMPTY_MARKETS;
    emit();
    scheduleReconnect();
  });
  // The close handler above is what actually schedules a reconnect — a WebSocket error is
  // always followed by a close event, so there is nothing additional to do here beyond
  // letting the browser log it.
}

function disconnect(): void {
  if (reconnectTimer !== null) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  reconnectDelayMs = 1000;
  ws?.close();
  ws = null;
  connected = false;
  markets = EMPTY_MARKETS;
}

/** `useSyncExternalStore`'s subscribe function: connects on the first subscriber, tears down on the last. */
export function subscribeToMarketOverview(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1) connect();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) disconnect();
  };
}

export function getMarketOverviewSnapshot(): OverviewState {
  return state;
}
