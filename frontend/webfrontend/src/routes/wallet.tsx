import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { useAuth } from "@/components/AuthProvider";
import { OrdersPanel } from "@/components/ui/orders-panel";
import { useTrading } from "@/hooks/useTrading";
import { useFundingRequests } from "@/hooks/useFundingRequests";
import { formatMoney } from "@/lib/instrument";
import { amount as parseAmount, type AssetClass } from "@/lib/trading-api";
import type { FundingRequest } from "@/lib/funding-api";

export const Route = createFileRoute("/wallet")({
  head: () => ({
    meta: [
      { title: "Wallet — Stocks360" },
      { name: "description", content: "Spot balances, holdings and transaction history." },
    ],
  }),
  component: WalletPage,
});

/** Same colour language as `/markets` and the trading desk — one palette for one asset class everywhere. */
const CLASS_STYLES: Record<AssetClass, { icon: string; color: string }> = {
  crypto: { icon: "fa-coins", color: "#f59e0b" },
  forex: { icon: "fa-money-bill-transfer", color: "#3b82f6" },
  stocks: { icon: "fa-chart-line", color: "#10b981" },
};

/** Where a position's "Trade" link goes — every class lands on the one desk. */
function tradeLinkFor(assetClass: AssetClass, symbol: string) {
  return { to: "/trade" as const, search: { symbol, class: assetClass } };
}

function fmt(n: number | null, decimals = 4) {
  if (n === null) return "—";
  return n.toLocaleString("en-US", { maximumFractionDigits: decimals });
}
function stamp(iso: string) {
  const d = new Date(iso);
  const p = (v: number) => String(v).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

type WalletRow = {
  key: string;
  label: string;
  sub: string;
  color: string;
  icon: string;
  available: number | null;
  locked: number | null;
  value: string;
  tradeTo: ReturnType<typeof tradeLinkFor> | null;
};

function AssetBadge({ color, text }: { color: string; text: string }) {
  return (
    <span
      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full font-mono text-[9px] font-bold uppercase"
      style={{ backgroundColor: `${color}20`, color }}
      aria-hidden
    >
      {text.slice(0, 3)}
    </span>
  );
}

function StatusPill({ status }: { status: FundingRequest["status"] }) {
  const tone =
    status === "completed"
      ? "bg-up/10 text-up"
      : status === "pending"
        ? "bg-primary/10 text-primary"
        : "bg-muted text-muted-foreground";
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize ${tone}`}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {status}
    </span>
  );
}

function WalletPage() {
  const navigate = useNavigate();
  const { isLoggedIn, kycCompleted } = useAuth();
  const trading = useTrading();
  const funding = useFundingRequests();

  const [query, setQuery] = useState("");
  const [gate, setGate] = useState<"login" | "kyc" | null>(null);

  const rows: WalletRow[] = useMemo(() => {
    const cash: WalletRow[] = trading.balances
      .filter((b) => (parseAmount(b.total) ?? 0) > 0)
      .map((b) => ({
        key: `cash:${b.currency}`,
        label: b.currency,
        sub: "Cash",
        color: "#6b7280",
        icon: "fa-dollar-sign",
        available: parseAmount(b.available),
        locked: parseAmount(b.reserved),
        value: formatMoney(parseAmount(b.total), b.currency),
        tradeTo: null,
      }));

    const positions: WalletRow[] = trading.positions.map((p) => {
      const style = CLASS_STYLES[p.asset_class];
      return {
        key: `pos:${p.asset_class}:${p.symbol}`,
        label: p.symbol,
        sub: p.asset_class,
        color: style.color,
        icon: style.icon,
        available: parseAmount(p.available_quantity),
        locked: parseAmount(p.reserved_quantity),
        value: formatMoney(parseAmount(p.market_value), p.currency),
        tradeTo: tradeLinkFor(p.asset_class, p.symbol),
      };
    });

    return [...cash, ...positions];
  }, [trading.balances, trading.positions]);

  const visibleRows = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => r.label.toLowerCase().includes(q) || r.sub.toLowerCase().includes(q));
  }, [rows, query]);

  const openPanel = (which: "deposit" | "withdraw") => {
    if (!isLoggedIn) {
      setGate("login");
      return;
    }
    if (!kycCompleted) {
      setGate("kyc");
      return;
    }
    navigate({ to: which === "deposit" ? "/deposit" : "/withdraw" });
  };

  if (!isLoggedIn) {
    return (
      <AppLayout>
        <section className="mx-auto max-w-lg px-6 py-24 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-secondary text-primary">
            <i className="fa-solid fa-wallet text-lg" />
          </div>
          <h1 className="mt-4 text-xl font-bold text-foreground">Sign in required</h1>
          <p className="mt-2 text-sm text-muted-foreground">Sign in to view your wallet balances.</p>
          <Link
            to="/login"
            className="mt-6 inline-block rounded sm:rounded-xl bg-primary px-5 py-2.5 text-sm font-bold uppercase tracking-wider text-primary-foreground transition-opacity hover:opacity-90"
          >
            Go to sign in
          </Link>
        </section>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <section className="mx-auto max-w-6xl px-6 py-10">
        {/* ── Title row ── */}
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-foreground">Wallet</h1>
            <p className="mt-1 text-sm text-muted-foreground">Spot balances and holdings.</p>
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => openPanel("deposit")}
              className="flex items-center gap-2 rounded-lg bg-[#d4af37] px-4 py-2.5 text-sm font-semibold text-black shadow-[0_0_0_1px_rgba(0,0,0,0.05)] transition-opacity hover:opacity-90"
            >
              <i className="fa-solid fa-download text-xs" />
              Deposit
            </button>
            <button
              type="button"
              onClick={() => openPanel("withdraw")}
              className="flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2.5 text-sm font-semibold text-foreground transition-colors hover:bg-secondary"
            >
              <i className="fa-solid fa-upload text-xs" />
              Withdraw
            </button>
          </div>
        </div>

        {/* ── Cash balances ── */}
        <div className="mt-6 rounded sm:rounded-2xl border border-border bg-card p-6">
          <div className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
            Cash balance
          </div>
          {trading.balances.length === 0 ? (
            <div className="mt-2 font-mono text-2xl font-bold tracking-tight text-foreground">
              {trading.loading ? "Loading…" : "No cash held yet"}
            </div>
          ) : (
            <div className="mt-3 flex flex-wrap gap-x-8 gap-y-3">
              {trading.balances.map((b) => {
                const reserved = parseAmount(b.reserved) ?? 0;
                return (
                  <div key={b.currency}>
                    <div className="font-mono text-2xl font-bold tracking-tight text-foreground">
                      {formatMoney(parseAmount(b.total), b.currency)}
                    </div>
                    {reserved > 0 && (
                      <div className="mt-1 text-xs text-muted-foreground">
                        {formatMoney(reserved, b.currency)} locked
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          {trading.error && (
            <p className="mt-3 text-xs text-destructive">{trading.error}</p>
          )}
          {/* No single grand total: adding currencies together needs an FX rate this app has no
              licensed source for, so each currency is shown on its own — same rule the backend's
              own portfolio and admin summary follow. */}
        </div>

        {/* ── Assets ── */}
        <div className="mt-6 rounded sm:rounded-2xl border border-border bg-card p-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <h2 className="text-lg font-bold text-foreground">Assets</h2>
            <div className="relative w-full max-w-xs">
              <i className="fa-solid fa-magnifying-glass pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search asset"
                aria-label="Search asset"
                className="w-full rounded-lg border border-border bg-background/60 py-2.5 pl-9 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/40"
              />
            </div>
          </div>

          <div className="mt-5 overflow-x-auto">
            <table className="w-full min-w-[680px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted-foreground">
                  <th className="px-1 sm:px-2 pb-2 sm:pb-3 font-medium">Asset</th>
                  <th className="px-1 sm:px-2 pb-2 sm:pb-3 text-right font-medium">Available</th>
                  <th className="px-1 sm:px-2 pb-2 sm:pb-3 text-right font-medium">Locked</th>
                  <th className="px-1 sm:px-2 pb-2 sm:pb-3 text-right font-medium">Value</th>
                  <th className="px-1 sm:px-2 pb-2 sm:pb-3 text-right font-medium">Action</th>
                </tr>
              </thead>
              <tbody>
                {visibleRows.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-10 text-center text-sm text-muted-foreground">
                      {query
                        ? `No assets match "${query}".`
                        : trading.loading
                          ? "Loading…"
                          : "Nothing held yet — deposit cash or place a trade to see it here."}
                    </td>
                  </tr>
                ) : (
                  visibleRows.map((r) => (
                    <tr key={r.key} className="border-b border-border last:border-b-0">
                      <td className="px-1 sm:px-2 py-2.5 sm:py-4">
                        <div className="flex items-center gap-3">
                          <AssetBadge color={r.color} text={r.label} />
                          <div className="min-w-0">
                            <div className="font-semibold text-foreground">{r.label}</div>
                            <div className="truncate text-xs capitalize text-muted-foreground">{r.sub}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-1 sm:px-2 py-2.5 sm:py-4 text-right font-mono text-foreground">{fmt(r.available)}</td>
                      <td className="px-1 sm:px-2 py-2.5 sm:py-4 text-right font-mono text-muted-foreground">{fmt(r.locked)}</td>
                      <td className="px-1 sm:px-2 py-2.5 sm:py-4 text-right font-mono text-foreground">{r.value}</td>
                      <td className="px-1 sm:px-2 py-2.5 sm:py-4 text-right">
                        {r.tradeTo ? (
                          <Link
                            to={r.tradeTo.to}
                            search={r.tradeTo.search}
                            className="text-sm font-semibold text-primary transition-opacity hover:opacity-80"
                          >
                            Trade
                          </Link>
                        ) : (
                          <Link
                            to="/markets"
                            className="text-sm font-semibold text-primary transition-opacity hover:opacity-80"
                          >
                            Trade
                          </Link>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* ── Orders ── */}
        <div className="mt-6 rounded sm:rounded-2xl border border-border bg-card p-6">
          <h2 className="text-lg font-bold text-foreground">Orders</h2>
          <div className="mt-5">
            <OrdersPanel />
          </div>
        </div>

        {/* ── Transaction history ── */}
        <div className="mt-6 rounded sm:rounded-2xl border border-border bg-card p-6">
          <h2 className="text-lg font-bold text-foreground">Transaction history</h2>
          <div className="mt-5 overflow-x-auto">
            <table className="w-full min-w-[720px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted-foreground">
                  <th className="px-1 sm:px-2 pb-2 sm:pb-3 font-medium">Date</th>
                  <th className="px-1 sm:px-2 pb-2 sm:pb-3 font-medium">Type</th>
                  <th className="px-1 sm:px-2 pb-2 sm:pb-3 font-medium">Asset</th>
                  <th className="px-1 sm:px-2 pb-2 sm:pb-3 font-medium">Network</th>
                  <th className="px-1 sm:px-2 pb-2 sm:pb-3 text-right font-medium">Amount</th>
                  <th className="px-1 sm:px-2 pb-2 sm:pb-3 text-right font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {funding.requests.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-10 text-center text-sm text-muted-foreground">
                      {funding.loading
                        ? "Loading…"
                        : "No transactions yet — deposits and withdrawals will appear here."}
                    </td>
                  </tr>
                ) : (
                  funding.requests.map((r) => <HistoryRow key={r.id} tx={r} />)
                )}
              </tbody>
            </table>
          </div>
          {funding.error && <p className="mt-3 text-xs text-destructive">{funding.error}</p>}
        </div>
      </section>

      {gate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setGate(null)} />
          <div className="relative max-h-[90vh] w-full max-w-md overflow-y-auto rounded sm:rounded-2xl border border-border bg-card p-6 shadow-2xl">
            <GateNotice
              reason={gate}
              onClose={() => setGate(null)}
              onAction={() => {
                const target = gate;
                setGate(null);
                if (target === "login") navigate({ to: "/login" });
                else navigate({ to: "/account", search: { tab: "account" } });
              }}
            />
          </div>
        </div>
      )}
    </AppLayout>
  );
}

function HistoryRow({ tx }: { tx: FundingRequest }) {
  const isWithdraw = tx.kind === "withdrawal";
  const sign = isWithdraw ? "−" : "+";
  const tone = tx.status === "cancelled" ? "text-muted-foreground" : isWithdraw ? "text-down" : "text-up";

  return (
    <tr className="border-b border-border last:border-b-0">
      <td className="px-1 sm:px-2 py-2.5 sm:py-4 font-mono text-xs text-muted-foreground">{stamp(tx.created_at)}</td>
      <td className="px-1 sm:px-2 py-2.5 sm:py-4 capitalize text-foreground">{tx.kind}</td>
      <td className="px-1 sm:px-2 py-2.5 sm:py-4 font-medium text-foreground">{tx.currency}</td>
      <td className="px-1 sm:px-2 py-2.5 sm:py-4 text-muted-foreground">{tx.network}</td>
      <td className={`px-1 sm:px-2 py-2.5 sm:py-4 text-right font-mono font-semibold ${tone}`}>
        {sign}
        {fmt(parseAmount(tx.amount))}
      </td>
      <td className="px-1 sm:px-2 py-2.5 sm:py-4 text-right">
        <div className="flex items-center justify-end gap-2" title={tx.resolution_note ?? undefined}>
          <StatusPill status={tx.status} />
        </div>
      </td>
    </tr>
  );
}

function GateNotice({
  reason,
  onClose,
  onAction,
}: {
  reason: "login" | "kyc";
  onClose: () => void;
  onAction: () => void;
}) {
  const copy =
    reason === "login"
      ? {
          icon: "fa-lock",
          title: "Sign in required",
          body: "You need to be signed in to move funds in or out of your Stocks360 account.",
          action: "Go to sign in",
        }
      : {
          icon: "fa-id-card",
          title: "Complete your account details",
          body: "Your identity hasn't been verified yet. Complete your remaining account details to unlock deposits and withdrawals.",
          action: "Complete account details",
        };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={onClose}
        aria-label="Close"
        className="absolute -right-1 -top-1 text-muted-foreground hover:text-foreground"
      >
        <i className="fa-solid fa-xmark" />
      </button>
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
        <i className={`fa-solid ${copy.icon} text-lg`} />
      </div>
      <h3 className="mt-4 text-center text-lg font-bold text-foreground">{copy.title}</h3>
      <p className="mt-2 text-center text-sm leading-6 text-muted-foreground">{copy.body}</p>
      <button
        type="button"
        onClick={onAction}
        className="mt-6 w-full rounded sm:rounded-xl bg-primary px-4 py-3 text-sm font-bold uppercase tracking-wider text-primary-foreground transition-opacity hover:opacity-90"
      >
        {copy.action}
      </button>
    </div>
  );
}
