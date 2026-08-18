import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useAuth, lockedAmount, convertedAmount, USDT_TO_INR, type DepositMethod } from "@/components/AuthProvider";

const CURRENCY_INFO: Record<DepositMethod, { label: string; icon: string; color: string }> = {
  INR: { label: "INR", icon: "fa-indian-rupee-sign", color: "#f59e0b" },
  USDT: { label: "USDT", icon: "fa-dollar-sign", color: "#26a17b" },
};

function fmt(n: number, decimals = 4) {
  return n.toLocaleString("en-US", { maximumFractionDigits: decimals });
}

/**
 * Converts between the wallet's two settlement currencies. Used both on the
 * forex page (there's no real market for INR/USDT pairs, so a wallet-to-wallet
 * swap is the only conversion the app can actually settle) and on withdraw
 * (to get funds into whichever currency the user wants to cash out in).
 */
export function ConvertWidget({ defaultFrom }: { defaultFrom?: DepositMethod }) {
  const { balances, transactions, convertBalance } = useAuth();
  const [from, setFrom] = useState<DepositMethod>(defaultFrom ?? "USDT");
  const to: DepositMethod = from === "USDT" ? "INR" : "USDT";
  const [amount, setAmount] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [done, setDone] = useState(false);

  // Follows whichever asset the caller has selected (e.g. the forex chart's pair).
  useEffect(() => {
    if (defaultFrom) setFrom(defaultFrom);
  }, [defaultFrom]);

  const available = balances[from] - lockedAmount(transactions, from);
  const value = parseFloat(amount) || 0;
  const converted = convertedAmount(from, to, value);
  const insufficient = value > 0 && value > available;
  const canPreview = value > 0 && !insufficient;

  const swap = () => {
    setFrom(to);
    setAmount("");
  };

  const handleConfirm = () => {
    if (insufficient || value <= 0) return;
    convertBalance(from, to, value);
    setConfirming(false);
    setDone(true);
    setAmount("");
  };

  return (
    <div className="rounded-2xl border border-overlay-border bg-surface p-5">
      {/* From */}
      <div className="rounded-xl border border-border bg-background/40 p-4">
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">From</span>
          <span className="text-muted-foreground">
            Available Balance {fmt(available, 2)} {from}
          </span>
        </div>
        <div className="mt-2 flex items-center justify-between gap-3">
          <span className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <i className={`fa-solid ${CURRENCY_INFO[from].icon}`} style={{ color: CURRENCY_INFO[from].color }} />
            {from}
          </span>
          <div className="flex items-center gap-2">
            <input
              value={amount}
              onChange={(e) => {
                setAmount(e.target.value.replace(/[^0-9.]/g, ""));
                setDone(false);
              }}
              placeholder="0.00"
              inputMode="decimal"
              className="w-28 border-none bg-transparent text-right font-mono text-lg text-foreground placeholder:text-muted-foreground/50 focus-visible:outline-none"
            />
            <button
              type="button"
              onClick={() => setAmount(available > 0 ? String(available) : "")}
              className="text-xs font-bold text-primary hover:opacity-80"
            >
              Max
            </button>
          </div>
        </div>
      </div>

      

      


      {confirming && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 md:items-center md:px-6"
          onClick={() => setConfirming(false)}
        >
          <div
            className="relative w-full max-h-[90vh] overflow-y-auto rounded-t-2xl border border-border bg-card p-6 pb-safe shadow-2xl md:max-w-sm md:max-h-none md:rounded-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-border md:hidden" />
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-foreground">Confirm</h3>
              <button
                type="button"
                onClick={() => setConfirming(false)}
                aria-label="Close"
                className="text-muted-foreground hover:text-foreground"
              >
                <i className="fa-solid fa-xmark" />
              </button>
            </div>

            <div className="mt-5 flex items-center justify-center gap-4">
              <div className="text-center">
                <div
                  className="mx-auto flex h-10 w-10 items-center justify-center rounded-full"
                  style={{ backgroundColor: `${CURRENCY_INFO[from].color}20` }}
                >
                  <i className={`fa-solid ${CURRENCY_INFO[from].icon}`} style={{ color: CURRENCY_INFO[from].color }} />
                </div>
                <div className="mt-2 text-xs text-muted-foreground">From</div>
                <div className="font-mono text-sm font-bold text-foreground">
                  {fmt(value)} {from}
                </div>
              </div>
              <i className="fa-solid fa-arrow-right text-muted-foreground" />
              <div className="text-center">
                <div
                  className="mx-auto flex h-10 w-10 items-center justify-center rounded-full"
                  style={{ backgroundColor: `${CURRENCY_INFO[to].color}20` }}
                >
                  <i className={`fa-solid ${CURRENCY_INFO[to].icon}`} style={{ color: CURRENCY_INFO[to].color }} />
                </div>
                <div className="mt-2 text-xs text-muted-foreground">To</div>
                <div className="font-mono text-sm font-bold text-foreground">
                  {fmt(converted)} {to}
                </div>
              </div>
            </div>

            <dl className="mt-5 space-y-2 rounded-xl border border-border bg-background/40 p-4 text-sm">
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Rate</dt>
                <dd className="text-foreground">
                  {from === "USDT" ? `1 USDT = ${USDT_TO_INR} INR` : `1 INR = ${fmt(1 / USDT_TO_INR, 6)} USDT`}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Payment Method</dt>
                <dd className="text-foreground">Wallet Balance</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Transaction Fees</dt>
                <dd className="text-foreground">0 {from}</dd>
              </div>
            </dl>

            {insufficient ? (
              <>
                <p className="mt-4 flex items-center gap-2 rounded-lg bg-destructive/10 px-3 py-2.5 text-xs font-medium text-destructive">
                  <i className="fa-solid fa-circle-exclamation" />
                  Your account has insufficient balance. Please fund your account.
                </p>
                <Link
                  to="/deposit"
                  className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 text-sm font-bold uppercase tracking-wider text-primary-foreground transition-opacity hover:opacity-90"
                >
                  Increase {from}
                </Link>
              </>
            ) : (
              <button
                type="button"
                onClick={handleConfirm}
                className="mt-4 w-full rounded-xl bg-primary px-4 py-3 text-sm font-bold uppercase tracking-wider text-primary-foreground transition-opacity hover:opacity-90"
              >
                Confirm
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
