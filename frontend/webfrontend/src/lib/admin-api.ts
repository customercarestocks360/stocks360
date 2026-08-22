import { apiFetch } from "@/lib/api";
import type { KycTier, OnboardingStatus, Product } from "@/lib/onboarding-api";
import type { Account, LedgerEntry, Order, Position, Trade } from "@/lib/trading-api";
import type { UserProfile } from "@/lib/users-api";

export type AdminOverview = {
  users: number;
  active_users: number;
  suspended_users: number;
  kyc_under_review: number;
  open_orders: number;
  open_positions: number;
  pending_deposits: number;
  pending_withdrawals: number;
  at: string;
};

export type AdminUserList = {
  items: UserProfile[];
  total: number;
  limit: number;
  offset: number;
};

export type LoginLogEntry = {
  at: string;
  provider: string | null;
  ip: string | null;
  user_agent: string | null;
};

export type AdminUserOperations = {
  profile: UserProfile;
  account: Account;
  orders: Order[];
  trades: Trade[];
  positions: Position[];
  ledger: LedgerEntry[];
  logins: LoginLogEntry[];
};

export type KycReviewResult = {
  uid: string;
  status: OnboardingStatus;
  kyc_tier: KycTier;
  enabled_products: Product[];
  pending_products: Product[];
  review_note: string;
  reviewed_by: string;
  reviewed_at: string;
};

export type BulkActionResult = {
  requested: number;
  succeeded: string[];
  failed: { uid: string; detail: string }[];
};

export type AdminAuditEntry = {
  id: string;
  actor_uid: string;
  actor_email: string | null;
  action: string;
  target_uid: string | null;
  reason: string | null;
  metadata: Record<string, unknown>;
  at: string;
};

export function adminFetchOverview(token: string, signal?: AbortSignal) {
  return apiFetch<AdminOverview>("/admin/overview", { token, ...(signal ? { signal } : {}) });
}

export function adminListUsers(
  token: string,
  options: {
    search?: string;
    accountStatus?: "active" | "suspended";
    onboardingStatus?: OnboardingStatus;
    limit?: number;
    offset?: number;
  } = {},
  signal?: AbortSignal,
) {
  const search = new URLSearchParams();
  if (options.search) search.set("search", options.search);
  if (options.accountStatus) search.set("account_status", options.accountStatus);
  if (options.onboardingStatus) search.set("onboarding_status", options.onboardingStatus);
  search.set("limit", String(options.limit ?? 50));
  search.set("offset", String(options.offset ?? 0));
  return apiFetch<AdminUserList>(`/admin/users/directory?${search}`, {
    token,
    ...(signal ? { signal } : {}),
  });
}

export function adminFetchUserOperations(uid: string, token: string, signal?: AbortSignal) {
  return apiFetch<AdminUserOperations>(`/admin/users/${uid}/operations`, {
    token,
    ...(signal ? { signal } : {}),
  });
}

export function adminSetAccountStatus(
  uid: string,
  input: { status: "active" | "suspended"; reason: string },
  token: string,
) {
  return apiFetch<UserProfile>(`/admin/users/${uid}/control`, {
    method: "PATCH",
    token,
    body: input,
  });
}

export function adminReviewKyc(
  uid: string,
  input: { decision: "approve" | "reject"; reason: string; enabled_products?: Product[] },
  token: string,
) {
  return apiFetch<KycReviewResult>(`/admin/users/${uid}/kyc-review`, {
    method: "POST",
    token,
    body: input,
  });
}

export function adminSetProductAccess(
  uid: string,
  input: { enabled_products: Product[]; reason: string },
  token: string,
) {
  return apiFetch<KycReviewResult>(`/admin/users/${uid}/products`, {
    method: "PATCH",
    token,
    body: input,
  });
}

export function adminBulkApproveKyc(uids: string[], reason: string, token: string) {
  return apiFetch<BulkActionResult>("/admin/users/bulk/kyc-approve", {
    method: "POST",
    token,
    body: { uids, reason },
  });
}

export function adminBulkSetProductAccess(
  uids: string[],
  enabledProducts: Product[],
  reason: string,
  token: string,
) {
  return apiFetch<BulkActionResult>("/admin/users/bulk/products", {
    method: "PATCH",
    token,
    body: { uids, enabled_products: enabledProducts, reason },
  });
}

export function adminAdjustBalance(
  uid: string,
  input: { currency?: string; amount: string; reason: string; idempotency_key: string },
  token: string,
) {
  return apiFetch<LedgerEntry>(`/admin/users/${uid}/balance-adjustments`, {
    method: "POST",
    token,
    body: input,
  });
}

export function adminCancelUserOrder(uid: string, orderId: string, token: string) {
  return apiFetch<Order>(`/admin/users/${uid}/orders/${orderId}`, {
    method: "DELETE",
    token,
  });
}

export function adminRevokeUserSessions(uid: string, reason: string, token: string) {
  return apiFetch<{ uid: string; revoked: boolean; revoked_at: string }>(
    `/admin/users/${uid}/revoke-sessions`,
    { method: "POST", token, body: { reason } },
  );
}

export function adminListAudit(
  token: string,
  options: { targetUid?: string; limit?: number } = {},
) {
  const search = new URLSearchParams({ limit: String(options.limit ?? 100) });
  if (options.targetUid) search.set("target_uid", options.targetUid);
  return apiFetch<AdminAuditEntry[]>(`/admin/audit?${search}`, { token });
}
