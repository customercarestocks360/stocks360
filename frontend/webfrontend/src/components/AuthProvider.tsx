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
  signInWithGooglePopup,
  signInWithPassword,
  signOutFirebase,
  watchIdToken,
} from "@/lib/firebase";

/**
 * Identity is real: Firebase issues the ID token, the FastAPI backend verifies it and owns
 * the stored profile.
 *
 * Everything below identity — balances, deposits, withdrawals, KYC, orders — is still the
 * client-side simulation this app started with, because `/trading/*` and `/onboarding/*`
 * have not been wired up yet. It is kept deliberately separate from identity, and
 * persisted under a **uid-scoped** localStorage key so one account's simulated money can
 * never show up in another's session.
 */
export type DepositMethod = "INR" | "USDT";

export type TransactionKind = "deposit" | "withdraw";
export type TransactionStatus = "completed" | "pending" | "cancelled";

export type Transaction = {
  id: string;
  method: DepositMethod;
  amount: number;
  date: string;
  /**
   * Optional because transactions written before withdrawals existed are still
   * sitting in localStorage. Read them through `txKind`/`txStatus` below rather
   * than touching the fields directly, so old records keep rendering.
   */
  kind?: TransactionKind;
  status?: TransactionStatus;
  /** Settlement rail actually used, e.g. "BEP20". Falls back to NETWORK_OF. */
  network?: string;
  /** Where a withdrawal should be sent — the user's own UPI ID or wallet address. */
  destination?: string;
};

export const txKind = (t: Transaction): TransactionKind => t.kind ?? "deposit";
export const txStatus = (t: Transaction): TransactionStatus => t.status ?? "completed";

/** Default settlement rail per currency, used when a record predates network choice. */
export const NETWORK_OF: Record<DepositMethod, string> = { INR: "UPI", USDT: "BEP20" };

export const txNetwork = (t: Transaction) => t.network ?? NETWORK_OF[t.method];

/**
 * Funds committed to withdrawals that haven't settled yet. They still count
 * toward the balance but can't be spent, which is what the wallet's
 * "Locked" column reports.
 */
export function lockedAmount(transactions: Transaction[], method: DepositMethod) {
  return transactions
    .filter((t) => t.method === method && txKind(t) === "withdraw" && txStatus(t) === "pending")
    .reduce((sum, t) => sum + t.amount, 0);
}

/** Demo conversion rate between the two wallet currencies. */
export const USDT_TO_INR = 93;

export function convertedAmount(from: DepositMethod, to: DepositMethod, amount: number) {
  if (from === to) return amount;
  return from === "USDT" ? amount * USDT_TO_INR : amount / USDT_TO_INR;
}

export type OrderType = "Market" | "Limit";
export type OrderStatus = "open" | "filled" | "cancelled";

export type Order = {
  id: string;
  action: "buy" | "sell";
  symbol: string;
  qty: number;
  price: string;
  date: string;
  /** Optional so orders placed before order types existed still render — read via orderType()/orderStatus(). */
  orderType?: OrderType;
  status?: OrderStatus;
};

export const orderType = (o: Order): OrderType => o.orderType ?? "Market";
/**
 * There's no matching engine here, so the only orders that stay "open" are
 * limit orders — a market order fills the moment it's placed, since that's
 * the whole point of a market order.
 */
export const orderStatus = (o: Order): OrderStatus => o.status ?? "filled";

export type KycProfile = {
  contact: {
    mobile_country_code: string;
    mobile_number: string;
    country_of_residence: string;
    nationality: string;
  };
  personal: {
    first_name: string;
    last_name: string;
    date_of_birth: string;
    gender: string;
    place_of_birth_country: string;
  };
  address: {
    residential: {
      line1: string;
      city: string;
      state: string;
      postal_code: string;
      country: string;
    };
    permanent_same_as_residential: boolean;
  };
  identity: {
    document_type: string;
    document_number: string;
    issuing_country: string;
  };
  tax: {
    tax_residency_country: string;
    tax_identification_number: string;
    is_us_person: boolean;
    pep_status: string;
    source_of_funds: string;
  };
  financial: {
    occupation: string;
    employer_name: string;
    income_currency: string;
    annual_income_band: string;
    net_worth_band: string;
    investment_experience_years: number;
    risk_tolerance: string;
    investment_objectives: string[];
  };
  markets: {
    products: string[];
    base_currency: string;
  };
  funding: {
    primary_method: string;
    bank_account: {
      account_holder_name: string;
      account_number: string;
      account_type: string;
      bank_name: string;
      routing_type: string;
      routing_code: string;
      currency: string;
    };
  };
  security: {
    two_factor_method: string;
    anti_phishing_code: string;
    withdrawal_whitelist_only: boolean;
    notify_on_new_device: boolean;
  };
  agreements: {
    accepted: { document: string; version: string }[];
  };
};

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

/** The part of the state that is still simulated client-side. */
type LocalState = {
  /** Overrides the Firebase display name when the user renames themselves in /account. */
  displayName: string | null;
  kycCompleted: boolean;
  kycProfile: KycProfile | null;
  balances: Record<DepositMethod, number>;
  transactions: Transaction[];
  orders: Order[];
};

const DEFAULT_LOCAL: LocalState = {
  displayName: null,
  kycCompleted: false,
  kycProfile: null,
  balances: { INR: 0, USDT: 0 },
  transactions: [],
  orders: [],
};

/** Module scope, so the memoised reducers below cannot capture a per-render copy of it. */
const newId = () => `${Date.now()}-${Math.round(Math.random() * 1e6)}`;

const STORAGE_PREFIX = "stocks360-auth";
/**
 * Scoped by uid so signing out and back in as somebody else cannot inherit the previous
 * account's simulated balances and KYC. The signed-out bucket exists only so the reducers
 * have somewhere to write before a session resolves.
 */
const storageKeyFor = (uid: string | null) => `${STORAGE_PREFIX}:${uid ?? "guest"}`;

function parseLocal(raw: string): LocalState {
  try {
    const parsed = JSON.parse(raw) as Partial<LocalState> & {
      balances?: Partial<Record<DepositMethod, number>>;
    };
    return {
      ...DEFAULT_LOCAL,
      ...parsed,
      balances: { ...DEFAULT_LOCAL.balances, ...parsed.balances },
    };
  } catch {
    return DEFAULT_LOCAL;
  }
}

function readLocal(key: string): LocalState {
  if (typeof window === "undefined") return DEFAULT_LOCAL;
  try {
    const stored = window.localStorage.getItem(key);
    return stored ? parseLocal(stored) : DEFAULT_LOCAL;
  } catch {
    // Private-mode Safari and a full quota both throw on read.
    return DEFAULT_LOCAL;
  }
}

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
 * One user-facing line for anything a sign-in can throw: a Firebase code, an `ApiError`
 * from the backend, or an unrecognised failure. Nothing internal is surfaced — the console
 * keeps the original for debugging.
 */
function authErrorMessage(
  error: unknown,
  fallback = "Something went wrong. Please try again.",
): string {
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

  /** Creates the account (POST /auth/signup), then signs in. Throws a displayable message. */
  signUpWithEmail: (email: string, password: string, displayName?: string) => Promise<void>;
  /** Firebase verifies the password, then POST /auth/login records the login. */
  signInWithEmail: (email: string, password: string) => Promise<void>;
  /** Google popup, then POST /auth/login. Resolves to false if the user closed the popup. */
  signInWithGoogle: () => Promise<boolean>;
  /** POST /auth/logout to revoke refresh tokens, then clears the local session. */
  logout: () => Promise<void>;

  kycCompleted: boolean;
  kycProfile: KycProfile | null;
  balances: Record<DepositMethod, number>;
  transactions: Transaction[];
  orders: Order[];

  submitKyc: (profile: KycProfile) => void;
  requestDeposit: (method: DepositMethod, amount: number, network?: string) => void;
  requestWithdrawal: (
    method: DepositMethod,
    amount: number,
    destination?: string,
    network?: string,
  ) => void;
  settleDeposit: (id: string, outcome: "complete" | "cancel") => void;
  settleWithdrawal: (id: string, outcome: "complete" | "cancel") => void;
  convertBalance: (from: DepositMethod, to: DepositMethod, amount: number) => void;
  setName: (name: string) => void;
  placeOrder: (order: Omit<Order, "id" | "date">) => void;
  cancelOrder: (id: string) => void;
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
   * Key and value held together, so the persist effect below can tell "this state belongs
   * to this key" from "the key just changed and the load has not happened yet". Two
   * independent effects would race and write the outgoing account's data to the incoming
   * account's key.
   */
  const [store, setStore] = useState<{ key: string; state: LocalState }>({
    key: storageKeyFor(null),
    state: DEFAULT_LOCAL,
  });

  const uid = identity?.uid ?? null;
  const storageKey = storageKeyFor(uid);

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
      if (!user) {
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
   * A session the SDK restored from its own storage has not been near the backend yet, so
   * confirm it with `GET /auth/me` — which also picks up the stored profile. Deliberately
   * not `POST /auth/login`: that appends a login event, and reloading a tab is not a login.
   */
  useEffect(() => {
    if (status !== "authenticated" || uid === null) return;
    if (signingInRef.current || confirmedUidRef.current === uid) return;
    confirmedUidRef.current = uid;

    let cancelled = false;
    void (async () => {
      try {
        const profile = await fetchCurrentUser(await currentIdToken());
        if (!cancelled) setIdentity(identityFromApi(profile));
      } catch (error: unknown) {
        if (cancelled) return;
        if (error instanceof ApiError && error.status === 401) {
          // The backend rejected a token the SDK still holds — revoked by a logout
          // elsewhere, or the account was disabled. Drop the local session rather than
          // render a signed-in shell that cannot make a single authenticated call.
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
  }, [status, uid]);

  // --- Simulated state, scoped to the signed-in uid ------------------------------------

  useEffect(() => {
    if (status === "loading") return;
    setStore((prev) =>
      prev.key === storageKey ? prev : { key: storageKey, state: readLocal(storageKey) },
    );
  }, [storageKey, status]);

  useEffect(() => {
    if (status === "loading") return;
    // The load above has not run for this key yet, so `store.state` still belongs to the
    // previous account — writing it here would copy it across.
    if (store.key !== storageKey) return;
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(store.state));
    } catch {
      // Out of quota or storage blocked: the session still works, it just will not persist.
    }
  }, [storageKey, store, status]);

  /**
   * The admin portal and the user's own tabs each hold their own copy of this state, so a
   * deposit an admin settles in one tab would not appear in another until something
   * re-reads localStorage. The `storage` event fires in every other tab the moment one of
   * them writes, so this pulls the fresh balances in without a refresh.
   */
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== storageKey) return;
      setStore({
        key: storageKey,
        state: event.newValue ? parseLocal(event.newValue) : DEFAULT_LOCAL,
      });
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [storageKey]);

  const updateLocal = useCallback((change: (state: LocalState) => LocalState) => {
    setStore((prev) => ({ ...prev, state: change(prev.state) }));
  }, []);

  // --- Sign-in actions -----------------------------------------------------------------

  /**
   * The shared tail of every sign-in: whatever produced the Firebase session, the backend
   * has to verify the resulting ID token before the user counts as signed in.
   *
   * If that second half fails the Firebase session is torn down again, so there is no such
   * thing as a half-signed-in client — a UI that thinks it is authenticated while the API
   * disagrees is the state every downstream bug comes from.
   */
  const completeSignIn = useCallback(async (produceSession: () => Promise<void>): Promise<void> => {
    signingInRef.current = true;
    setAuthError(null);
    try {
      await produceSession();
      const profile = await loginWithIdToken(await currentIdToken());
      confirmedUidRef.current = profile.uid;
      setIdentity(identityFromApi(profile));
      setStatus("authenticated");
    } catch (error: unknown) {
      await signOutFirebase().catch(() => {});
      confirmedUidRef.current = null;
      setIdentity(null);
      setStatus("unauthenticated");
      console.error("Sign-in failed", error);
      throw error;
    } finally {
      signingInRef.current = false;
    }
  }, []);

  const signInWithEmail = useCallback(
    async (email: string, password: string) => {
      try {
        // Firebase verifies the password — the Admin SDK behind the backend cannot.
        await completeSignIn(async () => {
          await signInWithPassword(email.trim(), password);
        });
      } catch (error: unknown) {
        throw new Error(authErrorMessage(error, "Could not sign you in. Please try again."));
      }
    },
    [completeSignIn],
  );

  const signUpWithEmail = useCallback(
    async (email: string, password: string, displayName?: string) => {
      try {
        await completeSignIn(async () => {
          // The backend owns user creation, so the Mongo mirror is written by the same
          // request that creates the Firebase user.
          await signupWithPassword({
            email: email.trim(),
            password,
            ...(displayName?.trim() ? { displayName: displayName.trim() } : {}),
          });
          await signInWithPassword(email.trim(), password);
        });
      } catch (error: unknown) {
        throw new Error(
          authErrorMessage(error, "Could not create your account. Please try again."),
        );
      }
    },
    [completeSignIn],
  );

  const signInWithGoogle = useCallback(async () => {
    try {
      await completeSignIn(async () => {
        await signInWithGooglePopup();
      });
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
      setStatus("unauthenticated");
      setAuthError(null);
      setStore({ key: storageKeyFor(null), state: DEFAULT_LOCAL });
    }
  }, []);

  // --- Simulated money and KYC (unchanged behaviour) -----------------------------------

  const submitKyc = useCallback(
    (profile: KycProfile) =>
      updateLocal((s) => ({ ...s, kycCompleted: true, kycProfile: profile })),
    [updateLocal],
  );

  /**
   * Both deposits and withdrawals settle in two steps: requesting one only
   * records what the user says they sent (or want out) — it never touches
   * the balance on its own. An admin then settles it, which is the one
   * action that actually moves money: crediting the balance for a deposit,
   * debiting it for a withdrawal. Cancelling just drops the request.
   *
   * Withdrawals additionally lock their amount the moment they're
   * requested, so it stops counting as spendable even before an admin acts —
   * see `lockedAmount`. Deposits carry no such lock since nothing has left
   * the user's balance yet.
   */
  const requestDeposit = useCallback(
    (method: DepositMethod, amount: number, network?: string) =>
      updateLocal((s) => {
        if (amount <= 0) return s;
        return {
          ...s,
          transactions: [
            {
              id: newId(),
              method,
              amount,
              date: new Date().toISOString(),
              kind: "deposit" as TransactionKind,
              status: "pending" as TransactionStatus,
              network: network ?? NETWORK_OF[method],
            },
            ...s.transactions,
          ],
        };
      }),
    [updateLocal],
  );

  const requestWithdrawal = useCallback(
    (method: DepositMethod, amount: number, destination?: string, network?: string) =>
      updateLocal((s) => {
        const available = s.balances[method] - lockedAmount(s.transactions, method);
        if (amount <= 0 || amount > available) return s;
        return {
          ...s,
          transactions: [
            {
              id: newId(),
              method,
              amount,
              date: new Date().toISOString(),
              kind: "withdraw" as TransactionKind,
              status: "pending" as TransactionStatus,
              // The rail the user actually picked on /withdraw, rather than leaving
              // txNetwork() to fall back to the currency's default.
              network: network ?? NETWORK_OF[method],
              ...(destination ? { destination } : {}),
            },
            ...s.transactions,
          ],
        };
      }),
    [updateLocal],
  );

  const settleDeposit = useCallback(
    (id: string, outcome: "complete" | "cancel") =>
      updateLocal((s) => {
        const tx = s.transactions.find((t) => t.id === id);
        if (!tx || txKind(tx) !== "deposit" || txStatus(tx) !== "pending") return s;
        return {
          ...s,
          balances:
            outcome === "complete"
              ? { ...s.balances, [tx.method]: s.balances[tx.method] + tx.amount }
              : s.balances,
          transactions: s.transactions.map((t) =>
            t.id === id ? { ...t, status: outcome === "complete" ? "completed" : "cancelled" } : t,
          ),
        };
      }),
    [updateLocal],
  );

  const settleWithdrawal = useCallback(
    (id: string, outcome: "complete" | "cancel") =>
      updateLocal((s) => {
        const tx = s.transactions.find((t) => t.id === id);
        if (!tx || txKind(tx) !== "withdraw" || txStatus(tx) !== "pending") return s;
        return {
          ...s,
          balances:
            outcome === "complete"
              ? { ...s.balances, [tx.method]: Math.max(s.balances[tx.method] - tx.amount, 0) }
              : s.balances,
          transactions: s.transactions.map((t) =>
            t.id === id ? { ...t, status: outcome === "complete" ? "completed" : "cancelled" } : t,
          ),
        };
      }),
    [updateLocal],
  );

  /** Moves money straight between the two wallet balances — no transaction record, since nothing left the account. */
  const convertBalance = useCallback(
    (from: DepositMethod, to: DepositMethod, amount: number) =>
      updateLocal((s) => {
        if (from === to || amount <= 0) return s;
        const available = s.balances[from] - lockedAmount(s.transactions, from);
        if (amount > available) return s;
        return {
          ...s,
          balances: {
            ...s.balances,
            [from]: s.balances[from] - amount,
            [to]: s.balances[to] + convertedAmount(from, to, amount),
          },
        };
      }),
    [updateLocal],
  );

  const setName = useCallback(
    (name: string) => updateLocal((s) => ({ ...s, displayName: name })),
    [updateLocal],
  );

  const placeOrder = useCallback(
    (order: Omit<Order, "id" | "date">) =>
      updateLocal((s) => ({
        ...s,
        orders: [{ id: newId(), date: new Date().toISOString(), ...order }, ...s.orders],
      })),
    [updateLocal],
  );

  const cancelOrder = useCallback(
    (id: string) =>
      updateLocal((s) => ({
        ...s,
        orders: s.orders.map((o) =>
          o.id === id && orderStatus(o) === "open"
            ? { ...o, status: "cancelled" as OrderStatus }
            : o,
        ),
      })),
    [updateLocal],
  );

  const local = store.state;

  const value = useMemo<AuthContextValue>(
    () => ({
      uid: identity?.uid ?? "",
      email: identity?.email ?? null,
      // A rename in /account wins over the Firebase display name; both are only labels.
      name: local.displayName ?? identity?.name ?? null,
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

      kycCompleted: local.kycCompleted,
      kycProfile: local.kycProfile,
      balances: local.balances,
      transactions: local.transactions,
      orders: local.orders,

      submitKyc,
      requestDeposit,
      requestWithdrawal,
      settleDeposit,
      settleWithdrawal,
      convertBalance,
      setName,
      placeOrder,
      cancelOrder,
    }),
    [
      identity,
      status,
      authError,
      local,
      signUpWithEmail,
      signInWithEmail,
      signInWithGoogle,
      logout,
      submitKyc,
      requestDeposit,
      requestWithdrawal,
      settleDeposit,
      settleWithdrawal,
      convertBalance,
      setName,
      placeOrder,
      cancelOrder,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
