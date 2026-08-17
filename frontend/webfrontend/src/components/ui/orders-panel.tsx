import { useMemo, useState } from "react";
import { useAuth, orderType, orderStatus, type Order } from "@/components/AuthProvider";

function stamp(iso: string) {
  const d = new Date(iso);
  const p = (v: number) => String(v).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function pairOf(o: Order) {
  const currency = o.price.trim().startsWith("₹") ? "INR" : "USDT";
  return `${o.symbol}/${currency}`;
}

function priceOf(o: Order) {
  return o.price.replace(/[^0-9.]/g, "");
}

const TABS = ["Open orders", "Order history", "Trade history"] as const;
type Tab = (typeof TABS)[number];

/**
 * Every placed order lands here — market orders arrive already filled (no
 * matching engine exists to hold them open), limit orders sit as "open"
 * until cancelled since nothing here can fill them later.
 */
export function OrdersPanel() {
  const { orders, cancelOrder } = useAuth();
  const [tab, setTab] = useState<Tab>("Open orders");

  const rows = useMemo(() => {
    if (tab === "Open orders") return orders.filter((o) => orderStatus(o) === "open");
    if (tab === "Trade history") return orders.filter((o) => orderStatus(o) === "filled");
    return orders;
  }, [orders, tab]);

  const emptyLabel =
    tab === "Open orders"
      ? "No open orders — market orders fill instantly, only limit orders sit here until cancelled."
      : tab === "Trade history"
        ? "No filled trades yet."
        : "No orders placed yet.";

  return (
    <div className="rounded-2xl border border-overlay-border bg-surface p-5">
      <div className="flex flex-wrap gap-1 rounded-lg bg-background/40 p-1">
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`rounded-md px-3 py-1.5 text-sm font-semibold transition-colors ${
              tab === t ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {rows.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">{emptyLabel}</p>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[760px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted-foreground">
                <th className="px-2 pb-3 font-medium">Date</th>
                <th className="px-2 pb-3 font-medium">Pair</th>
                <th className="px-2 pb-3 font-medium">Type</th>
                <th className="px-2 pb-3 text-right font-medium">Price</th>
                <th className="px-2 pb-3 text-right font-medium">Amount</th>
                <th className="px-2 pb-3 text-right font-medium">Filled</th>
                <th className="px-2 pb-3 text-right font-medium">Status</th>
                {tab === "Open orders" && <th className="px-2 pb-3 text-right font-medium">Action</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((o) => {
                const status = orderStatus(o);
                const filled = status === "filled" ? "100%" : "0%";
                return (
                  <tr key={o.id} className="border-b border-border last:border-b-0">
                    <td className="px-2 py-3 font-mono text-xs text-muted-foreground">{stamp(o.date)}</td>
                    <td className="px-2 py-3 font-medium text-foreground">{pairOf(o)}</td>
                    <td className="px-2 py-3">
                      <span className={`font-semibold capitalize ${o.action === "buy" ? "text-up" : "text-down"}`}>
                        {o.action}
                      </span>{" "}
                      <span className="text-muted-foreground">{orderType(o)}</span>
                    </td>
                    <td className="px-2 py-3 text-right font-mono text-foreground">{priceOf(o)}</td>
                    <td className="px-2 py-3 text-right font-mono text-foreground">{o.qty}</td>
                    <td className="px-2 py-3 text-right text-muted-foreground">{filled}</td>
                    <td className="px-2 py-3 text-right">
                      <span
                        className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                          status === "open"
                            ? "bg-primary/10 text-primary"
                            : status === "cancelled"
                              ? "bg-muted text-muted-foreground"
                              : "bg-up/10 text-up"
                        }`}
                      >
                        <span className="h-1.5 w-1.5 rounded-full bg-current" />
                        {status === "open" ? "Open" : status === "cancelled" ? "Cancelled" : "Filled"}
                      </span>
                    </td>
                    {tab === "Open orders" && (
                      <td className="px-2 py-3 text-right">
                        <button
                          type="button"
                          onClick={() => cancelOrder(o.id)}
                          className="text-xs font-semibold text-muted-foreground transition-colors hover:text-foreground"
                        >
                          Cancel
                        </button>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
