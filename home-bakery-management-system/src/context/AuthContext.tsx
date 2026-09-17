import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { getDeviceToken, setDeviceToken, clearDeviceToken } from "../utils/tokenStore";
import { apiFetch, mintDeviceTokenApi, setUnauthorizedHandler, signOutCurrentDeviceApi } from "../utils/api";

type Status = "checking" | "authenticated" | "unauthenticated";

interface AuthContextValue {
  status: Status;
  email: string | null;
  minting: boolean;
  error: string | null;
  signIn: () => void;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

// A hung mint would otherwise leave the login screen spinning forever.
const MINT_TIMEOUT_MS = 15000;
function mintWithTimeout() {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), MINT_TIMEOUT_MS);
  return mintDeviceTokenApi(undefined, { signal: ctrl.signal }).finally(() => clearTimeout(timer));
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>("checking");
  const [email, setEmail] = useState<string | null>(null);
  const [minting, setMinting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const unauthenticated = () => {
    setStatus("unauthenticated");
    setEmail(null);
  };
  // A 401 anywhere in the app clears the token and returns to the login screen.
  useEffect(() => setUnauthorizedHandler(unauthenticated), []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const params = new URLSearchParams(window.location.search);
      const isMint = params.get("mint") === "1";

      try {
        // ?mint=1 — we just completed an Access OTP on /admin and carry its cookie.
        if (isMint) {
          setMinting(true);
          const { token } = await mintWithTimeout();
          await setDeviceToken(token);
          if (cancelled) return;
          const url = new URL(window.location.href);
          url.searchParams.delete("mint");
          const clean = url.pathname + url.search;
          if (window.location.pathname !== "/app/") {
            window.location.replace("/app/");
            return;
          }
          window.history.replaceState({}, "", clean);
          setStatus("authenticated");
          return;
        }

        const token = await getDeviceToken();
        if (token) {
          const verify = await apiFetch<{ email: string }>("/api/auth/verify");
          if (cancelled) return;
          setStatus("authenticated");
          setEmail(verify.email);
          return;
        }

        // No token: try a silent mint in case a session cookie already exists
        // (desktop, or a phone that just signed in elsewhere).
        try {
          const { token } = await mintWithTimeout();
          await setDeviceToken(token);
          if (cancelled) return;
          setStatus("authenticated");
        } catch {
          if (cancelled) return;
          unauthenticated();
        }
      } catch {
        if (cancelled) return;
        setError(isMint ? "Sign-in failed. Please try again." : null);
        setMinting(false);
        unauthenticated();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const signIn = () => {
    window.location.href = "/admin/?mint=1";
  };

  const signOut = async () => {
    try {
      await signOutCurrentDeviceApi();
    } catch {
      /* token may already be invalid */
    }
    await clearDeviceToken();
    unauthenticated();
  };

  return (
    <AuthContext.Provider value={{ status, email, minting, error, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
