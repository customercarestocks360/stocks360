import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { useAuth } from "@/components/AuthProvider";
import { useFundingRequests } from "@/hooks/useFundingRequests";
import { useTrading } from "@/hooks/useTrading";
import { amount, money2 } from "@/lib/trading-api";

export const Route = createFileRoute("/history")({
  head: () => ({
    meta: [
      { title: "Account History — Stocks360" },
      { name: "description", content: "Funding, balance, order, and fill history." },
    ],
  }),
  component: HistoryPage,
});

type HistoryTab = "ledger" | "funding" | "fills" | "orders";

function stamp(iso: string) {
  return new Date(iso).toLocaleString();
}

function HistoryPage() {
  const { isLoggedIn, authReady } = useAuth();
  const trading = useTrading();
  const funding = useFundingRequests();
  const [tab, setTab] = useState<HistoryTab>("ledger");
  const currency = trading.portfolio?.account_currency ?? trading.balances[0]?.currency ?? "USDT";

  const totals = useMemo(() => {
    const deposited = trading.ledger
      .filter((row) => row.kind === "deposit")
      .reduce((sum, row) => sum + (amount(row.amount) ?? 0), 0);
    const withdrawn = trading.ledger
      .filter((row) => row.kind === "withdrawal")
      .reduce((sum, row) => sum + Math.abs(amount(row.amount) ?? 0), 0);
    const fees = trading.trades.reduce((sum, row) => sum + Math.abs(amount(row.fee) ?? 0), 0);
    const realized = trading.trades.reduce((sum, row) => sum + (amount(row.realized_pnl) ?? 0), 0);
    return { deposited, withdrawn, fees, realized };
  }, [trading.ledger, trading.trades]);

  if (!authReady) return null;
  if (!isLoggedIn) {
    return (
      <AppLayout>
        <section className="mx-auto max-w-lg px-6 py-24 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-secondary text-primary">
            <i className="fa-solid fa-clock-rotate-left" />
          </div>
          <h1 className="mt-4 text-xl font-bold">Sign in to view account history</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Your balance movements, funding requests, fills, and orders are private.
          </p>
          <Link
            to="/login"
            className="mt-6 inline-block rounded-xl bg-primary px-5 py-2.5 text-sm font-bold text-primary-foreground"
          >
            Go to sign in
          </Link>
        </section>
      </AppLayout>
    );
  }

  const tabs = [
    { key: "ledger" as const, label: "Balance ledger", count: trading.ledger.length },
    { key: "funding" as const, label: "Funding requests", count: funding.requests.length },
    { key: "fills" as const, label: "Trade fills", count: trading.trades.length },
    { key: "orders" as const, label: "Orders", count: trading.orders.length },
  ];

  return (
    <AppLayout>
      <section className="mx-auto max-w-6xl px-6 py-10">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Account history</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Authoritative records from the trading ledger and reviewed funding queue.
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              void trading.refresh();
              void funding.refresh();
            }}
            className="rounded-lg border border-border bg-card px-4 py-2.5 text-sm font-semibold hover:bg-secondary"
          >
            <i className="fa-solid fa-rotate mr-2 text-xs" />
            Refresh
          </button>
        </div>

        {(trading.error || funding.error) && (
          <p className="mt-4 rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {trading.error || funding.error}
          </p>
        )}

        <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Metric
            label="Deposited"
            value={totals.deposited}
            currency={currency}
            icon="fa-arrow-down"
          />
          <Metric
            label="Withdrawn"
            value={totals.withdrawn}
            currency={currency}
            icon="fa-arrow-up"
          />
          <Metric
            label="Realized P&L"
            value={totals.realized}
            currency={currency}
            icon="fa-chart-line"
            pnl
          />
          <Metric label="Trading fees" value={totals.fees} currency={currency} icon="fa-receipt" />
        </div>

        <div className="mt-6 overflow-hidden rounded-2xl border border-border bg-card">
          <div className="flex overflow-x-auto border-b border-border bg-background/20">
            {tabs.map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => setTab(item.key)}
                className={`shrink-0 border-b-2 px-4 py-3 text-xs font-semibold ${tab === item.key ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}
              >
                {item.label}
                <span className="ml-2 rounded bg-secondary px-1.5 py-0.5 font-mono text-[9px]">
                  {item.count}
                </span>
              </button>
            ))}
          </div>
          {(trading.loading || funding.loading) && (
            <div className="h-0.5 animate-pulse bg-primary" />
          )}

          {tab === "ledger" && (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[820px] text-xs">
                <thead>
                  <tr className="border-b border-border text-left uppercase tracking-wider text-muted-foreground">
                    <TH>Time</TH>
                    <TH>Activity</TH>
                    <TH>Reference</TH>
                    <TH right>Movement</TH>
                    <TH right>Available after</TH>
                    <TH right>Reserved after</TH>
                  </tr>
                </thead>
                <tbody>
                  {trading.ledger.map((entry) => (
                    <tr key={entry.id} className="border-b border-border/70 last:border-0">
                      <TD muted mono>
                        {stamp(entry.at)}
                      </TD>
                      <TD>{entry.kind.replaceAll("_", " ")}</TD>
                      <TD muted>{entry.reference ?? entry.order_id ?? entry.trade_id ?? "—"}</TD>
                      <TD
                        right
                        mono
                        className={(amount(entry.amount) ?? 0) >= 0 ? "text-up" : "text-down"}
                      >
                        {(amount(entry.amount) ?? 0) > 0 ? "+" : ""}
                        {money2(entry.amount)} {entry.currency}
                      </TD>
                      <TD right mono>
                        {money2(entry.available_after)} {entry.currency}
                      </TD>
                      <TD right mono muted>
                        {money2(entry.reserved_after)} {entry.currency}
                      </TD>
                    </tr>
                  ))}
                </tbody>
              </table>
              <Empty show={trading.ledger.length === 0} label="No balance movements yet." />
            </div>
          )}

          {tab === "funding" && (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[860px] text-xs">
                <thead>
                  <tr className="border-b border-border text-left uppercase tracking-wider text-muted-foreground">
                    <TH>Created</TH>
                    <TH>Request</TH>
                    <TH>Network</TH>
                    <TH>Reference / destination</TH>
                    <TH right>Amount</TH>
                    <TH>Status</TH>
                    <TH>Resolution</TH>
                    <TH right>Action</TH>
                  </tr>
                </thead>
                <tbody>
                  {funding.requests.map((request) => (
                    <tr key={request.id} className="border-b border-border/70 last:border-0">
                      <TD muted mono>
                        {stamp(request.created_at)}
                      </TD>
                      <TD className="font-semibold capitalize">{request.kind}</TD>
                      <TD>{request.network}</TD>
                      <TD muted>{request.reference ?? request.destination ?? "—"}</TD>
                      <TD
                        right
                        mono
                        className={request.kind === "deposit" ? "text-up" : "text-down"}
                      >
                        {request.kind === "deposit" ? "+" : "−"}
                        {money2(request.amount)} {request.currency}
                      </TD>
                      <TD>
                        <Status status={request.status} />
                      </TD>
                      <TD muted>{request.resolution_note ?? "—"}</TD>
                      <TD right>
                        {request.status === "pending" ? (
                          <button
                            type="button"
                            disabled={funding.cancellingId !== null}
                            onClick={() => {
                              if (!window.confirm("Cancel this pending funding request?")) return;
                              void funding.cancelRequest(request.id).then((cancelled) => {
                                if (cancelled) void trading.refresh();
                              });
                            }}
                            className="rounded-md border border-border px-2.5 py-1 font-semibold text-destructive hover:bg-destructive/10 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {funding.cancellingId === request.id ? "Cancelling…" : "Cancel"}
                          </button>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TD>
                    </tr>
                  ))}
                </tbody>
              </table>
              <Empty
                show={funding.requests.length === 0}
                label="No deposit or withdrawal requests yet."
              />
            </div>
          )}

          {tab === "fills" && (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px] text-xs">
                <thead>
                  <tr className="border-b border-border text-left uppercase tracking-wider text-muted-foreground">
                    <TH>Time</TH>
                    <TH>Instrument</TH>
                    <TH>Side</TH>
                    <TH right>Quantity</TH>
                    <TH right>Price</TH>
                    <TH right>Notional</TH>
                    <TH right>Fee</TH>
                    <TH right>Realized P&L</TH>
                  </tr>
                </thead>
                <tbody>
                  {trading.trades.map((trade) => (
                    <tr key={trade.id} className="border-b border-border/70 last:border-0">
                      <TD muted mono>
                        {stamp(trade.at)}
                      </TD>
                      <TD className="font-semibold">
                        {trade.symbol}
                        <span className="ml-2 text-muted-foreground">{trade.asset_class}</span>
                      </TD>
                      <TD
                        className={`font-bold uppercase ${trade.side === "buy" ? "text-up" : "text-down"}`}
                      >
                        {trade.side}
                        {trade.liquidation ? " · liquidation" : ""}
                      </TD>
                      <TD right mono>
                        {trade.quantity}
                      </TD>
                      <TD right mono>
                        {money2(trade.price)} {trade.currency}
                      </TD>
                      <TD right mono>
                        {money2(trade.notional)} {trade.account_currency}
                      </TD>
                      <TD right mono>
                        {money2(trade.fee)}
                      </TD>
                      <TD
                        right
                        mono
                        className={(amount(trade.realized_pnl) ?? 0) >= 0 ? "text-up" : "text-down"}
                      >
                        {trade.realized_pnl === null
                          ? "—"
                          : `${money2(trade.realized_pnl)} ${trade.account_currency}`}
                      </TD>
                    </tr>
                  ))}
                </tbody>
              </table>
              <Empty show={trading.trades.length === 0} label="No fills yet." />
            </div>
          )}

          {tab === "orders" && (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[920px] text-xs">
                <thead>
                  <tr className="border-b border-border text-left uppercase tracking-wider text-muted-foreground">
                    <TH>Created</TH>
                    <TH>Instrument</TH>
                    <TH>Side</TH>
                    <TH>Order</TH>
                    <TH right>Quantity</TH>
                    <TH right>Fill price</TH>
                    <TH>Status</TH>
                    <TH>Reason</TH>
                  </tr>
                </thead>
                <tbody>
                  {trading.orders.map((order) => (
                    <tr key={order.id} className="border-b border-border/70 last:border-0">
                      <TD muted mono>
                        {stamp(order.created_at)}
                      </TD>
                      <TD className="font-semibold">
                        {order.symbol}
                        <span className="ml-2 text-muted-foreground">{order.asset_class}</span>
                      </TD>
                      <TD
                        className={`font-bold uppercase ${order.side === "buy" ? "text-up" : "text-down"}`}
                      >
                        {order.side}
                      </TD>
                      <TD>
                        {order.type} · {order.time_in_force}
                      </TD>
                      <TD right mono>
                        {order.quantity}
                      </TD>
                      <TD right mono>
                        {order.average_price === null
                          ? "—"
                          : `${money2(order.average_price)} ${order.currency}`}
                      </TD>
                      <TD>
                        <Status status={order.status} />
                      </TD>
                      <TD muted>{order.reject_reason ?? "—"}</TD>
                    </tr>
                  ))}
                </tbody>
              </table>
              <Empty show={trading.orders.length === 0} label="No orders yet." />
            </div>
          )}
        </div>
      </section>
    </AppLayout>
  );
}

function Metric({
  label,
  value,
  currency,
  icon,
  pnl = false,
}: {
  label: string;
  value: number;
  currency: string;
  icon: string;
  pnl?: boolean;
}) {
  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          {label}
        </span>
        <i className={`fa-solid ${icon} text-primary`} />
      </div>
      <div
        className={`mt-3 font-mono text-xl font-bold ${pnl ? (value >= 0 ? "text-up" : "text-down") : "text-foreground"}`}
      >
        {pnl && value > 0 ? "+" : ""}
        {money2(String(value))}{" "}
        <span className="text-[10px] text-muted-foreground">{currency}</span>
      </div>
    </div>
  );
}

function TH({ children, right = false }: { children: React.ReactNode; right?: boolean }) {
  return <th className={`px-4 py-3 font-semibold ${right ? "text-right" : ""}`}>{children}</th>;
}
function TD({
  children,
  right = false,
  muted = false,
  mono = false,
  className = "",
}: {
  children: React.ReactNode;
  right?: boolean;
  muted?: boolean;
  mono?: boolean;
  className?: string;
}) {
  return (
    <td
      className={`px-4 py-3 ${right ? "text-right" : ""} ${muted ? "text-muted-foreground" : ""} ${mono ? "font-mono tabular-nums" : ""} ${className}`}
    >
      {children}
    </td>
  );
}
function Empty({ show, label }: { show: boolean; label: string }) {
  return show ? <p className="p-10 text-center text-sm text-muted-foreground">{label}</p> : null;
}
function Status({ status }: { status: string }) {
  const tone =
    status === "completed" || status === "filled"
      ? "bg-up/10 text-up"
      : status === "pending" || status === "open"
        ? "bg-primary/10 text-primary"
        : "bg-muted text-muted-foreground";
  return (
    <span className={`rounded-full px-2 py-1 text-[10px] font-bold uppercase ${tone}`}>
      {status}
    </span>
  );
}
