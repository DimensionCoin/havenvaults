// /components/actions/Move.tsx
"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import { PublicKey } from "@solana/web3.js";
import { useSponsoredUsdcTransfer } from "@/hooks/useSponsoredUsdcTransfer";
import { usePrivy } from "@privy-io/react-auth";
import { useUser } from "@/providers/UserProvider";
import { useRouter } from "next/navigation";

type AccountKind = "deposit" | "savings";

export type MoveProps = {
  depositOwner: string; // user's chequing/deposit owner pubkey (base58)
  savingsOwner: string; // user's savings owner pubkey (base58)
  defaultFrom?: AccountKind;
  onSuccess?: (signature: string) => void;
};

// fixed protocol fee, denominated in USD (sent as USDC behind the scenes)
const PROCESSING_FEE_USD = 0.02;

export default function Move({
  depositOwner,
  savingsOwner,
  defaultFrom = "deposit",
  onSuccess,
}: MoveProps) {
  const router = useRouter();
  const { user } = useUser();
  const targetCurrency =
    (user?.displayCurrency || "USD").toUpperCase() === "USDC"
      ? "USD"
      : (user?.displayCurrency || "USD").toUpperCase();

  // UI state (amount typed in user's currency)
  const [from, setFrom] = useState<AccountKind>(defaultFrom);
  const [localAmountStr, setLocalAmountStr] = useState<string>("");

  // FX (kept internal; no UI mentions of conversion/USDC)
  const [rate, setRate] = useState<number | null>(null); // USD -> targetCurrency
  const [fxLoading, setFxLoading] = useState(false);
  const [fxErr, setFxErr] = useState<string | null>(null);

  // Resolve owners
  const fromOwner = useMemo(
    () => new PublicKey(from === "deposit" ? depositOwner : savingsOwner),
    [from, depositOwner, savingsOwner]
  );
  const toOwner = useMemo(
    () => new PublicKey(from === "deposit" ? savingsOwner : depositOwner),
    [from, depositOwner, savingsOwner]
  );

  // Sponsored transfer hook
  const {
    send: transferSponsored,
    loading,
    lastSig,
    error,
  } = useSponsoredUsdcTransfer();

  const { getAccessToken } = usePrivy();

  // Formatter (user currency only)
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

  // Fetch USD->targetCurrency rate (quietly, no UI text about rates)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setFxLoading(true);
      setFxErr(null);
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
        if (!r.ok) throw new Error(`FX ${r.status}`);
        const j = (await r.json()) as { rate: number };
        if (!cancelled) setRate(Number(j.rate || 0));
      } catch (e) {
        if (!cancelled) setFxErr(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setFxLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [targetCurrency, getAccessToken]);

  // Derived amounts (all displayed in user's currency only)
  const localAmount = Number(localAmountStr);
  const validLocal = isFinite(localAmount) && localAmount > 0;
  const usdAmount = validLocal && rate && rate > 0 ? localAmount / rate : 0; // internal only
  const feeLocal = rate ? PROCESSING_FEE_USD * rate : null;
  const netLocal = rate
    ? Math.max(0, localAmount - PROCESSING_FEE_USD * rate)
    : null;

  // disable until we have a rate and the amount covers the fee internally
  const disabled =
    loading ||
    fxLoading ||
    !!fxErr ||
    !validLocal ||
    !rate ||
    rate <= 0 ||
    usdAmount <= PROCESSING_FEE_USD;

  const submit = async () => {
    if (disabled) return;
    try {
      let accessToken: string | undefined;
      try {
        accessToken = (await getAccessToken?.()) || undefined;
      } catch {
        /* noop */
      }

      // send in USD-equivalent units (handled internally by backend)
      const sig = await transferSponsored({
        fromOwner,
        toOwner,
        totalAmountUi: usdAmount,
        accessToken,
      });

      onSuccess?.(sig);

      // refresh balances (client-side web3 hooks)
      setTimeout(() => {
        router.refresh();
        if (typeof window !== "undefined") window.location.reload();
      }, 250);
    } catch {
      /* error is surfaced below */
    }
  };

  return (
    <div className="w-full max-w-md rounded-2xl border border-white/10 bg-zinc-900/80 backdrop-blur-xl p-6 space-y-6 shadow-2xl">
      <div className="flex items-center justify-between">
        <h3 className="text-xl font-semibold text-white">Move Money</h3>
      </div>

      {/* From selector */}
      <div className="space-y-3">
        <label className="text-sm font-medium text-zinc-300">
          From Account
        </label>
        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => setFrom("deposit")}
            className={`flex-1 px-4 py-3 rounded-xl border transition-all duration-200 font-medium ${
              from === "deposit"
                ? "bg-[rgb(182,255,62)] text-black border-[rgb(182,255,62)] shadow-lg shadow-[rgb(182,255,62)]/20"
                : "border-zinc-700 bg-zinc-800/50 text-zinc-300 hover:border-zinc-600 hover:bg-zinc-800"
            }`}
          >
            Chequing
          </button>
          <button
            type="button"
            onClick={() => setFrom("savings")}
            className={`flex-1 px-4 py-3 rounded-xl border transition-all duration-200 font-medium ${
              from === "savings"
                ? "bg-[rgb(182,255,62)] text-black border-[rgb(182,255,62)] shadow-lg shadow-[rgb(182,255,62)]/20"
                : "border-zinc-700 bg-zinc-800/50 text-zinc-300 hover:border-zinc-600 hover:bg-zinc-800"
            }`}
          >
            Savings
          </button>
        </div>
        <p className="text-xs text-zinc-400">
          Funds will be transferred to your{" "}
          {from === "deposit" ? "savings" : "chequing"} account.
        </p>
      </div>

      {/* Amount input (user currency only) */}
      <div className="space-y-3">
        <label className="text-sm font-medium text-zinc-300">
          Transfer Amount ({targetCurrency})
        </label>
        <input
          type="number"
          min="0"
          step="0.01"
          value={localAmountStr}
          onChange={(e) => setLocalAmountStr(e.target.value)}
          className="w-full rounded-xl border border-zinc-700 bg-zinc-800/50 px-4 py-3 text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-[rgb(182,255,62)]/50 focus:border-[rgb(182,255,62)] transition-all"
          placeholder="0.00"
          inputMode="decimal"
        />

        {/* Simple breakdown (no USDC/FX mentions) */}
        <div className="bg-zinc-800/30 rounded-lg p-3 space-y-1">
          <div className="flex justify-between text-sm">
            <span className="text-zinc-400">You send:</span>
            <span className="text-white font-medium">
              {fmt(validLocal ? localAmount : null)}
            </span>
          </div>

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
          ? "Processing Transfer..."
          : `Transfer ${fmt(validLocal ? localAmount : 0)}`}
      </button>

      {/* Status */}
      {lastSig && (
        <div className="bg-green-900/20 border border-green-700/30 rounded-lg p-3">
          <div className="text-sm text-green-400 font-medium mb-1">
            Transfer Successful!
          </div>
          <div className="text-xs text-zinc-400 break-all">
            Reference: {lastSig}
          </div>
          <a
            href={`https://explorer.solana.com/tx/${lastSig}?cluster=devnet`}
            target="_blank"
            rel="noreferrer"
            className="text-xs text-[rgb(182,255,62)] hover:underline mt-1 inline-block"
          >
            View details →
          </a>
        </div>
      )}

      {error && (
        <div className="bg-red-900/20 border border-red-700/30 rounded-lg p-3">
          <div className="text-sm text-red-400">Transfer Failed: {error}</div>
        </div>
      )}

      <p className="text-xs text-zinc-500 text-center">
        Network fees are covered by Haven. A small processing fee applies to all
        transfers
        {feeLocal != null ? ` (${fmt(feeLocal)}).` : "."}
      </p>
    </div>
  );
}
