/**
 * Every line that touches the Firebase Web SDK lives here.
 *
 * Sign-in has to happen client-side: the backend's Admin SDK cannot verify a password. So
 * the browser exchanges credentials for an ID token, and the backend verifies that token —
 * this module owns the first half of that handshake and nothing else.
 *
 * One module, for two reasons. The SDK reaches for browser globals on import and this app
 * is server-rendered, so the dynamic imports that keep it out of the SSR bundle are needed
 * in exactly one place. And the config comes from `GET /auth/config`, so initialisation is
 * asynchronous whether we like it or not; sharing one promise means a page with three
 * sign-in buttons still initialises once.
 *
 * The ID token is never copied into `localStorage`. It is read from the SDK on demand,
 * which refreshes it near expiry — a copy of our own would be a credential with a lifetime
 * we would have to manage, and an XSS-readable one at that.
 */
import type { Auth, User } from "firebase/auth";

import { fetchFirebaseConfig, type FirebaseWebConfig } from "@/lib/auth-api";

let authPromise: Promise<Auth> | undefined;

function assertBrowser(): void {
  if (typeof window === "undefined") {
    throw new Error(
      "Firebase Auth is browser-only and must not be called while rendering on the server.",
    );
  }
}

/**
 * The backend refuses to boot without these, so a blank one means something is talking to
 * a different service. Failing here gives a readable error instead of the SDK's cryptic
 * `auth/invalid-api-key` three steps later.
 */
function assertUsableConfig(config: FirebaseWebConfig): void {
  const missing = (["apiKey", "authDomain", "projectId", "appId"] as const).filter(
    (key) => typeof config[key] !== "string" || config[key].trim() === "",
  );
  if (missing.length > 0) {
    throw new Error(
      `GET /auth/config returned no ${missing.join(", ")} — check the backend's .env.`,
    );
  }
}

/**
 * `measurementId` is optional in the console and the backend serialises an absent one as
 * `null`, but `FirebaseOptions` wants the key gone rather than nulled.
 */
function toFirebaseOptions(config: FirebaseWebConfig) {
  const { measurementId, ...rest } = config;
  return measurementId ? { ...rest, measurementId } : rest;
}

async function initAuth(): Promise<Auth> {
  const config = await fetchFirebaseConfig();
  assertUsableConfig(config);

  const [{ getApp, getApps, initializeApp }, { getAuth }] = await Promise.all([
    import("firebase/app"),
    import("firebase/auth"),
  ]);

  // Vite's HMR can re-run this module with the app already registered; initialising twice
  // throws.
  const app = getApps().length > 0 ? getApp() : initializeApp(toFirebaseOptions(config));
  return getAuth(app);
}

export function getFirebaseAuth(): Promise<Auth> {
  assertBrowser();
  if (!authPromise) {
    authPromise = initAuth().catch((error: unknown) => {
      // A failed init must not stay cached, or a backend that was briefly down would leave
      // sign-in broken until a full page reload.
      authPromise = undefined;
      throw error;
    });
  }
  return authPromise;
}

/**
 * Subscribe to the signed-in user. Resolves to the unsubscribe function.
 *
 * `onIdTokenChanged` rather than `onAuthStateChanged`: it also fires on the SDK's hourly
 * token refresh, so a long-lived tab's view of the session cannot go stale.
 */
export async function watchIdToken(onChange: (user: User | null) => void): Promise<() => void> {
  const auth = await getFirebaseAuth();
  const { onIdTokenChanged } = await import("firebase/auth");
  return onIdTokenChanged(auth, onChange);
}

/** The current ID token, refreshed by the SDK if it is close to expiry. */
export async function currentIdToken(): Promise<string> {
  const auth = await getFirebaseAuth();
  const user = auth.currentUser;
  if (!user) throw new Error("Not signed in.");
  return user.getIdToken();
}

export async function signInWithPassword(email: string, password: string): Promise<User> {
  const auth = await getFirebaseAuth();
  const { signInWithEmailAndPassword } = await import("firebase/auth");
  const credential = await signInWithEmailAndPassword(auth, email, password);
  return credential.user;
}

export async function signInWithGooglePopup(): Promise<User> {
  const auth = await getFirebaseAuth();
  const { GoogleAuthProvider, signInWithPopup } = await import("firebase/auth");
  const provider = new GoogleAuthProvider();
  // Ask which account every time, rather than silently reusing whichever Google session
  // the browser happens to hold — on a shared machine that is somebody else's account.
  provider.setCustomParameters({ prompt: "select_account" });
  const credential = await signInWithPopup(auth, provider);
  return credential.user;
}

/**
 * Send (or re-send) the "confirm your address" email.
 *
 * Only the Web SDK can do this: the Admin SDK behind the backend can generate a link but
 * has no mailer, so the browser asks Firebase to send its own. It needs a signed-in user,
 * which is why signup signs in before calling this and signs back out afterwards.
 */
export async function sendVerificationEmail(user: User): Promise<void> {
  const { sendEmailVerification } = await import("firebase/auth");
  await sendEmailVerification(user);
}

/** Re-reads the account from Firebase, so `emailVerified` reflects a link clicked elsewhere. */
export async function reloadUser(user: User): Promise<User> {
  const { reload } = await import("firebase/auth");
  await reload(user);
  // The verified flag lives in the ID token's claims too; force a refresh so the backend
  // sees it on the very next call instead of up to an hour later.
  await user.getIdToken(true);
  return user;
}

export async function signOutFirebase(): Promise<void> {
  const auth = await getFirebaseAuth();
  const { signOut } = await import("firebase/auth");
  await signOut(auth);
}

/**
 * Firebase error codes, translated into something a user can act on.
 *
 * `auth/invalid-credential`, `auth/wrong-password` and `auth/user-not-found` deliberately
 * share one message: telling a wrong password apart from an unknown email turns the
 * sign-in form into an account-enumeration oracle.
 */
const FIREBASE_MESSAGES: Record<string, string> = {
  "auth/invalid-email": "That email address is not valid.",
  "auth/invalid-credential": "Incorrect email or password.",
  "auth/wrong-password": "Incorrect email or password.",
  "auth/user-not-found": "Incorrect email or password.",
  "auth/missing-password": "Please enter your password.",
  "auth/user-disabled": "This account has been disabled.",
  "auth/too-many-requests": "Too many attempts. Please wait a moment and try again.",
  "auth/weak-password": "Please choose a password of at least 6 characters.",
  "auth/email-already-in-use": "That email is already registered.",
  "auth/network-request-failed": "Network error. Check your connection and try again.",
  "auth/popup-blocked":
    "Your browser blocked the Google sign-in window. Allow pop-ups and try again.",
  "auth/account-exists-with-different-credential":
    "That email is already registered with a different sign-in method.",
  "auth/unauthorized-domain": "This domain is not authorised for sign-in in the Firebase console.",
  "auth/operation-not-allowed": "That sign-in method is not enabled for this project.",
};

/** The user walked away from the Google window. Not an error worth showing them. */
const CANCELLED_CODES = new Set([
  "auth/popup-closed-by-user",
  "auth/cancelled-popup-request",
  "auth/user-cancelled",
]);

function codeOf(error: unknown): string | null {
  if (!error || typeof error !== "object") return null;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : null;
}

export function isCancelledSignIn(error: unknown): boolean {
  const code = codeOf(error);
  return code !== null && CANCELLED_CODES.has(code);
}

/** A user-facing message for a Firebase error, or `null` if this was not one. */
export function firebaseAuthMessage(error: unknown): string | null {
  const code = codeOf(error);
  if (code === null) return null;
  return FIREBASE_MESSAGES[code] ?? "Sign-in failed. Please try again.";
}
