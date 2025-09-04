// app/sign-in/page.tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  usePrivy,
  useLoginWithOAuth,
  useLoginWithEmail,
} from "@privy-io/react-auth";
import { FcGoogle } from "react-icons/fc";
import Link from "next/link";

type LoginResponse = {
  status?: "ok" | "onboarding_required";
  onboarded?: boolean;
  error?: string;
  message?: string;
};

export default function SignInPage() {
  const router = useRouter();
  const { ready, authenticated, getAccessToken } = usePrivy();

  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const finalizedRef = useRef(false);

  // --- Google OAuth ---
  const {
    initOAuth,
    loading: oauthLoading,
    state: oauthState,
  } = useLoginWithOAuth({
    onError: (error: unknown) => {
      setErr(
        error instanceof Error ? error.message : String(error ?? "OAuth failed")
      );
    },
  });

  // --- Email OTP ---
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");

  const {
    sendCode,
    loginWithCode,
    state: emailState,
  } = useLoginWithEmail({
    onError: (error: unknown) => {
      setErr(
        error instanceof Error
          ? error.message
          : String(error ?? "Email login failed")
      );
    },
  });

  const onSendCode = async () => {
    setErr(null);
    await sendCode({ email: email.trim() });
  };

  const onSubmitCode = async () => {
    setErr(null);
    await loginWithCode({ code: code.trim() });
    // finalize runs in effect after `authenticated` flips
  };

  // Finalize: call your /api/auth/login to set __session
  const finalizeLogin = useMemo(
    () => async () => {
      try {
        setBusy(true);
        setErr(null);

        const accessToken = await getAccessToken();
        if (!accessToken) throw new Error("No Privy access token available");

        const res = await fetch("/api/auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          cache: "no-store",
          body: JSON.stringify({ accessToken }),
        });

        // Always try to parse JSON; if not ok, throw message
        const text = await res.text();
        let data: LoginResponse = {};
        try {
          data = text ? JSON.parse(text) : {};
        } catch {
          // ignore; keep empty object
        }

        if (!res.ok) {
          const msg =
            data?.error || data?.message || text || "Failed to finalize login";
          throw new Error(msg);
        }

        // route based on onboarded flag
        if (data.status === "onboarding_required") {
          router.replace("/onboarding");
          return;
        }

        router.replace(data.onboarded ? "/dashboard" : "/onboarding");
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
        setBusy(false);
        finalizedRef.current = false;
      }
    },
    [getAccessToken, router]
  );

  // After Privy completes, finalize once
  useEffect(() => {
    if (!ready || !authenticated || finalizedRef.current) return;
    finalizedRef.current = true;
    void finalizeLogin();
  }, [ready, authenticated, finalizeLogin]);

  // Helpers
  const pickMessage = (e: unknown, fallback: string) =>
    e instanceof Error ? e.message : typeof e === "string" ? e : fallback;

  const oauthError =
    oauthState.status === "error"
      ? pickMessage(
          (oauthState as Record<string, unknown>).error,
          "OAuth failed"
        )
      : null;

  const emailError =
    emailState.status === "error"
      ? pickMessage(
          (emailState as Record<string, unknown>).error,
          "Email login failed"
        )
      : null;

  const flowError = err || oauthError || emailError;

  const isEmailAwaitingCode = emailState.status === "awaiting-code-input";
  const isEmailSubmitting = emailState.status === "submitting-code";
  const isEmailSending = emailState.status === "sending-code";

  const isWorking =
    busy ||
    oauthLoading ||
    oauthState.status === "loading" ||
    isEmailSending ||
    isEmailSubmitting;

  const startGoogle = async () => {
    setErr(null);
    await initOAuth({ provider: "google" });
  };

  if (!ready) return null;

  return (
    <div className="min-h-screen flex items-center justify-center text-white px-4">
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-white/5 p-6 shadow-2xl space-y-6">
        <header>
          <h1 className="text-2xl font-semibold">Sign in to Haven</h1>
          <p className="mt-1 text-sm text-zinc-400">
            Continue with Google or an email code. We’ll restore your session.
          </p>
        </header>

        {/* Google */}
        <div className="space-y-2">
          <button
            onClick={startGoogle}
            disabled={isWorking}
            className="w-full rounded-lg bg-white/10 hover:bg-white/15 disabled:opacity-60 border border-white/20 px-4 py-2 transition flex items-center justify-center gap-2"
          >
            {isWorking && oauthState.status === "loading" ? (
              "Redirecting…"
            ) : (
              <>
                <FcGoogle className="w-5 h-5" />
                Continue With Google
              </>
            )}
          </button>
        </div>

        <div className="relative flex items-center">
          <div className="flex-1 h-px bg-white/10" />
          <span className="px-3 text-xs text-white/50">or</span>
          <div className="flex-1 h-px bg-white/10" />
        </div>

        {/* Email OTP */}
        <div className="space-y-3">
          <label className="block text-sm text-white/80">Email</label>
          <input
            type="email"
            inputMode="email"
            autoComplete="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.currentTarget.value)}
            className="w-full rounded-lg bg-black/20 border border-white/10 px-3 py-2 outline-none focus:ring-2 ring-white/20"
            disabled={isWorking || isEmailAwaitingCode}
          />

          {isEmailAwaitingCode ? (
            <>
              <label className="block text-sm text-white/80">
                Enter 6-digit code
              </label>
              <input
                type="text"
                inputMode="numeric"
                placeholder="123456"
                value={code}
                onChange={(e) => setCode(e.currentTarget.value)}
                className="w-full rounded-lg bg-black/20 border border-white/10 px-3 py-2 outline-none focus:ring-2 ring-white/20 tracking-widest"
                maxLength={6}
                disabled={isWorking}
              />
              <button
                onClick={onSubmitCode}
                disabled={isWorking || code.trim().length < 4}
                className="w-full rounded-lg bg-white/10 hover:bg-white/15 disabled:opacity-60 border border-white/20 px-4 py-2 transition"
              >
                {isEmailSubmitting ? "Verifying…" : "Sign in"}
              </button>

              <button
                type="button"
                onClick={onSendCode}
                disabled={isWorking}
                className="w-full text-xs text-white/60 hover:text-white/80 underline underline-offset-4"
              >
                Resend code
              </button>
            </>
          ) : (
            <button
              onClick={onSendCode}
              disabled={isWorking || !email.trim()}
              className="w-full rounded-lg bg-white/10 hover:bg-white/15 disabled:opacity-60 border border-white/20 px-4 py-2 transition"
            >
              {emailState.status === "sending-code" ? "Sending…" : "Send code"}
            </button>
          )}
        </div>

        {/* Errors */}
        <div
          role="alert"
          aria-live="polite"
          className="min-h-[1.25rem] text-sm"
        >
          {flowError && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-red-300">
              {flowError}
            </div>
          )}
        </div>

        <footer className="space-y-4">
          <div className="pt-4 border-t border-white/10">
            <p className="text-sm text-zinc-400 text-center mb-3">
              New to Haven?
            </p>
            <Link href="/sign-up">
              <button className="w-full rounded-lg bg-[rgb(182,255,62)]/10 hover:bg-[rgb(182,255,62)]/20 border border-[rgb(182,255,62)]/30 px-4 py-2 text-[rgb(182,255,62)] transition-all duration-200 font-medium">
                Create account
              </button>
            </Link>
          </div>
        </footer>
      </div>
    </div>
  );
}
