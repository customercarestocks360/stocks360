/**
 * Typed wrappers over the backend's `/users/*` routes. Shapes mirror
 * `backend/app/schemas/user.py` exactly.
 *
 * This is the stored MongoDB profile, as opposed to `/auth/me` which reads straight from
 * the verified token. The two differ in one important way: `onboarding_status`, `kyc_tier`
 * and the product lists live only here — they are denormalised onto the user record by
 * `POST /onboarding/submit` and nowhere else, so this is the one place that knows whether
 * an account has actually finished KYC.
 */
import { apiFetch } from "@/lib/api";
import type {
  KycTier,
  OnboardingSession,
  OnboardingStatus,
  OnboardingStepInput,
  Product,
} from "@/lib/onboarding-api";

export type UserProfile = {
  uid: string;
  email: string | null;
  name: string | null;
  picture: string | null;
  provider: string | null;
  email_verified: boolean;
  created_at: string;
  updated_at: string;
  last_login_at: string | null;
  login_count: number;
  onboarding_status: OnboardingStatus;
  kyc_tier: KycTier;
  enabled_products: Product[];
  pending_products: Product[];
  account_status: "active" | "suspended";
  account_status_reason: string | null;
  account_status_updated_at: string | null;
  account_status_updated_by: string | null;
};

/**
 * `GET /users/me`. `404` until `POST /auth/login` has run at least once for this uid —
 * callers should treat that as "no profile yet" rather than a hard failure, since it can
 * legitimately happen for a session the SDK restored before the first login call completes.
 */
export function fetchUserProfile(token: string): Promise<UserProfile> {
  return apiFetch<UserProfile>("/users/me", { token });
}

export type UserProfileUpdate = { name?: string };

/** `PATCH /users/me` — only `name` is editable here; KYC sections go through `PATCH /onboarding/kyc`. */
export function updateUserProfile(payload: UserProfileUpdate, token: string): Promise<UserProfile> {
  return apiFetch<UserProfile>("/users/me", { method: "PATCH", token, body: payload });
}

/** Request a market-access change. Removals are immediate; additions await admin approval. */
export function updateMyMarketProducts(products: Product[], token: string): Promise<UserProfile> {
  return apiFetch<UserProfile>("/users/me/products", {
    method: "PATCH",
    token,
    body: { products },
  });
}

// --------------------------------------------------------------------------------------- //
// Admin — the only surface here that reads or edits across users.
// --------------------------------------------------------------------------------------- //

export type AdminUserDetail = { profile: UserProfile; kyc: OnboardingSession };

/** `GET /admin/users?email=` — `404` if no user has that exact address. */
export function adminFindUserByEmail(email: string, token: string): Promise<UserProfile> {
  return apiFetch<UserProfile>(`/admin/users?email=${encodeURIComponent(email)}`, { token });
}

/** `GET /admin/users/{uid}` — the stored profile plus the same masked KYC recap the user sees. */
export function adminFetchUserDetail(uid: string, token: string): Promise<AdminUserDetail> {
  return apiFetch<AdminUserDetail>(`/admin/users/${uid}`, { token });
}

/** `PATCH /admin/users/{uid}` — update a user's display name on their behalf. */
export function adminUpdateUserProfile(
  uid: string,
  payload: UserProfileUpdate,
  token: string,
): Promise<UserProfile> {
  return apiFetch<UserProfile>(`/admin/users/${uid}`, { method: "PATCH", token, body: payload });
}

/**
 * `PATCH /admin/users/{uid}/kyc` — corrects one section of a user's submitted application.
 * Same rules as `amendOnboardingStep`: `404` nothing submitted, `409` for `markets`/
 * `agreements` or a duplicate identity document.
 */
export function adminAmendUserKyc(
  uid: string,
  payload: OnboardingStepInput,
  token: string,
): Promise<OnboardingSession> {
  return apiFetch<OnboardingSession>(`/admin/users/${uid}/kyc`, {
    method: "PATCH",
    token,
    body: payload,
  });
}
