import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import {
  useAuth,
  txKind,
  txStatus,
  lockedAmount,
  NETWORK_OF,
  type DepositMethod,
} from "@/components/AuthProvider";
import { ConvertWidget } from "@/components/ui/convert-widget";

export const Route = createFileRoute("/withdraw")({
  head: () => ({
    meta: [
      { title: "Withdraw — Stocks360" },
      { name: "description", content: "Withdraw INR or USDT from your Stocks360 account." },
    ],
  }),
  component: WithdrawPage,
});

type AssetOption = {
  code: DepositMethod;
  name: string;
  symbol: string;
  color: string;
  network: string;
  destinationLabel: string;
  destinationPlaceholder: string;
  minimum: string;
  arrival: string;
  fee: string;
};

/**
 * Withdrawal rails per currency. Same two assets as deposit, each settling
 * out over its one destination type — a bank/UPI handle for rupees, a chain
 * address for USDT.
 */
const ASSET_OPTIONS: AssetOption[] = [
  {
    code: "INR",
    name: "Indian Rupee",
    symbol: "₹",
    color: "#f59e0b",
    network: NETWORK_OF.INR,
    destinationLabel: "UPI ID",
    destinationPlaceholder: "yourname@upi",
    minimum: "More than ₹100",
    arrival: "Usually settles within 24 hours",
    fee: "₹0",
  },
  {
    code: "USDT",
    name: "TetherUS",
    symbol: "",
    color: "#26a17b",
    network: NETWORK_OF.USDT,
    destinationLabel: "Wallet Address (BEP20)",
    destinationPlaceholder: "0x…",
    minimum: "More than 1 USDT",
    arrival: "About 15 network confirmations after settlement",
    fee: "1 USDT",
  },
];

const FAQS = [
  {
    q: "How does a withdrawal actually work?",
    a: "Requesting a withdrawal locks that amount immediately — it stays in your balance but can't be withdrawn again or spent until the request is settled or cancelled. Settling debits your balance and sends funds to the destination; cancelling releases the lock and changes nothing.",
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
    a: "Each asset has its own minimum and network fee, shown once you pick it above. The fee is deducted from your balance, not added on top of the amount you enter.",
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
        className="flex w-full items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3.5 text-left transition-colors hover:border-foreground/25"
      >
        {render(selected)}
        <i className={`fa-solid fa-chevron-down text-xs text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <ul
          role="listbox"
          className="absolute left-0 right-0 top-[calc(100%+0.35rem)] z-20 overflow-hidden rounded-xl border border-border bg-card p-1 shadow-xl"
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

/** Diamond marker for a completed step, numbered circle for the one in progress. */
function StepMarker({ done, n }: { done: boolean; n: number }) {
  if (done) {
    return (
      <span className="flex h-5 w-5 rotate-45 items-center justify-center rounded-[3px] border-2 border-foreground/70">
        <i className="fa-solid fa-check -rotate-45 text-[9px] text-foreground/70" />
      </span>
    );
  }
  return (
    <span className="flex h-5 w-5 items-center justify-center rounded-full border-2 border-foreground/70 text-[10px] font-bold text-foreground/70">
      {n}
    </span>
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
  const { isLoggedIn, kycCompleted, balances, transactions, requestWithdrawal } = useAuth();

  const [asset, setAsset] = useState<AssetOption>(ASSET_OPTIONS[0]!);
  const [destination, setDestination] = useState("");
  const [amount, setAmount] = useState("");
  const [stage, setStage] = useState<"idle" | "requested">("idle");
  const [openFaq, setOpenFaq] = useState<number | null>(null);
  const [showConvert, setShowConvert] = useState(false);

  /**
   * What's actually free to withdraw right now — the raw balance minus
   * whatever's already locked in a pending withdrawal request.
   */
  const available = balances[asset.code] - lockedAmount(transactions, asset.code);

  const recentWithdrawals = useMemo(
    () => transactions.filter((t) => txKind(t) === "withdraw").slice(0, 5),
    [transactions],
  );

  const selectAsset = (next: AssetOption) => {
    setAsset(next);
    setDestination("");
    setAmount("");
    setStage("idle");
  };

  const value = parseFloat(amount);
  const overBalance = Number.isFinite(value) && value > available;
  const canSubmit =
    Number.isFinite(value) && value > 0 && !overBalance && destination.trim().length > 0 && stage === "idle";

  const handleSubmit = () => {
    if (!canSubmit) return;
    requestWithdrawal(asset.code, value, destination.trim());
    setStage("requested");
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
            className="mt-6 inline-block rounded-xl bg-primary px-5 py-2.5 text-sm font-bold uppercase tracking-wider text-primary-foreground transition-opacity hover:opacity-90"
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
            <li className="relative pl-10 pb-10">
              <button
                type="button"
                onClick={() => setShowConvert((v) => !v)}
                className="flex items-center gap-2 text-sm font-semibold text-primary transition-opacity hover:opacity-80"
              >
                <i className="fa-solid fa-arrow-down-up-across-line text-xs" />
                Holding the wrong currency? Convert to INR or USDT first
                <i className={`fa-solid fa-chevron-down text-[10px] transition-transform ${showConvert ? "rotate-180" : ""}`} />
              </button>
              {showConvert && (
                <div className="mt-4 max-w-lg">
                  <ConvertWidget />
                </div>
              )}
            </li>

            <Step n={1} done title="Select Asset">
              <div className="max-w-lg">
                <Dropdown
                  label="Select asset"
                  items={ASSET_OPTIONS}
                  selected={asset}
                  onSelect={selectAsset}
                  render={(a) => (
                    <span className="flex min-w-0 items-center gap-3">
                      <span
                        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full font-mono text-[8px] font-bold"
                        style={{ backgroundColor: `${a.color}25`, color: a.color }}
                      >
                        {a.code.slice(0, 3)}
                      </span>
                      <span className="truncate font-semibold text-foreground">{a.code}</span>
                      <span className="truncate text-sm text-muted-foreground">{a.name}</span>
                    </span>
                  )}
                />

                <div className="mt-4 flex items-center justify-between rounded-xl border border-border bg-card px-4 py-3">
                  <span className="text-sm text-muted-foreground">Available to withdraw</span>
                  <span className="font-mono text-sm font-semibold text-foreground">
                    {asset.symbol}
                    {fmt(available)} {asset.code === "USDT" ? "USDT" : ""}
                  </span>
                </div>
              </div>
            </Step>

            <Step n={2} done title="Withdrawal Network">
              <div className="max-w-lg">
                <div className="flex w-full items-center gap-3 rounded-xl border border-border bg-card px-4 py-3.5">
                  <span className="font-semibold text-foreground">{asset.network}</span>
                  <span className="truncate text-sm text-muted-foreground">
                    {asset.code === "INR" ? "Unified Payments Interface" : "BNB Smart Chain (BEP20)"}
                  </span>
                </div>

                <label className="mt-4 block text-sm font-medium text-foreground">
                  {asset.destinationLabel}
                  <input
                    value={destination}
                    onChange={(e) => setDestination(e.target.value)}
                    placeholder={asset.destinationPlaceholder}
                    className="mt-2 w-full rounded-xl border border-border bg-background/60 px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/40"
                  />
                </label>
              </div>
            </Step>

            <Step n={3} done={false} last title="Amount">
              <div className="max-w-lg">
                <div className="rounded-xl border border-border bg-card p-4">
                  {stage === "requested" ? (
                    <div className="text-center">
                      <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-primary/10 text-primary">
                        <i className="fa-solid fa-clock" />
                      </div>
                      <p className="mt-3 text-sm font-semibold text-foreground">Withdrawal requested</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {fmt(value)} {asset.code} is now locked and pending. An admin will review it and send it
                        to {destination}.
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
                            placeholder={asset.code === "INR" ? "e.g. 5000" : "e.g. 100"}
                            inputMode="decimal"
                            className="w-full rounded-xl border border-border bg-background/60 px-3 py-2.5 pr-16 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/40"
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
                        <span className="font-semibold text-foreground">{asset.minimum}</span>
                      </div>
                      <div className="mt-2 flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">Network fee</span>
                        <span className="font-semibold text-foreground">{asset.fee}</span>
                      </div>
                      <div className="mt-2 flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">Expected settlement</span>
                        <span className="font-semibold text-foreground">{asset.arrival}</span>
                      </div>

                      <button
                        type="button"
                        onClick={handleSubmit}
                        disabled={!canSubmit}
                        className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 text-sm font-bold uppercase tracking-wider text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
                      >
                        Request withdrawal
                      </button>
                      <p className="mt-3 text-center text-[11px] text-muted-foreground/70">
                        This locks the amount immediately. It's debited from your balance only once settled.
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
                    <i className={`fa-solid fa-chevron-down mt-1 shrink-0 text-[10px] text-muted-foreground transition-transform ${openFaq === i ? "rotate-180" : ""}`} />
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
                    <th className="px-2 pb-3 font-medium">Date</th>
                    <th className="px-2 pb-3 font-medium">Asset</th>
                    <th className="px-2 pb-3 font-medium">Network</th>
                    <th className="px-2 pb-3 text-right font-medium">Amount</th>
                    <th className="px-2 pb-3 text-right font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {recentWithdrawals.map((t) => {
                    const status = txStatus(t);
                    const tone =
                      status === "cancelled"
                        ? "text-muted-foreground"
                        : status === "pending"
                          ? "text-primary"
                          : "text-down";
                    return (
                      <tr key={t.id} className="border-b border-border last:border-b-0">
                        <td className="px-2 py-4 font-mono text-xs text-muted-foreground">{stamp(t.date)}</td>
                        <td className="px-2 py-4 font-medium text-foreground">{t.method}</td>
                        <td className="px-2 py-4 text-muted-foreground">{NETWORK_OF[t.method]}</td>
                        <td className={`px-2 py-4 text-right font-mono font-semibold ${tone}`}>−{fmt(t.amount)}</td>
                        <td className="px-2 py-4 text-right">
                          <span
                            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                              status === "cancelled"
                                ? "bg-muted text-muted-foreground"
                                : status === "pending"
                                  ? "bg-primary/10 text-primary"
                                  : "bg-down/10 text-down"
                            }`}
                          >
                            <span className="h-1.5 w-1.5 rounded-full bg-current" />
                            {status === "pending" ? "Pending" : status === "cancelled" ? "Cancelled" : "Completed"}
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
