import { useMemo, useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { useAuth, lockedAmount, type DepositMethod } from "@/components/AuthProvider";

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
  const [qty, setQty] = useState("1");
  const [placed, setPlaced] = useState(false);

  /** Rupee prices settle out of the INR balance, dollar prices out of USDT (treated as ~$1 each). */
  const currency: DepositMethod = price.trim().startsWith("₹") ? "INR" : "USDT";
  const unitPrice = parseFloat(price.replace(/[^0-9.]/g, "")) || 0;
  const qtyValue = parseFloat(qty) || 0;
  const cost = qtyValue * unitPrice;

  const availableFunds = auth.balances[currency] - lockedAmount(auth.transactions, currency);

  const heldQty = useMemo(() => {
    if (action !== "sell") return 0;
    return auth.orders
      .filter((o) => o.symbol === symbol)
      .reduce((sum, o) => sum + (o.action === "buy" ? o.qty : -o.qty), 0);
  }, [auth.orders, action, symbol]);

  const insufficientFunds = action === "buy" && qtyValue > 0 && cost > availableFunds;
  const insufficientHoldings = action === "sell" && qtyValue > 0 && qtyValue > heldQty;
  const canPlace = qtyValue > 0 && !insufficientFunds && !insufficientHoldings;

  if (!open) return null;

  const handleClose = () => {
    onClose();
    setPlaced(false);
    setQty("1");
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
    body = (
      <>
        <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-secondary text-primary">
          <i className="fa-solid fa-id-card text-base" />
        </div>
        <h3 className="mt-4 text-center text-lg font-bold text-foreground">Complete your account details</h3>
        <p className="mt-2 text-center text-sm text-muted-foreground">
          We need to verify your identity before you can {action} {symbol}.
        </p>
        <Link
          to="/account"
          search={{ tab: "account" }}
          onClick={handleClose}
          className="mt-6 block w-full rounded-xl bg-primary px-4 py-3 text-center text-sm font-bold uppercase tracking-wider text-primary-foreground transition-opacity hover:opacity-90"
        >
          Complete account details
        </Link>
      </>
    );
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

        <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
          {action === "buy" ? (
            <>
              <span>
                Available: {availableFunds.toLocaleString()} {currency}
              </span>
              <span>Cost: {cost.toLocaleString()} {currency}</span>
            </>
          ) : (
            <>
              <span>Holding: {heldQty.toLocaleString()} {symbol}</span>
              <span>Selling: {qtyValue.toLocaleString()} {symbol}</span>
            </>
          )}
        </div>

        {insufficientFunds && (
          <p className="mt-2 text-xs font-medium text-down">
            Not enough {currency} balance for this order. Deposit more to continue.
          </p>
        )}
        {insufficientHoldings && (
          <p className="mt-2 text-xs font-medium text-down">
            You only hold {heldQty.toLocaleString()} {symbol}.
          </p>
        )}

        <button
          type="button"
          disabled={!canPlace}
          onClick={() => {
            if (!canPlace) return;
            auth.placeOrder({ action, symbol, qty: qtyValue, price });
            setPlaced(true);
          }}
          className={`mt-6 w-full rounded-xl px-4 py-3 text-sm font-bold uppercase tracking-wider text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40 ${
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
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 md:items-center md:px-6"
      onClick={handleClose}
    >
      {/* Bottom sheet on mobile (native app modal pattern), centered dialog on md+. */}
      <div
        className="relative w-full max-h-[90vh] overflow-y-auto rounded-t-2xl border border-border bg-card p-6 pb-safe shadow-2xl md:max-w-sm md:max-h-none md:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-border md:hidden" />
        <button
          type="button"
          onClick={handleClose}
          aria-label="Close"
          className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center text-muted-foreground hover:text-foreground"
        >
          <i className="fa-solid fa-xmark" />
        </button>
        {body}
      </div>
    </div>
  );
}
