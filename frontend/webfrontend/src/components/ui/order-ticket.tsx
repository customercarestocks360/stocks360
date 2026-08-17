import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useAuth, lockedAmount, type DepositMethod } from "@/components/AuthProvider";

export type OrderAsset = {
  t: string;
  n: string;
  p: string;
  c: string;
  up: boolean;
};

function fmt(n: number, decimals = 2) {
  return n.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

/**
 * Inline order ticket embedded directly in the trade layout (no modal) — the
 * same sign-in/KYC gating and balance checks trade-modal.tsx uses, just
 * rendered as a persistent panel that follows whichever asset is selected.
 */
export function OrderTicket({
  asset,
  action,
  onActionChange,
}: {
  asset: OrderAsset;
  action: "buy" | "sell";
  onActionChange: (action: "buy" | "sell") => void;
}) {
  const auth = useAuth();
  const [qty, setQty] = useState("1");
  const [placed, setPlaced] = useState(false);
  const [orderType, setOrderType] = useState<"Limit" | "Market">("Limit");
  const [showOrderTypeMenu, setShowOrderTypeMenu] = useState(false);

  // Switching symbols or sides mid-flow should drop back to a fresh ticket.
  useEffect(() => {
    setPlaced(false);
  }, [asset.t, action]);

  const currency: DepositMethod = asset.p.trim().startsWith("₹") ? "INR" : "USDT";
  const unitPrice = parseFloat(asset.p.replace(/[^0-9.]/g, "")) || 0;
  const qtyValue = parseFloat(qty) || 0;
  const cost = qtyValue * unitPrice;
  const bid = unitPrice * 0.998;
  const ask = unitPrice * 1.002;

  const availableFunds = auth.balances[currency] - lockedAmount(auth.transactions, currency);

  const heldQty = useMemo(() => {
    return auth.orders
      .filter((o) => o.symbol === asset.t)
      .reduce((sum, o) => sum + (o.action === "buy" ? o.qty : -o.qty), 0);
  }, [auth.orders, asset.t]);

  const insufficientFunds = action === "buy" && cost > availableFunds;
  const insufficientHoldings = action === "sell" && qtyValue > heldQty;
  const canPlace = qtyValue > 0 && !insufficientFunds && !insufficientHoldings;

  if (!auth.isLoggedIn) {
    return (
      <div className="rounded-2xl border border-overlay-border bg-surface p-5 text-center">
        <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-secondary text-primary">
          <i className="fa-solid fa-lock text-base" />
        </div>
        <h3 className="mt-4 text-sm font-bold text-foreground">Sign in required</h3>
        <p className="mt-2 text-xs text-muted-foreground">Log in to trade {asset.t}.</p>
        <Link
          to="/login"
          className="mt-5 block w-full rounded-xl bg-primary px-4 py-2.5 text-center text-sm font-bold uppercase tracking-wider text-primary-foreground transition-opacity hover:opacity-90"
        >
          Go to sign in
        </Link>
      </div>
    );
  }

  if (!auth.kycCompleted) {
    return (
      <div className="rounded-2xl border border-overlay-border bg-surface p-5 text-center">
        <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-secondary text-primary">
          <i className="fa-solid fa-id-card text-base" />
        </div>
        <h3 className="mt-4 text-sm font-bold text-foreground">Complete your account details</h3>
        <p className="mt-2 text-xs text-muted-foreground">Verify your identity before trading {asset.t}.</p>
        <Link
          to="/account"
          search={{ tab: "account" }}
          className="mt-5 block w-full rounded-xl bg-primary px-4 py-2.5 text-center text-sm font-bold uppercase tracking-wider text-primary-foreground transition-opacity hover:opacity-90"
        >
          Complete account details
        </Link>
      </div>
    );
  }

  if (placed) {
    return (
      <div className="rounded-2xl border border-overlay-border bg-surface p-5 text-center">
        <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-up/10 text-up">
          <i className="fa-solid fa-check text-base" />
        </div>
        <h3 className="mt-4 text-sm font-bold text-foreground">
          {orderType === "Limit" ? "Limit order opened" : "Order filled"}
        </h3>
        <p className="mt-2 text-xs text-muted-foreground">
          {orderType === "Limit"
            ? `Your ${action} limit order for ${qty} ${asset.t} at ${asset.p[0]}${asset.p.replace(/[^0-9.]/g, "")} is now open — cancel it anytime from Open Orders.`
            : `Your ${action} order for ${qty} ${asset.t} has been filled.`}
        </p>
        <button
          type="button"
          onClick={() => {
            setPlaced(false);
            setQty("1");
          }}
          className="mt-5 w-full rounded-xl border border-border px-4 py-2.5 text-sm font-semibold text-foreground transition-colors hover:bg-secondary"
        >
          Trade again
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-overlay-border bg-surface p-5">
      {/* ── Buy/Sell tabs + order type ── */}
      <div className="flex items-center justify-between gap-3">
        <div className="grid flex-1 grid-cols-2 gap-1.5 rounded-lg bg-background/60 p-1">
          <button
            type="button"
            onClick={() => onActionChange("buy")}
            className={`rounded-md py-1.5 text-sm font-bold transition-colors ${
              action === "buy" ? "bg-up text-white" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Buy
          </button>
          <button
            type="button"
            onClick={() => onActionChange("sell")}
            className={`rounded-md py-1.5 text-sm font-bold transition-colors ${
              action === "sell" ? "bg-down text-white" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Sell
          </button>
        </div>

        <div className="relative shrink-0">
          <button
            type="button"
            onClick={() => setShowOrderTypeMenu((v) => !v)}
            className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm font-medium text-foreground transition-colors hover:bg-secondary"
          >
            {orderType}
            <i className={`fa-solid fa-chevron-down text-[10px] text-muted-foreground transition-transform ${showOrderTypeMenu ? "rotate-180" : ""}`} />
          </button>
          {showOrderTypeMenu && (
            <ul className="absolute right-0 top-[calc(100%+0.35rem)] z-10 overflow-hidden rounded-lg border border-border bg-card p-1 shadow-xl">
              {(["Market", "Limit"] as const).map((t) => (
                <li key={t}>
                  <button
                    type="button"
                    onClick={() => {
                      setOrderType(t);
                      setShowOrderTypeMenu(false);
                    }}
                    className={`w-full whitespace-nowrap rounded-md px-3 py-1.5 text-left text-sm ${
                      orderType === t ? "bg-secondary text-foreground" : "text-muted-foreground hover:bg-secondary/60"
                    }`}
                  >
                    {t}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* ── Price ── */}
      <div className="mt-5">
        <div className="text-xs font-medium text-muted-foreground">Price</div>
        <div className="mt-1 flex items-baseline gap-2">
          <span className="text-lg font-bold text-muted-foreground">{asset.p[0]}</span>
          <span className="font-mono text-3xl font-bold text-foreground">{fmt(unitPrice)}</span>
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs">
          <span className={asset.up ? "text-up" : "text-down"}>
            <i className={`fa-solid ${asset.up ? "fa-arrow-trend-up" : "fa-arrow-trend-down"} mr-1`} />
            {asset.c}
          </span>
          <span className="text-muted-foreground">
            Bid <span className="font-mono text-up">{asset.p[0]}{fmt(bid)}</span>
          </span>
          <span className="text-muted-foreground">
            Ask <span className="font-mono text-down">{asset.p[0]}{fmt(ask)}</span>
          </span>
        </div>
      </div>

      {/* ── Shares ── */}
      <label className="mt-5 block">
        <div className="text-xs font-medium text-muted-foreground">Shares</div>
        <div className="mt-1 flex items-baseline gap-2.5">
          <input
            value={qty}
            onChange={(e) => setQty(e.target.value.replace(/[^0-9.]/g, ""))}
            className="w-24 min-w-0 border-none bg-transparent p-0 font-mono text-3xl font-bold text-down focus-visible:outline-none"
          />
          <span className="truncate font-mono text-2xl font-bold text-muted-foreground/50">{asset.t}</span>
        </div>
        <div className="mt-1 font-mono text-xs text-muted-foreground">
          ≈ {fmt(cost)} {currency}
        </div>
      </label>

      {/* ── Available / holdings ── */}
      <div className="mt-4 flex items-center justify-between text-xs">
        <span className="text-muted-foreground">
          {action === "buy" ? `Avbl ${fmt(availableFunds, 0)} ${currency}` : `Holding ${fmt(heldQty, 0)} ${asset.t}`}
        </span>
      </div>

      {insufficientFunds && (
        <p className="mt-2 text-xs font-medium text-down">
          Insufficient {currency} in Funding + Spot.
        </p>
      )}
      {insufficientHoldings && (
        <p className="mt-2 text-xs font-medium text-down">You only hold {fmt(heldQty, 0)} {asset.t}.</p>
      )}

      {/* ── Pay from ── */}
      <div className="mt-4 flex items-center justify-between rounded-xl border border-border bg-background/40 px-4 py-3">
        <div>
          <div className="text-xs text-muted-foreground">Pay from</div>
          <div className="text-sm font-semibold text-foreground">Funding + Spot</div>
        </div>
        <span className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
          <i className={`fa-solid ${currency === "INR" ? "fa-indian-rupee-sign" : "fa-dollar-sign"} text-primary`} />
          {currency}
        </span>
      </div>

      {insufficientFunds ? (
        <Link
          to="/deposit"
          className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-up px-4 py-3 text-sm font-bold uppercase tracking-wider text-white transition-opacity hover:opacity-90"
        >
          Add {currency} Balance
        </Link>
      ) : (
        <button
          type="button"
          disabled={!canPlace}
          onClick={() => {
            if (!canPlace) return;
            auth.placeOrder({
              action,
              symbol: asset.t,
              qty: qtyValue,
              price: asset.p,
              orderType,
              status: orderType === "Limit" ? "open" : "filled",
            });
            setPlaced(true);
          }}
          className={`mt-4 w-full rounded-xl px-4 py-3 text-sm font-bold uppercase tracking-wider text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40 ${
            action === "buy" ? "bg-up" : "bg-down"
          }`}
        >
          {action} {asset.t}
        </button>
      )}
    </div>
  );
}
