import { useState, type FormEvent, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { useAuth } from "@/components/AuthProvider";

/**
 * Buy/Sell entry point shown on each asset row. Opens the gated TradeModal
 * flow — this component itself has no auth logic, it just reports intent.
 */
export function BuySellButtons({
  onBuy,
  onSell,
}: {
  onBuy: () => void;
  onSell: () => void;
}) {
  return (
    <div className="mt-3 grid grid-cols-2 gap-2 border-t border-border/60 pt-3">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onBuy();
        }}
        className="rounded-lg bg-up/10 py-1.5 text-xs font-bold uppercase tracking-wide text-up hover:bg-up/20"
      >
        Buy
      </button>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onSell();
        }}
        className="rounded-lg bg-down/10 py-1.5 text-xs font-bold uppercase tracking-wide text-down hover:bg-down/20"
      >
        Sell
      </button>
    </div>
  );
}

/**
 * The gated trade flow: sign-in check → KYC check (with a simulated
 * verification step, no backend exists) → order ticket → confirmation.
 * Renders nothing when closed.
 */
export function TradeModal({
  open,
  onClose,
  action,
  symbol,
  price,
}: {
  open: boolean;
  onClose: () => void;
  action: "buy" | "sell";
  symbol: string;
  price: string;
}) {
  const auth = useAuth();
  const [kycNumber, setKycNumber] = useState("");
  const [kycStage, setKycStage] = useState<"form" | "verifying" | "verified">("form");
  const [qty, setQty] = useState("1");
  const [placed, setPlaced] = useState(false);

  if (!open) return null;

  const handleClose = () => {
    onClose();
    setKycStage("form");
    setKycNumber("");
    setPlaced(false);
    setQty("1");
  };

  const handleKycSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!kycNumber.trim()) return;
    setKycStage("verifying");
    setTimeout(() => {
      setKycStage("verified");
      setTimeout(() => auth.submitKyc(kycNumber.trim()), 900);
    }, 1400);
  };

  let body: ReactNode;

  if (!auth.isLoggedIn) {
    body = (
      <>
        <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-secondary text-primary">
          <i className="fa-solid fa-lock text-base" />
        </div>
        <h3 className="mt-4 text-center text-lg font-bold text-foreground">Sign in required</h3>
        <p className="mt-2 text-center text-sm text-muted-foreground">
          Log in to your Stocks360 account to {action} {symbol}.
        </p>
        <Link
          to="/login"
          className="mt-6 block w-full rounded-xl bg-primary px-4 py-3 text-center text-sm font-bold uppercase tracking-wider text-primary-foreground transition-opacity hover:opacity-90"
        >
          Go to sign in
        </Link>
      </>
    );
  } else if (!auth.kycCompleted) {
    if (kycStage === "form") {
      body = (
        <>
          <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-secondary text-primary">
            <i className="fa-solid fa-id-card text-base" />
          </div>
          <h3 className="mt-4 text-center text-lg font-bold text-foreground">Complete your KYC</h3>
          <p className="mt-2 text-center text-sm text-muted-foreground">
            We need to verify your identity before you can trade. Enter your KYC number to continue.
          </p>
          <form onSubmit={handleKycSubmit} className="mt-6 space-y-4">
            <input
              value={kycNumber}
              onChange={(e) => setKycNumber(e.target.value)}
              placeholder="Enter your KYC number"
              className="w-full rounded-xl border border-border bg-background/60 px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/40"
            />
            <button
              type="submit"
              className="w-full rounded-xl bg-primary px-4 py-3 text-sm font-bold uppercase tracking-wider text-primary-foreground transition-opacity hover:opacity-90"
            >
              Submit for verification
            </button>
          </form>
        </>
      );
    } else if (kycStage === "verifying") {
      body = (
        <div className="py-6 text-center">
          <i className="fa-solid fa-circle-notch fa-spin text-2xl text-primary" />
          <p className="mt-4 text-sm text-muted-foreground">Verifying your KYC number...</p>
        </div>
      );
    } else {
      body = (
        <div className="py-6 text-center">
          <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-up/10 text-up">
            <i className="fa-solid fa-check text-base" />
          </div>
          <h3 className="mt-4 text-lg font-bold text-foreground">KYC verified</h3>
          <p className="mt-2 text-sm text-muted-foreground">You're all set — loading your trade ticket.</p>
        </div>
      );
    }
  } else if (!placed) {
    body = (
      <>
        <h3 className="text-lg font-bold capitalize text-foreground">
          {action} {symbol}
        </h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Market price: <span className="font-mono text-foreground">{price}</span>
        </p>
        <label className="mt-5 block text-sm font-medium text-foreground">
          Quantity
          <input
            value={qty}
            onChange={(e) => setQty(e.target.value.replace(/[^0-9.]/g, ""))}
            className="mt-2 w-full rounded-xl border border-border bg-background/60 px-3 py-2.5 text-sm text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/40"
          />
        </label>
        <button
          type="button"
          onClick={() => setPlaced(true)}
          className={`mt-6 w-full rounded-xl px-4 py-3 text-sm font-bold uppercase tracking-wider text-white transition-opacity hover:opacity-90 ${
            action === "buy" ? "bg-up" : "bg-down"
          }`}
        >
          {action} {symbol}
        </button>
      </>
    );
  } else {
    body = (
      <div className="py-6 text-center">
        <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-up/10 text-up">
          <i className="fa-solid fa-check text-base" />
        </div>
        <h3 className="mt-4 text-lg font-bold text-foreground">Order placed</h3>
        <p className="mt-2 text-sm text-muted-foreground">
          Your {action} order for {qty} {symbol} has been simulated successfully.
        </p>
      </div>
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-6"
      onClick={handleClose}
    >
      <div
        className="relative w-full max-w-sm rounded-2xl border border-border bg-card p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={handleClose}
          aria-label="Close"
          className="absolute right-4 top-4 text-muted-foreground hover:text-foreground"
        >
          <i className="fa-solid fa-xmark" />
        </button>
        {body}
      </div>
    </div>
  );
}
