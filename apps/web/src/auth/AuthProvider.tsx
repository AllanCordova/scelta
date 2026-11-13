import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { currentSession } from "./auth-api";
import type { SessionUser } from "./types";

type AuthState =
  | { status: "loading"; user: null }
  | { status: "anonymous"; user: null }
  | { status: "authenticated"; user: SessionUser };

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: "loading", user: null });

  useEffect(() => {
    let cancelled = false;
    void currentSession()
      .then((user) => {
        if (!cancelled) {
          setState(user ? { status: "authenticated", user } : { status: "anonymous", user: null });
        }
      })
      .catch(() => {
        if (!cancelled) {
          setState({ status: "anonymous", user: null });
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return <AuthContext.Provider value={state}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const state = useContext(AuthContext);
  if (!state) {
    throw new Error("AuthProvider is missing");
  }
  return state;
}
