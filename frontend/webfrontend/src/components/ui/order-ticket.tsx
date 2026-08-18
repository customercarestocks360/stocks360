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
  className,
  layout = "vertical",
}: {
  asset: OrderAsset;
  action: "buy" | "sell";
  onActionChange: (action: "buy" | "sell") => void;
  className?: string;
  layout?: "vertical" | "horizontal";
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

  if (layout === "horizontal") {
    if (!auth.isLoggedIn) {
      return (
        <div className={`rounded sm:rounded-2xl border border-overlay-border bg-surface p-4 sm:p-5 flex flex-col sm:flex-row items-center justify-between gap-4 shadow-sm ${className ?? ""}`}>
          <div className="flex items-center gap-3.5">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-secondary text-primary">
              <i className="fa-solid fa-lock text-sm" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-foreground">Sign in required to trade</h3>
              <p className="text-xs text-muted-foreground">Log in to buy or sell {asset.t} with tight spreads and real-time execution.</p>
            </div>
          </div>
          <Link
            to="/login"
            className="shrink-0 rounded-xl bg-primary px-6 py-2.5 text-sm font-bold uppercase tracking-wider text-primary-foreground transition-opacity hover:opacity-90"
          >
            Go to sign in
          </Link>
        </div>
      );
    }

    if (!auth.kycCompleted) {
      return (
        <div className={`rounded sm:rounded-2xl border border-overlay-border bg-surface p-4 sm:p-5 flex flex-col sm:flex-row items-center justify-between gap-4 shadow-sm ${className ?? ""}`}>
          <div className="flex items-center gap-3.5">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-secondary text-primary">
              <i className="fa-solid fa-id-card text-sm" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-foreground">Account verification required</h3>
              <p className="text-xs text-muted-foreground">Verify your identity to unlock live trading for {asset.t}.</p>
            </div>
          </div>
          <Link
            to="/account"
            search={{ tab: "account" }}
            className="shrink-0 rounded-xl bg-primary px-6 py-2.5 text-sm font-bold uppercase tracking-wider text-primary-foreground transition-opacity hover:opacity-90"
          >
            Complete account details
          </Link>
        </div>
      );
    }

    if (placed) {
      return (
        <div className={`rounded sm:rounded-2xl border border-overlay-border bg-surface p-4 sm:p-5 flex flex-col sm:flex-row items-center justify-between gap-4 shadow-sm ${className ?? ""}`}>
          <div className="flex items-center gap-3.5">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-up/10 text-up">
              <i className="fa-solid fa-check text-sm" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-foreground">
                {orderType === "Limit" ? "Limit order active" : "Order filled successfully"}
              </h3>
              <p className="text-xs text-muted-foreground">
                {orderType === "Limit"
                  ? `Your ${action} limit order for ${qty} ${asset.t} at ${asset.p[0]}${asset.p.replace(/[^0-9.]/g, "")} is open.`
                  : `Your ${action} order for ${qty} ${asset.t} has been executed.`}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              setPlaced(false);
              setQty("1");
            }}
            className="shrink-0 rounded-xl border border-border px-5 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-secondary"
          >
            Trade again
          </button>
        </div>
      );
    }

    return (
      <div className={`rounded sm:rounded-2xl border border-overlay-border bg-surface p-4 sm:p-5 shadow-sm ${className ?? ""}`}>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-12 gap-4 lg:gap-5 items-center">
          {/* Col 1: Buy/Sell & Order type */}
          <div className="lg:col-span-3 flex items-center gap-2">
            <div className="grid flex-1 grid-cols-2 gap-1 rounded bg-background/60 p-1 border border-border">
              <button
                type="button"
                onClick={() => onActionChange("buy")}
                className={`rounded-md py-1.5 text-xs sm:text-sm font-bold transition-colors ${
                  action === "buy" ? "bg-up text-white shadow-sm" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Buy
              </button>
              <button
                type="button"
                onClick={() => onActionChange("sell")}
                className={`rounded-md py-1.5 text-xs sm:text-sm font-bold transition-colors ${
                  action === "sell" ? "bg-down text-white shadow-sm" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Sell
              </button>
            </div>
            <div className="relative shrink-0">
              <button
                type="button"
                onClick={() => setShowOrderTypeMenu((v) => !v)}
                className="flex items-center gap-1.5 rounded border border-border bg-card px-3 py-2 text-xs font-semibold text-foreground transition-colors hover:bg-secondary hover:text-primary"
              >
                {orderType}
                <i className={`fa-solid fa-chevron-down text-[10px] text-muted-foreground transition-transform ${showOrderTypeMenu ? "rotate-180" : ""}`} />
              </button>
              {showOrderTypeMenu && (
                <ul className="absolute left-0 top-[calc(100%+0.35rem)] z-20 overflow-hidden rounded-lg border border-border bg-card p-1 shadow-xl min-w-[100px]">
                  {(["Market", "Limit"] as const).map((t) => (
                    <li key={t}>
                      <button
                        type="button"
                        onClick={() => {
                          setOrderType(t);
                          setShowOrderTypeMenu(false);
                        }}
                        className={`w-full whitespace-nowrap rounded-md px-3 py-1.5 text-left text-xs ${
                          orderType === t ? "bg-secondary text-foreground font-semibold" : "text-muted-foreground hover:bg-secondary/60"
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

          {/* Col 2: Price display */}
          <div className="lg:col-span-2 rounded border border-border bg-card/60 px-3 py-2">
            <div className="flex items-center justify-between text-[11px] text-muted-foreground">
              <span>Price</span>
              <span className={asset.up ? "text-up font-mono text-[10px]" : "text-down font-mono text-[10px]"}>
                <i className={`fa-solid ${asset.up ? "fa-arrow-trend-up" : "fa-arrow-trend-down"} mr-1`} />
                {asset.c}
              </span>
            </div>
            <div className="mt-0.5 flex items-baseline justify-between">
              <span className="font-mono text-sm sm:text-base font-bold text-foreground">{asset.p}</span>
              <div className="flex gap-1.5 text-[10px] text-muted-foreground font-mono">
                <span>B:<span className="text-up ml-0.5">{asset.p[0]}{fmt(bid)}</span></span>
                <span>A:<span className="text-down ml-0.5">{asset.p[0]}{fmt(ask)}</span></span>
              </div>
            </div>
          </div>

          {/* Col 3: Shares Input */}
          <div className="lg:col-span-3 rounded border border-border bg-card/60 px-3 py-2">
            <div className="flex items-center justify-between text-[11px] text-muted-foreground">
              <span>Amount / Shares</span>
              <span className="font-mono text-[10px] text-muted-foreground/80">≈ {fmt(cost)} {currency}</span>
            </div>
            <div className="mt-0.5 flex items-center justify-between gap-2">
              <input
                value={qty}
                onChange={(e) => setQty(e.target.value.replace(/[^0-9.]/g, ""))}
                placeholder="1"
                className="w-full min-w-0 border-none bg-transparent p-0 font-mono text-sm sm:text-base font-bold text-foreground focus-visible:outline-none"
              />
              <span className="font-mono text-xs font-bold text-muted-foreground shrink-0">{asset.t}</span>
            </div>
          </div>

          {/* Col 4: Balance / Funding info */}
          <div className="lg:col-span-2 flex flex-col justify-center text-xs">
            <div className="flex items-center justify-between text-muted-foreground text-[11px]">
              <span className="truncate">{action === "buy" ? `Avbl: ${fmt(availableFunds, 0)} ${currency}` : `Hold: ${fmt(heldQty, 0)} ${asset.t}`}</span>
              <Link to="/deposit" className="text-[11px] font-bold text-primary hover:underline ml-1 shrink-0">
                + Deposit
              </Link>
            </div>
            <div className="mt-1 flex items-center gap-1.5 text-foreground font-medium text-xs truncate">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 shrink-0 animate-pulse" />
              Funding + Spot
            </div>
          </div>

          {/* Col 5: Action Button */}
          <div className="lg:col-span-2">
            {insufficientFunds ? (
              <Link
                to="/deposit"
                className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-up px-4 py-2.5 text-xs sm:text-sm font-bold uppercase tracking-wider text-white transition-opacity hover:opacity-90 shadow-sm"
              >
                Add {currency}
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
                className={`w-full rounded-xl px-4 py-2.5 text-xs sm:text-sm font-bold uppercase tracking-wider text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40 shadow-sm ${
                  action === "buy" ? "bg-up" : "bg-down"
                }`}
              >
                {action} {asset.t}
              </button>
            )}
          </div>
        </div>
        {insufficientFunds && (
          <p className="mt-2 text-xs font-medium text-down">
            Insufficient {currency} in Funding + Spot.
          </p>
        )}
        {insufficientHoldings && (
          <p className="mt-2 text-xs font-medium text-down">
            You only hold {fmt(heldQty, 0)} {asset.t}.
          </p>
        )}
      </div>
    );
  }

  if (!auth.isLoggedIn) {
    return (
      <div className={`rounded-md sm:rounded-2xl border border-overlay-border bg-surface p-3 sm:p-5 text-center shrink-0 ${className ?? ""}`}>
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
      <div className={`rounded-md sm:rounded-2xl border border-overlay-border bg-surface p-3 sm:p-5 text-center shrink-0 ${className ?? ""}`}>
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
      <div className={`rounded-md sm:rounded-2xl border border-overlay-border bg-surface p-3 sm:p-5 text-center shrink-0 ${className ?? ""}`}>
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
    <div className={`rounded sm:rounded-2xl border border-overlay-border bg-surface p-2.5 sm:p-5 shrink-0 flex flex-col ${className ?? ""}`}>
      {/* ── Buy/Sell tabs + order type ── */}
      <div className="flex items-center justify-between gap-1.5 sm:gap-3">
        <div className="grid flex-1 grid-cols-2 gap-1 sm:gap-1.5 rounded bg-background/60 p-1">
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
            className="flex items-center gap-1 sm:gap-1.5 rounded border border-border bg-card px-2 py-1.5 sm:px-3 text-[11px] sm:text-xs font-semibold text-foreground transition-colors hover:bg-secondary hover:text-primary"
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
        <div className="flex w-full items-center justify-between rounded border border-border bg-card px-2 sm:px-3 py-2 sm:py-2.5 transition-colors focus-within:border-primary">
          <span className="text-[11px] sm:text-xs text-muted-foreground">Price</span>
          <div className="flex items-center gap-1.5 sm:gap-2">
            <span className="text-[13px] sm:text-sm font-mono font-semibold">{asset.p}</span>
          </div>
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
      <div className="mt-4 flex items-center justify-between rounded sm:rounded-xl border border-border bg-background/40 px-2 sm:px-4 py-2 sm:py-3">
        <div>
          <div className="text-[10px] sm:text-[11px] font-medium text-muted-foreground">Pay from</div>
          <div className="text-sm sm:text-base font-semibold text-foreground flex items-center gap-1.5 mt-0.5">
            Funding + Spot
            <i className="fa-solid fa-angle-down text-[10px] sm:text-xs text-muted-foreground" />
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className="text-[10px] sm:text-[11px] font-medium text-muted-foreground">Avbl 0 USDT</div>
          <button type="button" className="text-[11px] sm:text-xs font-bold text-primary hover:text-primary/80 transition-colors mt-0.5">
            <i className="fa-solid fa-plus mr-1" />
            Deposit
          </button>
        </div>
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
