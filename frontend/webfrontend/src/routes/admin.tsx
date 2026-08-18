import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useAuth, txKind, txStatus, txNetwork, type Transaction } from "@/components/AuthProvider";

export const Route = createFileRoute("/admin")({
  head: () => ({
    meta: [
      { title: "Admin — Stocks360" },
      { name: "description", content: "Stocks360 admin portal." },
    ],
  }),
  component: AdminPage,
});

/**
 * Hardcoded on purpose — this demo has no backend to hold admin accounts
 * against, so the single admin identity lives here instead of a database.
 */
const ADMIN_EMAIL = "customercare.stocks360@gmail.com";
const ADMIN_PASSWORD = "Pass@Stocks36098765";

const SESSION_KEY = "stocks360-admin-session";
const USDT_TO_INR = 93;

function fmt(n: number) {
  return n.toLocaleString("en-US", { maximumFractionDigits: 4 });
}
function stamp(iso: string) {
  const d = new Date(iso);
  const p = (v: number) => String(v).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function AdminPage() {
  const [session, setSession] = useState(false);

  useEffect(() => {
    setSession(sessionStorage.getItem(SESSION_KEY) === "1");
  }, []);

  const handleLogin = () => {
    sessionStorage.setItem(SESSION_KEY, "1");
    setSession(true);
  };

  const handleLogout = () => {
    sessionStorage.removeItem(SESSION_KEY);
    setSession(false);
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="grid-bg fixed inset-0 opacity-30" />
      <div className="relative">{session ? <AdminDashboard onLogout={handleLogout} /> : <AdminLogin onLogin={handleLogin} />}</div>
    </div>
  );
}

function AdminLogin({ onLogin }: { onLogin: () => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (email.trim().toLowerCase() === ADMIN_EMAIL && password === ADMIN_PASSWORD) {
      setError(null);
      onLogin();
      return;
    }
    setError("Invalid admin email or password.");
  };

  return (
    <div className="flex min-h-screen items-center justify-center px-6 py-12">
      <div className="w-full max-w-md rounded sm:rounded-3xl border border-border bg-card/80 p-8 shadow-2xl backdrop-blur-xl">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
          <i className="fa-solid fa-shield-halved text-lg" />
        </div>
        <h1 className="mt-4 text-center text-2xl font-bold tracking-tight text-foreground">Admin portal</h1>
        <p className="mt-1 text-center text-sm text-muted-foreground">
          Restricted access — Stocks360 staff only.
        </p>

        <form onSubmit={handleSubmit} className="mt-8 space-y-4">
          <label className="block text-sm font-medium text-foreground">
            Admin email
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="username"
              placeholder="admin@stocks360.com"
              className="mt-2 w-full rounded sm:rounded-xl border border-border bg-background/60 px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/40"
            />
          </label>

          <label className="block text-sm font-medium text-foreground">
            Password
            <div className="relative mt-2">
              <input
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                placeholder="••••••••••"
                className="w-full rounded sm:rounded-xl border border-border bg-background/60 px-3 py-2.5 pr-10 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/40"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? "Hide password" : "Show password"}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground"
              >
                <i className={`fa-solid ${showPassword ? "fa-eye-slash" : "fa-eye"} text-xs`} />
              </button>
            </div>
          </label>

          {error && (
            <p className="rounded-lg bg-destructive/10 px-3 py-2 text-xs font-medium text-destructive">{error}</p>
          )}

          <button
            type="submit"
            className="w-full rounded sm:rounded-xl bg-primary px-4 py-3 text-sm font-bold uppercase tracking-wider text-primary-foreground transition-opacity hover:opacity-90"
          >
            Sign in
          </button>
        </form>
      </div>
    </div>
  );
}

function AdminDashboard({ onLogout }: { onLogout: () => void }) {
  const { email, kycProfile, balances, transactions, settleDeposit, settleWithdrawal } = useAuth();
  const [tab, setTab] = useState<"deposits" | "withdrawals">("deposits");

  const contact =
    email ??
    (kycProfile ? `${kycProfile.contact.mobile_country_code} ${kycProfile.contact.mobile_number}` : "—");

  const deposits = useMemo(
    () => transactions.filter((t) => txKind(t) === "deposit"),
    [transactions],
  );
  const withdrawals = useMemo(
    () => transactions.filter((t) => txKind(t) === "withdraw"),
    [transactions],
  );

  const pendingDeposits = deposits.filter((t) => txStatus(t) === "pending").length;
  const pendingWithdrawals = withdrawals.filter((t) => txStatus(t) === "pending").length;

  const totalUsdt = balances.USDT;

  return (
    <div className="mx-auto max-w-6xl px-6 py-10">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Admin dashboard</h1>
          <p className="mt-1 text-sm text-muted-foreground">Review deposit and withdrawal requests.</p>
        </div>
        <button
          type="button"
          onClick={onLogout}
          className="flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2.5 text-sm font-semibold text-foreground transition-colors hover:bg-secondary"
        >
          <i className="fa-solid fa-arrow-right-from-bracket text-xs" />
          Log out
        </button>
      </div>

      {/* ── Totals ── */}
      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        <div className="rounded sm:rounded-2xl border border-border bg-card p-6">
          <div className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
            Total money on the site
          </div>
          <div className="mt-2 font-mono text-2xl font-bold tracking-tight text-foreground">{fmt(totalUsdt)} USDT</div>
          <div className="mt-1 text-xs text-muted-foreground">
            {fmt(balances.USDT)} USDT (BEP20)
          </div>
        </div>
        <div className="rounded sm:rounded-2xl border border-border bg-card p-6">
          <div className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
            Pending deposits
          </div>
          <div className="mt-2 font-mono text-2xl font-bold tracking-tight text-foreground">{pendingDeposits}</div>
          <div className="mt-1 text-xs text-muted-foreground">Awaiting your confirmation</div>
        </div>
        <div className="rounded sm:rounded-2xl border border-border bg-card p-6">
          <div className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
            Pending withdrawals
          </div>
          <div className="mt-2 font-mono text-2xl font-bold tracking-tight text-foreground">{pendingWithdrawals}</div>
          <div className="mt-1 text-xs text-muted-foreground">Awaiting your confirmation</div>
        </div>
      </div>

      {/* ── Tabs ── */}
      <div className="mt-8 flex gap-2 border-b border-border">
        {(
          [
            { key: "deposits", label: "Deposits", count: pendingDeposits },
            { key: "withdrawals", label: "Withdrawals", count: pendingWithdrawals },
          ] as const
        ).map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`relative flex items-center gap-2 px-4 py-3 text-sm font-semibold transition-colors ${
              tab === t.key ? "text-foreground" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {t.label}
            {t.count > 0 && (
              <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-bold text-primary">
                {t.count}
              </span>
            )}
            {tab === t.key && <span className="absolute inset-x-0 -bottom-px h-0.5 bg-primary" />}
          </button>
        ))}
      </div>

      {tab === "deposits" ? (
        <RequestTable
          rows={deposits}
          contact={contact}
          showDestination={false}
          emptyLabel="No deposit requests yet."
          onComplete={(id) => settleDeposit(id, "complete")}
        />
      ) : (
        <RequestTable
          rows={withdrawals}
          contact={contact}
          showDestination
          emptyLabel="No withdrawal requests yet."
          onComplete={(id) => settleWithdrawal(id, "complete")}
        />
      )}
    </div>
  );
}

function RequestTable({
  rows,
  contact,
  showDestination,
  emptyLabel,
  onComplete,
}: {
  rows: Transaction[];
  contact: string;
  showDestination: boolean;
  emptyLabel: string;
  onComplete: (id: string) => void;
}) {
  if (rows.length === 0) {
    return (
      <div className="py-14 text-center">
        <i className="fa-regular fa-folder-open text-3xl text-muted-foreground/40" />
        <p className="mt-3 text-sm text-muted-foreground">{emptyLabel}</p>
      </div>
    );
  }

  return (
    <div className="mt-5 overflow-x-auto">
      <table className="w-full min-w-[820px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs text-muted-foreground">
            <th className="px-1 sm:px-2 pb-2 sm:pb-3 font-medium">Date</th>
            <th className="px-1 sm:px-2 pb-2 sm:pb-3 font-medium">User</th>
            <th className="px-1 sm:px-2 pb-2 sm:pb-3 font-medium">Asset</th>
            <th className="px-1 sm:px-2 pb-2 sm:pb-3 font-medium">Network</th>
            {showDestination && <th className="px-1 sm:px-2 pb-2 sm:pb-3 font-medium">Destination</th>}
            <th className="px-1 sm:px-2 pb-2 sm:pb-3 text-right font-medium">Amount</th>
            <th className="px-1 sm:px-2 pb-2 sm:pb-3 text-right font-medium">Status</th>
            <th className="px-1 sm:px-2 pb-2 sm:pb-3 text-right font-medium">Action</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((t) => {
            const status = txStatus(t);
            return (
              <tr key={t.id} className="border-b border-border last:border-b-0">
                <td className="px-1 sm:px-2 py-2.5 sm:py-4 font-mono text-xs text-muted-foreground">{stamp(t.date)}</td>
                <td className="px-1 sm:px-2 py-2.5 sm:py-4 text-foreground">{contact}</td>
                <td className="px-1 sm:px-2 py-2.5 sm:py-4 font-medium text-foreground">{t.method}</td>
                <td className="px-1 sm:px-2 py-2.5 sm:py-4 text-muted-foreground">{txNetwork(t)}</td>
                {showDestination && (
                  <td className="px-1 sm:px-2 py-2.5 sm:py-4 font-mono text-xs text-muted-foreground">{t.destination ?? "—"}</td>
                )}
                <td className="px-1 sm:px-2 py-2.5 sm:py-4 text-right font-mono font-semibold text-foreground">{fmt(t.amount)}</td>
                <td className="px-1 sm:px-2 py-2.5 sm:py-4 text-right">
                  <span
                    className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                      status === "cancelled"
                        ? "bg-muted text-muted-foreground"
                        : status === "pending"
                          ? "bg-primary/10 text-primary"
                          : "bg-up/10 text-up"
                    }`}
                  >
                    <span className="h-1.5 w-1.5 rounded-full bg-current" />
                    {status === "pending" ? "Pending" : status === "cancelled" ? "Cancelled" : "Completed"}
                  </span>
                </td>
                <td className="px-1 sm:px-2 py-2.5 sm:py-4 text-right">
                  {status === "pending" && (
                    <button
                      type="button"
                      onClick={() => onComplete(t.id)}
                      className="rounded-md border border-border px-2 py-1 text-[11px] font-semibold text-foreground transition-colors hover:bg-secondary"
                    >
                      Mark as done
                    </button>
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
