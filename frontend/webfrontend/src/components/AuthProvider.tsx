import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

/**
 * No backend exists yet, so "auth" here is a client-side simulation persisted
 * to localStorage — enough to gate the Buy/Sell flow behind sign-in + KYC
 * without inventing a real identity system.
 */
type AuthState = {
  isLoggedIn: boolean;
  kycCompleted: boolean;
  kycNumber: string | null;
};

const STORAGE_KEY = "stocks360-auth";
const DEFAULT_STATE: AuthState = { isLoggedIn: false, kycCompleted: false, kycNumber: null };

const AuthContext = createContext<
  AuthState & {
    login: () => void;
    logout: () => void;
    submitKyc: (kycNumber: string) => void;
  }
>({ ...DEFAULT_STATE, login: () => {}, logout: () => {}, submitKyc: () => {} });

export function useAuth() {
  return useContext(AuthContext);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>(() => {
    if (typeof window === "undefined") return DEFAULT_STATE;
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      return stored ? { ...DEFAULT_STATE, ...JSON.parse(stored) } : DEFAULT_STATE;
    } catch {
      return DEFAULT_STATE;
    }
  });

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }, [state]);

  const login = () => setState((s) => ({ ...s, isLoggedIn: true }));
  const logout = () => setState(DEFAULT_STATE);
  const submitKyc = (kycNumber: string) => setState((s) => ({ ...s, kycCompleted: true, kycNumber }));

  return (
    <AuthContext.Provider value={{ ...state, login, logout, submitKyc }}>
      {children}
    </AuthContext.Provider>
  );
}
