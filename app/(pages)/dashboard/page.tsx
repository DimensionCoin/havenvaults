// app/(app)/dashboard/page.tsx
"use client";

// Keep this to avoid creating a big Serverless function for the dashboard page
export const dynamic = "force-static";

import NextDynamic from "next/dynamic";
import Hero from "@/components/dash/Hero";
import { useUser } from "@/providers/UserProvider";
import { useMemo } from "react";
import toast from "react-hot-toast";
import Link from "next/link";
import ClaimBanner from "@/components/dash/ClaimBanner";

export default function DashboardPage() {
  const { user } = useUser();

  // Config for internal "Move" (Deposit <-> Savings)
  const moveConfig = useMemo(() => {
    const depositOwner = user?.depositWallet?.address || null;
    const savingsOwner = user?.savingsWallet?.address || null;
    if (!depositOwner || !savingsOwner) return undefined;

    return {
      depositOwner,
      savingsOwner,
      defaultFrom: "deposit" as const,
      onSuccess: (sig: string) => toast.success(`Moved! ${sig}`),
    };
  }, [user?.depositWallet?.address, user?.savingsWallet?.address]);

  // Config for Withdraw modal (bank + crypto withdraw needs both owners too)
  const withdrawConfig = useMemo(() => {
    const depositOwner = user?.depositWallet?.address || null;
    const savingsOwner = user?.savingsWallet?.address || null;
    if (!depositOwner || !savingsOwner) return undefined;

    return {
      depositOwner,
      savingsOwner,
      defaultFrom: "deposit" as const,
      onSuccess: (sig: string) => toast.success(`Withdrawal sent! ${sig}`),
    };
  }, [user?.depositWallet?.address, user?.savingsWallet?.address]);

  // If you want to *disable* quick actions while KYC is pending:
  const actionsDisabled = user?.kycStatus === "pending";

  return (
    <div className="min-h-screen">
      <div className="mx-auto w-full max-w-6xl px-3 md:px-4 py-6 md:py-10">
          <div className="space-y-6 md:space-y-8">
            <ClaimBanner/>
            <Hero />

            {/* KYC pending banner (optional UI) */}
            {user?.kycStatus === "pending" && (
              <div className="rounded-xl border border-yellow-500/30 bg-yellow-500/10 p-4 text-yellow-200">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="font-semibold">Finish your onboarding</div>
                    <div className="text-sm opacity-90">
                      Your verification is pending. Some actions are disabled
                      until onboarding is complete.
                    </div>
                  </div>
                  <Link
                    href="/onboarding"
                    className="rounded-lg bg-yellow-500 text-black px-3 py-2 text-sm font-semibold hover:bg-yellow-400 transition"
                  >
                    Continue
                  </Link>
                </div>
              </div>
            )}

            <DynamicDepositAccount />

            <DynamicQuickActions
              move={moveConfig}
              withdraw={withdrawConfig}
              disabled={actionsDisabled}
            />

            <div className="mt-6">
              <DynamicSavingsAccount />
            </div>
          </div>
      </div>
    </div>
  );
}

// Defer heavy client-only components to the client bundle
const DynamicDepositAccount = NextDynamic(
  () => import("@/components/dash/DepositAccount"),
  { ssr: false }
);

const DynamicQuickActions = NextDynamic(
  () => import("@/components/dash/QuickActions"),
  { ssr: false }
);

const DynamicSavingsAccount = NextDynamic(
  () => import("@/components/dash/SavingsAccount"),
  { ssr: false }
);
