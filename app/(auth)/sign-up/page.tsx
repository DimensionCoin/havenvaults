// app/sign-up/page.tsx
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

export default function SignUpPage() {
  const router = useRouter();
  const { ready, authenticated, getAccessToken } = usePrivy();

  // shared UI state
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const finalizedRef = useRef(false);

  // --- Google OAuth (only Google enabled) ---
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
    // finalize runs via effect
  };

  // Finalize: exchange Privy access token for our app session (CREATE-OR-LOGIN)
  const finalizeSignup = useMemo(
    () => async () => {
      try {
        setBusy(true);
        setErr(null);

        const accessToken = await getAccessToken();
        if (!accessToken) throw new Error("No Privy access token available");

        const res = await fetch("/api/auth/signup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          cache: "no-store",
          body: JSON.stringify({ accessToken }),
        });

        if (!res.ok) {
          const text = await res.text();
          throw new Error(text || "Failed to finalize signup");
        }

        const data = await res.json();
        router.replace(data.onboarded ? "/dashboard" : "/onboarding");
      } catch (e: unknown) {
        setErr(e instanceof Error ? e.message : String(e));
        setBusy(false);
        finalizedRef.current = false;
      }
    },
    [getAccessToken, router]
  );

  // After Google or Email completes, Privy sets authenticated=true → finalize once
  useEffect(() => {
    if (!ready || !authenticated || finalizedRef.current) return;
    finalizedRef.current = true;
    void finalizeSignup();
  }, [ready, authenticated, finalizeSignup]);

  // Start Google flow
  const startGoogle = async () => {
    setErr(null);
    await initOAuth({ provider: "google" });
  };

  const emailStatus = emailState.status;
  const isEmailAwaitingCode = emailStatus === "awaiting-code-input";
  const isEmailSubmitting = emailStatus === "submitting-code";
  const isEmailSending = emailStatus === "sending-code";

  const isWorking =
    busy ||
    oauthLoading ||
    oauthState.status === "loading" ||
    isEmailSending ||
    isEmailSubmitting;

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

  return (
    <div className="min-h-screen flex items-center justify-center text-white px-4">
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-white/5 p-6 shadow-2xl space-y-6">
        <header>
          <h1 className="text-2xl font-semibold">Create your Haven account</h1>
          <p className="mt-1 text-sm text-zinc-400">
            Sign in with Google or continue with an email code. We’ll set up
            your session and guide you through onboarding.
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
                {isEmailSubmitting ? "Verifying…" : "Login"}
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
              Already have an account?
            </p>
            <Link href="/sign-in">
              <button className="w-full rounded-lg bg-[rgb(182,255,62)]/10 hover:bg-[rgb(182,255,62)]/20 border border-[rgb(182,255,62)]/30 px-4 py-2 text-[rgb(182,255,62)] transition-all duration-200 font-medium">
                Sign In
              </button>
            </Link>
          </div>
        </footer>

        <footer className="space-y-2">
          <p className="text-xs text-zinc-500">
            By continuing, you agree to Haven’s Terms and acknowledge the
            Privacy Policy.
          </p>
          <p className="text-[11px] text-zinc-600">
            If Google appears “not allowed,” enable Google in Privy, add this
            site to Allowed Origins, and verify your App ID.
          </p>
        </footer>
      </div>
    </div>
  );
}
