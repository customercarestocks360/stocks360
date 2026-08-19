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
import type { KycTier, OnboardingStatus, Product } from "@/lib/onboarding-api";

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
};

/**
 * `GET /users/me`. `404` until `POST /auth/login` has run at least once for this uid —
 * callers should treat that as "no profile yet" rather than a hard failure, since it can
 * legitimately happen for a session the SDK restored before the first login call completes.
 */
export function fetchUserProfile(token: string): Promise<UserProfile> {
  return apiFetch<UserProfile>("/users/me", { token });
}
