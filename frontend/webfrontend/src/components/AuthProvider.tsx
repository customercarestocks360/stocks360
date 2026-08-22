import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { User as FirebaseUser } from "firebase/auth";

import { ApiError } from "@/lib/api";
import {
  fetchCurrentUser,
  loginWithIdToken,
  logoutCurrentUser,
  signupWithPassword,
  type AuthUser,
} from "@/lib/auth-api";
import {
  currentIdToken,
  firebaseAuthMessage,
  isCancelledSignIn,
  reloadUser,
  sendVerificationEmail,
  signInWithGooglePopup,
  signInWithPassword,
  signOutFirebase,
  watchIdToken,
} from "@/lib/firebase";
import { fetchUserProfile, updateUserProfile, type UserProfile } from "@/lib/users-api";
import type { KycTier, OnboardingStatus, Product } from "@/lib/onboarding-api";

/**
 * Identity and KYC status are both real: Firebase issues the ID token, the FastAPI backend
 * verifies it, and `GET /users/me` is the one place that knows whether onboarding has
 * actually been submitted — `onboarding_status`, `kyc_tier` and the product lists are
 * denormalised there by `POST /onboarding/submit` and nowhere else.
 *
 * Trading, balances, deposits, and withdrawals are owned by backend services. This
 * provider contains identity and server profile state only, so browser-local values can
 * never be mistaken for authoritative account data.
 */
/** Who the caller is, as asserted by Firebase and confirmed by the backend. */
export type Identity = {
  uid: string;
  email: string | null;
  name: string | null;
  picture: string | null;
  /** `password` or `google.com`. */
  provider: string | null;
  emailVerified: boolean;
};

/**
 * `loading` covers both server rendering and the moment before the SDK reports a restored
 * session. Treated as signed-out for gating, so nothing protected renders on a guess.
 */
export type AuthStatus = "loading" | "authenticated" | "unauthenticated";

function identityFromApi(user: AuthUser): Identity {
  return {
    uid: user.uid,
    email: user.email,
    name: user.name,
    picture: user.picture,
    provider: user.provider,
    emailVerified: user.email_verified,
  };
}

function identityFromFirebase(user: FirebaseUser): Identity {
  return {
    uid: user.uid,
    email: user.email,
    name: user.displayName,
    picture: user.photoURL,
    // UserRecord.providerId is always "firebase"; the real provider lives in providerData.
    provider: user.providerData[0]?.providerId ?? null,
    emailVerified: user.emailVerified,
  };
}

/**
 * Thrown when the credentials were right but the address has never been confirmed. Its own
 * type so {@link authErrorMessage} passes the message through instead of flattening it to
 * the generic "could not sign you in" fallback.
 */
export class EmailNotVerifiedError extends Error {}

/**
 * One user-facing line for anything a sign-in can throw: a Firebase code, an `ApiError`
 * from the backend, or an unrecognised failure. Nothing internal is surfaced — the console
 * keeps the original for debugging.
 */
function authErrorMessage(
  error: unknown,
  fallback = "Something went wrong. Please try again.",
): string {
  if (error instanceof EmailNotVerifiedError) return error.message;
  const firebase = firebaseAuthMessage(error);
  if (firebase) return firebase;
  if (error instanceof ApiError) return error.message;
  return fallback;
}

type AuthContextValue = Identity & {
  isLoggedIn: boolean;
  status: AuthStatus;
  /** True once the session has been determined either way — use it to hold off redirects. */
  authReady: boolean;
  /** Set when the auth service itself could not be reached, not when a credential was wrong. */
  authError: string | null;

  /**
   * Creates the account (POST /auth/signup) and sends the verification email. Deliberately
   * does **not** sign in: the user has to click the link first. Throws a displayable message.
   */
  signUpWithEmail: (email: string, password: string, displayName?: string) => Promise<void>;
  /**
   * Firebase verifies the password, then POST /auth/login records the login. Refuses an
   * unverified address, re-sending the link before it throws.
   */
  signInWithEmail: (email: string, password: string) => Promise<void>;
  /** Google popup, then POST /auth/login. Resolves to false if the user closed the popup. */
  signInWithGoogle: () => Promise<boolean>;
  /** POST /auth/logout to revoke refresh tokens, then clears the local session. */
  logout: () => Promise<void>;

  /** True once `POST /onboarding/submit` has run — derived from `GET /users/me`, never local. */
  kycCompleted: boolean;
  /**
   * The human-review state once submitted: `under_review` right after `POST
   * /onboarding/submit`, then `approved` or `rejected`. `kycTier` alone can't tell these
   * apart — it becomes `verified` immediately at submit and stays there through review.
   */
  onboardingStatus: OnboardingStatus;
  /** `unverified` until identity is captured, `verified` once the application is submitted. */
  kycTier: KycTier;
  /** Live immediately once submitted. */
  enabledProducts: Product[];
  /** Submitted but held on a leveraged product until the income proof is reviewed. */
  pendingProducts: Product[];
  /**
   * Re-fetches `GET /users/me`. The onboarding funnel calls this right after
   * `POST /onboarding/submit`, so the rest of the app sees the new status without a reload.
   */
  refreshProfile: () => Promise<void>;

  /** Persists via `PATCH /users/me`, then updates local state once the save succeeds. Throws on failure. */
  setName: (name: string) => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside <AuthProvider>.");
  return context;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  /**
   * The stored MongoDB profile from `GET /users/me` — `null` before it has loaded, and
   * also `null` on a `404` (no `POST /auth/login` has run for this uid yet), which reads
   * as "no onboarding status to report" rather than a failure.
   */
  const [serverProfile, setServerProfile] = useState<UserProfile | null>(null);

  const uid = identity?.uid ?? null;

  /** uid whose token the backend has already accepted, so a restored session is checked once. */
  const confirmedUidRef = useRef<string | null>(null);
  /** True while a sign-in action is mid-flight; it calls POST /auth/login itself. */
  const signingInRef = useRef(false);

  // --- Session --------------------------------------------------------------------------

  useEffect(() => {
    let cancelled = false;
    let unsubscribe: (() => void) | undefined;

    watchIdToken((user) => {
      if (cancelled) return;
      // An unverified address counts as signed out, whatever the SDK is holding: signup
      // signs in for a moment to send the confirmation email, and a session restored from
      // SDK storage could predate the verification requirement. Both must stay locked out,
      // and the backend refuses their token anyway.
      if (!user || !user.emailVerified) {
        confirmedUidRef.current = null;
        setIdentity(null);
        setStatus("unauthenticated");
        return;
      }
      setIdentity(identityFromFirebase(user));
      setStatus("authenticated");
    })
      .then((teardown) => {
        if (cancelled) teardown();
        else unsubscribe = teardown;
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        console.error("Firebase Auth could not be initialised", error);
        setStatus("unauthenticated");
        setAuthError(
          authErrorMessage(
            error,
            "Could not reach the authentication service. Please try again shortly.",
          ),
        );
      });

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, []);

  /**
   * `GET /users/me`, tolerant of the one expected failure mode: swallows a `404` as "no
   * profile yet" rather than surfacing it, since that can legitimately happen for a
   * session the SDK restored before `POST /auth/login` finished mirroring the user into
   * Mongo. Any other failure is logged and leaves whatever profile is already held —
   * onboarding status going briefly stale beats it flickering to "not started" on a
   * transient network error.
   */
  const loadServerProfile = useCallback(async (token: string) => {
    try {
      setServerProfile(await fetchUserProfile(token));
    } catch (error: unknown) {
      if (error instanceof ApiError && error.status === 404) {
        setServerProfile(null);
        return;
      }
      console.error("Could not load the stored profile", error);
    }
  }, []);

  /**
   * Re-fetches the stored profile on demand. The onboarding funnel calls this right after
   * `POST /onboarding/submit`, so `kycCompleted` flips without waiting for a reload.
   */
  const refreshProfile = useCallback(async () => {
    const token = await currentIdToken().catch(() => null);
    if (token) await loadServerProfile(token);
  }, [loadServerProfile]);

  /**
   * A session the SDK restored from its own storage has not been near the backend yet, so
   * confirm it with `GET /auth/me` — which also picks up the stored identity. Deliberately
   * not `POST /auth/login`: that appends a login event, and reloading a tab is not a login.
   * `GET /users/me` rides along to pick up the onboarding status that `/auth/me` does not
   * carry.
   */
  useEffect(() => {
    if (status !== "authenticated" || uid === null) return;
    if (signingInRef.current || confirmedUidRef.current === uid) return;
    confirmedUidRef.current = uid;

    let cancelled = false;
    void (async () => {
      try {
        const token = await currentIdToken();
        const profile = await fetchCurrentUser(token);
        if (cancelled) return;
        setIdentity(identityFromApi(profile));
        await loadServerProfile(token);
      } catch (error: unknown) {
        if (cancelled) return;
        if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
          // The backend rejected a token the SDK still holds — revoked by a logout
          // elsewhere, the account was disabled, or (403) the email is not verified. Drop
          // the local session rather than render a signed-in shell that cannot make a
          // single authenticated call.
          confirmedUidRef.current = null;
          await signOutFirebase().catch(() => {});
          return;
        }
        // Anything else (backend down, 503 from Atlas) leaves the session alone: the user
        // is signed in, the API is simply unreachable right now.
        console.error("Could not confirm the session with the backend", error);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [status, uid, loadServerProfile]);

  // --- Sign-in actions -----------------------------------------------------------------

  /**
   * The shared tail of every sign-in: whatever produced the Firebase session, the backend
   * has to verify the resulting ID token before the user counts as signed in.
   *
   * If that second half fails the Firebase session is torn down again, so there is no such
   * thing as a half-signed-in client — a UI that thinks it is authenticated while the API
   * disagrees is the state every downstream bug comes from.
   */
  const completeSignIn = useCallback(
    async (produceSession: () => Promise<FirebaseUser>): Promise<void> => {
      signingInRef.current = true;
      setAuthError(null);
      try {
        const user = await produceSession();
        // The one gate on access. `reload` because the user may have clicked the link in
        // another tab since this session's token was minted; it also refreshes the token,
        // so the backend sees the same answer this check just got.
        await reloadUser(user);
        if (!user.emailVerified) {
          // Re-send rather than make them hunt for the original mail, which by now may be
          // expired or in a spam folder. Best effort: rate-limited by Firebase.
          await sendVerificationEmail(user).catch((error: unknown) => {
            console.error("Could not re-send the verification email", error);
          });
          throw new EmailNotVerifiedError(
            "Please verify your email address first — we've sent a fresh link to your inbox.",
          );
        }
        const token = await currentIdToken();
        const profile = await loginWithIdToken(token);
        confirmedUidRef.current = profile.uid;
        setIdentity(identityFromApi(profile));
        setStatus("authenticated");
        // POST /auth/login just upserted the Mongo mirror, so the profile is there to read.
        await loadServerProfile(token);
      } catch (error: unknown) {
        await signOutFirebase().catch(() => {});
        confirmedUidRef.current = null;
        setIdentity(null);
        setServerProfile(null);
        setStatus("unauthenticated");
        console.error("Sign-in failed", error);
        throw error;
      } finally {
        signingInRef.current = false;
      }
    },
    [loadServerProfile],
  );

  const signInWithEmail = useCallback(
    async (email: string, password: string) => {
      try {
        // Firebase verifies the password — the Admin SDK behind the backend cannot.
        await completeSignIn(() => signInWithPassword(email.trim(), password));
      } catch (error: unknown) {
        throw new Error(authErrorMessage(error, "Could not sign you in. Please try again."));
      }
    },
    [completeSignIn],
  );

  /**
   * Signing up no longer signs the user in: a brand-new account is unverified, so the only
   * thing left to do is post them the confirmation link and send them back to the login
   * page. Anyone can type an address they do not own — this is what stops them using it.
   */
  const signUpWithEmail = useCallback(
    async (email: string, password: string, displayName?: string) => {
      setAuthError(null);
      try {
        // The backend owns user creation, so the Mongo mirror is written by the same
        // request that creates the Firebase user.
        await signupWithPassword({
          email: email.trim(),
          password,
          ...(displayName?.trim() ? { displayName: displayName.trim() } : {}),
        });
        // Only the Web SDK can send the mail, and only for a signed-in user, so this signs
        // in for exactly as long as that takes. The token watcher above treats an
        // unverified user as signed out, so no protected screen sees this session.
        const user = await signInWithPassword(email.trim(), password);
        await sendVerificationEmail(user);
      } catch (error: unknown) {
        throw new Error(
          authErrorMessage(error, "Could not create your account. Please try again."),
        );
      } finally {
        // The account exists either way; leaving a half-session behind after a failed send
        // is worse than making them sign in once the link is clicked.
        await signOutFirebase().catch(() => {});
      }
    },
    [],
  );

  const signInWithGoogle = useCallback(async () => {
    try {
      await completeSignIn(() => signInWithGooglePopup());
      return true;
    } catch (error: unknown) {
      // Closing the Google window is a decision, not a failure worth an error banner.
      if (isCancelledSignIn(error)) return false;
      throw new Error(authErrorMessage(error, "Google sign-in failed. Please try again."));
    }
  }, [completeSignIn]);

  const logout = useCallback(async () => {
    try {
      // Revoke server-side first, while there is still a valid token to present with it.
      const token = await currentIdToken().catch(() => null);
      if (token) await logoutCurrentUser(token);
    } catch (error: unknown) {
      // Best effort: other sessions may survive, but refusing to sign out locally because
      // the network hiccuped is strictly worse than signing out locally and saying so.
      console.error("Server-side logout failed; clearing the local session anyway", error);
    } finally {
      await signOutFirebase().catch(() => {});
      confirmedUidRef.current = null;
      setIdentity(null);
      setServerProfile(null);
      setStatus("unauthenticated");
      setAuthError(null);
    }
  }, []);

  const setName = useCallback(async (name: string) => {
    const token = await currentIdToken();
    const profile = await updateUserProfile({ name }, token);
    setServerProfile(profile);
    setIdentity((current) => (current ? { ...current, name: profile.name } : current));
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      uid: identity?.uid ?? "",
      email: identity?.email ?? null,
      name: serverProfile?.name ?? identity?.name ?? null,
      picture: identity?.picture ?? null,
      provider: identity?.provider ?? null,
      emailVerified: identity?.emailVerified ?? false,
      isLoggedIn: status === "authenticated" && identity !== null,
      status,
      authReady: status !== "loading",
      authError,

      signUpWithEmail,
      signInWithEmail,
      signInWithGoogle,
      logout,

      // "not_started" is exactly what /users/me reports before POST /onboarding/submit has
      // ever run, so a profile that hasn't loaded yet and a profile that genuinely has not
      // onboarded read the same way here — both correctly gate on "not complete".
      kycCompleted: serverProfile !== null && serverProfile.onboarding_status !== "not_started",
      onboardingStatus: serverProfile?.onboarding_status ?? "not_started",
      kycTier: serverProfile?.kyc_tier ?? "unverified",
      enabledProducts: serverProfile?.enabled_products ?? [],
      pendingProducts: serverProfile?.pending_products ?? [],
      refreshProfile,

      setName,
    }),
    [
      identity,
      status,
      authError,
      serverProfile,
      refreshProfile,
      signUpWithEmail,
      signInWithEmail,
      signInWithGoogle,
      logout,
      setName,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
