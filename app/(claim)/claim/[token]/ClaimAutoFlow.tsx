// app/(claim)/claim/[token]/ClaimAutoFlow.tsx
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";

// pull an email off the Privy user in a provider-agnostic way
function extractPrivyEmail(u: unknown): string {
  const obj = (u ?? {}) as Record<string, unknown>;
  const emailField = obj["email"] as unknown;
  if (emailField && typeof emailField === "object") {
    const addr = (emailField as Record<string, unknown>)["address"];
    if (typeof addr === "string" && addr) return addr;
  }
  const linkedRaw = obj["linkedAccounts"] as unknown;
  const linked = Array.isArray(linkedRaw) ? (linkedRaw as unknown[]) : [];
  for (const acc of linked) {
    if (!acc || typeof acc !== "object") continue;
    const candidate = (acc as Record<string, unknown>)["email"];
    if (typeof candidate === "string" && candidate) return candidate;
  }
  return "";
}

type Step =
  | "idle"
  | "login"
  | "waitingEmail"
  | "ready"
  | "signup"
  | "claim"
  | "done"
  | "error";

export default function ClaimAutoFlow({
  token,
  recipientEmailExpected,
  expiresAt,
}: {
  token: string;
  recipientEmailExpected: string | null;
  expiresAt: string | null;
}) {
  const { ready, authenticated, login, getAccessToken, user } = usePrivy();
  const [step, setStep] = useState<Step>("idle");
  const [error, setError] = useState<string | null>(null);
  const runningRef = useRef(false);

  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

  const getPrivyToken = useCallback(
    async (tries = 60, delay = 200): Promise<string | null> => {
      for (let i = 0; i < tries; i++) {
        try {
          const t = await getAccessToken?.();
          if (t) return t;
        } catch {}
        await wait(delay);
      }
      return null;
    },
    [getAccessToken]
  );

  const begin = useCallback(async () => {
    if (runningRef.current) return;
    runningRef.current = true;
    setError(null);

    try {
      if (!recipientEmailExpected)
        throw new Error("Invalid or expired claim link.");
      if (expiresAt && Date.now() > new Date(expiresAt).getTime()) {
        throw new Error("This claim link has expired.");
      }

      setStep("login");
      if (!authenticated) {
        await login(); // open Privy modal
      }

      setStep("waitingEmail");
      const expected = recipientEmailExpected.toLowerCase();
      for (let i = 0; i < 60; i++) {
        const now = extractPrivyEmail(user).toLowerCase();
        if (now) {
          if (now !== expected) {
            throw new Error(
              `You're signed in as ${now}, but this claim is for ${recipientEmailExpected}. Please sign in with the invited email.`
            );
          }
          // matched
          setStep("ready");
          runningRef.current = false; // allow button clicks
          return;
        }
        await wait(250);
      }
      throw new Error(
        "We couldn't verify your invited email yet. Please try again."
      );
    } catch (e) {
      setStep("error");
      setError(e instanceof Error ? e.message : String(e));
      runningRef.current = false;
    }
  }, [authenticated, login, user, recipientEmailExpected, expiresAt]);

  // Claim button handler
  const claimToHaven = useCallback(async () => {
    if (runningRef.current) return;
    runningRef.current = true;
    setError(null);

    try {
      setStep("signup");
      const privyToken = await getPrivyToken();
      if (!privyToken) throw new Error("Failed to obtain Privy access token.");

      // IMPORTANT: no redirect here
      const signupRes = await fetch("/api/auth/signup", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          Authorization: `Bearer ${privyToken}`,
        },
        credentials: "include",
      });
      const signupJson = await signupRes.json().catch(() => ({}));
      if (!signupRes.ok) {
        throw new Error(
          signupJson.error || `Signup failed (${signupRes.status})`
        );
      }

      setStep("claim");
      const claimRes = await fetch("/api/transfers/email/claim", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token }),
        credentials: "include",
      });
      const claimJson = await claimRes.json().catch(() => ({}));
      if (!claimRes.ok || !claimJson.ok) {
        throw new Error(claimJson.error || `Claim failed (${claimRes.status})`);
      }

      setStep("done");
      window.location.replace("/onboarding");
    } catch (e) {
      setStep("error");
      setError(e instanceof Error ? e.message : String(e));
      runningRef.current = false;
    }
  }, [getPrivyToken, token]);

  // Off-ramp button (placeholder)
  const offRamp = useCallback(() => {
    alert("Off-ramp is coming soon.");
  }, []);

  useEffect(() => {
    if (!ready) return;
    begin(); // only login + verify; no signup/claim yet
  }, [ready, begin]);

  return (
    <div className="space-y-4 text-sm text-white/80">
      <div className="space-y-1">
        <div className={step === "login" ? "text-white" : ""}>
          1) Signing in with Privy
        </div>
        <div className={step === "waitingEmail" ? "text-white" : ""}>
          2) Verifying your invited email
        </div>
        {step !== "ready" && (
          <>
            <div className={step === "signup" ? "text-white" : ""}>
              3) Creating your Haven wallet
            </div>
            <div className={step === "claim" ? "text-white" : ""}>
              4) Delivering funds to your wallet
            </div>
          </>
        )}
      </div>

      {step === "ready" && (
        <div className="rounded-lg border border-white/10 bg-white/5 p-3">
          <div className="text-white mb-2 font-medium">
            Choose how to receive:
          </div>
          <div className="flex items-center gap-3">
            <button type="button" className="btn-neon" onClick={claimToHaven}>
              Claim to Haven
            </button>
            <button
              type="button"
              className="rounded-xl border border-white/10 px-4 py-2 hover:bg-white/10"
              onClick={offRamp}
            >
              Off-ramp (soon)
            </button>
          </div>
        </div>
      )}

      {step === "error" && (
        <div className="rounded-lg border border-red-500/30 bg-red-900/20 p-3 text-red-300">
          {error || "Something went wrong. Please try again."}
          <div className="mt-2 flex gap-2">
            <button
              className="rounded-md bg-white/10 px-3 py-1 hover:bg-white/15"
              onClick={begin}
            >
              Retry
            </button>
            <button
              className="rounded-md bg-white/10 px-3 py-1 hover:bg-white/15"
              onClick={() => window.location.reload()}
            >
              Reload
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
