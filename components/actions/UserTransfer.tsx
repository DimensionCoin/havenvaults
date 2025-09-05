"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { PublicKey } from "@solana/web3.js";
import { usePrivy } from "@privy-io/react-auth";
import { useUser } from "@/providers/UserProvider";
import { useRouter } from "next/navigation";
import { useResolveDepositOwnerByEmail } from "@/hooks/useResolveDepositOwnerByEmail";
import { useSponsoredUsdcTransfer } from "@/hooks/useSponsoredUsdcTransfer";

const FEE_USDC = 0.02; // fixed processing fee

type Props = {
  /** Optional override; otherwise uses current user's chequing/deposit owner address */
  fromOwnerBase58?: string;
  onSuccess?: (signature: string) => void;
};

type RecipientState = "idle" | "checking" | "user" | "nonuser" | "error";

export default function UserTransfer({ fromOwnerBase58, onSuccess }: Props) {
  const router = useRouter();
  const { user } = useUser();
  const { getAccessToken } = usePrivy();

  // Sender owner (chequing/deposit)
  const depositOwner = fromOwnerBase58 ?? user?.depositWallet?.address ?? "";
  const fromOwnerPk = useMemo<PublicKey | null>(() => {
    try {
      return depositOwner ? new PublicKey(depositOwner) : null;
    } catch {
      return null;
    }
  }, [depositOwner]);
  const fromOwnerValid = !!fromOwnerPk;

  // Display currency
  const targetCurrency =
    (user?.displayCurrency || "USD").toUpperCase() === "USDC"
      ? "USD"
      : (user?.displayCurrency || "USD").toUpperCase();

  // UI state
  const [email, setEmail] = useState("");
  const [note, setNote] = useState("");
  const [amountLocalStr, setAmountLocalStr] = useState("");

  // FX 1 USD -> target currency
  const [rate, setRate] = useState<number | null>(null);
  const [fxLoading, setFxLoading] = useState(false);

  // Recipient resolution
  const {
    resolve,
    loading: resolving,
    error: resolveErr,
    setError: setResolveErr,
  } = useResolveDepositOwnerByEmail();

  const [recipientState, setRecipientState] = useState<RecipientState>("idle");
  const [resolvedPk, setResolvedPk] = useState<PublicKey | null>(null);

  // Transfer hook
  const {
    send,
    loading: sending,
    lastSig,
    error: sendErr,
  } = useSponsoredUsdcTransfer();

  const fmt = useCallback(
    (v: number | null | undefined) => {
      if (v == null || !isFinite(v)) return "—";
      try {
        return new Intl.NumberFormat(undefined, {
          style: "currency",
          currency: targetCurrency,
          maximumFractionDigits: 2,
        }).format(v);
      } catch {
        return `${targetCurrency} ${Number(v).toFixed(2)}`;
      }
    },
    [targetCurrency]
  );

  // Load FX once per currency
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setFxLoading(true);
      try {
        const token = await getAccessToken?.();
        const r = await fetch(
          `/api/fx?currency=${encodeURIComponent(targetCurrency)}&amount=1`,
          {
            headers: token ? { Authorization: `Bearer ${token}` } : undefined,
            credentials: "include",
            cache: "no-store",
          }
        );
        const j = r.ok ? await r.json() : { rate: 1 };
        if (!cancelled) setRate(Number(j.rate || 1));
      } catch {
        if (!cancelled) setRate(1);
      } finally {
        if (!cancelled) setFxLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [targetCurrency, getAccessToken]);

  // Debounced email lookup
  const normEmail = (s: string) => s.trim().toLowerCase();
  const emailLooksValid = /\S+@\S+\.\S+/.test(normEmail(email));

  useEffect(() => {
    setResolvedPk(null);
    setResolveErr(null);
    setRecipientState("idle");
    if (!emailLooksValid) return;

    let cancelled = false;
    const t = setTimeout(async () => {
      setRecipientState("checking");
      try {
        const pk = await resolve(normEmail(email));
        if (!cancelled) {
          setResolvedPk(pk);
          setRecipientState("user");
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (!cancelled) {
          if (msg.toLowerCase().includes("user not found")) {
            setResolvedPk(null);
            setRecipientState("nonuser");
          } else {
            setRecipientState("error");
          }
        }
      }
    }, 450);

    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [email, emailLooksValid, resolve, setResolveErr]);

  // Derived UI values
  const amountLocal = Number(amountLocalStr);
  const validLocal = isFinite(amountLocal) && amountLocal > 0;
  const feeLocal = rate ? FEE_USDC * rate : null;
  const netLocal = rate ? Math.max(0, amountLocal - FEE_USDC * rate) : null;

  const sendingToSelf =
    recipientState === "user" &&
    !!resolvedPk &&
    !!fromOwnerPk &&
    resolvedPk.equals(fromOwnerPk);

  const rateInvalid = rate == null || rate <= 0;

  const disabled =
    !fromOwnerValid ||
    sending ||
    resolving ||
    fxLoading ||
    rateInvalid ||
    !emailLooksValid ||
    !validLocal ||
    amountLocal <= (feeLocal ?? 0) ||
    recipientState === "checking" ||
    recipientState === "error" ||
    sendingToSelf;

  const submit = async () => {
    if (disabled || !rate || !fromOwnerPk) return;

    const totalAmountUi = amountLocal / rate; // local → USD (USDC) UI
    const token = (await getAccessToken?.()) || undefined;

    try {
      if (recipientState === "user" && resolvedPk) {
        // Direct transfer to existing Haven user
        const sig = await send({
          fromOwner: fromOwnerPk,
          toOwner: resolvedPk,
          totalAmountUi,
          accessToken: token,
        });
        onSuccess?.(sig);
      } else if (recipientState === "nonuser") {
        // Server handles: escrow funding + claim + email
        const r = await fetch("/api/transfers/email/create", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          credentials: "include", // includes __session cookie
          body: JSON.stringify({
            recipientEmail: normEmail(email),
            fromOwner: fromOwnerPk.toBase58(),
            amountUi: totalAmountUi,
            note: note || undefined, // optional: you can store it later if you add schema support
          }),
        });
        const j = await r.json();
        if (!r.ok || !j?.ok) {
          throw new Error(j?.error || `HTTP ${r.status}`);
        }
        // success: server already moved funds to escrow AND sent email
      } else {
        throw new Error("Unable to determine recipient type.");
      }

      // Refresh balances (soft + hard)
      setTimeout(() => {
        router.refresh();
        if (typeof window !== "undefined") window.location.reload();
      }, 250);
    } catch {
      // surfaced via sendErr / resolveErr or thrown here
    }
  };

  const helperLine = (() => {
    if (resolving || recipientState === "checking")
      return "Looking up recipient…";
    if (recipientState === "user")
      return "Haven user found — funds will arrive instantly.";
    if (recipientState === "nonuser")
      return "Invite will be emailed — they can claim to Haven or off-ramp.";
    if (recipientState === "error")
      return resolveErr || "Lookup failed. Try again.";
    return "";
  })();

  return (
    <div className="w-full max-w-md rounded-2xl border border-white/10 bg-zinc-900/80 backdrop-blur-xl p-6 space-y-6 shadow-2xl">
      <div className="flex items-center justify-between">
        <h3 className="text-xl font-semibold text-white">Send money</h3>
      </div>

      {!fromOwnerValid && (
        <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/10 p-3 text-xs text-yellow-200">
          Your chequing wallet isn’t ready yet. Please finish onboarding.
        </div>
      )}

      {/* Recipient email */}
      <div className="space-y-2">
        <label className="text-sm font-medium text-zinc-300">
          Recipient email
        </label>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="name@email.com"
          className={`w-full rounded-xl border px-4 py-3 bg-zinc-800/50 text-white placeholder-zinc-500 focus:outline-none transition-all ${
            recipientState === "error"
              ? "border-red-500/60 focus:ring-2 focus:ring-red-500/40"
              : "border-zinc-700 focus:ring-2 focus:ring-[rgb(182,255,62)]/50 focus:border-[rgb(182,255,62)]"
          }`}
        />
        <div className="text-xs text-zinc-400 h-4">{helperLine}</div>
      </div>

      {/* Optional note */}
      <div className="space-y-2">
        <label className="text-sm font-medium text-zinc-300">
          Note (optional)
        </label>
        <input
          type="text"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Dinner payback 🍝"
          className="w-full rounded-xl border border-zinc-700 bg-zinc-800/50 px-4 py-3 text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-[rgb(182,255,62)]/50 focus:border-[rgb(182,255,62)] transition-all"
          maxLength={120}
        />
      </div>

      {/* Amount (local currency) */}
      <div className="space-y-3">
        <label className="text-sm font-medium text-zinc-300">
          Amount ({targetCurrency})
        </label>
        <input
          type="number"
          min="0"
          step="0.01"
          value={amountLocalStr}
          onChange={(e) => setAmountLocalStr(e.target.value)}
          className="w-full rounded-xl border border-zinc-700 bg-zinc-800/50 px-4 py-3 text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-[rgb(182,255,62)]/50 focus:border-[rgb(182,255,62)] transition-all"
          placeholder="0.00"
          inputMode="decimal"
        />
        <div className="bg-zinc-800/30 rounded-lg p-3 space-y-1">
          {sendingToSelf && (
            <div className="text-xs text-red-400">
              You can’t send to your own account.
            </div>
          )}
          <div className="flex justify-between text-sm">
            <span className="text-zinc-400">Processing fee:</span>
            <span className="text-white font-medium">{fmt(feeLocal)}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-zinc-400">
              {recipientState === "nonuser"
                ? "Escrow receives (est.):"
                : "Recipient receives (est.):"}
            </span>
            <span className="text-[rgb(182,255,62)] font-semibold">
              {fmt(netLocal)}
            </span>
          </div>
          {recipientState === "nonuser" && (
            <div className="text-[10px] text-zinc-500 mt-1">
              We’ll email them a claim link. They can off-ramp or create a Haven
              account.
            </div>
          )}
        </div>
      </div>

      {/* Submit */}
      <button
        type="button"
        disabled={disabled}
        onClick={submit}
        className="w-full rounded-xl bg-[rgb(182,255,62)] text-black py-4 font-semibold text-lg disabled:opacity-50 disabled:cursor-not-allowed hover:bg-[rgb(182,255,62)]/90 transition-all duration-200 shadow-lg shadow-[rgb(182,255,62)]/20"
      >
        {sending ? "Sending…" : `Send ${fmt(validLocal ? amountLocal : 0)}`}
      </button>

      {/* Status */}
      {lastSig && (
        <div className="bg-green-900/20 border border-green-700/30 rounded-lg p-3 mt-2">
          <div className="text-sm text-green-400 font-medium mb-1">
            {recipientState === "nonuser"
              ? "Invite sent"
              : "Transfer submitted"}
          </div>
          <div className="text-xs text-zinc-400 break-all">
            Transaction: {lastSig}
          </div>
          <a
            href={`https://explorer.solana.com/tx/${lastSig}?cluster=devnet`}
            target="_blank"
            rel="noreferrer"
            className="text-xs text-[rgb(182,255,62)] hover:underline mt-1 inline-block"
          >
            View on Blockchain Explorer →
          </a>
        </div>
      )}

      {(sendErr || (recipientState === "error" && resolveErr)) && (
        <div className="bg-red-900/20 border border-red-700/30 rounded-lg p-3 mt-2">
          <div className="text-sm text-red-400">{sendErr || resolveErr}</div>
        </div>
      )}

      <p className="text-xs text-zinc-500 text-center">
        Network fees are covered. A small processing fee applies.
      </p>
    </div>
  );
}
