import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { useAuth } from "@/components/AuthProvider";
import { useTrading } from "@/hooks/useTrading";
import { useFundingRequests } from "@/hooks/useFundingRequests";
import { ApiError } from "@/lib/api";
import { currentIdToken } from "@/lib/firebase";
import {
  requestWithdrawalFunding,
  newIdempotencyKey,
  type FundingNetwork,
} from "@/lib/funding-api";
import { amount as parseAmount, type SettlementCurrency } from "@/lib/trading-api";

type DepositMethod = SettlementCurrency;

export const Route = createFileRoute("/withdraw")({
  head: () => ({
    meta: [
      { title: "Withdraw — Stocks360" },
      { name: "description", content: "Withdraw USDT from your Stocks360 account." },
    ],
  }),
  component: WithdrawPage,
});

type AssetOption = {
  code: DepositMethod;
  name: string;
  symbol: string;
  color: string;
};

type NetworkOption = {
  code: FundingNetwork;
  name: string;
  destinationLabel: string;
  destinationPlaceholder: string;
  minimum: string;
  arrival: string;
  fee: string;
};

/** Withdrawal rails — USDT is the only asset the platform pays out. */
const ASSET_OPTIONS: AssetOption[] = [
  { code: "USDT", name: "TetherUS", symbol: "", color: "#26a17b" },
];

/** The 6 USDT networks most traders actually use for withdrawals. */
const NETWORK_OPTIONS: NetworkOption[] = [
  {
    code: "TRC20",
    name: "Tron (TRC20)",
    destinationLabel: "Wallet Address (TRC20)",
    destinationPlaceholder: "T…",
    minimum: "No additional platform minimum",
    arrival: "After manual administrator review",
    fee: "No platform fee recorded",
  },
  {
    code: "BEP20",
    name: "BNB Smart Chain (BEP20)",
    destinationLabel: "Wallet Address (BEP20)",
    destinationPlaceholder: "0x…",
    minimum: "No additional platform minimum",
    arrival: "After manual administrator review",
    fee: "No platform fee recorded",
  },
  {
    code: "ERC20",
    name: "Ethereum (ERC20)",
    destinationLabel: "Wallet Address (ERC20)",
    destinationPlaceholder: "0x…",
    minimum: "No additional platform minimum",
    arrival: "After manual administrator review",
    fee: "No platform fee recorded",
  },
  {
    code: "SOL",
    name: "Solana",
    destinationLabel: "Wallet Address (Solana)",
    destinationPlaceholder: "Base58 address…",
    minimum: "No additional platform minimum",
    arrival: "After manual administrator review",
    fee: "No platform fee recorded",
  },
  {
    // The backend's rail enum names this chain POLYGON, not the ticker MATIC — sending
    // the wrong string here would 422 on every Polygon withdrawal.
    code: "POLYGON",
    name: "Polygon",
    destinationLabel: "Wallet Address (Polygon)",
    destinationPlaceholder: "0x…",
    minimum: "No additional platform minimum",
    arrival: "After manual administrator review",
    fee: "No platform fee recorded",
  },
  {
    code: "ARBITRUM",
    name: "Arbitrum One",
    destinationLabel: "Wallet Address (Arbitrum)",
    destinationPlaceholder: "0x…",
    minimum: "No additional platform minimum",
    arrival: "After manual administrator review",
    fee: "No platform fee recorded",
  },
];

const FAQS = [
  {
    q: "How does a withdrawal actually work?",
    a: "Requesting a withdrawal locks that amount immediately. An administrator manually reviews the destination and payout; marking it completed records the debit. Cancelling or declining releases the lock.",
  },
  {
    q: "Why can't I withdraw my full balance?",
    a: "The amount available to withdraw is your balance minus anything already locked in a pending withdrawal. Once a pending request settles or is cancelled, that amount becomes available again.",
  },
  {
    q: "Deposit & Withdrawal status query",
    a: "Every withdrawal is listed below with its status — pending, completed, or cancelled. Pending ones can still be settled or cancelled from here or from your wallet.",
  },
  {
    q: "Is there a minimum or a fee?",
    a: "Stocks360 currently records no separate platform withdrawal fee. Any external network cost is handled during the administrator-reviewed payout.",
  },
];

function fmt(n: number) {
  return n.toLocaleString("en-US", { maximumFractionDigits: 4 });
}
function stamp(iso: string) {
  const d = new Date(iso);
  const p = (v: number) => String(v).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** Diamond marker for a completed step, numbered circle for the one in progress. */
function StepMarker({ done, n }: { done: boolean; n: number }) {
  return (
    <span
      className={`flex h-5 w-5 items-center justify-center rounded-full border-2 text-[10px] font-bold ${done ? "border-primary text-primary" : "border-foreground/70 text-foreground/70"}`}
    >
      {n}
    </span>
  );
}

function Dropdown<T>({
  items,
  selected,
  onSelect,
  render,
  label,
}: {
  items: T[];
  selected: T;
  onSelect: (item: T) => void;
  render: (item: T) => React.ReactNode;
  label: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={label}
        aria-expanded={open}
        aria-haspopup="listbox"
        className="flex w-full items-center justify-between gap-3 rounded sm:rounded-xl border border-border bg-card px-4 py-3.5 text-left transition-colors hover:border-foreground/25"
      >
        {render(selected)}
        <i
          className={`fa-solid fa-chevron-down text-xs text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && (
        <ul
          role="listbox"
          className="absolute left-0 right-0 top-[calc(100%+0.35rem)] z-20 overflow-hidden rounded sm:rounded-xl border border-border bg-card p-1 shadow-xl"
        >
          {items.map((item, i) => (
            <li key={i}>
              <button
                type="button"
                role="option"
                aria-selected={item === selected}
                onClick={() => {
                  onSelect(item);
                  setOpen(false);
                }}
                className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors ${
                  item === selected ? "bg-secondary" : "hover:bg-secondary/60"
                }`}
              >
                {render(item)}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Step({
  n,
  done,
  title,
  last,
  children,
}: {
  n: number;
  done: boolean;
  title: string;
  last?: boolean;
  children: React.ReactNode;
}) {
  return (
    <li className="relative pl-10">
      <span className="absolute left-0 top-0.5">
        <StepMarker done={done} n={n} />
      </span>
      {!last && <span className="absolute left-[9px] top-7 bottom-0 w-px bg-border" aria-hidden />}
      <h2 className="text-xl font-bold text-foreground">{title}</h2>
      <div className={last ? "mt-4" : "mt-4 pb-10"}>{children}</div>
    </li>
  );
}

function WithdrawPage() {
  const { isLoggedIn, kycCompleted } = useAuth();
  const trading = useTrading();
  const withdrawals = useFundingRequests("withdrawal");

  const asset = ASSET_OPTIONS[0]!;
  const [network, setNetwork] = useState<NetworkOption>(NETWORK_OPTIONS[0]!);
  const [destination, setDestination] = useState("");
  const [amount, setAmount] = useState("");
  const [stage, setStage] = useState<"idle" | "submitting" | "requested">("idle");
  const [error, setError] = useState("");
  const [openFaq, setOpenFaq] = useState<number | null>(null);

  /**
   * What's actually free to withdraw right now. `Balance.available` already excludes
   * anything reserved — by an open buy order or by an earlier pending withdrawal — so
   * there is no local locked-amount math to redo here.
   */
  const available = trading.availableIn(asset.code);

  const recentWithdrawals = withdrawals.requests.slice(0, 5);

  const value = parseFloat(amount);
  const overBalance = Number.isFinite(value) && value > available;
  const canSubmit =
    Number.isFinite(value) &&
    value > 0 &&
    !overBalance &&
    destination.trim().length > 0 &&
    stage === "idle";

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setStage("submitting");
    setError("");
    try {
      const token = await currentIdToken();
      await requestWithdrawalFunding(
        {
          currency: asset.code,
          amount: String(value),
          network: network.code,
          destination: destination.trim(),
          idempotency_key: newIdempotencyKey(),
        },
        token,
      );
      setStage("requested");
      void withdrawals.refresh();
      void trading.refresh();
    } catch (err) {
      setStage("idle");
      setError(
        err instanceof ApiError
          ? err.message
          : "Could not request this withdrawal. Please try again.",
      );
    }
  };

  if (!isLoggedIn || !kycCompleted) {
    const locked = !isLoggedIn
      ? {
          icon: "fa-lock",
          title: "Sign in required",
          body: "You need to be signed in to withdraw funds from your Stocks360 account.",
          cta: "Go to sign in",
          to: "/login" as const,
          search: undefined,
        }
      : {
          icon: "fa-id-card",
          title: "Account details incomplete",
          body: "Your identity hasn't been verified yet. Complete your account details to unlock withdrawals.",
          cta: "Complete account details",
          to: "/account" as const,
          search: { tab: "account" as const },
        };
    return (
      <AppLayout>
        <section className="mx-auto max-w-lg px-6 py-20 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
            <i className={`fa-solid ${locked.icon} text-lg`} />
          </div>
          <h1 className="mt-4 text-xl font-bold text-foreground">{locked.title}</h1>
          <p className="mt-2 text-sm text-muted-foreground">{locked.body}</p>
          <Link
            to={locked.to}
            {...(locked.search ? { search: locked.search } : {})}
            className="mt-6 inline-block rounded sm:rounded-xl bg-primary px-5 py-2.5 text-sm font-bold uppercase tracking-wider text-primary-foreground transition-opacity hover:opacity-90"
          >
            {locked.cta}
          </Link>
        </section>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <section className="mx-auto max-w-6xl px-6 py-10">
        <div className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_300px]">
          {/* ── Stepper ── */}
          <ol className="min-w-0">
            <Step n={1} done title="Asset">
              <div className="max-w-lg">
                <div className="flex w-full items-center gap-3 rounded sm:rounded-xl border border-border bg-card px-4 py-3.5">
                  <span
                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full font-mono text-[8px] font-bold"
                    style={{ backgroundColor: `${asset.color}25`, color: asset.color }}
                  >
                    {asset.code.slice(0, 3)}
                  </span>
                  <span className="truncate font-semibold text-foreground">{asset.code}</span>
                  <span className="truncate text-sm text-muted-foreground">{asset.name}</span>
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  USDT is the only asset Stocks360 pays out withdrawals in.
                </p>

                <div className="mt-4 flex items-center justify-between rounded sm:rounded-xl border border-border bg-card px-4 py-3">
                  <span className="text-sm text-muted-foreground">Available to withdraw</span>
                  <span className="font-mono text-sm font-semibold text-foreground">
                    {fmt(available)} USDT
                  </span>
                </div>
              </div>
            </Step>

            <Step n={2} done title="Withdrawal Network">
              <div className="max-w-lg">
                <Dropdown
                  label="Select network"
                  items={NETWORK_OPTIONS}
                  selected={network}
                  onSelect={(n) => setNetwork(n)}
                  render={(n) => (
                    <span className="flex min-w-0 items-center gap-3">
                      <span className="shrink-0 font-semibold text-foreground">{n.code}</span>
                      <span className="truncate text-sm text-muted-foreground">{n.name}</span>
                    </span>
                  )}
                />

                <label className="mt-4 block text-sm font-medium text-foreground">
                  {network.destinationLabel}
                  <input
                    value={destination}
                    onChange={(e) => setDestination(e.target.value)}
                    placeholder={network.destinationPlaceholder}
                    className="mt-2 w-full rounded sm:rounded-xl border border-border bg-background/60 px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/40"
                  />
                </label>
              </div>
            </Step>

            <Step n={3} done={false} last title="Amount">
              <div className="max-w-lg">
                <div className="rounded sm:rounded-xl border border-border bg-card p-4">
                  {stage === "requested" ? (
                    <div className="text-center">
                      <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-primary/10 text-primary">
                        <i className="fa-solid fa-clock" />
                      </div>
                      <p className="mt-3 text-sm font-semibold text-foreground">
                        Withdrawal requested
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {fmt(value)} {asset.code} is now locked and pending. An admin will review it
                        and send it to {destination}.
                      </p>
                      <button
                        type="button"
                        onClick={() => {
                          setAmount("");
                          setDestination("");
                          setStage("idle");
                        }}
                        className="mt-4 rounded-lg border border-border px-4 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-secondary"
                      >
                        Make another withdrawal
                      </button>
                    </div>
                  ) : (
                    <>
                      <label className="block text-sm font-medium text-foreground">
                        Amount ({asset.code})
                        <div className="relative mt-2">
                          <input
                            value={amount}
                            onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
                            placeholder="e.g. 100"
                            inputMode="decimal"
                            className="w-full rounded sm:rounded-xl border border-border bg-background/60 px-3 py-2.5 pr-16 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/40"
                          />
                          <button
                            type="button"
                            onClick={() => setAmount(available > 0 ? String(available) : "")}
                            className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md px-2 py-1 text-xs font-bold text-primary hover:bg-primary/10"
                          >
                            MAX
                          </button>
                        </div>
                      </label>
                      {overBalance && (
                        <p className="mt-2 text-xs text-destructive">
                          That's more than the {fmt(available)} {asset.code} you have available.
                        </p>
                      )}

                      <div className="mt-4 flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">Minimum withdrawal</span>
                        <span className="font-semibold text-foreground">{network.minimum}</span>
                      </div>
                      <div className="mt-2 flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">Network fee</span>
                        <span className="font-semibold text-foreground">{network.fee}</span>
                      </div>
                      <div className="mt-2 flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">Expected settlement</span>
                        <span className="font-semibold text-foreground">{network.arrival}</span>
                      </div>

                      {error && (
                        <p className="mt-3 text-xs text-destructive" role="alert">
                          {error}
                        </p>
                      )}
                      <button
                        type="button"
                        onClick={() => void handleSubmit()}
                        disabled={!canSubmit}
                        className="mt-4 flex w-full items-center justify-center gap-2 rounded sm:rounded-xl bg-primary px-4 py-3 text-sm font-bold uppercase tracking-wider text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
                      >
                        {stage === "submitting" ? "Requesting…" : "Request withdrawal"}
                      </button>
                      <p className="mt-3 text-center text-[11px] text-muted-foreground/70">
                        This locks the amount immediately. It's debited from your balance only once
                        settled.
                      </p>
                    </>
                  )}
                </div>
              </div>
            </Step>
          </ol>

          {/* ── FAQ ── */}
          <aside>
            <h2 className="text-xl font-bold text-foreground">FAQ</h2>
            <ul className="mt-5 space-y-1">
              {FAQS.map((f, i) => (
                <li key={f.q} className="border-b border-border/60 last:border-b-0">
                  <button
                    type="button"
                    onClick={() => setOpenFaq((v) => (v === i ? null : i))}
                    aria-expanded={openFaq === i}
                    className="flex w-full items-start justify-between gap-3 py-3 text-left text-sm text-foreground transition-colors hover:text-primary"
                  >
                    <span>{f.q}</span>
                    <i
                      className={`fa-solid fa-chevron-down mt-1 shrink-0 text-[10px] text-muted-foreground transition-transform ${openFaq === i ? "rotate-180" : ""}`}
                    />
                  </button>
                  {openFaq === i && (
                    <p className="pb-4 text-xs leading-5 text-muted-foreground">{f.a}</p>
                  )}
                </li>
              ))}
            </ul>
          </aside>
        </div>

        {/* ── Recent withdrawals ── */}
        <div className="mt-14 border-t border-border pt-8">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-bold text-foreground">Recent Withdrawals</h2>
            <Link
              to="/wallet"
              className="flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              More <i className="fa-solid fa-chevron-right text-[10px]" />
            </Link>
          </div>

          {recentWithdrawals.length === 0 ? (
            <div className="py-14 text-center">
              <i className="fa-regular fa-folder-open text-3xl text-muted-foreground/40" />
              <p className="mt-3 text-sm text-muted-foreground">No records</p>
            </div>
          ) : (
            <div className="mt-5 overflow-x-auto">
              <table className="w-full min-w-[620px] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs text-muted-foreground">
                    <th className="px-1 sm:px-2 pb-2 sm:pb-3 font-medium">Date</th>
                    <th className="px-1 sm:px-2 pb-2 sm:pb-3 font-medium">Asset</th>
                    <th className="px-1 sm:px-2 pb-2 sm:pb-3 font-medium">Network</th>
                    <th className="px-1 sm:px-2 pb-2 sm:pb-3 text-right font-medium">Amount</th>
                    <th className="px-1 sm:px-2 pb-2 sm:pb-3 text-right font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {recentWithdrawals.map((t) => {
                    const status = t.status;
                    const tone =
                      status === "cancelled"
                        ? "text-muted-foreground"
                        : status === "pending"
                          ? "text-primary"
                          : "text-down";
                    return (
                      <tr key={t.id} className="border-b border-border last:border-b-0">
                        <td className="px-1 sm:px-2 py-2.5 sm:py-4 font-mono text-xs text-muted-foreground">
                          {stamp(t.created_at)}
                        </td>
                        <td className="px-1 sm:px-2 py-2.5 sm:py-4 font-medium text-foreground">
                          {t.currency}
                        </td>
                        <td className="px-1 sm:px-2 py-2.5 sm:py-4 text-muted-foreground">
                          {t.network}
                        </td>
                        <td
                          className={`px-1 sm:px-2 py-2.5 sm:py-4 text-right font-mono font-semibold ${tone}`}
                        >
                          −{fmt(parseAmount(t.amount) ?? 0)}
                        </td>
                        <td className="px-1 sm:px-2 py-2.5 sm:py-4 text-right">
                          <span
                            title={t.resolution_note ?? undefined}
                            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                              status === "cancelled"
                                ? "bg-muted text-muted-foreground"
                                : status === "pending"
                                  ? "bg-primary/10 text-primary"
                                  : "bg-down/10 text-down"
                            }`}
                          >
                            <span className="h-1.5 w-1.5 rounded-full bg-current" />
                            {status === "pending"
                              ? "Pending"
                              : status === "cancelled"
                                ? "Cancelled"
                                : "Completed"}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>
    </AppLayout>
  );
}
