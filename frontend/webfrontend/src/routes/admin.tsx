import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import { ApiError } from "@/lib/api";
import { currentIdToken } from "@/lib/firebase";
import {
  adminApproveFundingRequest,
  adminDeclineFundingRequest,
  adminFundingSummary,
  adminListFundingRequests,
  type FundingKind,
  type FundingRequest,
  type FundingSummary,
} from "@/lib/funding-api";

export const Route = createFileRoute("/admin")({
  head: () => ({
    meta: [
      { title: "Admin — Stocks360" },
      { name: "description", content: "Stocks360 admin portal." },
    ],
  }),
  component: AdminPage,
});

function fmt(n: number) {
  return n.toLocaleString("en-US", { maximumFractionDigits: 4 });
}
function stamp(iso: string) {
  const d = new Date(iso);
  const p = (v: number) => String(v).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
function num(raw: string): number {
  const value = Number(raw);
  return Number.isFinite(value) ? value : 0;
}

/**
 * Gated on the caller's own Firebase session, exactly like every other page — there is no
 * separate admin credential to phish or leak. `ADMIN_EMAILS` on the backend decides who
 * gets past `require_admin`; this page just asks and shows whatever it says.
 *
 * The email/password form this used to have was a client-side check against a constant
 * baked into the JS bundle — anyone who opened devtools had the password. Removed rather
 * than fixed: there was nothing for it to protect that `require_admin` was not already
 * protecting server-side.
 */
function AdminPage() {
  const { isLoggedIn, authReady, email } = useAuth();
  const [state, setState] = useState<"checking" | "allowed" | "forbidden" | "error">("checking");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!authReady) return;
    if (!isLoggedIn) {
      setState("checking");
      return;
    }
    let cancelled = false;
    setState("checking");
    (async () => {
      try {
        const token = await currentIdToken();
        // Any admin-only read works as the gate; the summary is the cheapest one and the
        // dashboard needs it regardless.
        await adminFundingSummary(token);
        if (!cancelled) setState("allowed");
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 403) {
          setState("forbidden");
        } else {
          setState("error");
          setError(err instanceof ApiError ? err.message : "Could not reach the admin API.");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [authReady, isLoggedIn]);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="grid-bg fixed inset-0 opacity-30" />
      <div className="relative">
        {!authReady ? null : !isLoggedIn ? (
          <GatePage
            icon="fa-lock"
            title="Sign in required"
            body="The admin portal uses your regular Stocks360 sign-in — there is no separate admin password."
            action={{ label: "Go to sign in", to: "/login" }}
          />
        ) : state === "checking" ? (
          <div className="flex min-h-screen items-center justify-center">
            <i className="fa-solid fa-circle-notch fa-spin text-2xl text-muted-foreground" />
          </div>
        ) : state === "forbidden" ? (
          <GatePage
            icon="fa-shield-halved"
            title="Not an administrator"
            body={`${email ?? "This account"} is signed in but is not on the admin allowlist for this deployment.`}
            action={{ label: "Back to Stocks360", to: "/" }}
          />
        ) : state === "error" ? (
          <GatePage icon="fa-triangle-exclamation" title="Could not load the admin portal" body={error} />
        ) : (
          <AdminDashboard />
        )}
      </div>
    </div>
  );
}

function GatePage({
  icon,
  title,
  body,
  action,
}: {
  icon: string;
  title: string;
  body: string;
  action?: { label: string; to: "/login" | "/" };
}) {
  return (
    <div className="flex min-h-screen items-center justify-center px-6 py-12">
      <div className="w-full max-w-md rounded sm:rounded-3xl border border-border bg-card/80 p-8 text-center shadow-2xl backdrop-blur-xl">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
          <i className={`fa-solid ${icon} text-lg`} />
        </div>
        <h1 className="mt-4 text-2xl font-bold tracking-tight text-foreground">{title}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{body}</p>
        {action && (
          <Link
            to={action.to}
            className="mt-6 inline-block rounded sm:rounded-xl bg-primary px-5 py-2.5 text-sm font-bold uppercase tracking-wider text-primary-foreground transition-opacity hover:opacity-90"
          >
            {action.label}
          </Link>
        )}
      </div>
    </div>
  );
}

function AdminDashboard() {
  const { email, logout } = useAuth();
  const [tab, setTab] = useState<FundingKind>("deposit");
  const [requests, setRequests] = useState<FundingRequest[]>([]);
  const [summary, setSummary] = useState<FundingSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const token = await currentIdToken();
    const [requestsResult, summaryResult] = await Promise.all([
      adminListFundingRequests(token, { kind: tab, limit: 100 }),
      adminFundingSummary(token),
    ]);
    setRequests(requestsResult);
    setSummary(summaryResult);
  }, [tab]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    load()
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : "Could not load the review queue.");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [load]);

  const refresh = useCallback(() => {
    void load().catch((err: unknown) => {
      setError(err instanceof ApiError ? err.message : "Could not refresh the review queue.");
    });
  }, [load]);

  return (
    <div className="mx-auto max-w-6xl px-6 py-10">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Admin dashboard</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Signed in as {email ?? "—"} · Review deposit and withdrawal requests.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void logout()}
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
            Held per currency
          </div>
          {!summary || summary.balances.length === 0 ? (
            <div className="mt-2 text-sm text-muted-foreground">
              {loading ? "Loading…" : "Nothing held yet"}
            </div>
          ) : (
            <div className="mt-2 space-y-1">
              {summary.balances.map((b) => (
                <div key={b.currency} className="font-mono text-lg font-bold tracking-tight text-foreground">
                  {fmt(num(b.total))} {b.currency}
                  <span className="ml-2 font-sans text-xs font-normal text-muted-foreground">
                    ({b.wallets} {b.wallets === 1 ? "wallet" : "wallets"})
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="rounded sm:rounded-2xl border border-border bg-card p-6">
          <div className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
            Pending deposits
          </div>
          <div className="mt-2 font-mono text-2xl font-bold tracking-tight text-foreground">
            {summary?.pending_deposits ?? "—"}
          </div>
          <div className="mt-1 text-xs text-muted-foreground">Awaiting your confirmation</div>
        </div>
        <div className="rounded sm:rounded-2xl border border-border bg-card p-6">
          <div className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
            Pending withdrawals
          </div>
          <div className="mt-2 font-mono text-2xl font-bold tracking-tight text-foreground">
            {summary?.pending_withdrawals ?? "—"}
          </div>
          <div className="mt-1 text-xs text-muted-foreground">Awaiting your confirmation</div>
        </div>
      </div>

      {error && (
        <p className="mt-4 rounded-lg bg-destructive/10 px-3 py-2 text-xs font-medium text-destructive">
          {error}
        </p>
      )}

      {/* ── Tabs ── */}
      <div className="mt-8 flex gap-2 border-b border-border">
        {(
          [
            { key: "deposit" as const, label: "Deposits", count: summary?.pending_deposits ?? 0 },
            { key: "withdrawal" as const, label: "Withdrawals", count: summary?.pending_withdrawals ?? 0 },
          ]
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

      <RequestTable
        rows={requests}
        loading={loading}
        showDestination={tab === "withdrawal"}
        emptyLabel={tab === "deposit" ? "No deposit requests yet." : "No withdrawal requests yet."}
        onDecided={refresh}
      />
    </div>
  );
}

function RequestTable({
  rows,
  loading,
  showDestination,
  emptyLabel,
  onDecided,
}: {
  rows: FundingRequest[];
  loading: boolean;
  showDestination: boolean;
  emptyLabel: string;
  onDecided: () => void;
}) {
  if (rows.length === 0) {
    return (
      <div className="py-14 text-center">
        <i className="fa-regular fa-folder-open text-3xl text-muted-foreground/40" />
        <p className="mt-3 text-sm text-muted-foreground">{loading ? "Loading…" : emptyLabel}</p>
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
            {showDestination && (
              <th className="px-1 sm:px-2 pb-2 sm:pb-3 font-medium">Destination</th>
            )}
            <th className="px-1 sm:px-2 pb-2 sm:pb-3 text-right font-medium">Amount</th>
            <th className="px-1 sm:px-2 pb-2 sm:pb-3 text-right font-medium">Status</th>
            <th className="px-1 sm:px-2 pb-2 sm:pb-3 text-right font-medium">Action</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <RequestRow key={r.id} row={r} showDestination={showDestination} onDecided={onDecided} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RequestRow({
  row,
  showDestination,
  onDecided,
}: {
  row: FundingRequest;
  showDestination: boolean;
  onDecided: () => void;
}) {
  const [declining, setDeclining] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [rowError, setRowError] = useState("");

  const approve = async () => {
    if (!window.confirm(`Approve this ${row.kind} of ${row.amount} ${row.currency}?`)) return;
    setBusy(true);
    setRowError("");
    try {
      const token = await currentIdToken();
      await adminApproveFundingRequest(row.id, {}, token);
      onDecided();
    } catch (err) {
      setRowError(err instanceof ApiError ? err.message : "Could not approve this request.");
      setBusy(false);
    }
  };

  const decline = async () => {
    setBusy(true);
    setRowError("");
    try {
      const token = await currentIdToken();
      await adminDeclineFundingRequest(row.id, note.trim() ? { note: note.trim() } : {}, token);
      onDecided();
    } catch (err) {
      setRowError(err instanceof ApiError ? err.message : "Could not decline this request.");
      setBusy(false);
    }
  };

  return (
    <tr className="border-b border-border last:border-b-0 align-top">
      <td className="px-1 sm:px-2 py-2.5 sm:py-4 font-mono text-xs text-muted-foreground">
        {stamp(row.created_at)}
      </td>
      <td className="px-1 sm:px-2 py-2.5 sm:py-4 text-foreground">{row.email ?? row.uid}</td>
      <td className="px-1 sm:px-2 py-2.5 sm:py-4 font-medium text-foreground">{row.currency}</td>
      <td className="px-1 sm:px-2 py-2.5 sm:py-4 text-muted-foreground">{row.network}</td>
      {showDestination && (
        <td className="px-1 sm:px-2 py-2.5 sm:py-4 font-mono text-xs text-muted-foreground">
          {row.destination ?? "—"}
        </td>
      )}
      <td className="px-1 sm:px-2 py-2.5 sm:py-4 text-right font-mono font-semibold text-foreground">
        {fmt(num(row.amount))}
      </td>
      <td className="px-1 sm:px-2 py-2.5 sm:py-4 text-right">
        <span
          title={row.resolution_note ?? undefined}
          className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ${
            row.status === "cancelled"
              ? "bg-muted text-muted-foreground"
              : row.status === "pending"
                ? "bg-primary/10 text-primary"
                : "bg-up/10 text-up"
          }`}
        >
          <span className="h-1.5 w-1.5 rounded-full bg-current" />
          {row.status === "pending" ? "Pending" : row.status === "cancelled" ? "Cancelled" : "Completed"}
        </span>
      </td>
      <td className="px-1 sm:px-2 py-2.5 sm:py-4 text-right">
        {row.status === "pending" && (
          <div className="flex flex-col items-end gap-2">
            {declining ? (
              <div className="w-56 text-left">
                <input
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Reason (shown to the user)"
                  disabled={busy}
                  className="w-full rounded-md border border-border bg-background/60 px-2 py-1 text-xs text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/40"
                />
                <div className="mt-1.5 flex justify-end gap-1.5">
                  <button
                    type="button"
                    onClick={() => setDeclining(false)}
                    disabled={busy}
                    className="rounded-md border border-border px-2 py-1 text-[11px] font-semibold text-foreground transition-colors hover:bg-secondary"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => void decline()}
                    disabled={busy}
                    className="rounded-md bg-destructive px-2 py-1 text-[11px] font-semibold text-destructive-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
                  >
                    Confirm decline
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex gap-1.5">
                <button
                  type="button"
                  onClick={() => setDeclining(true)}
                  disabled={busy}
                  className="rounded-md border border-border px-2 py-1 text-[11px] font-semibold text-foreground transition-colors hover:bg-secondary disabled:opacity-50"
                >
                  Decline
                </button>
                <button
                  type="button"
                  onClick={() => void approve()}
                  disabled={busy}
                  className="rounded-md bg-primary px-2 py-1 text-[11px] font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
                >
                  {busy ? "Approving…" : "Approve"}
                </button>
              </div>
            )}
            {rowError && <p className="text-[11px] text-destructive">{rowError}</p>}
          </div>
        )}
      </td>
    </tr>
  );
}
