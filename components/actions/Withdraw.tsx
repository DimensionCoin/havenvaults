// /components/actions/Withdraw.tsx
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { PublicKey } from "@solana/web3.js";
import { useSponsoredUsdcTransfer } from "@/hooks/useSponsoredUsdcTransfer";
import { usePrivy } from "@privy-io/react-auth";
import { useUser } from "@/providers/UserProvider";
import { useRouter } from "next/navigation";

export type WithdrawProps = {
  /** Owner pubkey (base58) for the user's Chequing/Deposit wallet (REQUIRED) */
  depositOwner: string;

  /** Unused (kept for compatibility if your QuickActions still passes it) */
  savingsOwner?: string;

  /** Optional callback on success (tx signature) */
  onSuccess?: (signature: string) => void;
};

/** Fixed processing fee taken by treasury (in USDC ≈ USD) */
const FEE_USDC = 0.02;

export default function Withdraw({ depositOwner, onSuccess }: WithdrawProps) {
  const router = useRouter();
  const { user } = useUser();
  const targetCurrency =
    (user?.displayCurrency || "USD").toUpperCase() === "USDC"
      ? "USD"
      : (user?.displayCurrency || "USD").toUpperCase();

  // Recipient + amount (shown only in user's currency)
  const [recipient, setRecipient] = useState<string>("");
  const [amountLocalStr, setAmountLocalStr] = useState<string>("");

  // FX (we use it silently to convert local → USDC for the backend)
  const [rate, setRate] = useState<number | null>(null); // USD -> target
  const [fxLoading, setFxLoading] = useState(false);

  // Validate and memoize the **deposit/chequing** owner ONLY
  const fromOwner = useMemo(() => {
    try {
      return new PublicKey(depositOwner);
    } catch {
      return null;
    }
  }, [depositOwner]);

  const {
    send: transfer,
    loading,
    lastSig,
    error,
  } = useSponsoredUsdcTransfer();
  const { getAccessToken } = usePrivy();

  // Format helper (local currency only)
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
        return `${targetCurrency} ${v.toFixed(2)}`;
      }
    },
    [targetCurrency]
  );

  // Load FX rate silently (fallback to 1 if it fails)
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

  // Derived values (local display only; conversion happens before send)
  const amountLocal = Number(amountLocalStr);
  const validLocal = isFinite(amountLocal) && amountLocal > 0;
  const feeLocal = rate ? FEE_USDC * rate : null;
  const netLocal = rate ? Math.max(0, amountLocal - FEE_USDC * rate) : null;

  // Validate recipient address
  let recipientPubkey: PublicKey | null = null;
  let recipientError: string | null = null;
  try {
    if (recipient) recipientPubkey = new PublicKey(recipient);
  } catch {
    if (recipient) recipientError = "Invalid wallet address";
  }

  // Disable button until everything is valid
  const disabled =
    loading ||
    fxLoading ||
    !fromOwner ||
    !validLocal ||
    !rate ||
    rate <= 0 ||
    !recipient ||
    !!recipientError ||
    amountLocal <= (feeLocal ?? 0);

  const submit = async () => {
    if (disabled || !recipientPubkey || !rate || !fromOwner) return;

    // Convert local currency to USDC (≈ USD) before sending to backend
    const totalAmountUi = amountLocal / rate;

    try {
      let accessToken: string | undefined;
      try {
        accessToken = (await getAccessToken?.()) || undefined;
      } catch {
        /* noop; cookie fallback on backend */
      }

      const sig = await transfer({
        fromOwner, // ALWAYS Chequing/Deposit account
        toOwner: recipientPubkey, // external wallet
        totalAmountUi, // backend nets out fee + sponsors fees
        accessToken,
      });

      onSuccess?.(sig);

      // Refresh balances (soft + hard)
      setTimeout(() => {
        router.refresh();
        if (typeof window !== "undefined") window.location.reload();
      }, 250);
    } catch {
      // surfaced via `error`
    }
  };

  return (
    <div className="w-full max-w-md rounded-2xl border border-white/10 bg-zinc-900/80 backdrop-blur-xl p-6 space-y-6 shadow-2xl">
      <div className="flex items-center justify-between">
        <h3 className="text-xl font-semibold text-white">Withdraw to Wallet</h3>
      </div>

      {/* Source info (fixed to Chequing/Deposit) */}
      <div className="rounded-xl border border-white/10 bg-white/5 p-3 text-sm text-white/80">
        <div className="font-medium">From: Chequing account</div>
        <div className="mt-1 break-all text-xs opacity-80">
          {depositOwner || "—"}
        </div>
      </div>

      {/* Recipient */}
      <div className="space-y-2">
        <label className="text-sm font-medium text-zinc-300">
          Recipient Wallet Address (Solana)
        </label>
        <input
          type="text"
          value={recipient}
          onChange={(e) => setRecipient(e.target.value.trim())}
          placeholder="Paste a Solana address"
          className={`w-full rounded-xl border px-4 py-3 bg-zinc-800/50 text-white placeholder-zinc-500 focus:outline-none transition-all
            ${
              recipientError
                ? "border-red-500/60 focus:ring-2 focus:ring-red-500/40"
                : "border-zinc-700 focus:ring-2 focus:ring-[rgb(182,255,62)]/50 focus:border-[rgb(182,255,62)]"
            }`}
        />
        {recipientError && (
          <div className="text-xs text-red-400">{recipientError}</div>
        )}
      </div>

      {/* Amount (local currency only) */}
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

        {/* Simple fee + net breakdown (local currency only) */}
        <div className="bg-zinc-800/30 rounded-lg p-3 space-y-1">
          <div className="flex justify-between text-sm">
            <span className="text-zinc-400">Processing fee:</span>
            <span className="text-white font-medium">{fmt(feeLocal)}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-zinc-400">Recipient receives (est.):</span>
            <span className="text-[rgb(182,255,62)] font-semibold">
              {fmt(netLocal)}
            </span>
          </div>
        </div>
      </div>

      {/* Submit */}
      <button
        type="button"
        disabled={disabled}
        onClick={submit}
        className="w-full rounded-xl bg-[rgb(182,255,62)] text-black py-4 font-semibold text-lg disabled:opacity-50 disabled:cursor-not-allowed hover:bg-[rgb(182,255,62)]/90 transition-all duration-200 shadow-lg shadow-[rgb(182,255,62)]/20"
      >
        {loading
          ? "Withdrawing…"
          : `Withdraw ${fmt(validLocal ? amountLocal : 0)}`}
      </button>

      {/* Status */}
      {lastSig && (
        <div className="bg-green-900/20 border border-green-700/30 rounded-lg p-3">
          <div className="text-sm text-green-400 font-medium mb-1">
            Withdrawal Submitted
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

      {error && (
        <div className="bg-red-900/20 border border-red-700/30 rounded-lg p-3">
          <div className="text-sm text-red-400">Withdrawal Failed: {error}</div>
        </div>
      )}

      <p className="text-xs text-zinc-500 text-center">
        Network fees are covered. A small processing fee applies.
      </p>
    </div>
  );
}
