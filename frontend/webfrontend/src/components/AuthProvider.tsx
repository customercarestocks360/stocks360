import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

/**
 * No backend exists yet, so "auth" here is a client-side simulation persisted
 * to localStorage — enough to gate the Buy/Sell flow behind sign-in + KYC
 * without inventing a real identity system.
 */
export type DepositMethod = "INR" | "USDT";

export type Transaction = {
  id: string;
  method: DepositMethod;
  amount: number;
  date: string;
};

export type Order = {
  id: string;
  action: "buy" | "sell";
  symbol: string;
  qty: number;
  price: string;
  date: string;
};

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
    deposit: (method: DepositMethod, amount: number) => void;
    setName: (name: string) => void;
    placeOrder: (order: Omit<Order, "id" | "date">) => void;
  }
>({
  ...DEFAULT_STATE,
  login: () => {},
  logout: () => {},
  submitKyc: () => {},
  deposit: () => {},
  setName: () => {},
  placeOrder: () => {},
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

  const login = (email?: string) =>
    setState((s) => ({ ...s, isLoggedIn: true, email: email ?? s.email }));
  const logout = () => setState(DEFAULT_STATE);
  const submitKyc = (profile: KycProfile) =>
    setState((s) => ({ ...s, kycCompleted: true, kycProfile: profile }));
  const deposit = (method: DepositMethod, amount: number) =>
    setState((s) => ({
      ...s,
      balances: { ...s.balances, [method]: s.balances[method] + amount },
      transactions: [
        { id: `${Date.now()}-${Math.round(Math.random() * 1e6)}`, method, amount, date: new Date().toISOString() },
        ...s.transactions,
      ],
    }));
  const setName = (name: string) => setState((s) => ({ ...s, name }));
  const placeOrder = (order: Omit<Order, "id" | "date">) =>
    setState((s) => ({
      ...s,
      orders: [
        { id: `${Date.now()}-${Math.round(Math.random() * 1e6)}`, date: new Date().toISOString(), ...order },
        ...s.orders,
      ],
    }));

  return (
    <AuthContext.Provider value={{ ...state, login, logout, submitKyc, deposit, setName, placeOrder }}>
      {children}
    </AuthContext.Provider>
  );
}
