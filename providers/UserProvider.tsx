// providers/UserProvider.tsx
"use client";

import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  useCallback,
} from "react";
import { usePathname, useRouter } from "next/navigation";
import { usePrivy } from "@privy-io/react-auth";

type EmbeddedWallet = {
  walletId?: string;
  address?: string;
  chainType: "solana";
} | null;

type PublicUser = {
  id: string;
  privyId: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  displayName: string | null;
  countryISO: string | null;
  displayCurrency: string;
  status: "pending" | "active" | "blocked" | "closed";
  kycStatus: "none" | "pending" | "approved" | "rejected";
  riskLevel: "low" | "medium" | "high";
  features: { onramp: boolean; cards: boolean; lend: boolean };
  depositWallet: EmbeddedWallet;
  savingsWallet: EmbeddedWallet;
  savingsConsent?: { enabled?: boolean; acceptedAt?: string; version?: string };
  createdAt?: string;
  updatedAt?: string;
};

type UserContextValue = {
  user: PublicUser | null;
  loading: boolean;
  refresh: () => Promise<void>;
};

const UserContext = createContext<UserContextValue>({
  user: null,
  loading: true,
  refresh: async () => {},
});

const PUBLIC_ROUTES = new Set<string>([
  "/",
  "/sign-in",
  "/sign-up",
  "/onboarding",
  "/kyc/pending",
]);

function isPublicPath(pathname: string) {
  // Treat exact matches as public; extend if you have nested public routes
  if (PUBLIC_ROUTES.has(pathname)) return true;
  return false;
}

export function UserProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { ready, authenticated } = usePrivy();

  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<PublicUser | null>(null);

  const fetchMe = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/user/me", {
        method: "GET",
        credentials: "include",
        cache: "no-store",
        headers: { accept: "application/json" },
      });

      if (res.status === 401) {
        // No app session cookie
        setUser(null);
        if (!isPublicPath(pathname)) router.replace("/sign-in");
        return;
      }

      if (res.status === 404) {
        // No Mongo user yet
        setUser(null);
        if (!isPublicPath(pathname)) router.replace("/sign-up");
        return;
      }

      if (!res.ok) {
        // treat as anonymous on error
        setUser(null);
        if (!isPublicPath(pathname)) router.replace("/sign-in");
        return;
      }

      const data = (await res.json()) as PublicUser;
      setUser(data);

      // Gatekeeping / redirection rules (only on protected routes)
      if (!isPublicPath(pathname)) {
        if (data.kycStatus === "approved" && data.status === "active") {
          // If already approved/active but somehow on onboarding/pending, go to dashboard
          // (No-op if already on a protected normal route)
        } else {
          // Not approved/active → send to pending unless already on onboarding
          if (pathname !== "/onboarding" && pathname !== "/kyc/pending") {
            router.replace("/kyc/pending");
          }
        }
      }
    } catch (e) {
      console.error("UserProvider fetch error:", e);
      setUser(null);
      if (!isPublicPath(pathname)) router.replace("/sign-in");
    } finally {
      setLoading(false);
    }
  }, [pathname, router]);

  // Initial fetch when Privy ready state stabilizes or path changes
  useEffect(() => {
    if (!ready) return; // wait for Privy to init (so we know auth status)
    // For public routes, we still try to fetch (to show header w/ name, etc.), but never redirect away.
    // For protected routes, fetch will redirect as needed.
    fetchMe();
  }, [ready, authenticated, pathname, fetchMe]);

  const refresh = useCallback(async () => {
    await fetchMe();
  }, [fetchMe]);

  const value = useMemo(
    () => ({ user, loading, refresh }),
    [user, loading, refresh]
  );

  return <UserContext.Provider value={value}>{children}</UserContext.Provider>;
}

export function useUser() {
  return useContext(UserContext);
}
