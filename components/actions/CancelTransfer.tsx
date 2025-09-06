// components/actions/CancelTransfer.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "react-hot-toast";

/**
 * Expected GET /api/transfers/user/sent/list response:
 * {
 *   ok: true,
 *   items: Array<{
 *     id: string;
 *     recipientEmail: string;
 *     amountUnits: number;         // USDC in 6dp
 *     currency?: string;           // "USDC"
 *     createdAt?: string;          // ISO
 *     tokenExpiresAt?: string;     // ISO
 *     escrowSignature?: string;    // optional
 *   }>
 * }
 */

type SentPending = {
  id: string;
  recipientEmail: string;
  amountUnits: number;
  currency?: string;
  createdAt?: string;
  tokenExpiresAt?: string;
  escrowSignature?: string;
};

const DECIMALS = 6;

function fmtUsdcUnits(units?: number) {
  const ui = typeof units === "number" ? units / 10 ** DECIMALS : 0;
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 2,
    }).format(ui);
  } catch {
    return `$${ui.toFixed(2)}`;
  }
}

export default function CancelTransfer({
  className,
  onChanged,
}: {
  className?: string;
  /** optional: called after any successful cancel to let parent refresh other views */
  onChanged?: () => void;
}) {
  const [items, setItems] = useState<SentPending[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [busyAll, setBusyAll] = useState(false);
  const [busyOne, setBusyOne] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch("/api/transfers/user/sent/list", {
        method: "GET",
        credentials: "include",
        cache: "no-store",
        headers: { accept: "application/json" },
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.ok || !Array.isArray(j.items)) {
        throw new Error(j?.error || `HTTP ${r.status}`);
      }
      setItems(j.items as SentPending[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load transfers");
      setItems([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const totalUnits = useMemo(
    () =>
      Array.isArray(items)
        ? items.reduce((a, c) => a + (c.amountUnits || 0), 0)
        : 0,
    [items]
  );

  const hasItems = Array.isArray(items) && items.length > 0;

  const cancelAll = async () => {
    if (!hasItems) return;
    const toastId = toast.loading("Canceling transfers…");
    setBusyAll(true);
    try {
      // Send explicit list for safety/traceability (API can also accept no body to cancel all)
      const claimIds = items!.map((i) => i.id);
      const r = await fetch("/api/transfers/user/cancel", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ claimIds }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.ok) throw new Error(j?.error || `HTTP ${r.status}`);

      toast.success(
        `Canceled ${j.canceledCount ?? claimIds.length} transfer${
          (j.canceledCount ?? claimIds.length) === 1 ? "" : "s"
        }`,
        { id: toastId }
      );
      await load();
      onChanged?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Cancel failed", {
        id: toastId,
      });
    } finally {
      setBusyAll(false);
    }
  };

  const cancelOne = async (id: string) => {
    const toastId = toast.loading("Canceling transfer…");
    setBusyOne(id);
    try {
      const r = await fetch("/api/transfers/user/cancel", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ claimIds: [id] }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.ok) throw new Error(j?.error || `HTTP ${r.status}`);

      toast.success("Transfer canceled", { id: toastId });
      await load();
      onChanged?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Cancel failed", {
        id: toastId,
      });
    } finally {
      setBusyOne(null);
    }
  };

  if (loading) {
    return (
      <section
        className={`rounded-2xl border border-white/10 bg-white/[0.03] p-5 ${
          className ?? ""
        }`}
      >
        <div className="h-5 w-44 bg-white/10 rounded mb-4 animate-pulse" />
        <div className="h-24 w-full bg-white/5 rounded animate-pulse" />
      </section>
    );
  }

  if (error) {
    return (
      <section
        className={`rounded-2xl border border-red-500/30 bg-red-900/20 p-5 text-red-300 ${
          className ?? ""
        }`}
      >
        <div className="font-medium mb-2">
          Couldn’t load your pending transfers
        </div>
        <div className="text-sm">{error}</div>
        <button
          onClick={load}
          className="mt-3 rounded-md border border-white/20 px-3 py-1 text-sm hover:bg-white/10"
        >
          Retry
        </button>
      </section>
    );
  }

  if (!hasItems) {
    return null; // nothing to show if there are no pending sent transfers
  }

  return (
    <section
      className={`rounded-2xl border border-white/10 bg-white/[0.03] ${
        className ?? ""
      }`}
    >
      <div className="p-5 md:p-6 flex flex-col gap-4">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <div className="flex items-start md:items-center gap-3">
            <div className="h-10 w-10 flex items-center justify-center rounded-xl bg-yellow-400/20 text-yellow-300">
              ⏳
            </div>
            <div>
              <h3 className="text-lg font-semibold text-foreground">
                Pending invites you’ve sent
              </h3>
              <p className="text-sm text-muted-foreground">
                Total escrowed:{" "}
                <span className="font-medium text-foreground">
                  {fmtUsdcUnits(totalUnits)} USDC
                </span>
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={cancelAll}
              disabled={busyAll || !!busyOne}
              className="rounded-xl bg-red-500/90 px-4 py-2 text-sm font-semibold text-white hover:bg-red-500 disabled:opacity-50 disabled:cursor-not-allowed shadow-lg"
            >
              {busyAll ? "Canceling…" : "Cancel all"}
            </button>
          </div>
        </div>

        {/* List */}
        <ul className="divide-y divide-white/10 rounded-xl border border-white/10 bg-white/[0.02]">
          {items!.map((t) => {
            const date = t.createdAt ? new Date(t.createdAt) : undefined;
            const dateStr =
              date &&
              date.toLocaleString(undefined, {
                month: "short",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              });

            return (
              <li
                key={t.id}
                className="flex items-center justify-between gap-3 px-4 py-3"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-muted-foreground">To</span>
                    <span className="truncate text-sm font-medium text-foreground">
                      {t.recipientEmail || "Unknown"}
                    </span>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Sent {dateStr ?? "—"}
                    {t.tokenExpiresAt
                      ? ` • Expires ${new Date(
                          t.tokenExpiresAt
                        ).toLocaleDateString()}`
                      : ""}
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <div className="text-right">
                    <div className="text-sm font-semibold text-foreground">
                      {fmtUsdcUnits(t.amountUnits)} USDC
                    </div>
                  </div>
                  <button
                    onClick={() => cancelOne(t.id)}
                    disabled={busyAll || busyOne === t.id}
                    className="rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm text-foreground hover:bg-white/10 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {busyOne === t.id ? "Canceling…" : "Cancel"}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>

        <p className="text-[11px] text-muted-foreground/80">
          Canceling returns funds from escrow back to your wallet. All actions
          settle on Solana.
        </p>
      </div>
    </section>
  );
}
