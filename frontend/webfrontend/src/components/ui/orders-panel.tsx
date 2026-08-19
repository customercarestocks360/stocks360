/**
 * Orders and fills from the real venue.
 *
 * Two exports, because of how this gets used:
 *
 * - `OrdersPanelView` takes a `TradingState` and renders it. The trading pages already hold
 *   one polling instance for the order ticket, so they pass it straight through instead of
 *   starting a second poller against the same endpoints.
 * - `OrdersPanel` owns its own `useTrading()` and is what a page with no ticket renders.
 *
 * "Trade history" is a genuinely different resource here, not a filter over orders:
 * `GET /trading/trades` returns the executions, each with the fee actually charged and the
 * realised P&L on a sell. The previous version derived it by filtering orders and showed a
 * hardcoded `100%` / `0%` fill column.
 */
import { useMemo, useState } from "react";
import { ApiError } from "@/lib/api";
import { formatPrice } from "@/lib/instrument";
import { amount, type Order, type OrderStatus, type Trade } from "@/lib/trading-api";
import { useTrading, type TradingState } from "@/hooks/useTrading";

const TABS = ["Open orders", "Order history", "Trade history"] as const;
type Tab = (typeof TABS)[number];

function stamp(iso: string) {
  const d = new Date(iso);
  const p = (v: number) => String(v).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

const STATUS_STYLE: Record<OrderStatus, string> = {
  open: "bg-primary/10 text-primary",
  filled: "bg-up/10 text-up",
  cancelled: "bg-muted text-muted-foreground",
  expired: "bg-muted text-muted-foreground",
  rejected: "bg-down/10 text-down",
};

function StatusPill({ status }: { status: OrderStatus }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize ${STATUS_STYLE[status]}`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {status}
    </span>
  );
}

/** The price that actually describes an order: what it filled at, else what it is waiting for. */
function displayPrice(o: Order): string {
  const price = amount(o.average_price) ?? amount(o.limit_price) ?? amount(o.stop_price);
  return price === null ? "Market" : formatPrice(price);
}

function fillPercent(o: Order): string {
  const total = amount(o.quantity);
  const done = amount(o.filled_quantity) ?? 0;
  if (total === null || total === 0) return "—";
  return `${Math.round((done / total) * 100)}%`;
}

export function OrdersPanelView({
  trading,
  className = "",
}: {
  trading: TradingState;
  className?: string;
}) {
  const [tab, setTab] = useState<Tab>("Open orders");
  const [cancelling, setCancelling] = useState<string | null>(null);
  const [actionError, setActionError] = useState("");

  const orderRows = useMemo(() => {
    if (tab === "Open orders") return trading.orders.filter((o) => o.status === "open");
    return trading.orders;
  }, [trading.orders, tab]);

  const cancel = async (orderId: string) => {
    setCancelling(orderId);
    setActionError("");
    try {
      await trading.cancel(orderId);
    } catch (err) {
      // 409 means it already left the open state — most often it filled while on screen.
      setActionError(
        err instanceof ApiError ? err.message : "Could not cancel that order. Please try again.",
      );
    } finally {
      setCancelling(null);
    }
  };

  const emptyLabel =
    tab === "Open orders"
      ? "No open orders. A market order fills or is refused immediately; only a resting order waits here."
      : tab === "Trade history"
        ? "No fills yet."
        : "No orders placed yet.";

  if (!trading.ready) {
    return (
      <div className={`rounded-2xl border border-overlay-border bg-surface p-5 ${className}`}>
        <p className="py-6 text-center text-sm text-muted-foreground">
          Sign in to see your orders and fills.
        </p>
      </div>
    );
  }

  return (
    <div className={`rounded-2xl border border-overlay-border bg-surface p-5 ${className}`}>
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex flex-wrap gap-1 rounded-lg bg-background/40 p-1">
          {TABS.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={`rounded-md px-3 py-1.5 text-sm font-semibold transition-colors ${
                tab === t
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {t}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => void trading.refresh()}
          className="ml-auto flex items-center gap-1.5 text-xs font-semibold text-muted-foreground transition-colors hover:text-foreground"
        >
          <i className="fa-solid fa-rotate" />
          Refresh
        </button>
      </div>

      {actionError && <p className="mt-3 text-xs font-medium text-down">{actionError}</p>}
      {trading.error && <p className="mt-3 text-xs font-medium text-down">{trading.error}</p>}

      {trading.loading && trading.orders.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">
          <i className="fa-solid fa-circle-notch fa-spin mr-2" />
          Loading your orders…
        </p>
      ) : tab === "Trade history" ? (
        <TradeTable trades={trading.trades} emptyLabel={emptyLabel} />
      ) : (
        <OrderTable
          orders={orderRows}
          emptyLabel={emptyLabel}
          showCancel={tab === "Open orders"}
          cancelling={cancelling}
          onCancel={(id) => void cancel(id)}
        />
      )}
    </div>
  );
}

function OrderTable({
  orders,
  emptyLabel,
  showCancel,
  cancelling,
  onCancel,
}: {
  orders: Order[];
  emptyLabel: string;
  showCancel: boolean;
  cancelling: string | null;
  onCancel: (orderId: string) => void;
}) {
  if (orders.length === 0)
    return <p className="py-10 text-center text-sm text-muted-foreground">{emptyLabel}</p>;

  return (
    <div className="mt-4 overflow-x-auto">
      <table className="w-full min-w-[820px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs text-muted-foreground">
            <th className="px-2 pb-3 font-medium">Date</th>
            <th className="px-2 pb-3 font-medium">Symbol</th>
            <th className="px-2 pb-3 font-medium">Type</th>
            <th className="px-2 pb-3 text-right font-medium">Price</th>
            <th className="px-2 pb-3 text-right font-medium">Quantity</th>
            <th className="px-2 pb-3 text-right font-medium">Filled</th>
            <th className="px-2 pb-3 text-right font-medium">Status</th>
            {showCancel && <th className="px-2 pb-3 text-right font-medium">Action</th>}
          </tr>
        </thead>
        <tbody>
          {orders.map((o) => (
            <tr key={o.id} className="border-b border-border last:border-b-0">
              <td className="px-2 py-3 font-mono text-xs text-muted-foreground">
                {stamp(o.created_at)}
              </td>
              <td className="px-2 py-3 font-medium text-foreground">
                {o.symbol}
                <span className="ml-1.5 text-xs text-muted-foreground">{o.currency}</span>
              </td>
              <td className="px-2 py-3">
                <span
                  className={`font-semibold capitalize ${o.side === "buy" ? "text-up" : "text-down"}`}
                >
                  {o.side}
                </span>{" "}
                <span className="text-muted-foreground">{o.type.replace("_", " ")}</span>
                <span className="ml-1.5 font-mono text-[10px] uppercase text-muted-foreground/70">
                  {o.time_in_force}
                </span>
              </td>
              <td className="px-2 py-3 text-right font-mono text-foreground">{displayPrice(o)}</td>
              <td className="px-2 py-3 text-right font-mono text-foreground">{o.quantity}</td>
              <td className="px-2 py-3 text-right text-muted-foreground">{fillPercent(o)}</td>
              <td className="px-2 py-3 text-right">
                <StatusPill status={o.status} />
                {/* The venue's own words on why — far more useful than a bare "rejected". */}
                {o.reject_reason && (
                  <div className="mt-1 max-w-[220px] text-right text-[10px] leading-tight text-muted-foreground">
                    {o.reject_reason}
                  </div>
                )}
              </td>
              {showCancel && (
                <td className="px-2 py-3 text-right">
                  <button
                    type="button"
                    disabled={cancelling === o.id}
                    onClick={() => onCancel(o.id)}
                    className="text-xs font-semibold text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
                  >
                    {cancelling === o.id ? "Cancelling…" : "Cancel"}
                  </button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TradeTable({ trades, emptyLabel }: { trades: Trade[]; emptyLabel: string }) {
  if (trades.length === 0)
    return <p className="py-10 text-center text-sm text-muted-foreground">{emptyLabel}</p>;

  return (
    <div className="mt-4 overflow-x-auto">
      <table className="w-full min-w-[820px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs text-muted-foreground">
            <th className="px-2 pb-3 font-medium">Date</th>
            <th className="px-2 pb-3 font-medium">Symbol</th>
            <th className="px-2 pb-3 font-medium">Side</th>
            <th className="px-2 pb-3 text-right font-medium">Price</th>
            <th className="px-2 pb-3 text-right font-medium">Quantity</th>
            <th className="px-2 pb-3 text-right font-medium">Notional</th>
            <th className="px-2 pb-3 text-right font-medium">Fee</th>
            <th className="px-2 pb-3 text-right font-medium">Realised P&amp;L</th>
          </tr>
        </thead>
        <tbody>
          {trades.map((t) => {
            const pnl = amount(t.realized_pnl);
            return (
              <tr key={t.id} className="border-b border-border last:border-b-0">
                <td className="px-2 py-3 font-mono text-xs text-muted-foreground">{stamp(t.at)}</td>
                <td className="px-2 py-3 font-medium text-foreground">
                  {t.symbol}
                  <span className="ml-1.5 text-xs text-muted-foreground">{t.currency}</span>
                </td>
                <td className="px-2 py-3">
                  <span
                    className={`font-semibold capitalize ${t.side === "buy" ? "text-up" : "text-down"}`}
                  >
                    {t.side}
                  </span>
                </td>
                <td className="px-2 py-3 text-right font-mono text-foreground">{t.price}</td>
                <td className="px-2 py-3 text-right font-mono text-foreground">{t.quantity}</td>
                <td className="px-2 py-3 text-right font-mono text-muted-foreground">
                  {t.notional}
                </td>
                <td className="px-2 py-3 text-right font-mono text-muted-foreground">{t.fee}</td>
                <td className="px-2 py-3 text-right font-mono">
                  {/* Buys have no realised P&L — showing 0 would imply a flat round trip. */}
                  {pnl === null ? (
                    <span className="text-muted-foreground">—</span>
                  ) : (
                    <span className={pnl >= 0 ? "text-up" : "text-down"}>
                      {pnl >= 0 ? "+" : ""}
                      {t.realized_pnl}
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Self-contained variant for a page that does not already hold a `useTrading()` instance. */
export function OrdersPanel({ className = "" }: { className?: string } = {}) {
  const trading = useTrading();
  return <OrdersPanelView trading={trading} className={className} />;
}
