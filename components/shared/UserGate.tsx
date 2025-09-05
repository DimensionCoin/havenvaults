// components/UserGate.tsx
"use client";

import { usePathname } from "next/navigation";
import { usePrivy } from "@privy-io/react-auth";
import { useUser } from "@/providers/UserProvider";
import FullScreenLoader from "@/components/shared/FullScreenLoader";

const PUBLIC_PREFIXES = [
  "/",
  "/sign-in",
  "/sign-up",
  "/onboarding",
  "/kyc/pending",
  "/claim",
];

function isPublic(path: string) {
  return PUBLIC_PREFIXES.some((p) =>
    p === "/claim" ? path.startsWith("/claim") : path === p
  );
}

export default function UserGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { ready: privyReady } = usePrivy();
  const { loading: userLoading } = useUser();

  // Show a global loader until:
  // - Privy is initialized, and
  // - UserProvider finished calling /api/user/me (and potential redirects)
  const shouldHold =
    !privyReady || userLoading || (!isPublic(pathname) && userLoading);

  if (shouldHold) return <FullScreenLoader />;

  return <>{children}</>;
}
