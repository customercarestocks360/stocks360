import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import {
  useAuth,
  lockedAmount,
  txKind,
  txStatus,
  NETWORK_OF,
  type DepositMethod,
  type Transaction,
} from "@/components/AuthProvider";
import { ASSETS, TYPE_ROUTES } from "@/lib/market-assets";
import { OrdersPanel } from "@/components/ui/orders-panel";

export const Route = createFileRoute("/wallet")({
  head: () => ({
    meta: [
      { title: "Wallet — Stocks360" },
      { name: "description", content: "Spot balances, holdings and transaction history." },
    ],
  }),
  component: WalletPage,
});

/**
 * Demo conversion rates. Everything in the wallet is totalled in INR so the
 * numbers line up with the account dashboard, which also reports in ₹.
 */
const USDT_TO_INR = 93;
const USD_TO_INR = 84;

/** Prices in market-assets are display strings ("$229.87", "1.0892"). */
function priceOf(sym: string) {
  const asset = ASSETS.find((a) => a.sym === sym);
  if (!asset) return 0;
  const n = parseFloat(asset.price.replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

/**
 * Always pass an explicit locale — `toLocaleString()` with none uses the host
 * locale, which differs between the SSR process and the browser (en-IN groups
 * 2794281 as "27,94,281", en-US as "2,794,281") and trips a hydration error.
 */
function inr(n: number) {
  return `₹${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function qty(n: number) {
  return n.toLocaleString("en-US", { maximumFractionDigits: 4 });
}
function stamp(iso: string) {
  const d = new Date(iso);
  const p = (v: number) => String(v).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

type WalletRow = {
  key: string;
  sym: string;
  name: string;
  color: string;
  icon: string;
  available: number;
  locked: number;
  valueInr: number;
  /** Cash rows have nothing to trade against. */
  tradeTo: string | null;
};

function AssetBadge({ color, sym }: { color: string; sym: string }) {
  return (
    <span
      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full font-mono text-[9px] font-bold uppercase"
      style={{ backgroundColor: `${color}20`, color }}
      aria-hidden
    >
      {sym.replace("/", "").slice(0, 3)}
    </span>
  );
}

function StatusPill({ status }: { status: ReturnType<typeof txStatus> }) {
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
  const { isLoggedIn, kycCompleted, balances, transactions, orders } = useAuth();

  const [query, setQuery] = useState("");
  const [gate, setGate] = useState<"login" | "kyc" | null>(null);

  const locked = useMemo(
    () => ({ INR: lockedAmount(transactions, "INR"), USDT: lockedAmount(transactions, "USDT") }),
    [transactions],
  );

  /** Net position per symbol, built from the demo order history. */
  const holdings = useMemo(() => {
    const map = new Map<string, number>();
    for (const o of orders) {
      const delta = o.action === "buy" ? o.qty : -o.qty;
      map.set(o.symbol, (map.get(o.symbol) ?? 0) + delta);
    }
    return [...map.entries()].filter(([, q]) => q > 1e-9);
  }, [orders]);

  const rows: WalletRow[] = useMemo(() => {
    const cash: WalletRow[] = [
      {
        key: "INR",
        sym: "INR",
        name: "Indian Rupee",
        color: "#f59e0b",
        icon: "fa-indian-rupee-sign",
        available: balances.INR - locked.INR,
        locked: locked.INR,
        valueInr: balances.INR,
        tradeTo: null,
      },
      {
        key: "USDT",
        sym: "USDT",
        name: "TetherUS",
        color: "#26a17b",
        icon: "fa-dollar-sign",
        available: balances.USDT - locked.USDT,
        locked: locked.USDT,
        valueInr: balances.USDT * USDT_TO_INR,
        tradeTo: null,
      },
    ];

    const positions: WalletRow[] = holdings.map(([sym, q]) => {
      const asset = ASSETS.find((a) => a.sym === sym);
      const unitInr = priceOf(sym) * USD_TO_INR;
      return {
        key: `pos:${sym}`,
        sym,
        name: asset?.name ?? sym,
        color: asset?.color ?? "#6b7280",
        icon: asset?.icon ?? "fa-chart-line",
        available: q,
        locked: 0,
        valueInr: q * unitInr,
        tradeTo: asset ? TYPE_ROUTES[asset.type] : null,
      };
    });

    return [...cash, ...positions];
  }, [balances, locked, holdings]);

  const visibleRows = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => r.sym.toLowerCase().includes(q) || r.name.toLowerCase().includes(q));
  }, [rows, query]);

  const totalInr = useMemo(() => rows.reduce((sum, r) => sum + r.valueInr, 0), [rows]);

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
            className="mt-6 inline-block rounded-xl bg-primary px-5 py-2.5 text-sm font-bold uppercase tracking-wider text-primary-foreground transition-opacity hover:opacity-90"
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
            <p className="mt-1 text-sm text-muted-foreground">Spot balances for the demo account.</p>
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => openPanel("deposit")}
              className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90"
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

        {/* ── Total balance ── */}
        <div className="mt-6 rounded-2xl border border-border bg-card p-6">
          <div className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
            Total balance
          </div>
          <div className="mt-2 font-mono text-4xl font-bold tracking-tight text-foreground">
            {inr(totalInr)}
          </div>
          {locked.INR + locked.USDT > 0 && (
            <div className="mt-2 text-xs text-muted-foreground">
              {inr(locked.INR + locked.USDT * USDT_TO_INR)} locked in pending withdrawals
            </div>
          )}
        </div>

        {/* ── Assets ── */}
        <div className="mt-6 rounded-2xl border border-border bg-card p-6">
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
                  <th className="px-2 pb-3 font-medium">Asset</th>
                  <th className="px-2 pb-3 text-right font-medium">Available</th>
                  <th className="px-2 pb-3 text-right font-medium">Locked</th>
                  <th className="px-2 pb-3 text-right font-medium">Value</th>
                  <th className="px-2 pb-3 text-right font-medium">Action</th>
                </tr>
              </thead>
              <tbody>
                {visibleRows.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-10 text-center text-sm text-muted-foreground">
                      No assets match “{query}”.
                    </td>
                  </tr>
                ) : (
                  visibleRows.map((r) => (
                    <tr key={r.key} className="border-b border-border last:border-b-0">
                      <td className="px-2 py-4">
                        <div className="flex items-center gap-3">
                          <AssetBadge color={r.color} sym={r.sym} />
                          <div className="min-w-0">
                            <div className="font-semibold text-foreground">{r.sym}</div>
                            <div className="truncate text-xs text-muted-foreground">{r.name}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-2 py-4 text-right font-mono text-foreground">{qty(r.available)}</td>
                      <td className="px-2 py-4 text-right font-mono text-muted-foreground">{qty(r.locked)}</td>
                      <td className="px-2 py-4 text-right font-mono text-foreground">{inr(r.valueInr)}</td>
                      <td className="px-2 py-4 text-right">
                        {r.tradeTo ? (
                          <Link
                            to={r.tradeTo}
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
        <div className="mt-6 rounded-2xl border border-border bg-card p-6">
          <h2 className="text-lg font-bold text-foreground">Orders</h2>
          <div className="mt-5">
            <OrdersPanel />
          </div>
        </div>

        {/* ── Transaction history ── */}
        <div className="mt-6 rounded-2xl border border-border bg-card p-6">
          <h2 className="text-lg font-bold text-foreground">Transaction history</h2>
          <div className="mt-5 overflow-x-auto">
            <table className="w-full min-w-[720px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted-foreground">
                  <th className="px-2 pb-3 font-medium">Date</th>
                  <th className="px-2 pb-3 font-medium">Type</th>
                  <th className="px-2 pb-3 font-medium">Asset</th>
                  <th className="px-2 pb-3 font-medium">Network</th>
                  <th className="px-2 pb-3 text-right font-medium">Amount</th>
                  <th className="px-2 pb-3 text-right font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {transactions.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-10 text-center text-sm text-muted-foreground">
                      No transactions yet — deposits and withdrawals will appear here.
                    </td>
                  </tr>
                ) : (
                  transactions.map((t) => <HistoryRow key={t.id} tx={t} />)
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {gate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setGate(null)} />
          <div className="relative max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl border border-border bg-card p-6 shadow-2xl">
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

function HistoryRow({ tx }: { tx: Transaction }) {
  const kind = txKind(tx);
  const status = txStatus(tx);
  const isWithdraw = kind === "withdraw";
  const sign = isWithdraw ? "−" : "+";
  const tone = status === "cancelled" ? "text-muted-foreground" : isWithdraw ? "text-down" : "text-up";

  return (
    <tr className="border-b border-border last:border-b-0">
      <td className="px-2 py-4 font-mono text-xs text-muted-foreground">{stamp(tx.date)}</td>
      <td className="px-2 py-4 capitalize text-foreground">{kind}</td>
      <td className="px-2 py-4 font-medium text-foreground">{tx.method}</td>
      <td className="px-2 py-4 text-muted-foreground">{NETWORK_OF[tx.method]}</td>
      <td className={`px-2 py-4 text-right font-mono font-semibold ${tone}`}>
        {sign}
        {qty(tx.amount)}
      </td>
      <td className="px-2 py-4 text-right">
        <div className="flex items-center justify-end gap-2">
          <StatusPill status={status} />
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
        className="mt-6 w-full rounded-xl bg-primary px-4 py-3 text-sm font-bold uppercase tracking-wider text-primary-foreground transition-opacity hover:opacity-90"
      >
        {copy.action}
      </button>
    </div>
  );
}
