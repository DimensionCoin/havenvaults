// app/components/dash/SavingsAccount.tsx
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { useUser } from "@/providers/UserProvider";
import { Connection, PublicKey } from "@solana/web3.js";
import {
  getAssociatedTokenAddress,
  getAccount as getSplAccount,
} from "@solana/spl-token";

type FxResponse = {
  base: "USD";
  target: string;
  rate: number;
  amount: number;
  converted: number;
  asOf?: string | null;
};

const RPC_URL =
  process.env.NEXT_PUBLIC_SOLANA_RPC ?? "https://api.mainnet-beta.solana.com";
const USDC_MINT = new PublicKey(
  process.env.NEXT_PUBLIC_USDC_MINT ??
    "EPjFWdd5AuVNx6iGJ9g8s7f2GzAxQ8c3Gya4A1b1fS3"
);
const USDC_DECIMALS = 6;

/* ---- helpers (kept consistent with DepositAccount) ---- */
function formatFiat(n: number, currency: string) {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(n);
  } catch {
    return `${currency} ${n.toFixed(2)}`;
  }
}
function mask(addr?: string | null) {
  if (!addr || addr.length < 4) return "****-****-0000";
  return `****-****-${addr.slice(-4)}`;
}
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const id = setTimeout(() => reject(new Error(`${label} timed out`)), ms);
    p.then(
      (v) => {
        clearTimeout(id);
        resolve(v);
      },
      (e) => {
        clearTimeout(id);
        reject(e);
      }
    );
  });
}

export default function SavingsAccount() {
  const { user, refresh: refreshUser } = useUser();
  const { ready, authenticated, getAccessToken } = usePrivy();

  const walletAddress = user?.savingsWallet?.address ?? null;
  const displayCurrency = (user?.displayCurrency || "USD").toUpperCase();

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [usdcBalance, setUsdcBalance] = useState(0);
  const [fxRate, setFxRate] = useState(1);

  // Modal state (for opening a savings account)
  const [open, setOpen] = useState(false);
  const [agree, setAgree] = useState(true);
  const [opening, setOpening] = useState(false);

  const connection = useMemo(() => new Connection(RPC_URL, "confirmed"), []);

  const fetchUsdc = useCallback(
    async (owner58: string) => {
      try {
        const owner = new PublicKey(owner58);
        const ata = await getAssociatedTokenAddress(USDC_MINT, owner, false);
        const acc = await getSplAccount(connection, ata, "confirmed");
        const amt = acc.amount as unknown;
        const raw =
          typeof amt === "bigint" ? Number(amt) : Number(amt as number | string);
        return raw / 10 ** USDC_DECIMALS;
      } catch {
        return 0;
      }
    },
    [connection]
  );

  const convertFx = useCallback(
    async (amount: number, currency: string): Promise<FxResponse> => {
      const accessToken = await getAccessToken().catch(() => null);
      const url = `/api/fx?amount=${encodeURIComponent(
        amount
      )}&currency=${encodeURIComponent(currency)}`;
      const resp = await withTimeout(
        fetch(url, {
          method: "GET",
          cache: "no-store",
          credentials: "include",
          headers: accessToken
            ? { Authorization: `Bearer ${accessToken}` }
            : {},
        }),
        8000,
        "FX fetch"
      );
      if (!resp.ok) throw new Error(await resp.text());
      return (await resp.json()) as FxResponse;
    },
    [getAccessToken]
  );

  const refresh = useCallback(async () => {
    if (!ready || !authenticated || !walletAddress) return;
    setLoading(true);
    setErr(null);
    try {
      const bal = await fetchUsdc(walletAddress);
      if (displayCurrency === "USD") {
        setUsdcBalance(bal);
        setFxRate(1);
      } else {
        const fx = await convertFx(bal, displayCurrency);
        setUsdcBalance(bal);
        setFxRate(fx.rate);
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [
    ready,
    authenticated,
    walletAddress,
    displayCurrency,
    fetchUsdc,
    convertFx,
  ]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const fiatValue = useMemo(() => usdcBalance * fxRate, [usdcBalance, fxRate]);

  const copyAccountNumber = useCallback(async () => {
    if (!walletAddress) return;
    try {
      await navigator.clipboard.writeText(walletAddress);
    } catch {}
  }, [walletAddress]);

  const onOpenSavings = useCallback(async () => {
    setOpening(true);
    setErr(null);
    try {
      const accessToken = await getAccessToken();
      if (!accessToken) throw new Error("Missing Privy access token");
      const r = await fetch("/api/user/savings/open", {
        method: "POST",
        credentials: "include",
        headers: {
          "content-type": "application/json",
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
        body: JSON.stringify({ agree }),
      });
      if (!r.ok) throw new Error((await r.text()) || "Failed to open savings");
      // Pull latest user (so the card appears)
      await refreshUser?.();
      setOpen(false);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setOpening(false);
    }
  }, [agree, getAccessToken, refreshUser]);

  /* ------------------------ No wallet: open flow ------------------------ */
  if (!walletAddress) {
    return (
      <section className="rounded-2xl border border-white/10 bg-white/5 p-6 text-white">
        <header className="flex items-center justify-between mb-2">
          <h3 className="text-lg font-semibold">Savings</h3>
          <span className="text-xs text-white/60">Earn 4.25% APY</span>
        </header>

        <p className="text-sm text-white/70">
          Open a dedicated savings account to grow your balance separately from
          your deposits.
        </p>

        {err && (
          <div className="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-red-300 text-sm">
            {err}
          </div>
        )}

        <div className="mt-4 flex gap-2">
          <button
            onClick={() => setOpen(true)}
            className="rounded-xl border border-[rgb(182,255,62)]/30 bg-[rgb(182,255,62)]/15 px-4 py-2 text-sm text-[rgb(182,255,62)] hover:bg-[rgb(182,255,62)]/25 transition"
          >
            Open savings
          </button>
        </div>

        {/* Modal */}
        {open && (
          <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 backdrop-blur">
            <div className="w-full max-w-md rounded-2xl border border-white/10 bg-zinc-900 p-6 shadow-2xl">
              <h4 className="text-xl font-semibold">Open a Savings Account</h4>
              <p className="mt-2 text-sm text-zinc-300">
                We’ll create a dedicated on-chain wallet for your savings. You
                can deposit, withdraw, and move funds between accounts anytime.
              </p>

              <label className="mt-4 flex items-center gap-2 text-sm text-zinc-300">
                <input
                  type="checkbox"
                  checked={agree}
                  onChange={(e) => setAgree(e.target.checked)}
                />
                <span>
                  I agree to the Savings Terms and understand a new wallet will
                  be created for me.
                </span>
              </label>

              {err && (
                <div className="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-red-300 text-sm">
                  {err}
                </div>
              )}

              <div className="mt-5 flex items-center justify-end gap-2">
                <button
                  onClick={() => setOpen(false)}
                  className="rounded-xl border border-white/15 bg-white/10 px-4 py-2 text-sm hover:bg-white/15"
                >
                  Cancel
                </button>
                <button
                  onClick={onOpenSavings}
                  disabled={!agree || opening}
                  className="rounded-xl border border-[rgb(182,255,62)]/30 bg-[rgb(182,255,62)]/15 px-4 py-2 text-sm text-[rgb(182,255,62)] hover:bg-[rgb(182,255,62)]/25 disabled:opacity-60"
                >
                  {opening ? "Creating…" : "Open savings"}
                </button>
              </div>
            </div>
          </div>
        )}
      </section>
    );
  }

  /* ---------------------- Has wallet: match deposit card ---------------------- */
  return (
    <section className="rounded-2xl border border-white/10 bg-black/20 backdrop-blur-xl p-6 text-white shadow-2xl hover:border-[rgb(182,255,62)]/30 transition-all duration-300">
      {/* top row: title + refresh */}
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-3 h-3 rounded-full bg-[rgb(182,255,62)]" />
          <h3 className="text-lg font-semibold text-white">Savings</h3>
        </div>
        <button
          onClick={() => void refresh()}
          disabled={loading}
          className="rounded-full border border-[rgb(182,255,62)]/20 bg-[rgb(182,255,62)]/10 px-3 py-1.5 text-xs text-[rgb(182,255,62)] hover:bg-[rgb(182,255,62)]/20 disabled:opacity-60 transition-all duration-200 font-medium"
        >
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {/* main row: balance + masked addr (same feel as DepositAccount) */}
      <div className="flex items-center justify-between">
        <div>
          <div className="text-3xl font-bold text-white mb-1">
            {loading ? "—" : formatFiat(fiatValue, displayCurrency)}
          </div>
          <div className="text-sm text-[rgb(182,255,62)] font-medium">
            Earning 4.25% APY
          </div>
          <div className="mt-1 text-xs text-zinc-400">
            
          </div>
          {err && (
            <div className="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-red-300 text-xs">
              {err}
            </div>
          )}
        </div>

        <button
          onClick={copyAccountNumber}
          className="text-sm text-zinc-400 hover:text-[rgb(182,255,62)] transition-colors font-mono group cursor-pointer text-right"
          title={walletAddress}
        >
          <span className="group-hover:text-[rgb(182,255,62)]">
            {mask(walletAddress)}
          </span>
          <div className="text-xs opacity-0 group-hover:opacity-100 transition-opacity mt-1">
            (Click to copy)
          </div>
        </button>
      </div>
    </section>
  );
}
