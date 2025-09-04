// app/components/dash/DepositAccount.tsx
"use client";

import type React from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { useUser } from "@/providers/UserProvider";

import { Connection, PublicKey } from "@solana/web3.js";
import {
  getAssociatedTokenAddress,
  getAccount as getSplAccount,
} from "@solana/spl-token";

/** ---------- Solana + tokens ---------- */
const RPC_URL =
  process.env.NEXT_PUBLIC_SOLANA_RPC ?? "https://api.mainnet-beta.solana.com";

const USDC_MINT_STR =
  process.env.NEXT_PUBLIC_USDC_MINT ??
  "EPjFWdd5AuVNx6iGJ9g8s7f2GzAxQ8c3Gya4A1b1fS3"; // mainnet USDC

const USDC_MINT = new PublicKey(USDC_MINT_STR);
const USDC_DECIMALS = 6;

/** ---------- Types from /api/fx ---------- */
type FxResponse = {
  base: "USD";
  target: string;
  rate: number; // USD -> target
  amount: number; // USDC amount we asked to convert
  converted: number; // amount * rate
  asOf?: string | null;
};

/** ---------- Helpers ---------- */
function formatFiat(n: number, currency: string) {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(n);
  } catch {
    // in case currency isn't supported by the runtime
    return `${currency} ${n.toFixed(2)}`;
  }
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

function mask(addr?: string | null) {
  if (!addr || addr.length < 4) return "****-****-0000";
  return `****-****-${addr.slice(-4)}`;
}

/** ---------- Component ---------- */
const DepositAccount: React.FC = () => {
  const { user } = useUser();
  const { ready, authenticated, getAccessToken } = usePrivy();

  // Prefer nested shape, but also support a flat fallback (from /api/user/me)
  const walletAddress =
    user?.depositWallet?.address ??
    (user && typeof user === "object" && "walletAddress" in user &&
    typeof (user as Record<string, unknown>).walletAddress === "string"
      ? ((user as Record<string, unknown>).walletAddress as string)
      : null);
  const displayCurrency = (user?.displayCurrency || "USD").toUpperCase();

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [usdcBalance, setUsdcBalance] = useState(0);
  const [fxRate, setFxRate] = useState(1);

  const connection = useMemo(() => new Connection(RPC_URL, "confirmed"), []);

  /** Read the user's USDC token balance from their ATA */
  const fetchUsdc = useCallback(
    async (owner58: string) => {
      try {
        const owner = new PublicKey(owner58);
        const ata = await getAssociatedTokenAddress(USDC_MINT, owner, false);
        const acc = await getSplAccount(connection, ata, "confirmed");

        // spl-token returns BigInt in newer versions
        const amt = acc.amount as unknown;
        const raw =
          typeof amt === "bigint" ? Number(amt) : Number(amt as number | string);

        return raw / 10 ** USDC_DECIMALS;
      } catch {
        // no ATA / no balance yet
        return 0;
      }
    },
    [connection]
  );

  /** Call your /api/fx (pegged USD) to convert USDC -> local currency */
  const convertFx = useCallback(
    async (amount: number, currency: string): Promise<FxResponse> => {
      // The API expects ?amount=<number>&currency=<3-letter>
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
        8_000,
        "FX fetch"
      );

      if (!resp.ok) {
        throw new Error(await resp.text());
      }
      const data = (await resp.json()) as FxResponse;

      if (
        !data ||
        data.base !== "USD" ||
        typeof data.rate !== "number" ||
        data.rate <= 0
      ) {
        throw new Error("Bad FX payload");
      }
      return data;
    },
    [getAccessToken]
  );

  /** Load balance + FX (only when authenticated and we have an address) */
  const refresh = useCallback(async () => {
    if (!ready || !authenticated || !walletAddress) return;

    setLoading(true);
    setErr(null);
    try {
      const bal = await fetchUsdc(walletAddress);

      if (displayCurrency === "USD") {
        // USDC ~= USD
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
    } catch (e) {
      console.error("Clipboard failed", e);
    }
  }, [walletAddress]);

  return (
    <div className="space-y-6">
      {/* Header */}

      {err && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {err}
        </div>
      )}

      {/* Chequing card */}
      <div className="rounded-2xl border border-white/10 bg-black/20 backdrop-blur-xl p-6 text-white shadow-2xl hover:border-[rgb(182,255,62)]/30 transition-all duration-300">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3 mb-2 ">
            <div className="w-3 h-3 rounded-full bg-[rgb(182,255,62)]" />
            <h3 className="text-lg font-semibold text-white">Deposits</h3>
          </div>
          <div>
            <button
              onClick={() => void refresh()}
              disabled={loading || !walletAddress}
              className=" border border-[rgb(182,255,62)]/20 bg-[rgb(182,255,62)]/10 px-3 py-1.5 text-xs text-[rgb(182,255,62)] hover:bg-[rgb(182,255,62)]/20 disabled:opacity-60 transition-all duration-200 font-medium rounded-full"
            >
              {loading ? "Refreshing…" : "Refresh"}
            </button>
          </div>
        </div>

        <div className="flex items-center justify-between mb-1">
          <div>
            <div className="text-3xl font-bold text-white mb-1">
              {loading ? "—" : formatFiat(fiatValue, displayCurrency)}
            </div>
            <div className="text-sm text-[rgb(182,255,62)] font-medium">
              Earning 2.5% APY
            </div>
            <div className="mt-1 text-xs text-zinc-400"></div>
          </div>

          <button
            onClick={copyAccountNumber}
            className="text-sm text-zinc-400 hover:text-[rgb(182,255,62)] transition-colors font-mono group cursor-pointer text-right"
            disabled={!walletAddress}
            title={walletAddress || undefined}
          >
            <span className="group-hover:text-[rgb(182,255,62)]">
              {mask(walletAddress)}
            </span>
            <div className="text-xs opacity-0 group-hover:opacity-100 transition-opacity mt-1">
              (Click to copy)
            </div>
          </button>
        </div>
      </div>
    </div>
  );
};

export default DepositAccount;
