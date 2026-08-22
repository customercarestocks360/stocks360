import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import { KycDetails } from "@/components/ui/kyc-recap";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ApiError } from "@/lib/api";
import {
  adminAdjustBalance,
  adminBulkApproveKyc,
  adminBulkSetProductAccess,
  adminCancelUserOrder,
  adminFetchOverview,
  adminFetchUserOperations,
  adminListAudit,
  adminListUsers,
  adminReviewKyc,
  adminRevokeUserSessions,
  adminSetAccountStatus,
  adminSetProductAccess,
  type AdminAuditEntry,
  type AdminOverview,
  type AdminUserOperations,
  type BulkActionResult,
} from "@/lib/admin-api";
import { currentIdToken } from "@/lib/firebase";
import {
  adminFetchPlatformSettings,
  adminUpdatePlatformSettings,
  type DepositRail,
  type PlatformSettings,
} from "@/lib/platform-api";
import {
  adminApproveFundingRequest,
  adminDeclineFundingRequest,
  adminFundingSummary,
  adminListFundingRequests,
  FUNDING_NETWORKS,
  type FundingKind,
  type FundingRequest,
  type FundingSummary,
} from "@/lib/funding-api";
import { PRODUCTS, type Product } from "@/lib/onboarding-api";
import {
  adminFetchUserDetail,
  adminUpdateUserProfile,
  type AdminUserDetail,
  type UserProfile,
} from "@/lib/users-api";

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
        await adminFetchOverview(token);
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
          <GatePage
            icon="fa-triangle-exclamation"
            title="Could not load the admin portal"
            body={error}
          />
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
  const [section, setSection] = useState<"overview" | "funding" | "users" | "settings" | "audit">(
    "overview",
  );
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
            Signed in as {email ?? "—"} · Full operational control · users, KYC, balances, orders,
            funding, and audit.
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

      {/* ── Section switcher ── */}
      <div className="mt-6 flex gap-2">
        {[
          { key: "overview" as const, label: "Overview", icon: "fa-gauge-high" },
          { key: "users" as const, label: "Users", icon: "fa-users-gear" },
          { key: "funding" as const, label: "Funding", icon: "fa-money-bill-transfer" },
          { key: "settings" as const, label: "Platform", icon: "fa-sliders" },
          { key: "audit" as const, label: "Audit log", icon: "fa-shield-halved" },
        ].map((s) => (
          <button
            key={s.key}
            type="button"
            onClick={() => setSection(s.key)}
            className={`rounded-lg px-4 py-2 text-sm font-semibold transition-colors ${
              section === s.key
                ? "bg-primary text-primary-foreground"
                : "border border-border bg-card text-muted-foreground hover:text-foreground"
            }`}
          >
            <i className={`fa-solid ${s.icon} mr-2 text-xs`} />
            {s.label}
          </button>
        ))}
      </div>

      {section === "overview" && <OverviewPanel onNavigate={setSection} />}
      {section === "users" && <UserLookupPanel />}
      {section === "settings" && <PlatformSettingsPanel />}
      {section === "audit" && <AuditPanel />}

      {section === "funding" && (
        <>
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
                    <div
                      key={b.currency}
                      className="font-mono text-lg font-bold tracking-tight text-foreground"
                    >
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
            {[
              { key: "deposit" as const, label: "Deposits", count: summary?.pending_deposits ?? 0 },
              {
                key: "withdrawal" as const,
                label: "Withdrawals",
                count: summary?.pending_withdrawals ?? 0,
              },
            ].map((t) => (
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
                {tab === t.key && (
                  <span className="absolute inset-x-0 -bottom-px h-0.5 bg-primary" />
                )}
              </button>
            ))}
          </div>

          <RequestTable
            rows={requests}
            loading={loading}
            showDestination
            emptyLabel={
              tab === "deposit" ? "No deposit requests yet." : "No withdrawal requests yet."
            }
            onDecided={refresh}
          />
        </>
      )}
    </div>
  );
}

function OverviewPanel({
  onNavigate,
}: {
  onNavigate: (section: "overview" | "funding" | "users" | "settings" | "audit") => void;
}) {
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      setError("");
      setOverview(await adminFetchOverview(await currentIdToken()));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load operations overview.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const cards = [
    { label: "Total users", value: overview?.users, icon: "fa-users", section: "users" as const },
    {
      label: "KYC awaiting review",
      value: overview?.kyc_under_review,
      icon: "fa-user-check",
      section: "users" as const,
    },
    {
      label: "Suspended accounts",
      value: overview?.suspended_users,
      icon: "fa-user-lock",
      section: "users" as const,
    },
    {
      label: "Open orders",
      value: overview?.open_orders,
      icon: "fa-file-lines",
      section: "users" as const,
    },
    {
      label: "Open positions",
      value: overview?.open_positions,
      icon: "fa-chart-line",
      section: "users" as const,
    },
    {
      label: "Funding pending",
      value:
        overview === null ? undefined : overview.pending_deposits + overview.pending_withdrawals,
      icon: "fa-money-bill-transfer",
      section: "funding" as const,
    },
  ];

  return (
    <div className="mt-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold">Operations overview</h2>
          <p className="text-xs text-muted-foreground">
            Live totals from the application database.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="rounded-lg border border-border px-3 py-2 text-xs font-semibold hover:bg-secondary"
        >
          <i className="fa-solid fa-rotate mr-2" />
          Refresh
        </button>
      </div>
      {error && (
        <p className="mt-3 rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error}
        </p>
      )}
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map((card) => (
          <button
            key={card.label}
            type="button"
            onClick={() => onNavigate(card.section)}
            className="group rounded-2xl border border-border bg-card p-5 text-left transition-colors hover:border-primary/40 hover:bg-secondary/30"
          >
            <div className="flex items-start justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {card.label}
              </span>
              <i className={`fa-solid ${card.icon} text-primary`} />
            </div>
            <div className="mt-3 font-mono text-3xl font-bold tabular-nums">
              {card.value ?? "—"}
            </div>
            <div className="mt-2 text-[11px] text-muted-foreground group-hover:text-foreground">
              Open control panel <i className="fa-solid fa-arrow-right ml-1" />
            </div>
          </button>
        ))}
      </div>
      <div className="mt-4 rounded-2xl border border-border bg-card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-sm font-bold">Control-plane safeguards</div>
            <div className="mt-1 text-xs text-muted-foreground">
              Every balance, account, KYC, and order action is server-authorized and written to the
              audit log.
            </div>
          </div>
          <button
            type="button"
            onClick={() => onNavigate("audit")}
            className="rounded-lg bg-primary px-3 py-2 text-xs font-bold text-primary-foreground"
          >
            Review audit trail
          </button>
        </div>
      </div>
    </div>
  );
}

const NEW_DEPOSIT_RAIL: DepositRail = {
  currency: "USDT",
  network: "BEP20",
  name: "BNB Smart Chain (BEP20)",
  address: "",
  address_label: "Wallet Address (BEP20)",
  minimum: "1 USDT",
  arrival: "After network confirmation",
  fee: "0 USDT",
  confirmations: "15 network confirmations",
  enabled: true,
};

function PlatformSettingsPanel() {
  const [settings, setSettings] = useState<PlatformSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveModalOpen, setSaveModalOpen] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setSettings(await adminFetchPlatformSettings(await currentIdToken()));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load platform settings.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const updateRail = <K extends keyof DepositRail>(
    index: number,
    key: K,
    value: DepositRail[K],
  ) => {
    setSettings((current) => {
      if (!current) return current;
      const deposit_rails = current.deposit_rails.map((rail, railIndex) =>
        railIndex === index ? { ...rail, [key]: value } : rail,
      );
      return { ...current, deposit_rails };
    });
  };

  const save = async () => {
    if (!settings) return;
    const invalidRail = settings.deposit_rails.find(
      (rail) =>
        !rail.currency.trim() ||
        !rail.name.trim() ||
        !rail.address.trim() ||
        !rail.address_label.trim() ||
        !rail.minimum.trim() ||
        !rail.arrival.trim() ||
        !rail.fee.trim() ||
        !rail.confirmations.trim(),
    );
    if (invalidRail) {
      setError("Complete every field for each deposit rail before saving.");
      return;
    }
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const updated = await adminUpdatePlatformSettings(
        {
          announcement: settings.announcement?.trim() || null,
          support_email: settings.support_email?.trim() || null,
          deposit_rails: settings.deposit_rails,
        },
        await currentIdToken(),
      );
      setSettings(updated);
      setMessage("Platform settings saved. Deposit pages now use this configuration.");
      setSaveModalOpen(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save platform settings.");
    } finally {
      setSaving(false);
    }
  };

  if (loading && !settings) {
    return (
      <div className="flex min-h-64 items-center justify-center">
        <i className="fa-solid fa-circle-notch fa-spin text-xl text-muted-foreground" />
      </div>
    );
  }

  if (!settings) {
    return (
      <div className="mt-6 rounded-2xl border border-destructive/30 bg-destructive/5 p-6">
        <p className="text-sm text-destructive">{error || "Platform settings are unavailable."}</p>
        <button
          type="button"
          onClick={() => void load()}
          className="mt-4 rounded-lg border border-border px-3 py-2 text-xs font-bold"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="mt-6 space-y-5">
      <div className="rounded-2xl border border-border bg-card p-5">
        <h2 className="text-lg font-bold">Public platform controls</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Configure public messaging, support contact, and every QR deposit destination.
        </p>
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <label className="text-xs font-semibold text-muted-foreground">
            Announcement
            <input
              value={settings.announcement ?? ""}
              onChange={(event) =>
                setSettings({ ...settings, announcement: event.target.value || null })
              }
              maxLength={280}
              placeholder="Optional public notice"
              className="mt-2 w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm text-foreground"
            />
          </label>
          <label className="text-xs font-semibold text-muted-foreground">
            Support email
            <input
              value={settings.support_email ?? ""}
              onChange={(event) =>
                setSettings({ ...settings, support_email: event.target.value || null })
              }
              maxLength={254}
              type="email"
              placeholder="support@example.com"
              className="mt-2 w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm text-foreground"
            />
          </label>
        </div>
      </div>

      <div className="rounded-2xl border border-border bg-card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold">QR deposit rails</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Disabled rails remain saved but disappear immediately from the customer deposit page.
            </p>
          </div>
          <button
            type="button"
            disabled={settings.deposit_rails.length >= 20}
            onClick={() =>
              setSettings({
                ...settings,
                deposit_rails: [...settings.deposit_rails, { ...NEW_DEPOSIT_RAIL }],
              })
            }
            className="rounded-lg border border-border px-3 py-2 text-xs font-bold hover:bg-secondary disabled:opacity-40"
          >
            <i className="fa-solid fa-plus mr-2" /> Add network
          </button>
        </div>

        <div className="mt-5 space-y-4">
          {settings.deposit_rails.map((rail, index) => (
            <div
              key={`${rail.network}:${index}`}
              className="rounded-xl border border-border bg-background/40 p-4"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="font-semibold">Rail {index + 1}</div>
                <div className="flex items-center gap-3">
                  <label className="flex items-center gap-2 text-xs text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={rail.enabled}
                      onChange={(event) => updateRail(index, "enabled", event.target.checked)}
                    />
                    Enabled
                  </label>
                  <button
                    type="button"
                    onClick={() =>
                      setSettings({
                        ...settings,
                        deposit_rails: settings.deposit_rails.filter(
                          (_, itemIndex) => itemIndex !== index,
                        ),
                      })
                    }
                    className="rounded-md border border-destructive/30 px-2 py-1 text-xs font-semibold text-destructive"
                  >
                    Remove
                  </button>
                </div>
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <RailField
                  label="Currency"
                  value={rail.currency}
                  onChange={(value) => updateRail(index, "currency", value.toUpperCase())}
                />
                <label className="text-[11px] font-semibold text-muted-foreground">
                  Network
                  <select
                    value={rail.network}
                    onChange={(event) =>
                      updateRail(index, "network", event.target.value as DepositRail["network"])
                    }
                    className="mt-1.5 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
                  >
                    {FUNDING_NETWORKS.map((network) => (
                      <option key={network}>{network}</option>
                    ))}
                  </select>
                </label>
                <RailField
                  label="Display name"
                  value={rail.name}
                  onChange={(value) => updateRail(index, "name", value)}
                />
                <div className="sm:col-span-2 lg:col-span-3">
                  <RailField
                    label="Receiving wallet address / QR value"
                    value={rail.address}
                    onChange={(value) => updateRail(index, "address", value)}
                    mono
                  />
                </div>
                <RailField
                  label="Address label"
                  value={rail.address_label}
                  onChange={(value) => updateRail(index, "address_label", value)}
                />
                <RailField
                  label="Minimum"
                  value={rail.minimum}
                  onChange={(value) => updateRail(index, "minimum", value)}
                />
                <RailField
                  label="Fee"
                  value={rail.fee}
                  onChange={(value) => updateRail(index, "fee", value)}
                />
                <RailField
                  label="Arrival"
                  value={rail.arrival}
                  onChange={(value) => updateRail(index, "arrival", value)}
                />
                <RailField
                  label="Confirmations"
                  value={rail.confirmations}
                  onChange={(value) => updateRail(index, "confirmations", value)}
                />
              </div>
            </div>
          ))}
          {settings.deposit_rails.length === 0 && (
            <p className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
              No deposit networks configured. Deposits will be unavailable until you add and enable
              one.
            </p>
          )}
        </div>
      </div>

      {error && (
        <p className="rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</p>
      )}
      {message && <p className="rounded-lg bg-up/10 px-3 py-2 text-xs text-up">{message}</p>}
      <div className="flex justify-end gap-2">
        <button
          type="button"
          disabled={saving}
          onClick={() => void load()}
          className="rounded-lg border border-border px-4 py-2.5 text-xs font-bold disabled:opacity-40"
        >
          Reset changes
        </button>
        <button
          type="button"
          disabled={saving}
          onClick={() => {
            setError("");
            setSaveModalOpen(true);
          }}
          className="rounded-lg bg-primary px-5 py-2.5 text-xs font-bold text-primary-foreground disabled:opacity-40"
        >
          {saving ? "Savingâ€¦" : "Save platform settings"}
        </button>
      </div>
      {settings.updated_at && (
        <p className="text-right text-[11px] text-muted-foreground">
          Last updated {stamp(settings.updated_at)} by {settings.updated_by ?? "administrator"}
        </p>
      )}

      <Dialog open={saveModalOpen} onOpenChange={(open) => !saving && setSaveModalOpen(open)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Publish platform settings</DialogTitle>
            <DialogDescription>
              These changes affect public messaging and deposit destinations immediately.
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-lg border border-border bg-secondary/20 p-3 text-sm">
            <div className="font-semibold">Configuration summary</div>
            <div className="mt-2 text-xs text-muted-foreground">
              {settings.deposit_rails.filter((rail) => rail.enabled).length} enabled deposit rails ·{" "}
              {settings.deposit_rails.length} total · support email{" "}
              {settings.support_email || "not configured"}
            </div>
          </div>
          {error && (
            <p className="rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <DialogClose asChild>
              <button
                type="button"
                disabled={saving}
                className="rounded-lg border border-border px-4 py-2 text-sm font-semibold"
              >
                Keep editing
              </button>
            </DialogClose>
            <button
              type="button"
              disabled={saving}
              onClick={() => void save()}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"
            >
              {saving ? "Publishing…" : "Publish changes"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function RailField({
  label,
  value,
  onChange,
  mono = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  mono?: boolean;
}) {
  return (
    <label className="block text-[11px] font-semibold text-muted-foreground">
      {label}
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        maxLength={256}
        className={`mt-1.5 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground ${mono ? "font-mono" : ""}`}
      />
    </label>
  );
}

function AuditPanel() {
  const [rows, setRows] = useState<AdminAuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [targetDraft, setTargetDraft] = useState("");
  const [targetUid, setTargetUid] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setError("");
      setRows(
        await adminListAudit(await currentIdToken(), {
          limit: 200,
          ...(targetUid ? { targetUid } : {}),
        }),
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load the audit log.");
    } finally {
      setLoading(false);
    }
  }, [targetUid]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="mt-6 rounded-2xl border border-border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-4">
        <div>
          <h2 className="font-bold">Administrative audit log</h2>
          <p className="text-xs text-muted-foreground">Newest privileged action first.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <input
            value={targetDraft}
            onChange={(event) => setTargetDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") setTargetUid(targetDraft.trim());
            }}
            placeholder="Filter by target UID"
            className="rounded-lg border border-border bg-background px-3 py-2 font-mono text-xs"
          />
          <button
            type="button"
            onClick={() => setTargetUid(targetDraft.trim())}
            className="rounded-lg border border-border px-3 py-2 text-xs font-semibold hover:bg-secondary"
          >
            Filter
          </button>
          <button
            type="button"
            onClick={() => void load()}
            className="rounded-lg border border-border px-3 py-2 text-xs font-semibold hover:bg-secondary"
          >
            <i className="fa-solid fa-rotate mr-2" />
            Refresh
          </button>
        </div>
      </div>
      {error ? (
        <p className="p-4 text-xs text-destructive">{error}</p>
      ) : loading ? (
        <p className="p-8 text-center text-sm text-muted-foreground">Loading audit trail…</p>
      ) : rows.length === 0 ? (
        <p className="p-8 text-center text-sm text-muted-foreground">
          No administrative actions recorded yet.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                <th className="px-4 py-3">Time</th>
                <th className="px-4 py-3">Administrator</th>
                <th className="px-4 py-3">Action</th>
                <th className="px-4 py-3">Target</th>
                <th className="px-4 py-3">Reason</th>
                <th className="px-4 py-3">Details</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-b border-border/70 last:border-0">
                  <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                    {stamp(row.at)}
                  </td>
                  <td className="px-4 py-3">{row.actor_email ?? row.actor_uid}</td>
                  <td className="px-4 py-3">
                    <span className="rounded bg-primary/10 px-2 py-1 font-mono text-xs text-primary">
                      {row.action}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                    {row.target_uid ?? "system"}
                  </td>
                  <td className="max-w-sm px-4 py-3 text-xs text-muted-foreground">
                    {row.reason ?? "—"}
                  </td>
                  <td className="max-w-md px-4 py-3">
                    <code className="block max-w-md whitespace-pre-wrap break-all text-[10px] text-muted-foreground">
                      {Object.keys(row.metadata).length ? JSON.stringify(row.metadata) : "—"}
                    </code>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/** Searchable user directory with a full operational drill-down. */
function UserLookupPanel() {
  const pageSize = 50;
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "suspended">("all");
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [detail, setDetail] = useState<AdminUserDetail | null>(null);
  const [operations, setOperations] = useState<AdminUserOperations | null>(null);
  const [selectedUid, setSelectedUid] = useState<string | null>(null);
  const [userModalOpen, setUserModalOpen] = useState(false);
  const [selectedLoading, setSelectedLoading] = useState(false);
  const [selectedError, setSelectedError] = useState("");
  const [selectedUsers, setSelectedUsers] = useState<Set<string>>(() => new Set());
  const [bulkAction, setBulkAction] = useState<"kyc" | "products" | null>(null);
  const [bulkTargets, setBulkTargets] = useState<string[]>([]);
  const [bulkReason, setBulkReason] = useState("");
  const [bulkPreparing, setBulkPreparing] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkError, setBulkError] = useState("");
  const [bulkResult, setBulkResult] = useState<BulkActionResult | null>(null);
  const [offset, setOffset] = useState(0);

  const search = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const token = await currentIdToken();
      const result = await adminListUsers(token, {
        ...(query.trim() ? { search: query.trim() } : {}),
        ...(statusFilter !== "all" ? { accountStatus: statusFilter } : {}),
        limit: pageSize,
        offset,
      });
      setUsers(result.items);
      setTotal(result.total);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load the user directory.");
    } finally {
      setLoading(false);
    }
  }, [offset, query, statusFilter]);

  useEffect(() => {
    setOffset(0);
  }, [query, statusFilter]);

  useEffect(() => {
    setSelectedUsers(new Set());
  }, [offset, query, statusFilter]);

  useEffect(() => {
    const timer = window.setTimeout(() => void search(), 250);
    return () => window.clearTimeout(timer);
  }, [search]);

  const selectUser = async (uid: string) => {
    setSelectedUid(uid);
    setUserModalOpen(true);
    setSelectedLoading(true);
    setSelectedError("");
    setDetail(null);
    setOperations(null);
    try {
      const token = await currentIdToken();
      const [nextDetail, nextOperations] = await Promise.all([
        adminFetchUserDetail(uid, token),
        adminFetchUserOperations(uid, token),
      ]);
      setDetail(nextDetail);
      setOperations(nextOperations);
    } catch (err) {
      setSelectedError(err instanceof ApiError ? err.message : "Could not load this account.");
    } finally {
      setSelectedLoading(false);
    }
  };

  const refreshSelected = async () => {
    if (!selectedUid) return;
    await Promise.all([search(), selectUser(selectedUid)]);
  };

  const pageUids = users.map((user) => user.uid);
  const pageSelected = pageUids.length > 0 && pageUids.every((uid) => selectedUsers.has(uid));
  const toggleUser = (uid: string) => {
    setSelectedUsers((current) => {
      const next = new Set(current);
      if (next.has(uid)) next.delete(uid);
      else next.add(uid);
      return next;
    });
  };
  const selectEligible = (kind: "kyc" | "products") => {
    setSelectedUsers(
      new Set(
        users
          .filter((user) =>
            kind === "kyc"
              ? user.onboarding_status === "under_review"
              : user.onboarding_status === "approved",
          )
          .map((user) => user.uid),
      ),
    );
  };
  const openBulk = async (kind: "kyc" | "products") => {
    let eligible = users
      .filter(
        (user) =>
          selectedUsers.has(user.uid) &&
          (kind === "kyc"
            ? user.onboarding_status === "under_review"
            : user.onboarding_status === "approved"),
      )
      .map((user) => user.uid);
    if (!eligible.length) {
      setBulkPreparing(true);
      setError("");
      try {
        const result = await adminListUsers(await currentIdToken(), {
          onboardingStatus: kind === "kyc" ? "under_review" : "approved",
          limit: 200,
          offset: 0,
        });
        eligible = result.items.map((user) => user.uid);
        setSelectedUsers(new Set(eligible));
      } catch (err) {
        setError(err instanceof ApiError ? err.message : "Could not prepare the bulk action.");
        return;
      } finally {
        setBulkPreparing(false);
      }
    }
    if (!eligible.length) {
      setError(
        kind === "kyc"
          ? "There are no KYC applications waiting for approval."
          : "There are no approved accounts eligible for product access.",
      );
      return;
    }
    setBulkTargets(eligible);
    setBulkReason("");
    setBulkError("");
    setBulkResult(null);
    setBulkAction(kind);
  };
  const submitBulk = async () => {
    if (!bulkAction || bulkReason.trim().length < 3) return;
    setBulkBusy(true);
    setBulkError("");
    try {
      const token = await currentIdToken();
      const result =
        bulkAction === "kyc"
          ? await adminBulkApproveKyc(bulkTargets, bulkReason.trim(), token)
          : await adminBulkSetProductAccess(bulkTargets, [...PRODUCTS], bulkReason.trim(), token);
      setBulkResult(result);
      setSelectedUsers((current) => {
        const next = new Set(current);
        result.succeeded.forEach((uid) => next.delete(uid));
        return next;
      });
      await search();
    } catch (err) {
      setBulkError(err instanceof ApiError ? err.message : "The bulk update failed.");
    } finally {
      setBulkBusy(false);
    }
  };

  return (
    <div className="mt-6">
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void search();
          }}
          placeholder="Search email, name, or UID"
          className="w-full max-w-md rounded-lg border border-border bg-background/60 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/40"
        />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
          className="rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground"
        >
          <option value="all">All accounts</option>
          <option value="active">Active</option>
          <option value="suspended">Suspended</option>
        </select>
        <button
          type="button"
          onClick={() => void search()}
          disabled={loading}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
        >
          {loading ? "Searching…" : "Find"}
        </button>
        <span className="text-xs text-muted-foreground">{total} accounts</span>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card/60 p-3">
        <span className="mr-1 text-xs font-semibold text-foreground">
          {selectedUsers.size} selected
        </span>
        <button
          type="button"
          onClick={() => selectEligible("kyc")}
          className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold hover:bg-secondary"
        >
          Select pending KYC
        </button>
        <button
          type="button"
          onClick={() => selectEligible("products")}
          className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold hover:bg-secondary"
        >
          Select approved users
        </button>
        <button
          type="button"
          disabled={bulkPreparing}
          onClick={() => void openBulk("kyc")}
          className="ml-auto rounded-lg bg-primary px-3 py-1.5 text-xs font-bold text-primary-foreground disabled:opacity-40"
        >
          <i
            className={`fa-solid ${bulkPreparing ? "fa-circle-notch fa-spin" : "fa-user-check"} mr-1.5`}
          />{" "}
          Bulk approve KYC
        </button>
        <button
          type="button"
          disabled={bulkPreparing}
          onClick={() => void openBulk("products")}
          className="rounded-lg border border-primary/40 bg-primary/10 px-3 py-1.5 text-xs font-bold text-primary disabled:opacity-40"
        >
          <i className="fa-solid fa-layer-group mr-1.5" /> Grant all products
        </button>
        {selectedUsers.size > 0 && (
          <button
            type="button"
            onClick={() => setSelectedUsers(new Set())}
            className="rounded-lg px-2 py-1.5 text-xs text-muted-foreground hover:text-foreground"
          >
            Clear
          </button>
        )}
      </div>
      {error && <p className="mt-3 text-xs font-medium text-destructive">{error}</p>}
      <div className="mt-4 overflow-x-auto rounded-2xl border border-border bg-card">
        <table className="w-full min-w-[760px] text-sm">
          <thead>
            <tr className="border-b border-border text-left text-[10px] uppercase tracking-wider text-muted-foreground">
              <th className="w-10 px-4 py-3">
                <input
                  type="checkbox"
                  aria-label="Select every user on this page"
                  checked={pageSelected}
                  onChange={(event) =>
                    setSelectedUsers((current) => {
                      const next = new Set(current);
                      pageUids.forEach((uid) =>
                        event.target.checked ? next.add(uid) : next.delete(uid),
                      );
                      return next;
                    })
                  }
                  className="accent-primary"
                />
              </th>
              <th className="px-4 py-3">User</th>
              <th className="px-4 py-3">Account</th>
              <th className="px-4 py-3">KYC</th>
              <th className="px-4 py-3">Products</th>
              <th className="px-4 py-3">Last login</th>
              <th className="px-4 py-3 text-right">Control</th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr
                key={user.uid}
                className={`border-b border-border/70 last:border-0 ${selectedUid === user.uid ? "bg-primary/5" : "hover:bg-secondary/30"}`}
              >
                <td className="px-4 py-3">
                  <input
                    type="checkbox"
                    aria-label={`Select ${user.email ?? user.uid}`}
                    checked={selectedUsers.has(user.uid)}
                    onChange={() => toggleUser(user.uid)}
                    className="accent-primary"
                  />
                </td>
                <td className="px-4 py-3">
                  <div className="font-semibold">{user.name ?? "Unnamed user"}</div>
                  <div className="text-xs text-muted-foreground">{user.email ?? user.uid}</div>
                </td>
                <td className="px-4 py-3">
                  <span
                    className={`rounded-full px-2 py-1 text-[10px] font-bold uppercase ${user.account_status === "suspended" ? "bg-destructive/10 text-destructive" : "bg-up/10 text-up"}`}
                  >
                    {user.account_status ?? "active"}
                  </span>
                </td>
                <td className="px-4 py-3 text-xs capitalize text-muted-foreground">
                  {user.onboarding_status.replaceAll("_", " ")} · {user.kyc_tier}
                </td>
                <td className="px-4 py-3 font-mono text-xs">
                  {user.enabled_products.length} live / {user.pending_products.length} pending
                </td>
                <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                  {user.last_login_at ? stamp(user.last_login_at) : "Never"}
                </td>
                <td className="px-4 py-3 text-right">
                  <button
                    type="button"
                    onClick={() => void selectUser(user.uid)}
                    className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold hover:border-primary/50 hover:text-primary"
                  >
                    Manage
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!loading && users.length === 0 && (
          <p className="p-8 text-center text-sm text-muted-foreground">
            No users match these filters.
          </p>
        )}
      </div>
      {total > pageSize && (
        <div className="mt-3 flex items-center justify-between gap-3 text-xs text-muted-foreground">
          <span>
            Showing {offset + 1}–{Math.min(offset + users.length, total)} of {total}
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={loading || offset === 0}
              onClick={() => setOffset((current) => Math.max(0, current - pageSize))}
              className="rounded-lg border border-border px-3 py-1.5 font-semibold text-foreground disabled:opacity-40"
            >
              Previous
            </button>
            <button
              type="button"
              disabled={loading || offset + users.length >= total}
              onClick={() => setOffset((current) => current + pageSize)}
              className="rounded-lg border border-border px-3 py-1.5 font-semibold text-foreground disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
      )}
      <Dialog
        open={bulkAction !== null}
        onOpenChange={(open) => {
          if (!open && !bulkBusy) setBulkAction(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {bulkAction === "kyc" ? "Bulk approve KYC" : "Grant all products"}
            </DialogTitle>
            <DialogDescription>
              {bulkAction === "kyc"
                ? `Approve ${bulkTargets.length} selected applications and enable each user’s requested products.`
                : `Grant all ${PRODUCTS.length} trading products to ${bulkTargets.length} selected approved accounts.`}
            </DialogDescription>
          </DialogHeader>

          {!bulkResult ? (
            <>
              <div className="rounded-lg border border-border bg-secondary/20 p-3 text-xs text-muted-foreground">
                Only eligible users are included, with up to 200 accounts per batch. Every
                successful user receives an individual audit entry.
              </div>
              {bulkAction === "products" && (
                <div className="flex flex-wrap gap-1.5">
                  {PRODUCTS.map((product) => (
                    <span
                      key={product}
                      className="rounded-full bg-primary/10 px-2 py-1 text-[10px] font-semibold capitalize text-primary"
                    >
                      {product.replaceAll("_", " ")}
                    </span>
                  ))}
                </div>
              )}
              <label className="space-y-2 text-sm font-medium">
                Audit reason
                <textarea
                  autoFocus
                  value={bulkReason}
                  onChange={(event) => setBulkReason(event.target.value)}
                  maxLength={256}
                  placeholder="Explain why this bulk change is required"
                  className="min-h-24 w-full resize-y rounded-lg border border-border bg-background px-3 py-2 text-foreground"
                />
                <span className="block text-right text-[10px] font-normal text-muted-foreground">
                  {bulkReason.trim().length}/256 · minimum 3 characters
                </span>
              </label>
            </>
          ) : (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-lg bg-up/10 p-4 text-center">
                  <div className="font-mono text-2xl font-bold text-up">
                    {bulkResult.succeeded.length}
                  </div>
                  <div className="text-xs text-up">Updated</div>
                </div>
                <div className="rounded-lg bg-destructive/10 p-4 text-center">
                  <div className="font-mono text-2xl font-bold text-destructive">
                    {bulkResult.failed.length}
                  </div>
                  <div className="text-xs text-destructive">Skipped</div>
                </div>
              </div>
              {bulkResult.failed.length > 0 && (
                <div className="max-h-40 overflow-y-auto rounded-lg border border-border">
                  {bulkResult.failed.map((failure) => (
                    <div
                      key={failure.uid}
                      className="border-b border-border px-3 py-2 text-xs last:border-0"
                    >
                      <div className="font-mono font-semibold">{failure.uid}</div>
                      <div className="mt-0.5 text-destructive">{failure.detail}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {bulkError && (
            <p className="rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {bulkError}
            </p>
          )}
          <DialogFooter>
            <DialogClose asChild>
              <button
                type="button"
                disabled={bulkBusy}
                className="rounded-lg border border-border px-4 py-2 text-sm font-semibold"
              >
                {bulkResult ? "Done" : "Cancel"}
              </button>
            </DialogClose>
            {!bulkResult && (
              <button
                type="button"
                disabled={bulkBusy || bulkReason.trim().length < 3}
                onClick={() => void submitBulk()}
                className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"
              >
                {bulkBusy ? "Applying…" : `Apply to ${bulkTargets.length} users`}
              </button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={userModalOpen} onOpenChange={setUserModalOpen}>
        <DialogContent className="flex max-h-[92vh] w-[min(96vw,1180px)] max-w-none flex-col gap-0 overflow-hidden p-0">
          <DialogHeader className="shrink-0 border-b border-border px-6 py-5 pr-14">
            <DialogTitle>Manage user</DialogTitle>
            <DialogDescription>
              Review identity, account activity, access, balances, orders, and security in one
              workspace.
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-6">
            {selectedLoading ? (
              <div className="flex min-h-64 items-center justify-center gap-2 text-sm text-muted-foreground">
                <i className="fa-solid fa-circle-notch fa-spin" /> Loading account…
              </div>
            ) : selectedError ? (
              <div className="my-6 rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
                {selectedError}
              </div>
            ) : detail && operations ? (
              <>
                <UserDetailCard detail={detail} onChanged={setDetail} />
                <AdminOperationsPanel
                  detail={detail}
                  operations={operations}
                  onChanged={() => void refreshSelected()}
                />
              </>
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function UserDetailCard({
  detail,
  onChanged,
}: {
  detail: AdminUserDetail;
  onChanged: (detail: AdminUserDetail) => void;
}) {
  const navigate = useNavigate();
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [savingName, setSavingName] = useState(false);
  const [nameError, setNameError] = useState("");

  const startEditingName = () => {
    setNameDraft(detail.profile.name ?? "");
    setNameError("");
    setEditingName(true);
  };
  const saveName = async () => {
    const trimmed = nameDraft.trim();
    if (!trimmed) return;
    setSavingName(true);
    setNameError("");
    try {
      const token = await currentIdToken();
      const profile = await adminUpdateUserProfile(detail.profile.uid, { name: trimmed }, token);
      onChanged({ ...detail, profile });
      setEditingName(false);
    } catch (err) {
      setNameError(err instanceof ApiError ? err.message : "Could not save the name.");
    } finally {
      setSavingName(false);
    }
  };

  return (
    <div className="mt-5 rounded sm:rounded-2xl border border-border bg-card p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <div className="text-base font-bold text-foreground">{detail.profile.name ?? "—"}</div>
            <button
              type="button"
              onClick={startEditingName}
              className="flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            >
              <i className="fa-solid fa-pen text-[10px]" />
              Edit profile
            </button>
          </div>
          <div className="mt-1 text-sm text-muted-foreground">{detail.profile.email ?? "—"}</div>
          <div className="mt-0.5 font-mono text-xs text-muted-foreground/70">
            {detail.profile.uid}
          </div>
        </div>
        <span
          className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ${
            detail.profile.onboarding_status === "rejected"
              ? "bg-destructive/10 text-destructive"
              : detail.profile.onboarding_status === "not_started"
                ? "bg-muted text-muted-foreground"
                : "bg-up/10 text-up"
          }`}
        >
          {detail.profile.onboarding_status.replace("_", " ")}
        </span>
      </div>

      <Dialog open={editingName} onOpenChange={(open) => !savingName && setEditingName(open)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Update user profile</DialogTitle>
            <DialogDescription>
              Change the display name for {detail.profile.email ?? detail.profile.uid}.
            </DialogDescription>
          </DialogHeader>
          <label className="space-y-2 text-sm font-medium">
            Display name
            <input
              autoFocus
              value={nameDraft}
              disabled={savingName}
              onChange={(event) => setNameDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void saveName();
              }}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/40 disabled:opacity-60"
            />
          </label>
          {nameError && <p className="text-xs font-medium text-destructive">{nameError}</p>}
          <DialogFooter>
            <DialogClose asChild>
              <button
                type="button"
                disabled={savingName}
                className="rounded-lg border border-border px-4 py-2 text-sm font-semibold"
              >
                Cancel
              </button>
            </DialogClose>
            <button
              type="button"
              onClick={() => void saveName()}
              disabled={savingName || !nameDraft.trim()}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"
            >
              {savingName ? "Saving…" : "Save changes"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {detail.kyc.completed_steps.length > 0 ? (
        <KycDetails
          session={detail.kyc}
          onEditStep={(step) =>
            void navigate({ to: "/kyc", search: { edit: true, step, uid: detail.profile.uid } })
          }
        />
      ) : (
        <p className="mt-4 text-sm text-muted-foreground">
          This user hasn't submitted any account details yet.
        </p>
      )}
    </div>
  );
}

function AdminOperationsPanel({
  detail,
  operations,
  onChanged,
}: {
  detail: AdminUserDetail;
  operations: AdminUserOperations;
  onChanged: () => void;
}) {
  const [tab, setTab] = useState<
    "account" | "orders" | "trades" | "positions" | "ledger" | "logins"
  >("account");
  const [reason, setReason] = useState("");
  const [adjustment, setAdjustment] = useState("");
  const [actionModal, setActionModal] = useState<
    "status" | "kyc-approve" | "kyc-reject" | "balance" | "products" | "sessions" | null
  >(null);
  const [cancelOrder, setCancelOrder] = useState<{ id: string; symbol: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [productAccess, setProductAccess] = useState<Product[]>(
    operations.profile.enabled_products,
  );
  const uid = detail.profile.uid;

  useEffect(() => {
    setProductAccess(operations.profile.enabled_products);
  }, [operations.profile.enabled_products]);

  const run = async (
    action: (token: string) => Promise<unknown>,
    success: string,
    auditReasonRequired = true,
  ) => {
    if (auditReasonRequired && reason.trim().length < 3) {
      setError("Enter a reason of at least 3 characters. It will be retained in the audit log.");
      return;
    }
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action(await currentIdToken());
      setNotice(success);
      setReason("");
      setAdjustment("");
      setActionModal(null);
      setCancelOrder(null);
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "The administrative action failed.");
    } finally {
      setBusy(false);
    }
  };

  const accountStatus = operations.profile.account_status ?? "active";
  const balanceCurrency = operations.account.balances[0]?.currency ?? "USDT";
  const openAction = (action: NonNullable<typeof actionModal>) => {
    setReason("");
    setAdjustment("");
    setError("");
    setNotice("");
    setActionModal(action);
  };
  const submitAction = () => {
    if (actionModal === "status") {
      return run(
        (token) =>
          adminSetAccountStatus(
            uid,
            {
              status: accountStatus === "suspended" ? "active" : "suspended",
              reason: reason.trim(),
            },
            token,
          ),
        accountStatus === "suspended"
          ? "Account restored."
          : "Account suspended and open orders cancelled.",
      );
    }
    if (actionModal === "kyc-approve" || actionModal === "kyc-reject") {
      const approve = actionModal === "kyc-approve";
      return run(
        (token) =>
          adminReviewKyc(
            uid,
            { decision: approve ? "approve" : "reject", reason: reason.trim() },
            token,
          ),
        approve ? "KYC approved and requested products enabled." : "KYC application rejected.",
      );
    }
    if (actionModal === "balance") {
      return run(
        (token) =>
          adminAdjustBalance(
            uid,
            {
              currency: balanceCurrency,
              amount: adjustment,
              reason: reason.trim(),
              idempotency_key: `admin-${Date.now().toString(36)}-${uid.slice(0, 8)}`,
            },
            token,
          ),
        "Balance adjustment posted to the ledger.",
      );
    }
    if (actionModal === "products") {
      return run(
        (token) =>
          adminSetProductAccess(
            uid,
            { enabled_products: productAccess, reason: reason.trim() },
            token,
          ),
        "Product access updated.",
      );
    }
    if (actionModal === "sessions") {
      return run(
        (token) => adminRevokeUserSessions(uid, reason.trim(), token),
        "All user sessions were revoked.",
      );
    }
  };
  const tabs = [
    { key: "account" as const, label: "Account", count: operations.account.balances.length },
    { key: "orders" as const, label: "Orders", count: operations.orders.length },
    { key: "trades" as const, label: "Trades", count: operations.trades.length },
    { key: "positions" as const, label: "Positions", count: operations.positions.length },
    { key: "ledger" as const, label: "Ledger", count: operations.ledger.length },
    { key: "logins" as const, label: "Security", count: operations.logins.length },
  ];

  return (
    <div className="mt-4 overflow-hidden rounded-2xl border border-border bg-card">
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

      {(error || notice) && (
        <p
          className={`m-4 rounded-lg px-3 py-2 text-xs ${error ? "bg-destructive/10 text-destructive" : "bg-up/10 text-up"}`}
        >
          {error || notice}
        </p>
      )}

      {tab === "account" && (
        <div className="space-y-5 p-5">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {operations.account.balances.map((balance) => (
              <div
                key={balance.currency}
                className="rounded-xl border border-border bg-background/30 p-4"
              >
                <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {balance.currency} balance
                </div>
                <div className="mt-2 font-mono text-xl font-bold">{fmt(num(balance.total))}</div>
                <div className="mt-1 text-[10px] text-muted-foreground">
                  {fmt(num(balance.available))} available · {fmt(num(balance.reserved))} reserved
                </div>
              </div>
            ))}
            <div className="rounded-xl border border-border bg-background/30 p-4">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Open orders
              </div>
              <div className="mt-2 font-mono text-xl font-bold">
                {operations.account.open_orders}
              </div>
            </div>
            <div className="rounded-xl border border-border bg-background/30 p-4">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Positions
              </div>
              <div className="mt-2 font-mono text-xl font-bold">{operations.account.positions}</div>
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <div className="rounded-xl border border-border p-4">
              <div className="text-sm font-bold">Account access</div>
              <p className="mt-1 text-xs text-muted-foreground">
                Suspending blocks new trading and funding and cancels open orders.
              </p>
              <button
                type="button"
                disabled={busy}
                onClick={() => openAction("status")}
                className={`mt-4 w-full rounded-lg px-3 py-2 text-xs font-bold ${accountStatus === "suspended" ? "bg-up text-white" : "bg-destructive text-destructive-foreground"}`}
              >
                {accountStatus === "suspended" ? "Restore account" : "Suspend account"}
              </button>
            </div>

            <div className="rounded-xl border border-border p-4">
              <div className="text-sm font-bold">KYC decision</div>
              <p className="mt-1 text-xs text-muted-foreground">
                Current state:{" "}
                <span className="font-semibold capitalize text-foreground">
                  {detail.profile.onboarding_status.replaceAll("_", " ")}
                </span>
              </p>
              <div className="mt-4 flex gap-2">
                <button
                  type="button"
                  disabled={busy || detail.profile.onboarding_status !== "under_review"}
                  onClick={() => openAction("kyc-reject")}
                  className="flex-1 rounded-lg border border-destructive/30 px-3 py-2 text-xs font-bold text-destructive disabled:opacity-40"
                >
                  Reject
                </button>
                <button
                  type="button"
                  disabled={busy || detail.profile.onboarding_status !== "under_review"}
                  onClick={() => openAction("kyc-approve")}
                  className="flex-1 rounded-lg bg-primary px-3 py-2 text-xs font-bold text-primary-foreground disabled:opacity-40"
                >
                  Approve
                </button>
              </div>
            </div>

            <div className="rounded-xl border border-border p-4">
              <div className="text-sm font-bold">Balance adjustment</div>
              <p className="mt-1 text-xs text-muted-foreground">
                Signed {balanceCurrency} amount. Negative values debit available funds.
              </p>
              <button
                type="button"
                disabled={busy}
                onClick={() => openAction("balance")}
                className="mt-4 w-full rounded-lg bg-primary px-3 py-2 text-xs font-bold text-primary-foreground disabled:opacity-40"
              >
                Adjust balance
              </button>
            </div>
          </div>

          <div className="rounded-xl border border-border p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="text-sm font-bold">Product access</div>
                <p className="mt-1 text-xs text-muted-foreground">
                  Grant or revoke products. “Requested” marks access the user is waiting for.
                </p>
              </div>
              <button
                type="button"
                disabled={busy || detail.profile.onboarding_status !== "approved"}
                onClick={() => openAction("products")}
                className="rounded-lg bg-primary px-3 py-2 text-xs font-bold text-primary-foreground disabled:opacity-40"
              >
                Save product access
              </button>
            </div>
            <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {PRODUCTS.map((product) => (
                <label
                  key={product}
                  className="flex cursor-pointer items-center gap-2 rounded-lg border border-border bg-background/30 px-3 py-2 text-xs"
                >
                  <input
                    type="checkbox"
                    checked={productAccess.includes(product)}
                    disabled={busy || detail.profile.onboarding_status !== "approved"}
                    onChange={(event) =>
                      setProductAccess((current) =>
                        event.target.checked
                          ? [...current, product]
                          : current.filter((item) => item !== product),
                      )
                    }
                    className="accent-primary"
                  />
                  <span className="capitalize">{product.replaceAll("_", " ")}</span>
                  {operations.profile.pending_products.includes(product) && (
                    <span className="ml-auto rounded bg-primary/10 px-1.5 py-0.5 text-[9px] font-bold uppercase text-primary">
                      Requested
                    </span>
                  )}
                </label>
              ))}
            </div>
          </div>
        </div>
      )}

      {tab === "orders" && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-xs">
            <thead>
              <tr className="border-b border-border text-left uppercase tracking-wider text-muted-foreground">
                <th className="px-4 py-3">Created</th>
                <th className="px-4 py-3">Instrument</th>
                <th className="px-4 py-3">Side</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3 text-right">Quantity</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {operations.orders.map((order) => (
                <tr key={order.id} className="border-b border-border/70 last:border-0">
                  <td className="px-4 py-3 font-mono text-muted-foreground">
                    {stamp(order.created_at)}
                  </td>
                  <td className="px-4 py-3 font-semibold">
                    {order.symbol}
                    <span className="ml-2 text-muted-foreground">{order.asset_class}</span>
                  </td>
                  <td
                    className={`px-4 py-3 font-bold uppercase ${order.side === "buy" ? "text-up" : "text-down"}`}
                  >
                    {order.side}
                  </td>
                  <td className="px-4 py-3">
                    {order.type} · {order.time_in_force}
                  </td>
                  <td className="px-4 py-3 text-right font-mono">{order.quantity}</td>
                  <td className="px-4 py-3 capitalize">{order.status}</td>
                  <td className="px-4 py-3 text-right">
                    {order.status === "open" && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => setCancelOrder({ id: order.id, symbol: order.symbol })}
                        className="rounded border border-destructive/30 px-2 py-1 font-semibold text-destructive"
                      >
                        Cancel
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {operations.orders.length === 0 && (
            <p className="p-8 text-center text-muted-foreground">No orders.</p>
          )}
        </div>
      )}

      {tab === "positions" && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-xs">
            <thead>
              <tr className="border-b border-border text-left uppercase tracking-wider text-muted-foreground">
                <th className="px-4 py-3">Instrument</th>
                <th className="px-4 py-3">Direction</th>
                <th className="px-4 py-3 text-right">Quantity</th>
                <th className="px-4 py-3 text-right">Average</th>
                <th className="px-4 py-3 text-right">Margin</th>
                <th className="px-4 py-3 text-right">Realized P&amp;L</th>
              </tr>
            </thead>
            <tbody>
              {operations.positions.map((position, index) => (
                <tr
                  key={`${position.asset_class}:${position.symbol}:${position.position_side ?? index}`}
                  className="border-b border-border/70 last:border-0"
                >
                  <td className="px-4 py-3 font-semibold">
                    {position.symbol}
                    <span className="ml-2 text-muted-foreground">{position.asset_class}</span>
                  </td>
                  <td
                    className={`px-4 py-3 font-bold uppercase ${position.direction === "short" ? "text-down" : "text-up"}`}
                  >
                    {position.position_side ?? position.direction}
                  </td>
                  <td className="px-4 py-3 text-right font-mono">{position.quantity}</td>
                  <td className="px-4 py-3 text-right font-mono">
                    {position.average_price ?? "—"} {position.currency}
                  </td>
                  <td className="px-4 py-3 text-right font-mono">
                    {position.margin_used} {position.account_currency}
                  </td>
                  <td
                    className={`px-4 py-3 text-right font-mono font-bold ${num(position.realized_pnl) >= 0 ? "text-up" : "text-down"}`}
                  >
                    {position.realized_pnl} {position.account_currency}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {operations.positions.length === 0 && (
            <p className="p-8 text-center text-muted-foreground">No position history.</p>
          )}
        </div>
      )}

      {tab === "trades" && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] text-xs">
            <thead>
              <tr className="border-b border-border text-left uppercase tracking-wider text-muted-foreground">
                <th className="px-4 py-3">Time</th>
                <th className="px-4 py-3">Instrument</th>
                <th className="px-4 py-3">Side</th>
                <th className="px-4 py-3 text-right">Quantity</th>
                <th className="px-4 py-3 text-right">Price</th>
                <th className="px-4 py-3 text-right">Notional</th>
                <th className="px-4 py-3 text-right">Fee</th>
                <th className="px-4 py-3 text-right">Realized P&amp;L</th>
              </tr>
            </thead>
            <tbody>
              {operations.trades.map((trade) => (
                <tr key={trade.id} className="border-b border-border/70 last:border-0">
                  <td className="px-4 py-3 font-mono text-muted-foreground">{stamp(trade.at)}</td>
                  <td className="px-4 py-3 font-semibold">
                    {trade.symbol}
                    <span className="ml-2 text-muted-foreground">{trade.asset_class}</span>
                  </td>
                  <td
                    className={`px-4 py-3 font-bold uppercase ${trade.side === "buy" ? "text-up" : "text-down"}`}
                  >
                    {trade.side}
                    {trade.liquidation ? " · liquidation" : ""}
                  </td>
                  <td className="px-4 py-3 text-right font-mono">{trade.quantity}</td>
                  <td className="px-4 py-3 text-right font-mono">
                    {trade.price} {trade.currency}
                  </td>
                  <td className="px-4 py-3 text-right font-mono">
                    {trade.notional} {trade.account_currency}
                  </td>
                  <td className="px-4 py-3 text-right font-mono">{trade.fee}</td>
                  <td
                    className={`px-4 py-3 text-right font-mono font-bold ${num(trade.realized_pnl ?? "0") >= 0 ? "text-up" : "text-down"}`}
                  >
                    {trade.realized_pnl ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {operations.trades.length === 0 && (
            <p className="p-8 text-center text-muted-foreground">No trade fills.</p>
          )}
        </div>
      )}

      {tab === "ledger" && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-xs">
            <thead>
              <tr className="border-b border-border text-left uppercase tracking-wider text-muted-foreground">
                <th className="px-4 py-3">Time</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Reference</th>
                <th className="px-4 py-3 text-right">Movement</th>
                <th className="px-4 py-3 text-right">Balance after</th>
              </tr>
            </thead>
            <tbody>
              {operations.ledger.map((entry) => (
                <tr key={entry.id} className="border-b border-border/70 last:border-0">
                  <td className="px-4 py-3 font-mono text-muted-foreground">{stamp(entry.at)}</td>
                  <td className="px-4 py-3 capitalize">{entry.kind.replaceAll("_", " ")}</td>
                  <td className="max-w-sm truncate px-4 py-3 text-muted-foreground">
                    {entry.reference ?? entry.order_id ?? "—"}
                  </td>
                  <td
                    className={`px-4 py-3 text-right font-mono font-bold ${num(entry.amount) >= 0 ? "text-up" : "text-down"}`}
                  >
                    {num(entry.amount) > 0 ? "+" : ""}
                    {entry.amount} {entry.currency}
                  </td>
                  <td className="px-4 py-3 text-right font-mono">
                    {entry.available_after} / {entry.reserved_after}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === "logins" && (
        <div>
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-background/20 p-4">
            <div>
              <div className="text-sm font-bold">Session security</div>
              <p className="mt-1 text-xs text-muted-foreground">
                Revoke every Firebase refresh token for this user. Existing ID tokens expire
                shortly.
              </p>
            </div>
            <button
              type="button"
              disabled={busy}
              onClick={() => openAction("sessions")}
              className="rounded-lg border border-destructive/30 px-3 py-2 text-xs font-bold text-destructive disabled:opacity-40"
            >
              Revoke all sessions
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-xs">
              <thead>
                <tr className="border-b border-border text-left uppercase tracking-wider text-muted-foreground">
                  <th className="px-4 py-3">Time</th>
                  <th className="px-4 py-3">Provider</th>
                  <th className="px-4 py-3">IP address</th>
                  <th className="px-4 py-3">Device</th>
                </tr>
              </thead>
              <tbody>
                {operations.logins.map((login, index) => (
                  <tr
                    key={`${login.at}:${index}`}
                    className="border-b border-border/70 last:border-0"
                  >
                    <td className="px-4 py-3 font-mono text-muted-foreground">{stamp(login.at)}</td>
                    <td className="px-4 py-3">{login.provider ?? "unknown"}</td>
                    <td className="px-4 py-3 font-mono">{login.ip ?? "—"}</td>
                    <td
                      className="max-w-md truncate px-4 py-3 text-muted-foreground"
                      title={login.user_agent ?? undefined}
                    >
                      {login.user_agent ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <Dialog
        open={actionModal !== null}
        onOpenChange={(open) => {
          if (!open && !busy) setActionModal(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {actionModal === "status"
                ? accountStatus === "suspended"
                  ? "Restore account"
                  : "Suspend account"
                : actionModal === "kyc-approve"
                  ? "Approve KYC"
                  : actionModal === "kyc-reject"
                    ? "Reject KYC"
                    : actionModal === "balance"
                      ? "Adjust balance"
                      : actionModal === "products"
                        ? "Update product access"
                        : "Revoke all sessions"}
            </DialogTitle>
            <DialogDescription>
              {actionModal === "status" && accountStatus !== "suspended"
                ? "This blocks trading and funding and cancels every open order."
                : actionModal === "sessions"
                  ? "The user will be signed out from every device. Existing ID tokens expire shortly."
                  : `Apply this change to ${detail.profile.email ?? uid}.`}
            </DialogDescription>
          </DialogHeader>

          {actionModal === "balance" && (
            <label className="space-y-2 text-sm font-medium">
              Signed amount ({balanceCurrency})
              <input
                autoFocus
                value={adjustment}
                onChange={(event) => setAdjustment(event.target.value)}
                inputMode="decimal"
                placeholder="250 to credit, -50 to debit"
                className="w-full rounded-lg border border-border bg-background px-3 py-2 font-mono text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/40"
              />
            </label>
          )}

          {actionModal === "products" && (
            <div className="rounded-lg border border-border bg-secondary/30 p-3 text-xs text-muted-foreground">
              <span className="font-semibold text-foreground">New access: </span>
              {productAccess.length
                ? productAccess.map((product) => product.replaceAll("_", " ")).join(", ")
                : "No trading products"}
            </div>
          )}

          <label className="space-y-2 text-sm font-medium">
            Audit reason
            <textarea
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              maxLength={256}
              placeholder="Explain why this change is necessary"
              className="min-h-24 w-full resize-y rounded-lg border border-border bg-background px-3 py-2 text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/40"
            />
            <span className="block text-right text-[10px] font-normal text-muted-foreground">
              {reason.trim().length}/256 · minimum 3 characters
            </span>
          </label>

          {error && (
            <p className="rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {error}
            </p>
          )}

          <DialogFooter>
            <DialogClose asChild>
              <button
                type="button"
                disabled={busy}
                className="rounded-lg border border-border px-4 py-2 text-sm font-semibold"
              >
                Cancel
              </button>
            </DialogClose>
            <button
              type="button"
              onClick={() => void submitAction()}
              disabled={
                busy ||
                reason.trim().length < 3 ||
                (actionModal === "balance" &&
                  (!Number.isFinite(Number(adjustment)) || Number(adjustment) === 0))
              }
              className={`rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 ${
                (actionModal === "status" && accountStatus !== "suspended") ||
                actionModal === "kyc-reject" ||
                actionModal === "sessions"
                  ? "bg-destructive"
                  : "bg-primary"
              }`}
            >
              {busy ? "Applying…" : "Confirm change"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={cancelOrder !== null}
        onOpenChange={(open) => {
          if (!open && !busy) setCancelOrder(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancel open order</DialogTitle>
            <DialogDescription>
              Cancel {cancelOrder?.symbol} order {cancelOrder?.id}? Reserved funds will be released.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <button
                type="button"
                disabled={busy}
                className="rounded-lg border border-border px-4 py-2 text-sm font-semibold"
              >
                Keep order
              </button>
            </DialogClose>
            <button
              type="button"
              disabled={busy || !cancelOrder}
              onClick={() => {
                if (!cancelOrder) return;
                void run(
                  (token) => adminCancelUserOrder(uid, cancelOrder.id, token),
                  "Open order cancelled and reservations released.",
                  false,
                );
              }}
              className="rounded-lg bg-destructive px-4 py-2 text-sm font-semibold text-destructive-foreground disabled:opacity-50"
            >
              {busy ? "Cancelling…" : "Cancel order"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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
            <th className="px-1 sm:px-2 pb-2 sm:pb-3 font-medium">Reference</th>
            <th className="px-1 sm:px-2 pb-2 sm:pb-3 text-right font-medium">Amount</th>
            <th className="px-1 sm:px-2 pb-2 sm:pb-3 text-right font-medium">Status</th>
            <th className="px-1 sm:px-2 pb-2 sm:pb-3 text-right font-medium">Action</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <RequestRow
              key={r.id}
              row={r}
              showDestination={showDestination}
              onDecided={onDecided}
            />
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
  const [decision, setDecision] = useState<"approve" | "decline" | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [rowError, setRowError] = useState("");

  const approve = async () => {
    if (row.kind === "withdrawal" && note.trim().length < 4) {
      setRowError("Enter the payout transaction reference before approving a withdrawal.");
      return;
    }
    setBusy(true);
    setRowError("");
    try {
      const token = await currentIdToken();
      await adminApproveFundingRequest(row.id, note.trim() ? { note: note.trim() } : {}, token);
      setDecision(null);
      onDecided();
    } catch (err) {
      setRowError(err instanceof ApiError ? err.message : "Could not approve this request.");
      setBusy(false);
    }
  };

  const decline = async () => {
    if (note.trim().length < 3) {
      setRowError("Enter a reason before declining this funding request.");
      return;
    }
    setBusy(true);
    setRowError("");
    try {
      const token = await currentIdToken();
      await adminDeclineFundingRequest(row.id, note.trim() ? { note: note.trim() } : {}, token);
      setDecision(null);
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
          {row.destination ?? row.deposit_address ?? "—"}
        </td>
      )}
      <td
        className="max-w-48 truncate px-1 py-2.5 font-mono text-xs text-muted-foreground sm:px-2 sm:py-4"
        title={row.reference ?? undefined}
      >
        {row.reference ?? "—"}
      </td>
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
          {row.status === "pending"
            ? "Pending"
            : row.status === "cancelled"
              ? "Cancelled"
              : "Completed"}
        </span>
      </td>
      <td className="px-1 sm:px-2 py-2.5 sm:py-4 text-right">
        {row.status === "pending" && (
          <div className="flex justify-end gap-1.5">
            <button
              type="button"
              onClick={() => {
                setNote("");
                setRowError("");
                setDecision("decline");
              }}
              className="rounded-md border border-border px-2.5 py-1.5 text-[11px] font-semibold hover:border-destructive/40 hover:text-destructive"
            >
              Decline
            </button>
            <button
              type="button"
              onClick={() => {
                setNote("");
                setRowError("");
                setDecision("approve");
              }}
              className="rounded-md bg-primary px-2.5 py-1.5 text-[11px] font-semibold text-primary-foreground"
            >
              Review
            </button>
          </div>
        )}
        <Dialog
          open={decision !== null}
          onOpenChange={(open) => {
            if (!open && !busy) setDecision(null);
          }}
        >
          <DialogContent className="text-left">
            <DialogHeader>
              <DialogTitle>
                {decision === "decline" ? "Decline" : "Approve"} {row.kind}
              </DialogTitle>
              <DialogDescription>
                {row.email ?? row.uid} · {row.amount} {row.currency} on {row.network}
              </DialogDescription>
            </DialogHeader>

            <div className="grid grid-cols-2 gap-3 rounded-lg border border-border bg-secondary/20 p-3 text-xs">
              <div>
                <div className="text-muted-foreground">Reference</div>
                <div className="mt-1 break-all font-mono">{row.reference ?? "—"}</div>
              </div>
              <div>
                <div className="text-muted-foreground">Destination</div>
                <div className="mt-1 break-all font-mono">
                  {row.destination ?? row.deposit_address ?? "—"}
                </div>
              </div>
            </div>

            <label className="space-y-2 text-sm font-medium">
              {decision === "decline"
                ? "Reason shown to the user"
                : row.kind === "withdrawal"
                  ? "Payout transaction reference"
                  : "Review note (optional)"}
              <textarea
                autoFocus
                value={note}
                onChange={(event) => setNote(event.target.value)}
                disabled={busy}
                placeholder={
                  decision === "decline"
                    ? "Why is this request being declined?"
                    : row.kind === "withdrawal"
                      ? "Enter the completed payout transaction ID"
                      : "Add an internal review note"
                }
                className="min-h-24 w-full resize-y rounded-lg border border-border bg-background px-3 py-2 text-foreground"
              />
            </label>
            {rowError && (
              <p className="rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">
                {rowError}
              </p>
            )}
            <DialogFooter>
              <DialogClose asChild>
                <button
                  type="button"
                  disabled={busy}
                  className="rounded-lg border border-border px-4 py-2 text-sm font-semibold"
                >
                  Cancel
                </button>
              </DialogClose>
              <button
                type="button"
                onClick={() => void (decision === "decline" ? decline() : approve())}
                disabled={
                  busy ||
                  (decision === "decline" && note.trim().length < 3) ||
                  (decision === "approve" && row.kind === "withdrawal" && note.trim().length < 4)
                }
                className={`rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 ${decision === "decline" ? "bg-destructive" : "bg-primary"}`}
              >
                {busy
                  ? "Applying…"
                  : decision === "decline"
                    ? "Confirm decline"
                    : "Confirm approval"}
              </button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </td>
    </tr>
  );
}
