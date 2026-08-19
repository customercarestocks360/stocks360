/**
 * The order ticket, wired to the real venue at `POST /trading/orders`.
 *
 * Three things this has to get right that a simulated ticket did not:
 *
 * 1. **A `201` is not a fill.** The venue answers with the order in whatever state it
 *    settled into — `filled`, `open`, `cancelled` (an IOC that could not fill) or `rejected`
 *    (the market moved past the reservation). The confirmation reads that status instead of
 *    assuming success, so "order filled" is only ever shown when it was.
 * 2. **Eligibility is the server's answer, not a local guess.** `GET /trading/eligibility`
 *    reports `can_trade` plus a per-asset-class `enabled` / `pending_review` / `reason`, so a
 *    product still under review says so in the venue's own words rather than being silently
 *    treated as tradable.
 * 3. **Bid and ask are only shown when a feed publishes them.** FX always does, crypto
 *    usually does, equities never do. The previous ticket invented a flat ±0.2 % spread off
 *    the display price for all three.
 *
 * Client-side validation deliberately mirrors the server's rules (`limit_price` only on
 * limit/stop-limit, stop direction, funds and units) so the common rejection is caught before
 * a request goes out — but the server is still the authority and its error is what gets shown.
 */
import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ApiError } from "@/lib/api";
import { decimalsFor, formatPrice, type TradeInstrument } from "@/lib/instrument";
import {
  describeOutcome,
  newClientOrderId,
  type Order,
  type OrderType,
  type TimeInForce,
} from "@/lib/trading-api";
import type { TradingState } from "@/hooks/useTrading";

/** Only the subset a spot desk needs; the venue also accepts these four and nothing else. */
const TICKET_ORDER_TYPES: { value: OrderType; label: string }[] = [
  { value: "market", label: "Market" },
  { value: "limit", label: "Limit" },
  { value: "stop", label: "Stop" },
  { value: "stop_limit", label: "Stop limit" },
];

/** A market order is always IOC server-side, so the selector is hidden for it. */
const RESTING_TIF: { value: TimeInForce; label: string }[] = [
  { value: "gtc", label: "GTC" },
  { value: "day", label: "Day" },
];

function fmt(n: number, decimals = 2) {
  return n.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function Shell({
  children,
  className,
  padded = true,
}: {
  children: React.ReactNode;
  className?: string | undefined;
  padded?: boolean;
}) {
  return (
    <div
      className={`rounded border border-overlay-border bg-surface shadow-sm sm:rounded-2xl ${
        padded ? "p-3 sm:p-5" : ""
      } ${className ?? ""}`}
    >
      {children}
    </div>
  );
}

function Gate({
  icon,
  title,
  body,
  ctaLabel,
  to,
  search,
  horizontal,
  className,
}: {
  icon: string;
  title: string;
  body: string;
  ctaLabel?: string | undefined;
  to?: "/login" | "/account" | "/kyc" | undefined;
  search?: { tab: "account" } | undefined;
  horizontal: boolean;
  className?: string | undefined;
}) {
  const cta =
    ctaLabel && to ? (
      <Link
        to={to}
        {...(search ? { search } : {})}
        className="shrink-0 rounded-xl bg-primary px-6 py-2.5 text-center text-sm font-bold uppercase tracking-wider text-primary-foreground transition-opacity hover:opacity-90"
      >
        {ctaLabel}
      </Link>
    ) : null;

  if (horizontal) {
    return (
      <Shell
        className={`flex flex-col items-center justify-between gap-4 sm:flex-row ${className ?? ""}`}
      >
        <div className="flex items-center gap-3.5">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-secondary text-primary">
            <i className={`fa-solid ${icon} text-sm`} />
          </div>
          <div>
            <h3 className="text-sm font-bold text-foreground">{title}</h3>
            <p className="text-xs text-muted-foreground">{body}</p>
          </div>
        </div>
        {cta}
      </Shell>
    );
  }

  return (
    <Shell className={`shrink-0 text-center ${className ?? ""}`}>
      <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-secondary text-primary">
        <i className={`fa-solid ${icon} text-base`} />
      </div>
      <h3 className="mt-4 text-sm font-bold text-foreground">{title}</h3>
      <p className="mt-2 text-xs text-muted-foreground">{body}</p>
      {cta && <div className="mt-5 [&>a]:block [&>a]:w-full">{cta}</div>}
    </Shell>
  );
}

export function OrderTicket({
  instrument,
  action,
  onActionChange,
  trading,
  className,
  layout = "vertical",
}: {
  instrument: TradeInstrument;
  action: "buy" | "sell";
  onActionChange: (action: "buy" | "sell") => void;
  /** Hoisted from the page so one poller serves the ticket and the orders panel alike. */
  trading: TradingState;
  className?: string | undefined;
  layout?: "vertical" | "horizontal";
}) {
  const horizontal = layout === "horizontal";

  const [qty, setQty] = useState("1");
  const [orderType, setOrderType] = useState<OrderType>("market");
  const [limitPrice, setLimitPrice] = useState("");
  const [stopPrice, setStopPrice] = useState("");
  const [timeInForce, setTimeInForce] = useState<TimeInForce>("gtc");
  const [showOrderTypeMenu, setShowOrderTypeMenu] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [placedOrder, setPlacedOrder] = useState<Order | null>(null);
  const [serverError, setServerError] = useState("");

  const { symbol, label, assetClass, price, currency } = instrument;
  const decimals = decimalsFor(price);

  // Switching symbol or side should drop back to a fresh ticket rather than carrying a
  // confirmation or an error from the previous instrument.
  useEffect(() => {
    setPlacedOrder(null);
    setServerError("");
    setLimitPrice("");
    setStopPrice("");
  }, [symbol, action]);

  const eligibility = trading.eligibility;
  const classEligibility = eligibility?.asset_classes.find((c) => c.asset_class === assetClass);

  const qtyValue = Number(qty) || 0;
  const limitValue = Number(limitPrice) || 0;
  const stopValue = Number(stopPrice) || 0;
  const needsLimit = orderType === "limit" || orderType === "stop_limit";
  const needsStop = orderType === "stop" || orderType === "stop_limit";

  /** The price the order will actually reserve against, matching the server's own choice. */
  const referencePrice = needsLimit && limitValue > 0 ? limitValue : price;
  const notional = referencePrice !== null ? qtyValue * referencePrice : null;

  const availableFunds = currency ? trading.availableIn(currency) : 0;
  const heldUnits = trading.availableUnits(symbol);

  const validation = useMemo((): string => {
    if (qtyValue <= 0) return "Enter a quantity.";
    if (needsLimit && limitValue <= 0) return "Enter a limit price.";
    if (needsStop && stopValue <= 0) return "Enter a stop price.";
    // The venue enforces stop direction; catching it here saves a round trip.
    if (needsStop && price !== null) {
      if (action === "buy" && stopValue <= price)
        return `A buy stop triggers on the way up — set it above ${formatPrice(price, decimals)}.`;
      if (action === "sell" && stopValue >= price)
        return `A sell stop triggers on the way down — set it below ${formatPrice(price, decimals)}.`;
    }
    if (action === "buy" && notional !== null && currency && notional > availableFunds)
      return `This order needs ${fmt(notional, 2)} ${currency} and you have ${fmt(availableFunds, 2)} available.`;
    if (action === "sell" && qtyValue > heldUnits)
      return `You hold ${heldUnits} ${label} free to sell. This venue is long-only spot.`;
    return "";
  }, [
    qtyValue,
    needsLimit,
    limitValue,
    needsStop,
    stopValue,
    price,
    action,
    decimals,
    notional,
    currency,
    availableFunds,
    heldUnits,
    label,
  ]);

  const needsDeposit =
    action === "buy" && notional !== null && !!currency && notional > availableFunds;

  const submit = async () => {
    if (validation || submitting) return;
    setSubmitting(true);
    setServerError("");
    try {
      const order = await trading.place({
        asset_class: assetClass,
        symbol,
        side: action,
        type: orderType,
        quantity: qty,
        // Sent only where they apply — the venue forbids them elsewhere outright (422).
        ...(needsLimit ? { limit_price: limitPrice } : {}),
        ...(needsStop ? { stop_price: stopPrice } : {}),
        ...(orderType === "market" ? {} : { time_in_force: timeInForce }),
        client_order_id: newClientOrderId(),
      });
      setPlacedOrder(order);
    } catch (err) {
      setServerError(
        err instanceof ApiError ? err.message : "Could not reach the venue. Please try again.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  const reset = () => {
    setPlacedOrder(null);
    setServerError("");
    setQty("1");
  };

  // ── Gates, in the order the server applies them ──────────────────────────────────────
  if (!trading.ready) {
    return (
      <Gate
        horizontal={horizontal}
        className={className}
        icon="fa-lock"
        title="Sign in required to trade"
        body={`Log in to buy or sell ${label}.`}
        ctaLabel="Go to sign in"
        to="/login"
      />
    );
  }

  if (trading.loading && !eligibility) {
    return (
      <Shell className={`${horizontal ? "" : "shrink-0"} ${className ?? ""}`}>
        <div className="flex items-center justify-center gap-2 py-4 text-xs text-muted-foreground">
          <i className="fa-solid fa-circle-notch fa-spin" />
          Loading your trading account…
        </div>
      </Shell>
    );
  }

  if (eligibility && !eligibility.can_trade) {
    const needsOnboarding =
      eligibility.onboarding_status !== "approved" &&
      eligibility.onboarding_status !== "under_review";
    return (
      <Gate
        horizontal={horizontal}
        className={className}
        icon="fa-id-card"
        title={needsOnboarding ? "Complete your account details" : "Account not cleared to trade"}
        body={
          needsOnboarding
            ? `Finish verification to unlock trading for ${label}.`
            : `Your KYC tier (${eligibility.kyc_tier}) does not permit trading yet.`
        }
        {...(needsOnboarding ? { ctaLabel: "Complete account details", to: "/kyc" as const } : {})}
      />
    );
  }

  if (classEligibility && !classEligibility.enabled) {
    return (
      <Gate
        horizontal={horizontal}
        className={className}
        icon={classEligibility.pending_review ? "fa-hourglass-half" : "fa-ban"}
        title={
          classEligibility.pending_review
            ? "Under review"
            : `${assetClass === "stocks" ? "Equities" : assetClass} not enabled`
        }
        body={
          classEligibility.reason ??
          "This product was not requested during onboarding, so it is not enabled on this account."
        }
      />
    );
  }

  if (placedOrder) {
    const outcome = describeOutcome(placedOrder);
    const body = (
      <>
        <div
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${
            outcome.ok ? "bg-up/10 text-up" : "bg-down/10 text-down"
          } ${horizontal ? "" : "mx-auto h-11 w-11"}`}
        >
          <i
            className={`fa-solid ${
              outcome.ok
                ? placedOrder.status === "filled"
                  ? "fa-check"
                  : "fa-hourglass-half"
                : "fa-circle-exclamation"
            } text-sm`}
          />
        </div>
        <div className={horizontal ? "" : "mt-4"}>
          <h3 className="text-sm font-bold text-foreground">
            {placedOrder.status === "filled"
              ? "Order filled"
              : placedOrder.status === "open"
                ? "Order resting"
                : placedOrder.status === "cancelled"
                  ? "Not filled"
                  : "Order rejected"}
          </h3>
          <p className={`text-xs text-muted-foreground ${horizontal ? "" : "mt-2"}`}>
            {outcome.message}
            {placedOrder.status === "filled" && Number(placedOrder.fee) > 0 && (
              <>
                {" "}
                · fee {placedOrder.fee} {placedOrder.currency}
              </>
            )}
          </p>
        </div>
      </>
    );

    return horizontal ? (
      <Shell
        className={`flex flex-col items-center justify-between gap-4 sm:flex-row ${className ?? ""}`}
      >
        <div className="flex items-center gap-3.5">{body}</div>
        <button
          type="button"
          onClick={reset}
          className="shrink-0 rounded-xl border border-border px-5 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-secondary"
        >
          Trade again
        </button>
      </Shell>
    ) : (
      <Shell className={`shrink-0 text-center ${className ?? ""}`}>
        {body}
        <button
          type="button"
          onClick={reset}
          className="mt-5 w-full rounded-xl border border-border px-4 py-2.5 text-sm font-semibold text-foreground transition-colors hover:bg-secondary"
        >
          Trade again
        </button>
      </Shell>
    );
  }

  // ── Shared field fragments ───────────────────────────────────────────────────────────
  const sideToggle = (
    <div className="grid flex-1 grid-cols-2 gap-1 rounded border border-border bg-background/60 p-1">
      {(["buy", "sell"] as const).map((side) => (
        <button
          key={side}
          type="button"
          onClick={() => onActionChange(side)}
          className={`rounded-md py-1.5 text-xs font-bold capitalize transition-colors sm:text-sm ${
            action === side
              ? side === "buy"
                ? "bg-up text-white shadow-sm"
                : "bg-down text-white shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {side}
        </button>
      ))}
    </div>
  );

  const orderTypePicker = (
    <div className="relative shrink-0">
      <button
        type="button"
        onClick={() => setShowOrderTypeMenu((v) => !v)}
        className="flex items-center gap-1.5 rounded border border-border bg-card px-3 py-2 text-xs font-semibold text-foreground transition-colors hover:bg-secondary hover:text-primary"
      >
        {TICKET_ORDER_TYPES.find((t) => t.value === orderType)?.label}
        <i
          className={`fa-solid fa-chevron-down text-[10px] text-muted-foreground transition-transform ${
            showOrderTypeMenu ? "rotate-180" : ""
          }`}
        />
      </button>
      {showOrderTypeMenu && (
        <ul className="absolute right-0 top-[calc(100%+0.35rem)] z-20 min-w-[120px] overflow-hidden rounded-lg border border-border bg-card p-1 shadow-xl">
          {TICKET_ORDER_TYPES.map((t) => (
            <li key={t.value}>
              <button
                type="button"
                onClick={() => {
                  setOrderType(t.value);
                  setShowOrderTypeMenu(false);
                }}
                className={`w-full whitespace-nowrap rounded-md px-3 py-1.5 text-left text-xs ${
                  orderType === t.value
                    ? "bg-secondary font-semibold text-foreground"
                    : "text-muted-foreground hover:bg-secondary/60"
                }`}
              >
                {t.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );

  const priceBlock = (
    <div className="rounded border border-border bg-card/60 px-3 py-2">
      <div className="flex items-center justify-between text-[11px] text-muted-foreground">
        <span>Last price</span>
        {instrument.changePercent !== null && (
          <span
            className={`font-mono text-[10px] ${instrument.changePercent >= 0 ? "text-up" : "text-down"}`}
          >
            <i
              className={`fa-solid ${
                instrument.changePercent >= 0 ? "fa-arrow-trend-up" : "fa-arrow-trend-down"
              } mr-1`}
            />
            {instrument.changePercent >= 0 ? "+" : ""}
            {instrument.changePercent.toFixed(2)}%
          </span>
        )}
      </div>
      <div className="mt-0.5 flex items-baseline justify-between gap-2">
        <span className="font-mono text-sm font-bold text-foreground sm:text-base">
          {formatPrice(price, decimals)}
          {currency && <span className="ml-1 text-[10px] text-muted-foreground">{currency}</span>}
        </span>
        {/* Only rendered where the feed actually publishes a book — equities never do. */}
        {(instrument.bid !== null || instrument.ask !== null) && (
          <div className="flex gap-1.5 font-mono text-[10px] text-muted-foreground">
            {instrument.bid !== null && (
              <span>
                B:<span className="ml-0.5 text-up">{formatPrice(instrument.bid, decimals)}</span>
              </span>
            )}
            {instrument.ask !== null && (
              <span>
                A:<span className="ml-0.5 text-down">{formatPrice(instrument.ask, decimals)}</span>
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );

  const qtyBlock = (
    <div className="rounded border border-border bg-card/60 px-3 py-2">
      <div className="flex items-center justify-between text-[11px] text-muted-foreground">
        <span>Quantity</span>
        <span className="font-mono text-[10px] text-muted-foreground/80">
          ≈ {notional === null ? "—" : fmt(notional, 2)} {currency ?? ""}
        </span>
      </div>
      <div className="mt-0.5 flex items-center justify-between gap-2">
        <input
          value={qty}
          onChange={(e) => setQty(e.target.value.replace(/[^0-9.]/g, ""))}
          inputMode="decimal"
          placeholder="1"
          className="w-full min-w-0 border-none bg-transparent p-0 font-mono text-sm font-bold text-foreground focus-visible:outline-none sm:text-base"
        />
        <span className="shrink-0 font-mono text-xs font-bold text-muted-foreground">{label}</span>
      </div>
    </div>
  );

  const conditionalPrices = (needsLimit || needsStop) && (
    <div className={`grid gap-2 ${needsLimit && needsStop ? "grid-cols-2" : "grid-cols-1"}`}>
      {needsStop && (
        <label className="rounded border border-border bg-card/60 px-3 py-2">
          <span className="block text-[11px] text-muted-foreground">Stop price</span>
          <input
            value={stopPrice}
            onChange={(e) => setStopPrice(e.target.value.replace(/[^0-9.]/g, ""))}
            inputMode="decimal"
            placeholder={formatPrice(price, decimals)}
            className="mt-0.5 w-full border-none bg-transparent p-0 font-mono text-sm font-bold text-foreground focus-visible:outline-none"
          />
        </label>
      )}
      {needsLimit && (
        <label className="rounded border border-border bg-card/60 px-3 py-2">
          <span className="block text-[11px] text-muted-foreground">Limit price</span>
          <input
            value={limitPrice}
            onChange={(e) => setLimitPrice(e.target.value.replace(/[^0-9.]/g, ""))}
            inputMode="decimal"
            placeholder={formatPrice(price, decimals)}
            className="mt-0.5 w-full border-none bg-transparent p-0 font-mono text-sm font-bold text-foreground focus-visible:outline-none"
          />
        </label>
      )}
    </div>
  );

  const tifPicker = orderType !== "market" && (
    <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
      <span>Time in force</span>
      <div className="flex gap-1">
        {RESTING_TIF.map((t) => (
          <button
            key={t.value}
            type="button"
            onClick={() => setTimeInForce(t.value)}
            className={`rounded border px-2 py-0.5 font-mono text-[10px] transition-colors ${
              timeInForce === t.value
                ? "border-primary bg-primary font-bold text-primary-foreground"
                : "border-border text-muted-foreground hover:text-foreground"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
    </div>
  );

  const fundsLine = (
    <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
      <span className="truncate">
        {action === "buy"
          ? `Available ${fmt(availableFunds, 2)} ${currency ?? ""}`
          : `Free to sell ${heldUnits} ${label}`}
      </span>
      <Link to="/deposit" className="shrink-0 font-bold text-primary hover:underline">
        + Deposit
      </Link>
    </div>
  );

  const messages = (
    <>
      {serverError && <p className="mt-2 text-xs font-medium text-down">{serverError}</p>}
      {!serverError && validation && qty !== "" && (
        <p className="mt-2 text-xs font-medium text-muted-foreground">{validation}</p>
      )}
      {instrument.stale && orderType === "market" && (
        <p className="mt-2 text-xs font-medium text-muted-foreground">
          This market looks closed — a market order will be refused, but a resting order will wait.
        </p>
      )}
    </>
  );

  const submitButton = needsDeposit ? (
    <Link
      to="/deposit"
      className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-up px-4 py-2.5 text-xs font-bold uppercase tracking-wider text-white shadow-sm transition-opacity hover:opacity-90 sm:text-sm"
    >
      Add {currency}
    </Link>
  ) : (
    <button
      type="button"
      disabled={!!validation || submitting}
      onClick={() => void submit()}
      className={`flex w-full items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-xs font-bold uppercase tracking-wider text-white shadow-sm transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40 sm:text-sm ${
        action === "buy" ? "bg-up" : "bg-down"
      }`}
    >
      {submitting && <i className="fa-solid fa-circle-notch fa-spin" />}
      {submitting ? "Placing…" : `${action} ${label}`}
    </button>
  );

  if (horizontal) {
    return (
      <Shell className={className}>
        <div className="grid grid-cols-1 items-center gap-4 md:grid-cols-2 lg:grid-cols-12 lg:gap-5">
          <div className="flex items-center gap-2 lg:col-span-3">
            {sideToggle}
            {orderTypePicker}
          </div>
          <div className="lg:col-span-2">{priceBlock}</div>
          <div className="lg:col-span-2">{qtyBlock}</div>
          <div className="lg:col-span-3 space-y-2">
            {conditionalPrices}
            {tifPicker}
            {!conditionalPrices && !tifPicker && fundsLine}
          </div>
          <div className="lg:col-span-2">{submitButton}</div>
        </div>
        {(conditionalPrices || tifPicker) && <div className="mt-3">{fundsLine}</div>}
        {messages}
      </Shell>
    );
  }

  return (
    <Shell className={`flex shrink-0 flex-col ${className ?? ""}`} padded={false}>
      <div className="space-y-4 p-2.5 sm:p-5">
        <div className="flex items-center justify-between gap-1.5 sm:gap-3">
          {sideToggle}
          {orderTypePicker}
        </div>
        {priceBlock}
        {conditionalPrices}
        {qtyBlock}
        {tifPicker}
        {fundsLine}
        {messages}
        {submitButton}
      </div>
    </Shell>
  );
}
