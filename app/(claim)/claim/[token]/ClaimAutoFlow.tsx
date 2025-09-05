// app/(claim)/claim/[token]/ClaimAutoFlow.tsx
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";

/* ----------------------------- helpers ---------------------------------- */

function extractPrivyEmail(u: unknown): string {
  const obj = (u ?? {}) as Record<string, unknown>;
  const ef = obj["email"] as unknown;
  if (ef && typeof ef === "object") {
    const addr = (ef as Record<string, unknown>)["address"];
    if (typeof addr === "string" && addr) return addr;
  }
  if (typeof obj["email"] === "string" && obj["email"]) {
    return String(obj["email"]);
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
  | "loadingSummary"
  | "ready"
  | "signup"
  | "claimingAll"
  | "done"
  | "error";

type Summary = {
  ok: true;
  count: number;
  totalUnits: number;
  totalUi: number;
  currency: "USDC";
};

type ListItem = {
  id: string;
  tokenId: string;
  amountUnits: number;
  amountUi: number;
  currency: string;
  createdAt: string | Date;
  from: { name?: string; email?: string; owner?: string };
};

function formatMoney(n: number) {
  try {
    return new Intl.NumberFormat(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(n);
  } catch {
    return n.toFixed(2);
  }
}
function formatDate(d: string | Date) {
  const date = typeof d === "string" ? new Date(d) : d;
  try {
    return new Intl.DateTimeFormat(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(date);
  } catch {
    return date.toISOString();
  }
}

/* ----------------------------- component -------------------------------- */

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

  const [summary, setSummary] = useState<Summary | null>(null);
  const [summaryError, setSummaryError] = useState<string | null>(null);

  const [list, setList] = useState<ListItem[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);

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

  const privyEmail = useMemo(
    () => extractPrivyEmail(user).toLowerCase(),
    [user]
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
        await login();
      }

      setStep("waitingEmail");
      const expected = recipientEmailExpected.toLowerCase();
      for (let i = 0; i < 80; i++) {
        const now = extractPrivyEmail(user).toLowerCase();
        if (now) {
          if (now !== expected) {
            throw new Error(
              `You're signed in as ${now}, but this claim is for ${recipientEmailExpected}. Please sign in with the invited email.`
            );
          }

          // Create __session cookie BEFORE hitting summary/list
          const privyToken = await getPrivyToken();
          if (!privyToken)
            throw new Error("Failed to obtain Privy access token.");

          setStep("loadingSummary");
          const signupRes = await fetch("/api/auth/signup", {
            method: "POST",
            headers: {
              "content-type": "application/json",
              Authorization: `Bearer ${privyToken}`,
            },
            credentials: "include",
          });
          if (!signupRes.ok) {
            const j = await signupRes.json().catch(() => ({}));
            throw new Error(j.error || `Signup failed (${signupRes.status})`);
          }

          // Fetch summary + list in parallel
          const [sumRes, listRes] = await Promise.all([
            fetch("/api/transfers/email/pending/summary", {
              method: "POST",
              headers: { "content-type": "application/json" },
              credentials: "include",
              body: JSON.stringify({ token }),
            }),
            fetch("/api/transfers/email/pending/list", {
              method: "POST",
              headers: { "content-type": "application/json" },
              credentials: "include",
              body: JSON.stringify({ token }),
            }),
          ]);

          // summary
          if (!sumRes.ok) {
            const j = await sumRes.json().catch(() => ({}));
            setSummaryError(
              j?.error || `Failed to load summary (${sumRes.status})`
            );
            setSummary(null);
          } else {
            const j = (await sumRes.json()) as Summary;
            setSummary(j);
            setSummaryError(null);
          }

          // list
          if (!listRes.ok) {
            const j = await listRes.json().catch(() => ({}));
            setListError(
              j?.error || `Failed to load transfers (${listRes.status})`
            );
            setList(null);
          } else {
            const j = (await listRes.json()) as { ok: true; items: ListItem[] };
            setList(j.items || []);
            setListError(null);
          }

          setStep("ready");
          runningRef.current = false;
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
  }, [
    authenticated,
    login,
    user,
    token,
    recipientEmailExpected,
    expiresAt,
    getPrivyToken,
  ]);

  // Single CTA: claim ALL (the API already claims everything pending)
  const claimAll = useCallback(async () => {
    if (runningRef.current) return;
    runningRef.current = true;
    setError(null);
    try {
      setStep("signup");
      const privyToken = await getPrivyToken();
      if (!privyToken) throw new Error("Failed to obtain Privy access token.");

      const signupRes = await fetch("/api/auth/signup", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          Authorization: `Bearer ${privyToken}`,
        },
        credentials: "include",
      });
      if (!signupRes.ok) {
        const j = await signupRes.json().catch(() => ({}));
        throw new Error(j.error || `Signup failed (${signupRes.status})`);
      }

      setStep("claimingAll");
      const res = await fetch("/api/transfers/email/claim", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ token }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j.ok)
        throw new Error(j.error || `Claim failed (${res.status})`);

      setStep("done");
      window.location.replace("/onboarding");
    } catch (e) {
      setStep("error");
      setError(e instanceof Error ? e.message : String(e));
      runningRef.current = false;
    }
  }, [getPrivyToken, token]);

  const offRamp = useCallback(() => {
    alert("Off-ramp is coming soon.");
  }, []);

  useEffect(() => {
    if (!ready) return;
    begin();
  }, [ready, begin]);

  const totalUiText = useMemo(() => {
    if (!summary?.ok) return null;
    return `$${formatMoney(summary.totalUi)} ${summary.currency}`;
  }, [summary]);

  const nothingToClaim = summary && summary.count <= 0;

  return (
    <div className="space-y-6 text-sm text-white/80">
      {/* Progress */}
      <div className="space-y-1">
        <div className={step === "login" ? "text-white" : ""}>
          1) Signing in with Privy
        </div>
        <div className={step === "waitingEmail" ? "text-white" : ""}>
          2) Verifying your invited email
        </div>
        {(step === "loadingSummary" || step === "ready") && (
          <div className={step === "loadingSummary" ? "text-white" : ""}>
            3) Loading your transfers
          </div>
        )}
        {["signup", "claimingAll"].includes(step) && (
          <>
            <div className="text-white">3) Creating your Haven wallet</div>
            <div className="text-white">4) Delivering funds (all claims)</div>
          </>
        )}
      </div>

      {/* Summary + Actions */}
      {step === "ready" && (
        <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-white font-medium">Pending transfers</div>
              {summaryError ? (
                <div className="text-xs text-red-400 mt-1">{summaryError}</div>
              ) : summary ? (
                <div className="text-xs text-white/70 mt-1">
                  {summary.count} transfer{summary.count === 1 ? "" : "s"}
                  {totalUiText ? ` · Total: ${totalUiText}` : ""}
                </div>
              ) : (
                <div className="h-4 w-40 bg-white/10 rounded animate-pulse mt-2" />
              )}
            </div>
            <div className="text-xs text-white/60">
              Signed in as{" "}
              <span className="text-white">{privyEmail || "…"}</span>
            </div>
          </div>

          {/* List */}
          <div className="mt-4">
            {listError && (
              <div className="text-xs text-red-400">{listError}</div>
            )}
            {!list && !listError && (
              <div className="h-12 w-full bg-white/10 rounded animate-pulse" />
            )}
            {list && list.length > 0 && (
              <div className="divide-y divide-white/10 rounded-xl border border-white/10 overflow-hidden">
                {list.map((item) => {
                  const fromLabel =
                    item.from?.name ||
                    item.from?.email ||
                    (item.from?.owner
                      ? `Owner ${item.from.owner.slice(0, 6)}…`
                      : "Unknown");
                  return (
                    <div
                      key={item.id}
                      className="p-4 flex items-center justify-between"
                    >
                      <div className="min-w-0">
                        <div className="text-white truncate">{fromLabel}</div>
                        <div className="text-xs text-white/60">
                          {formatDate(item.createdAt)}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-white font-medium">
                          ${formatMoney(item.amountUi)} {item.currency}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            {list && list.length === 0 && (
              <div className="text-xs text-white/60">No pending transfers.</div>
            )}
          </div>

          {/* Actions */}
          <div className="mt-4 flex flex-wrap gap-3">
            <button
              type="button"
              className="btn-neon"
              onClick={claimAll}
              disabled={!!nothingToClaim}
              title={
                nothingToClaim ? "No pending transfers to claim" : "Claim now"
              }
            >
              Claim now
            </button>

            <button
              type="button"
              className="rounded-xl border border-white/10 px-4 py-2 hover:bg-white/10"
              onClick={offRamp}
            >
              Off-ramp (soon)
            </button>
          </div>

          <p className="mt-3 text-xs text-white/60">
            We’ll deliver funds to your Haven wallet, then take you to
            onboarding to finish setting up your account.
          </p>
        </div>
      )}

      {/* Error */}
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
