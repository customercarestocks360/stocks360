import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

/**
 * No backend exists yet, so "auth" here is a client-side simulation persisted
 * to localStorage — enough to gate the Buy/Sell flow behind sign-in + KYC
 * without inventing a real identity system.
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
};

type AuthState = {
  isLoggedIn: boolean;
  email: string | null;
  name: string | null;
  kycCompleted: boolean;
  kycProfile: KycProfile | null;
  balances: Record<DepositMethod, number>;
  transactions: Transaction[];
  orders: Order[];
};

const STORAGE_KEY = "stocks360-auth";
const DEFAULT_STATE: AuthState = {
  isLoggedIn: false,
  email: null,
  name: null,
  kycCompleted: false,
  kycProfile: null,
  balances: { INR: 0, USDT: 0 },
  transactions: [],
  orders: [],
};

const AuthContext = createContext<
  AuthState & {
    login: (email?: string) => void;
    logout: () => void;
    submitKyc: (profile: KycProfile) => void;
    requestDeposit: (method: DepositMethod, amount: number, network?: string) => void;
    requestWithdrawal: (method: DepositMethod, amount: number, destination?: string, network?: string) => void;
    settleDeposit: (id: string, outcome: "complete" | "cancel") => void;
    settleWithdrawal: (id: string, outcome: "complete" | "cancel") => void;
    convertBalance: (from: DepositMethod, to: DepositMethod, amount: number) => void;
    setName: (name: string) => void;
    placeOrder: (order: Omit<Order, "id" | "date">) => void;
    cancelOrder: (id: string) => void;
  }
>({
  ...DEFAULT_STATE,
  login: () => {},
  logout: () => {},
  submitKyc: () => {},
  requestDeposit: () => {},
  requestWithdrawal: () => {},
  settleDeposit: () => {},
  settleWithdrawal: () => {},
  convertBalance: () => {},
  setName: () => {},
  placeOrder: () => {},
  cancelOrder: () => {},
});

export function useAuth() {
  return useContext(AuthContext);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>(() => {
    if (typeof window === "undefined") return DEFAULT_STATE;
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (!stored) return DEFAULT_STATE;
      const parsed = JSON.parse(stored);
      return { ...DEFAULT_STATE, ...parsed, balances: { ...DEFAULT_STATE.balances, ...parsed.balances } };
    } catch {
      return DEFAULT_STATE;
    }
  });

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }, [state]);

  /**
   * The admin portal and the user's own tabs each hold their own copy of this
   * state, so a deposit an admin settles in one tab won't appear in another
   * until something re-reads localStorage. The `storage` event fires in
   * every other tab the moment one of them writes, so this pulls the fresh
   * balances/transactions in without the user having to refresh.
   */
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== STORAGE_KEY || !e.newValue) return;
      try {
        const parsed = JSON.parse(e.newValue);
        setState({ ...DEFAULT_STATE, ...parsed, balances: { ...DEFAULT_STATE.balances, ...parsed.balances } });
      } catch {
        // Ignore a malformed write — keep whatever state we already have.
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const login = (email?: string) =>
    setState((s) => ({ ...s, isLoggedIn: true, email: email ?? s.email }));
  const logout = () => setState(DEFAULT_STATE);
  const submitKyc = (profile: KycProfile) =>
    setState((s) => ({ ...s, kycCompleted: true, kycProfile: profile }));
  const newId = () => `${Date.now()}-${Math.round(Math.random() * 1e6)}`;

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
  const requestDeposit = (method: DepositMethod, amount: number, network?: string) =>
    setState((s) => {
      if (amount <= 0) return s;
      return {
        ...s,
        transactions: [
          {
            id: newId(),
            method,
            amount,
            date: new Date().toISOString(),
            kind: "deposit",
            status: "pending",
            network: network ?? NETWORK_OF[method],
          },
          ...s.transactions,
        ],
      };
    });

  const requestWithdrawal = (method: DepositMethod, amount: number, destination?: string, network?: string) =>
    setState((s) => {
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
            kind: "withdraw",
            status: "pending",
            network: network ?? NETWORK_OF[method],
            ...(destination ? { destination } : {}),
          },
          ...s.transactions,
        ],
      };
    });

  const settleDeposit = (id: string, outcome: "complete" | "cancel") =>
    setState((s) => {
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
    });

  const settleWithdrawal = (id: string, outcome: "complete" | "cancel") =>
    setState((s) => {
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
    });
  /** Moves money straight between the two wallet balances — no transaction record, since nothing left the account. */
  const convertBalance = (from: DepositMethod, to: DepositMethod, amount: number) =>
    setState((s) => {
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
    });

  const setName = (name: string) => setState((s) => ({ ...s, name }));
  const placeOrder = (order: Omit<Order, "id" | "date">) =>
    setState((s) => ({
      ...s,
      orders: [
        { id: `${Date.now()}-${Math.round(Math.random() * 1e6)}`, date: new Date().toISOString(), ...order },
        ...s.orders,
      ],
    }));

  const cancelOrder = (id: string) =>
    setState((s) => ({
      ...s,
      orders: s.orders.map((o) => (o.id === id && orderStatus(o) === "open" ? { ...o, status: "cancelled" } : o)),
    }));

  return (
    <AuthContext.Provider
      value={{
        ...state,
        login,
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
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
