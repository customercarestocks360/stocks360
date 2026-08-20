import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { QrCode } from "@/components/ui/qr-code";
import { useAuth } from "@/components/AuthProvider";
import { useFundingRequests } from "@/hooks/useFundingRequests";
import { ApiError } from "@/lib/api";
import { currentIdToken } from "@/lib/firebase";
import { reportDeposit, newIdempotencyKey, type FundingNetwork } from "@/lib/funding-api";
import { amount as parseAmount, type SettlementCurrency } from "@/lib/trading-api";

type DepositMethod = SettlementCurrency;

export const Route = createFileRoute("/deposit")({
  head: () => ({
    meta: [
      { title: "Deposit — Stocks360" },
      { name: "description", content: "Deposit USDT into your Stocks360 account." },
    ],
  }),
  component: DepositPage,
});

type Network = {
  code: FundingNetwork;
  name: string;
  address: string;
  addressLabel: string;
  /** What the QR encodes — for UPI a payment intent, for chains the raw address. */
  payload: (address: string) => string;
  minimum: string;
  arrival: string;
  fee: string;
  confirmations: string;
};

type AssetOption = {
  code: DepositMethod;
  name: string;
  symbol: string;
  color: string;
  networks: Network[];
};

/** Deposit rails — USDT is the only asset the platform accepts. */
const ASSET_OPTIONS: AssetOption[] = [
  {
    code: "USDT",
    name: "TetherUS",
    symbol: "",
    color: "#26a17b",
    networks: [
      {
        code: "BEP20",
        name: "BNB Smart Chain (BEP20)",
        address: "0x8cfa8b2fff6d4cec11dd6b53b68793fb4f81ffe3",
        addressLabel: "Wallet Address (BEP20)",
        payload: (a) => a,
        minimum: "More than 0.000002 USDT",
        arrival: "About 1 minute after network confirmation",
        fee: "0 USDT",
        confirmations: "15 network confirmations",
      },
    ],
  },
];

const FAQS = [
  {
    q: "How to deposit? (Step-by-step guide)",
    a: "Choose the network your USDT will arrive on, then send to the address shown. Report the amount you sent and an admin verifies it and credits your balance.",
  },
  {
    q: "Deposit hasn't arrived?",
    a: "Check that you sent on the same network you selected here. Funds sent on a different network can't be verified automatically. Once verified, the balance is credited by an admin — it's listed as pending until then.",
  },
  {
    q: "Deposit & Withdrawal status query",
    a: "Every deposit and withdrawal is listed in your wallet with its status. Pending withdrawals stay locked until they settle, and you can cancel one to release the funds.",
  },
  {
    q: "Is there a minimum or a fee?",
    a: "Each network sets its own minimum and fee — both are shown with the deposit address once you've picked a network. Anything below the minimum may not be credited.",
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

/** Highlights the leading and trailing characters, the way exchanges do. */
function AddressText({ address }: { address: string }) {
  const head = address.slice(0, 6);
  const tail = address.slice(-5);
  const middle = address.slice(6, -5);
  return (
    <span className="break-all font-mono text-sm leading-6">
      <span className="text-primary">{head}</span>
      <span className="text-foreground">{middle}</span>
      <span className="text-primary">{tail}</span>
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
        <i className={`fa-solid fa-chevron-down text-xs text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} />
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

/** Diamond marker for a completed step, numbered circle for the one in progress. */
function StepMarker({ done, n }: { done: boolean; n: number }) {
  return (
    <span className={`flex h-5 w-5 items-center justify-center rounded-full border-2 text-[10px] font-bold ${done ? "border-primary text-primary" : "border-foreground/70 text-foreground/70"}`}>
      {n}
    </span>
  );
}

function Step({
  n,
  done,
  title,
  last,
  action,
  children,
}: {
  n: number;
  done: boolean;
  title: string;
  last?: boolean;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <li className="relative pl-10">
      <span className="absolute left-0 top-0.5">
        <StepMarker done={done} n={n} />
      </span>
      {!last && <span className="absolute left-[9px] top-7 bottom-0 w-px bg-border" aria-hidden />}
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-xl font-bold text-foreground">{title}</h2>
        {action}
      </div>
      <div className={last ? "mt-4" : "mt-4 pb-10"}>{children}</div>
    </li>
  );
}

function DepositPage() {
  const { isLoggedIn, kycCompleted } = useAuth();
  const deposits = useFundingRequests("deposit");

  const asset = ASSET_OPTIONS[0]!;
  const [network, setNetwork] = useState<Network>(asset.networks[0]!);
  const [copied, setCopied] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [openFaq, setOpenFaq] = useState<number | null>(null);
  const [amount, setAmount] = useState("");
  const [stage, setStage] = useState<"idle" | "submitting" | "requested">("idle");
  const [error, setError] = useState("");

  const recentDeposits = deposits.requests.slice(0, 5);

  const handleCopy = () => {
    navigator.clipboard?.writeText(network.address).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  const value = parseFloat(amount);
  const canSubmit = Number.isFinite(value) && value > 0 && stage === "idle";

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setStage("submitting");
    setError("");
    try {
      const token = await currentIdToken();
      await reportDeposit(
        {
          currency: asset.code,
          amount: String(value),
          network: network.code,
          idempotency_key: newIdempotencyKey(),
        },
        token,
      );
      setAmount("");
      setStage("requested");
      void deposits.refresh();
    } catch (err) {
      setStage("idle");
      setError(
        err instanceof ApiError ? err.message : "Could not report this deposit. Please try again.",
      );
    }
  };

  if (!isLoggedIn || !kycCompleted) {
    const locked = !isLoggedIn
      ? {
          icon: "fa-lock",
          title: "Sign in required",
          body: "You need to be signed in to deposit funds into your Stocks360 account.",
          cta: "Go to sign in",
          to: "/login" as const,
          search: undefined,
        }
      : {
          icon: "fa-id-card",
          title: "Account details incomplete",
          body: "Your identity hasn't been verified yet. Complete your account details to unlock deposits.",
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
                  USDT is the only asset Stocks360 accepts for deposits.
                </p>
              </div>
            </Step>

            <Step n={2} done title="Select Network">
              <div className="max-w-lg">
                <Dropdown
                  label="Select network"
                  items={asset.networks}
                  selected={network}
                  onSelect={(n) => {
                    setNetwork(n);
                    setCopied(false);
                  }}
                  render={(n) => (
                    <span className="flex min-w-0 items-center gap-3">
                      <span className="shrink-0 font-semibold text-foreground">{n.code}</span>
                      <span className="truncate text-sm text-muted-foreground">{n.name}</span>
                    </span>
                  )}
                />
              </div>
            </Step>

            <Step
              n={3}
              done={false}
              last
              title="Deposit Address"
            >
              <div className="max-w-lg">
                <div className="flex flex-col sm:flex-row items-center sm:items-start gap-5 rounded sm:rounded-xl border border-border bg-card p-4">
                  <div className="rounded-lg bg-white p-2 shrink-0">
                    <QrCode
                      value={network.payload(network.address)}
                      size={124}
                      title={`${asset.code} deposit address on ${network.code}`}
                    />
                  </div>
                  <div className="min-w-0 flex-1 w-full text-center sm:text-left">
                    <div className="text-sm text-muted-foreground">Address</div>
                    <div className="mt-1 flex flex-col sm:flex-row items-center sm:items-start gap-2">
                      <AddressText address={network.address} />
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={handleCopy}
                          aria-label="Copy deposit address"
                          className="shrink-0 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                        >
                          <i className={`fa-${copied ? "solid fa-check text-up" : "regular fa-copy"} text-sm`} />
                        </button>
                        <button
                          type="button"
                          onClick={() => setShowDetails((v) => !v)}
                          aria-label="Toggle address details"
                          aria-expanded={showDetails}
                          className="shrink-0 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                        >
                          <i className={`fa-solid fa-chevron-down text-xs transition-transform ${showDetails ? "rotate-180" : ""}`} />
                        </button>
                      </div>
                    </div>
                    <div className="mt-1 text-[11px] text-muted-foreground/70">{network.addressLabel}</div>
                  </div>
                </div>

                <div className="mt-4 flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Minimum deposit</span>
                  <span className="font-semibold text-foreground">{network.minimum}</span>
                </div>

                {showDetails && (
                  <dl className="mt-4 space-y-2.5 rounded sm:rounded-xl border border-border bg-background/40 p-4 text-sm">
                    <div className="flex justify-between gap-4">
                      <dt className="text-muted-foreground">Expected arrival</dt>
                      <dd className="text-right text-foreground">{network.arrival}</dd>
                    </div>
                    <div className="flex justify-between gap-4">
                      <dt className="text-muted-foreground">Deposit fee</dt>
                      <dd className="text-right text-foreground">{network.fee}</dd>
                    </div>
                    <div className="flex justify-between gap-4">
                      <dt className="text-muted-foreground">Credited after</dt>
                      <dd className="text-right text-foreground">{network.confirmations}</dd>
                    </div>
                    <div className="flex justify-between gap-4">
                      <dt className="text-muted-foreground">Selected network</dt>
                      <dd className="text-right text-foreground">
                        {network.code} · {network.name}
                      </dd>
                    </div>
                  </dl>
                )}

                <button
                  type="button"
                  onClick={() => setShowDetails((v) => !v)}
                  className="mx-auto mt-4 flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
                >
                  {showDetails ? "Less Details" : "More Details"}
                  <i className={`fa-solid fa-chevron-down text-[10px] transition-transform ${showDetails ? "rotate-180" : ""}`} />
                </button>

                {/* Reporting the amount only records the claim — an admin credits the balance once they've verified it landed. */}
                <div className="mt-8 rounded sm:rounded-xl border border-border bg-card p-4">
                  {stage === "requested" ? (
                    <div className="text-center">
                      <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-primary/10 text-primary">
                        <i className="fa-solid fa-clock" />
                      </div>
                      <p className="mt-3 text-sm font-semibold text-foreground">Deposit reported</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        It's pending admin confirmation — you'll see it settle under Recent Deposits once
                        verified.
                      </p>
                      <button
                        type="button"
                        onClick={() => setStage("idle")}
                        className="mt-4 rounded-lg border border-border px-4 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-secondary"
                      >
                        Report another deposit
                      </button>
                    </div>
                  ) : (
                    <>
                      <label className="block text-sm font-medium text-foreground">
                        Amount sent ({asset.code})
                        <input
                          value={amount}
                          onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
                          placeholder="e.g. 100"
                          inputMode="decimal"
                          className="mt-2 w-full rounded sm:rounded-xl border border-border bg-background/60 px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/40"
                        />
                      </label>
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
                        {stage === "submitting" ? "Reporting…" : "I've sent this amount"}
                      </button>
                      <p className="mt-3 text-center text-[11px] text-muted-foreground/70">
                        An admin verifies the transfer and credits your balance — it won't apply instantly.
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

        {/* ── Recent deposits ── */}
        <div className="mt-14 border-t border-border pt-8">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-bold text-foreground">Recent Deposits</h2>
            <Link
              to="/wallet"
              className="flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              More <i className="fa-solid fa-chevron-right text-[10px]" />
            </Link>
          </div>

          {recentDeposits.length === 0 ? (
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
                  {recentDeposits.map((t) => {
                    const status = t.status;
                    return (
                      <tr key={t.id} className="border-b border-border last:border-b-0">
                        <td className="px-1 sm:px-2 py-2.5 sm:py-4 font-mono text-xs text-muted-foreground">{stamp(t.created_at)}</td>
                        <td className="px-1 sm:px-2 py-2.5 sm:py-4 font-medium text-foreground">{t.currency}</td>
                        <td className="px-1 sm:px-2 py-2.5 sm:py-4 text-muted-foreground">{t.network}</td>
                        <td
                          className={`px-1 sm:px-2 py-2.5 sm:py-4 text-right font-mono font-semibold ${
                            status === "cancelled" ? "text-muted-foreground" : "text-up"
                          }`}
                        >
                          +{fmt(parseAmount(t.amount) ?? 0)}
                        </td>
                        <td className="px-1 sm:px-2 py-2.5 sm:py-4 text-right">
                          <span
                            title={t.resolution_note ?? undefined}
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
