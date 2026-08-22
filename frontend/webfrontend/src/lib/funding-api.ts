/**
 * Typed wrappers over the backend's `/funding/*` and `/admin/funding/*` routes — the
 * reviewed money rail.
 *
 * These are the only user-facing money-movement calls; there is no direct endpoint that
 * mints or removes book money without review. A request settles only once a human on the `ADMIN_EMAILS` allowlist
 * approves it: a deposit credits nothing until then, and a withdrawal locks its amount
 * into `reserved` the moment it is placed. See `backend/app/schemas/funding.py`.
 *
 * Types mirror that schema field-for-field, and `Amount`/`Money` fields stay strings for
 * the same reason `trading-api.ts` keeps them as strings: the backend serialises `Decimal`
 * in positional notation to protect precision in transit.
 */
import { apiFetch } from "@/lib/api";
import type { SettlementCurrency } from "@/lib/trading-api";

// --------------------------------------------------------------------------------------- //
// Enums
// --------------------------------------------------------------------------------------- //

export const FUNDING_KINDS = ["deposit", "withdrawal"] as const;
export type FundingKind = (typeof FUNDING_KINDS)[number];

export const FUNDING_STATUSES = ["pending", "completed", "cancelled"] as const;
export type FundingStatus = (typeof FUNDING_STATUSES)[number];

/** The settlement rails the venue accepts — bank rails and chains, never free text. */
export const FUNDING_NETWORKS = [
  "UPI",
  "IMPS",
  "NEFT",
  "RTGS",
  "SEPA",
  "SWIFT",
  "TRC20",
  "BEP20",
  "ERC20",
  "SOL",
  "POLYGON",
  "ARBITRUM",
] as const;
export type FundingNetwork = (typeof FUNDING_NETWORKS)[number];

// --------------------------------------------------------------------------------------- //
// Response shapes
// --------------------------------------------------------------------------------------- //

export type FundingRequest = {
  id: string;
  uid: string;
  email: string | null;
  kind: FundingKind;
  status: FundingStatus;
  currency: string;
  amount: string;
  network: FundingNetwork;
  /** Withdrawals only. */
  destination: string | null;
  /** Deposit only: receiving address captured when the claim was created. */
  deposit_address: string | null;
  reference: string | null;
  /** Withdrawals only: whether the amount actually locked. `false` means it cannot be approved. */
  funded: boolean;
  resolution_note: string | null;
  /** `"user"` for a self-cancellation, otherwise the reviewer's uid. */
  resolved_by: string | null;
  resolved_at: string | null;
  ledger_entry_id: string | null;
  created_at: string;
  updated_at: string;
};

export type CurrencyTotal = {
  currency: string;
  available: string;
  reserved: string;
  total: string;
  wallets: number;
};

export type FundingSummary = {
  pending_deposits: number;
  pending_withdrawals: number;
  balances: CurrencyTotal[];
  at: string;
};

// --------------------------------------------------------------------------------------- //
// Request shapes
// --------------------------------------------------------------------------------------- //

/**
 * Shared by both directions. `idempotency_key` is required — replaying one returns the
 * original request rather than queueing a second claim for the same transfer.
 */
type FundingBase = {
  currency: SettlementCurrency;
  amount: string;
  network: FundingNetwork;
  idempotency_key: string;
  reference?: string;
};

export type DepositRequestInput = FundingBase & { reference: string };

export type WithdrawalRequestInput = FundingBase & {
  /** The user's own account or wallet address — where the payout should go. */
  destination: string;
};

export type ReviewDecisionInput = { note?: string };

// --------------------------------------------------------------------------------------- //
// Calls — the user's own queue
// --------------------------------------------------------------------------------------- //

/**
 * `POST /funding/deposits` — records a claim that money was sent. **Credits nothing**: the
 * balance moves only once a reviewer confirms it, which is what makes this the honest path
 * for what has not actually arrived yet. `409` if the network cannot carry the currency or
 * the idempotency key is already in flight.
 */
export function reportDeposit(
  input: DepositRequestInput,
  token: string,
  signal?: AbortSignal,
): Promise<FundingRequest> {
  return apiFetch<FundingRequest>("/funding/deposits", {
    method: "POST",
    token,
    body: input,
    ...(signal ? { signal } : {}),
  });
}

/**
 * `POST /funding/withdrawals` — locks the amount immediately, moving it from `available`
 * into `reserved` until a reviewer approves or declines. `409` when `available` is short.
 */
export function requestWithdrawalFunding(
  input: WithdrawalRequestInput,
  token: string,
  signal?: AbortSignal,
): Promise<FundingRequest> {
  return apiFetch<FundingRequest>("/funding/withdrawals", {
    method: "POST",
    token,
    body: input,
    ...(signal ? { signal } : {}),
  });
}

/** `GET /funding/requests` — the wallet's own deposit/withdrawal history, newest first. */
export function listFundingRequests(
  token: string,
  options: { kind?: FundingKind; status?: FundingStatus; currency?: string; limit?: number } = {},
  signal?: AbortSignal,
): Promise<FundingRequest[]> {
  const search = new URLSearchParams();
  if (options.kind) search.append("kind", options.kind);
  if (options.status) search.append("status", options.status);
  if (options.currency) search.append("currency", options.currency);
  search.append("limit", String(options.limit ?? 50));
  return apiFetch<FundingRequest[]>(`/funding/requests?${search.toString()}`, {
    token,
    ...(signal ? { signal } : {}),
  });
}

/** `DELETE /funding/requests/{id}` — only while still `pending`. Releases a withdrawal's lock. */
export function cancelFundingRequest(
  requestId: string,
  token: string,
  signal?: AbortSignal,
): Promise<FundingRequest> {
  return apiFetch<FundingRequest>(`/funding/requests/${requestId}`, {
    method: "DELETE",
    token,
    ...(signal ? { signal } : {}),
  });
}

// --------------------------------------------------------------------------------------- //
// Calls — the admin review queue
// --------------------------------------------------------------------------------------- //

/**
 * `GET /admin/funding/requests` — every user's requests, newest first. `403` unless the
 * caller's verified email is on the backend's `ADMIN_EMAILS` allowlist.
 */
export function adminListFundingRequests(
  token: string,
  options: {
    kind?: FundingKind;
    status?: FundingStatus;
    currency?: string;
    uid?: string;
    limit?: number;
  } = {},
  signal?: AbortSignal,
): Promise<FundingRequest[]> {
  const search = new URLSearchParams();
  if (options.kind) search.append("kind", options.kind);
  if (options.status) search.append("status", options.status);
  if (options.currency) search.append("currency", options.currency);
  if (options.uid) search.append("uid", options.uid);
  search.append("limit", String(options.limit ?? 50));
  return apiFetch<FundingRequest[]>(`/admin/funding/requests?${search.toString()}`, {
    token,
    ...(signal ? { signal } : {}),
  });
}

/** `GET /admin/funding/summary` — pending counts and what the venue holds, per currency. */
export function adminFundingSummary(token: string, signal?: AbortSignal): Promise<FundingSummary> {
  return apiFetch<FundingSummary>("/admin/funding/summary", {
    token,
    ...(signal ? { signal } : {}),
  });
}

/**
 * `POST /admin/funding/requests/{id}/approve` — credits a deposit or pays out a
 * withdrawal from what it locked. `409` if it is no longer pending, or a withdrawal whose
 * lock never completed.
 */
export function adminApproveFundingRequest(
  requestId: string,
  input: ReviewDecisionInput,
  token: string,
  signal?: AbortSignal,
): Promise<FundingRequest> {
  return apiFetch<FundingRequest>(`/admin/funding/requests/${requestId}/approve`, {
    method: "POST",
    token,
    body: input,
    ...(signal ? { signal } : {}),
  });
}

/**
 * `POST /admin/funding/requests/{id}/decline` — moves it to `cancelled` and releases a
 * withdrawal's lock. `note` is shown to the user, so say why.
 */
export function adminDeclineFundingRequest(
  requestId: string,
  input: ReviewDecisionInput,
  token: string,
  signal?: AbortSignal,
): Promise<FundingRequest> {
  return apiFetch<FundingRequest>(`/admin/funding/requests/${requestId}/decline`, {
    method: "POST",
    token,
    body: input,
    ...(signal ? { signal } : {}),
  });
}

// --------------------------------------------------------------------------------------- //
// Helpers
// --------------------------------------------------------------------------------------- //

/** An `idempotency_key` the server will accept: `^[A-Za-z0-9_-]{8,64}$`. */
export function newIdempotencyKey(): string {
  const random = Math.random().toString(36).slice(2, 10);
  return `s360-${Date.now().toString(36)}-${random}`.slice(0, 64);
}
