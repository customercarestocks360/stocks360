import { useState } from "react";
import { useAuth, type DepositMethod } from "@/components/AuthProvider";

const METHOD_INFO: Record<
  DepositMethod,
  { label: string; symbol: string; caption: string; address: string; addressLabel: string }
> = {
  INR: {
    label: "INR",
    symbol: "₹",
    caption: "Scan with any UPI app to pay",
    address: "stocks360@upi",
    addressLabel: "UPI ID",
  },
  USDT: {
    label: "USDT",
    symbol: "",
    caption: "Scan to send USDT (TRC20 network)",
    address: "TQn9PhMxDem0UsdtAddr9x7ZK3sample",
    addressLabel: "Wallet Address (TRC20)",
  },
};

/** Deposit panel content — the caller positions it (e.g. anchored under the header's Deposit button). */
export function DepositPanel({ onClose }: { onClose: () => void }) {
  const { balances, deposit } = useAuth();
  const [method, setMethod] = useState<DepositMethod>("INR");
  const [amount, setAmount] = useState("");
  const [copied, setCopied] = useState(false);
  const [stage, setStage] = useState<"form" | "confirming" | "done">("form");

  const info = METHOD_INFO[method];

  const handleCopy = () => {
    navigator.clipboard?.writeText(info.address).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const handleConfirm = () => {
    const value = parseFloat(amount);
    if (!value || value <= 0) return;
    setStage("confirming");
    setTimeout(() => {
      deposit(method, value);
      setStage("done");
    }, 1200);
  };

  return (
    <DepositPanelBody
      stage={stage}
      method={method}
      setMethod={setMethod}
      amount={amount}
      setAmount={setAmount}
      copied={copied}
      onCopy={handleCopy}
      onConfirm={handleConfirm}
      onDone={onClose}
      onClose={onClose}
      info={info}
      balances={balances}
    />
  );
}

function DepositPanelBody({
  stage,
  method,
  setMethod,
  amount,
  setAmount,
  copied,
  onCopy,
  onConfirm,
  onDone,
  onClose,
  info,
  balances,
}: {
  stage: "form" | "confirming" | "done";
  method: DepositMethod;
  setMethod: (m: DepositMethod) => void;
  amount: string;
  setAmount: (v: string) => void;
  copied: boolean;
  onCopy: () => void;
  onConfirm: () => void;
  onDone: () => void;
  onClose: () => void;
  info: (typeof METHOD_INFO)[DepositMethod];
  balances: Record<DepositMethod, number>;
}) {
  return (
    <div className="w-full">
      {stage === "done" ? (
        <div className="py-4 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-up/10 text-up">
            <i className="fa-solid fa-check text-xl" />
          </div>
          <h3 className="mt-4 text-lg font-bold text-foreground">Deposit successful</h3>
          <p className="mt-2 text-sm text-muted-foreground">
            {info.symbol}
            {parseFloat(amount).toLocaleString()} {method === "USDT" ? "USDT" : ""} has been added to your
            account.
          </p>
          <div className="mt-5 rounded-xl border border-border bg-background/60 p-4">
            <div className="text-xs text-muted-foreground">New {method} balance</div>
            <div className="mt-1 font-mono text-2xl font-bold text-foreground">
              {info.symbol}
              {balances[method].toLocaleString()} {method === "USDT" ? "USDT" : ""}
            </div>
          </div>
          <button
            type="button"
            onClick={onDone}
            className="mt-6 w-full rounded-xl bg-primary px-4 py-3 text-sm font-bold uppercase tracking-wider text-primary-foreground transition-opacity hover:opacity-90"
          >
            Done
          </button>
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold text-foreground">Deposit funds</h2>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground"
            >
              <i className="fa-solid fa-xmark" />
            </button>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-2 rounded-xl border border-border bg-background/40 p-1">
            {(Object.keys(METHOD_INFO) as DepositMethod[]).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMethod(m)}
                className={`rounded-lg py-2 text-sm font-semibold transition-colors ${
                  method === m
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {METHOD_INFO[m].label}
              </button>
            ))}
          </div>

          <div className="mt-4 rounded-xl border border-border bg-background/40 px-4 py-2.5 text-sm text-muted-foreground">
            Current balance:{" "}
            <span className="font-mono font-semibold text-foreground">
              {info.symbol}
              {balances[method].toLocaleString()} {method === "USDT" ? "USDT" : ""}
            </span>
          </div>

          <div className="mt-6 flex flex-col items-center rounded-2xl border border-dashed border-border bg-background/40 p-6">
            <div className="flex h-40 w-40 items-center justify-center rounded-xl border border-border bg-white">
              <i className="fa-solid fa-qrcode text-7xl text-black" />
            </div>
            <p className="mt-3 text-center text-sm text-muted-foreground">{info.caption}</p>

            <div className="mt-4 flex w-full items-center gap-2 rounded-lg border border-border bg-card px-3 py-2">
              <span className="min-w-0 flex-1 truncate font-mono text-xs text-foreground">{info.address}</span>
              <button
                type="button"
                onClick={onCopy}
                className="shrink-0 rounded-md border border-border px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
              >
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
            <div className="mt-1 text-[11px] text-muted-foreground/70">{info.addressLabel}</div>
          </div>

          <label className="mt-6 block text-sm font-medium text-foreground">
            Amount deposited ({method})
            <input
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
              placeholder={method === "INR" ? "e.g. 5000" : "e.g. 100"}
              inputMode="decimal"
              className="mt-2 w-full rounded-xl border border-border bg-background/60 px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/40"
            />
          </label>

          <button
            type="button"
            onClick={onConfirm}
            disabled={!amount || parseFloat(amount) <= 0 || stage === "confirming"}
            className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 text-sm font-bold uppercase tracking-wider text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            {stage === "confirming" ? (
              <>
                <i className="fa-solid fa-circle-notch fa-spin" />
                Confirming payment...
              </>
            ) : (
              "I've completed the payment"
            )}
          </button>
          <p className="mt-3 text-center text-[11px] text-muted-foreground/70">
            Demo flow — no real payment is processed. Confirming just credits your account.
          </p>
        </>
      )}
    </div>
  );
}
