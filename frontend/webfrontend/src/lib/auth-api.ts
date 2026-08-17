/**
 * Typed wrappers over the backend's `/auth` routes. Shapes mirror
 * `backend/app/schemas/auth.py` exactly — if one changes there, it changes here.
 */
import { apiFetch } from "@/lib/api";

/**
 * `GET /auth/config`. camelCase because Firebase's `initializeApp()` expects exactly these
 * keys. Public by design — protected by authorized domains and security rules, not secrecy —
 * which is why it is fetched rather than committed to this repo.
 */
export type FirebaseWebConfig = {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
  measurementId?: string | null;
};

/** `UserResponse` — identity as asserted by Firebase, from the verified token or user record. */
export type AuthUser = {
  uid: string;
  email: string | null;
  name: string | null;
  picture: string | null;
  /** `password` or `google.com`. */
  provider: string | null;
  email_verified: boolean;
};

export function fetchFirebaseConfig(): Promise<FirebaseWebConfig> {
  return apiFetch<FirebaseWebConfig>("/auth/config");
}

/**
 * `POST /auth/signup` — creates the Firebase user and mirrors it into MongoDB. Signing in
 * is a separate, client-side step: the Admin SDK cannot verify a password.
 *
 * `409` if the email is taken, `422` on a bad email or a password under 6 characters.
 */
export function signupWithPassword(input: {
  email: string;
  password: string;
  displayName?: string;
}): Promise<AuthUser> {
  return apiFetch<AuthUser>("/auth/signup", {
    method: "POST",
    body: {
      email: input.email,
      password: input.password,
      // The schema is `extra="forbid"` with a 1-char minimum on display_name, so an
      // absent name is omitted rather than sent as an empty string.
      ...(input.displayName ? { display_name: input.displayName } : {}),
    },
  });
}

/**
 * `POST /auth/login` — verifies the ID token, upserts the user and **appends a login
 * event**. Call it on a real sign-in only; calling it on every page load would inflate
 * `login_count` and the login history. Use {@link fetchCurrentUser} to re-validate a
 * restored session.
 */
export function loginWithIdToken(idToken: string): Promise<AuthUser> {
  return apiFetch<AuthUser>("/auth/login", { method: "POST", body: { id_token: idToken } });
}

/** `GET /auth/me` — identity straight from the verified bearer token. Records nothing. */
export function fetchCurrentUser(idToken: string): Promise<AuthUser> {
  return apiFetch<AuthUser>("/auth/me", { token: idToken });
}

/** `POST /auth/logout` — revokes the user's refresh tokens, ending sessions everywhere. */
export function logoutCurrentUser(idToken: string): Promise<{ message: string }> {
  return apiFetch<{ message: string }>("/auth/logout", { method: "POST", token: idToken });
}
