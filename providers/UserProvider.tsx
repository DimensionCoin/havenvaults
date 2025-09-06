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

type PendingEmailClaim = {
  id: string;
  amountUnits: number; // USDC (6dp)
  currency: string; // e.g., "USDC"
  tokenExpiresAt: string; // ISO timestamp
  createdAt: string; // ISO timestamp
  // (sender info is fetched by the banner via /pending/list using the token)
};

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

  /** ✅ New fields for pending email claims */
  hasPendingEmailClaims?: boolean; // quick boolean for banner visibility
  pendingEmailClaims?: PendingEmailClaim[]; // optional lightweight list
  pendingEmailClaimsToken?: string; // short-lived token for /pending/list
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
  if (PUBLIC_ROUTES.has(pathname)) return true;
  // Treat all claim routes as public (e.g., /claim/:token)
  if (pathname === "/claim" || pathname.startsWith("/claim/")) return true;
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
        // Treat as anonymous on error
        setUser(null);
        if (!isPublicPath(pathname)) router.replace("/sign-in");
        return;
      }

      const data = (await res.json()) as PublicUser;

      // Ensure optional fields exist so consumers can rely on them safely
      const normalized: PublicUser = {
        ...data,
        hasPendingEmailClaims: data.hasPendingEmailClaims ?? false,
        pendingEmailClaims: data.pendingEmailClaims ?? [],
        pendingEmailClaimsToken: data.pendingEmailClaimsToken, // may be undefined
      };

      setUser(normalized);

      // Gatekeeping / redirection rules (only on protected routes)
      if (!isPublicPath(pathname)) {
        const ok =
          normalized.kycStatus === "approved" && normalized.status === "active";
        if (!ok && pathname !== "/onboarding" && pathname !== "/kyc/pending") {
          router.replace("/kyc/pending");
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
    // For public routes, we still fetch (to show header + claims), but never redirect away.
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
