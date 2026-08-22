/**
 * The real trading session: eligibility, cash, positions, orders and fills from
 * `/trading/*`, plus the two mutations the desk needs.
 *
 * **Polled, not pushed.** The matcher runs server-side but exposes no socket, so a resting
 * order that fills later only becomes visible on the next poll. The interval is slow by
 * default and pauses on a hidden tab; anything that mutates state refreshes immediately
 * rather than waiting for the next tick.
 *
 * **A placed order is not necessarily a filled order.** `place()` resolves with the order in
 * whatever state the venue settled it into — `filled`, `open`, `cancelled` or `rejected` —
 * and callers must read `status`. It throws only on a transport or validation failure, where
 * nothing was recorded at all.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import { ApiError } from "@/lib/api";
import { currentIdToken } from "@/lib/firebase";
import {
  cancelOrder as cancelOrderRequest,
  fetchEligibility,
  fetchLedger,
  fetchOrders,
  fetchPortfolio,
  fetchTrades,
  placeOrder as placeOrderRequest,
  type Balance,
  type Eligibility,
  type LedgerEntry,
  type Order,
  type OrderRequest,
  type Portfolio,
  type PositionValuation,
  type Trade,
} from "@/lib/trading-api";

/** Slow on purpose: this exists to catch a resting fill, not to animate a price. */
const POLL_INTERVAL_MS = 15_000;

export type TradingState = {
  eligibility: Eligibility | null;
  balances: Balance[];
  /**
   * Positions **marked to market** — they carry `last_price`, `market_value`,
   * `unrealized_pnl` and `unrealized_pnl_percent` on top of the cost basis. A `null` mark
   * means the feed had no usable price, which is deliberately distinct from a value of zero.
   */
  positions: PositionValuation[];
  /**
   * The whole portfolio read. There **is** a grand total (`equity`, `cash`, `market_value`,
   * `margin_used`, `free_margin`), in `portfolio.account_currency` — every position's cash leg
   * is already converted into the one balance the account holds, so these are numbers that
   * share a unit rather than an invented sum of INR and USDT. The `*_by_currency` maps survive
   * for API compatibility and now have exactly one key each; prefer the scalars.
   */
  portfolio: Portfolio | null;
  orders: Order[];
  trades: Trade[];
  /** Every USDT movement: funding, order holds/releases, fills, and fees. */
  ledger: LedgerEntry[];
  /** True until the first load settles. */
  loading: boolean;
  /** A read failure. Mutations report their own errors to the caller instead. */
  error: string;
  /** False while signed out — every `/trading/*` route is authenticated. */
  ready: boolean;
  refresh: () => Promise<void>;
  place: (request: OrderRequest) => Promise<Order>;
  cancel: (orderId: string) => Promise<Order>;
  /** Free cash in one currency, as a number. `0` when the venue holds none. */
  availableIn: (currency: string) => number;
  /** Units of one symbol free to sell — total held minus what open sells already reserve. */
  availableUnits: (symbol: string) => number;
};

export function useTrading(): TradingState {
  const { isLoggedIn, authReady } = useAuth();

  const [eligibility, setEligibility] = useState<Eligibility | null>(null);
  const [portfolio, setPortfolio] = useState<Portfolio | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [ledger, setLedger] = useState<LedgerEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // `/trading/portfolio` already carries balances and marked-to-market positions, so it stands
  // in for both `/trading/balances` and `/trading/positions` — one round trip instead of two,
  // and it is the only one of the three that knows unrealised P&L.
  //
  // Memoised so the `?? []` fallback does not mint a new array on every render, which would
  // re-create the lookup callbacks below and defeat their memoisation for every consumer.
  const balances: Balance[] = useMemo(() => portfolio?.balances ?? [], [portfolio]);
  const positions: PositionValuation[] = useMemo(() => portfolio?.positions ?? [], [portfolio]);

  const ready = authReady && isLoggedIn;

  // Guards a refresh that resolves after unmount, and after a sign-out.
  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  const load = useCallback(async (signal?: AbortSignal) => {
    const token = await currentIdToken();
    // In parallel: independent reads, and the desk needs all four to render a correct ticket
    // (cash for a buy, free units for a sell, eligibility for the gate).
    const [eligibilityResult, portfolioResult, ordersResult, tradesResult, ledgerResult] =
      await Promise.all([
        fetchEligibility(token, signal),
        fetchPortfolio(token, signal),
        fetchOrders(token, { limit: 100 }, signal),
        fetchTrades(token, { limit: 100 }, signal),
        fetchLedger(token, { limit: 200 }, signal),
      ]);
    if (!aliveRef.current || signal?.aborted) return;
    setEligibility(eligibilityResult);
    setPortfolio(portfolioResult);
    setOrders(ordersResult);
    setTrades(tradesResult);
    setLedger(ledgerResult);
  }, []);

  const refresh = useCallback(async () => {
    if (!ready) return;
    try {
      await load();
      if (aliveRef.current) setError("");
    } catch (err) {
      if (!aliveRef.current) return;
      setError(err instanceof ApiError ? err.message : "Could not load your trading account.");
    }
  }, [ready, load]);

  useEffect(() => {
    if (!authReady) return;
    if (!isLoggedIn) {
      setEligibility(null);
      setPortfolio(null);
      setOrders([]);
      setTrades([]);
      setLedger([]);
      setError("");
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    let cancelled = false;

    const run = async (first: boolean) => {
      if (first) setLoading(true);
      try {
        await load(controller.signal);
        if (!cancelled) setError("");
      } catch (err) {
        if (cancelled || controller.signal.aborted) return;
        setError(err instanceof ApiError ? err.message : "Could not load your trading account.");
      } finally {
        if (!cancelled && first) setLoading(false);
      }
    };

    void run(true);

    // A background tab does not need to watch for fills.
    const interval = setInterval(() => {
      if (typeof document === "undefined" || document.visibilityState === "visible") {
        void run(false);
      }
    }, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      controller.abort();
      clearInterval(interval);
    };
  }, [authReady, isLoggedIn, load]);

  const place = useCallback(
    async (request: OrderRequest): Promise<Order> => {
      const token = await currentIdToken();
      const order = await placeOrderRequest(request, token);
      // Cash, units and the order list all moved — re-read rather than patching locally, so
      // the screen reflects what the venue actually recorded.
      void refresh();
      return order;
    },
    [refresh],
  );

  const cancel = useCallback(
    async (orderId: string): Promise<Order> => {
      const token = await currentIdToken();
      const order = await cancelOrderRequest(orderId, token);
      void refresh();
      return order;
    },
    [refresh],
  );

  const availableIn = useCallback(
    (currency: string): number => {
      const held = balances.find((b) => b.currency === currency);
      if (!held) return 0;
      const value = Number(held.available);
      return Number.isFinite(value) ? value : 0;
    },
    [balances],
  );

  const availableUnits = useCallback(
    (symbol: string): number => {
      const held = positions.find((p) => p.symbol === symbol);
      if (!held) return 0;
      const value = Number(held.available_quantity);
      return Number.isFinite(value) ? value : 0;
    },
    [positions],
  );

  return {
    eligibility,
    balances,
    positions,
    portfolio,
    orders,
    trades,
    ledger,
    loading,
    error,
    ready,
    refresh,
    place,
    cancel,
    availableIn,
    availableUnits,
  };
}
