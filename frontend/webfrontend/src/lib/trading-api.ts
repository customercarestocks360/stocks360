/**
 * Typed wrappers over the backend's `/trading/*` routes — the simulated venue that owns
 * orders, balances, positions and the cash ledger.
 *
 * **What this venue is.** A paper-trading ledger, not a broker. Orders execute against the
 * same live market data the read endpoints serve, and cash is book money the API creates on
 * request. There is no matching engine and no depth: a resting order fills against the feed
 * price, never against another user. Read the backend's own docstrings before assuming
 * otherwise — they are explicit about it.
 *
 * **Three things that shape every caller here:**
 *
 * 1. **A `201` from `POST /trading/orders` does not mean "filled."** The returned `status`
 *    may be `filled`, `open` (resting), `cancelled` (an `ioc` that could not fill) or
 *    `rejected` (the market moved past the reservation). Callers must read `status` rather
 *    than treating a 2xx as success.
 * 2. **Every money and quantity field is a JSON string**, not a number. The backend
 *    serialises `Decimal` in positional notation (`"0.00000000"`, never `"0E-8"`) so no
 *    precision is lost in transit. They stay strings here and are parsed at the point of
 *    use.
 * 3. **There is no push channel.** The matcher runs server-side but exposes no socket, so
 *    order and fill state must be polled.
 *
 * Types mirror `backend/app/schemas/trading.py` field-for-field. The request models are
 * declared `extra="forbid"`, so a stray field is a `422` rather than a silent drop.
 */
import { apiFetch } from "@/lib/api";
import type { KycTier, OnboardingStatus, Product } from "@/lib/onboarding-api";

// --------------------------------------------------------------------------------------- //
// Enums
// --------------------------------------------------------------------------------------- //

export const ASSET_CLASSES = ["crypto", "forex", "stocks"] as const;
export type AssetClass = (typeof ASSET_CLASSES)[number];

export const ORDER_SIDES = ["buy", "sell"] as const;
export type OrderSide = (typeof ORDER_SIDES)[number];

export const ORDER_TYPES = ["market", "limit", "stop", "stop_limit"] as const;
export type OrderType = (typeof ORDER_TYPES)[number];

/**
 * `fok` is deliberately absent server-side: fills are all-or-nothing here, so fill-or-kill
 * and immediate-or-cancel would be the same instruction under two names.
 */
export const TIME_IN_FORCE = ["gtc", "day", "ioc"] as const;
export type TimeInForce = (typeof TIME_IN_FORCE)[number];

/** No `partially_filled`: a fill takes the whole order at one price. */
export const ORDER_STATUSES = ["open", "filled", "cancelled", "expired", "rejected"] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export type MarketState = "open" | "closed" | "unknown";

/** The only currencies this venue will hold. An instrument quoted in anything else is a 409. */
export const SETTLEMENT_CURRENCIES = [
  "USD",
  "EUR",
  "GBP",
  "JPY",
  "CHF",
  "AUD",
  "CAD",
  "NZD",
  "INR",
  "AED",
  "SGD",
  "HKD",
  "CNY",
  "ZAR",
  "BRL",
  "USDT",
  "USDC",
] as const;
export type SettlementCurrency = (typeof SETTLEMENT_CURRENCIES)[number];

export const LEDGER_KINDS = [
  "deposit",
  "withdrawal",
  "reserve",
  "release",
  "trade_debit",
  "trade_credit",
  "fee",
] as const;
export type LedgerKind = (typeof LEDGER_KINDS)[number];

// --------------------------------------------------------------------------------------- //
// Response shapes — every `Amount` is a decimal string, never a number
// --------------------------------------------------------------------------------------- //

export type Order = {
  id: string;
  client_order_id: string | null;
  asset_class: AssetClass;
  symbol: string;
  side: OrderSide;
  type: OrderType;
  time_in_force: TimeInForce;
  status: OrderStatus;
  /** Quote currency — what the order settles in. */
  currency: string;
  quantity: string;
  filled_quantity: string;
  limit_price: string | null;
  stop_price: string | null;
  triggered: boolean;
  /** Traded price, once filled. */
  average_price: string | null;
  filled_notional: string | null;
  fee: string;
  reserved_amount: string;
  reserved_quantity: string;
  reject_reason: string | null;
  created_at: string;
  updated_at: string;
  /** Set on a `day` order — 23:59:59 UTC of the placement day. */
  expires_at: string | null;
  closed_at: string | null;
};

export type Trade = {
  id: string;
  order_id: string;
  asset_class: AssetClass;
  symbol: string;
  side: OrderSide;
  currency: string;
  quantity: string;
  price: string;
  notional: string;
  fee: string;
  /** Present on sells only. */
  realized_pnl: string | null;
  at: string;
};

export type Position = {
  asset_class: AssetClass;
  symbol: string;
  currency: string;
  /** Total held, including units locked by open sell orders. */
  quantity: string;
  available_quantity: string;
  reserved_quantity: string;
  /** Cost basis per unit including entry fee. `null` once flat. */
  average_price: string | null;
  cost_basis: string;
  realized_pnl: string;
  updated_at: string;
};

/** A `Position` marked to market. A `null` mark means the feed had no usable price — not zero. */
export type PositionValuation = Position & {
  last_price: string | null;
  market_value: string | null;
  unrealized_pnl: string | null;
  unrealized_pnl_percent: string | null;
  market_state: MarketState;
  stale: boolean;
};

export type Balance = {
  currency: string;
  /** Free to spend or withdraw. */
  available: string;
  /** Locked by open buy orders. */
  reserved: string;
  total: string;
};

export type LedgerEntry = {
  id: string;
  currency: string;
  kind: LedgerKind;
  /** Signed from the point of view of `available` — can be negative or zero. */
  amount: string;
  available_after: string;
  reserved_after: string;
  order_id: string | null;
  trade_id: string | null;
  reference: string | null;
  at: string;
};

export type AssetClassEligibility = {
  asset_class: AssetClass;
  products: Product[];
  enabled: boolean;
  pending_review: boolean;
  /** `unknown` for equities, whose session is per-symbol rather than per-feed. */
  market_state: MarketState;
  reason: string | null;
};

export type Eligibility = {
  uid: string;
  onboarding_status: OnboardingStatus;
  kyc_tier: KycTier;
  can_trade: boolean;
  base_currency: string | null;
  /** Always exactly three, in crypto/forex/stocks order. */
  asset_classes: AssetClassEligibility[];
  at: string;
};

export type Account = {
  uid: string;
  base_currency: string | null;
  onboarding_status: OnboardingStatus;
  kyc_tier: KycTier;
  enabled_products: Product[];
  pending_products: Product[];
  balances: Balance[];
  open_orders: number;
  positions: number;
  at: string;
};

/**
 * No grand total: adding INR to USDT would need an FX rate this API has no licensed source
 * for, so totals are per currency. The three maps do **not** share key sets — the market
 * value and unrealized maps only carry currencies that had a priced position.
 */
export type Portfolio = {
  uid: string;
  balances: Balance[];
  positions: PositionValuation[];
  market_value_by_currency: Record<string, string>;
  unrealized_pnl_by_currency: Record<string, string>;
  realized_pnl_by_currency: Record<string, string>;
  priced: number;
  unpriced: number;
  at: string;
};

// --------------------------------------------------------------------------------------- //
// Request shapes
// --------------------------------------------------------------------------------------- //

/**
 * `limit_price` is required for `limit`/`stop_limit` and **must be omitted** otherwise;
 * `stop_price` likewise for `stop`/`stop_limit`. Sending one where it does not apply is a
 * `422`, which is why the builder below strips them rather than sending nulls.
 */
export type OrderRequest = {
  asset_class: AssetClass;
  symbol: string;
  side: OrderSide;
  type?: OrderType;
  quantity: string;
  limit_price?: string;
  stop_price?: string;
  time_in_force?: TimeInForce;
  client_order_id?: string;
};

// --------------------------------------------------------------------------------------- //
// Calls
// --------------------------------------------------------------------------------------- //

function query(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) search.append(key, String(value));
  }
  const qs = search.toString();
  return qs ? `?${qs}` : "";
}

/** `GET /trading/eligibility` — whether this account may trade, and which classes are open. */
export function fetchEligibility(token: string, signal?: AbortSignal): Promise<Eligibility> {
  return apiFetch<Eligibility>("/trading/eligibility", { token, ...(signal ? { signal } : {}) });
}

/** `GET /trading/balances` — cash per currency, newest state. Works even when trading is disabled. */
export function fetchBalances(token: string, signal?: AbortSignal): Promise<Balance[]> {
  return apiFetch<Balance[]>("/trading/balances", { token, ...(signal ? { signal } : {}) });
}

export function fetchAccount(token: string, signal?: AbortSignal): Promise<Account> {
  return apiFetch<Account>("/trading/account", { token, ...(signal ? { signal } : {}) });
}

export function fetchPortfolio(token: string, signal?: AbortSignal): Promise<Portfolio> {
  return apiFetch<Portfolio>("/trading/portfolio", { token, ...(signal ? { signal } : {}) });
}

/**
 * `GET /trading/orders` — newest first, `limit` 1-200. `status` is repeatable; passing
 * several is an OR, and passing none returns every status.
 */
export function fetchOrders(
  token: string,
  options: {
    status?: readonly OrderStatus[];
    assetClass?: AssetClass;
    symbol?: string;
    limit?: number;
  } = {},
  signal?: AbortSignal,
): Promise<Order[]> {
  const search = new URLSearchParams();
  options.status?.forEach((s) => search.append("status", s));
  if (options.assetClass) search.append("asset_class", options.assetClass);
  if (options.symbol) search.append("symbol", options.symbol);
  search.append("limit", String(options.limit ?? 50));
  return apiFetch<Order[]>(`/trading/orders?${search.toString()}`, {
    token,
    ...(signal ? { signal } : {}),
  });
}

export function fetchTrades(
  token: string,
  options: { assetClass?: AssetClass; symbol?: string; limit?: number } = {},
  signal?: AbortSignal,
): Promise<Trade[]> {
  return apiFetch<Trade[]>(
    `/trading/trades${query({
      asset_class: options.assetClass,
      symbol: options.symbol,
      limit: options.limit ?? 50,
    })}`,
    { token, ...(signal ? { signal } : {}) },
  );
}

/** `GET /trading/positions` — long-only spot holdings. Flat positions are excluded by default. */
export function fetchPositions(
  token: string,
  includeFlat = false,
  signal?: AbortSignal,
): Promise<Position[]> {
  return apiFetch<Position[]>(`/trading/positions${query({ include_flat: String(includeFlat) })}`, {
    token,
    ...(signal ? { signal } : {}),
  });
}

/**
 * `POST /trading/orders`. Returns `201` with the order in whatever state it settled into —
 * **check `status`**, since `cancelled` and `rejected` also arrive as `201`.
 *
 * Failure modes worth handling by status code: `403` not eligible (onboarding/KYC or a
 * product not enabled), `404` unknown instrument, `409` insufficient funds / duplicate
 * `client_order_id` / market closed to a market order / open-order cap, `422` a malformed
 * combination (price band, stop direction, notional bounds), `503` trading disabled or no
 * price available.
 */
export function placeOrder(
  request: OrderRequest,
  token: string,
  signal?: AbortSignal,
): Promise<Order> {
  // Undefined keys are stripped rather than sent as null: the server forbids `limit_price`
  // on a market order outright, and `extra="forbid"` makes a stray key a 422.
  const body: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(request)) {
    if (value !== undefined) body[key] = value;
  }
  return apiFetch<Order>("/trading/orders", {
    method: "POST",
    token,
    body,
    ...(signal ? { signal } : {}),
  });
}

/**
 * `DELETE /trading/orders/{id}` — open orders only. Answers `200` with the cancelled order
 * (not `204`), `404` if it does not exist or belongs to someone else, `409` if it already
 * left the open state.
 */
export function cancelOrder(orderId: string, token: string, signal?: AbortSignal): Promise<Order> {
  return apiFetch<Order>(`/trading/orders/${orderId}`, {
    method: "DELETE",
    token,
    ...(signal ? { signal } : {}),
  });
}

// --------------------------------------------------------------------------------------- //
// Small helpers shared by the trading UI
// --------------------------------------------------------------------------------------- //

/** `Number("")` is 0, which would read as a real zero rather than an absent field. */
export function amount(raw: string | null | undefined): number | null {
  if (raw === null || raw === undefined || raw === "") return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

/** A `client_order_id` the server will accept: `^[A-Za-z0-9_-]{8,64}$`. */
export function newClientOrderId(): string {
  const random = Math.random().toString(36).slice(2, 10);
  return `s360-${Date.now().toString(36)}-${random}`.slice(0, 64);
}

/** True while an order can still be cancelled. */
export function isOpen(order: Order): boolean {
  return order.status === "open";
}

/**
 * What actually happened to a just-placed order, as one line for the user. A `201` covers
 * four different outcomes, so the ticket cannot just say "order placed".
 */
export function describeOutcome(order: Order): { ok: boolean; message: string } {
  switch (order.status) {
    case "filled":
      return {
        ok: true,
        message: `Filled ${order.filled_quantity} ${order.symbol} at ${order.average_price ?? "—"} ${order.currency}`,
      };
    case "open":
      return {
        ok: true,
        message: `Order resting — ${order.quantity} ${order.symbol} ${order.side} (${order.time_in_force.toUpperCase()})`,
      };
    case "cancelled":
      return {
        ok: false,
        message: order.reject_reason ?? "Order was cancelled without filling.",
      };
    case "rejected":
      return { ok: false, message: order.reject_reason ?? "Order was rejected." };
    case "expired":
      return { ok: false, message: "Order expired before it could fill." };
  }
}
