// components/dash/ClaimBanner.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "react-hot-toast";
import { useUser } from "@/providers/UserProvider";

type PendingClaim = {
  id: string;
  amountUnits: number; // USDC in 6dp
  currency?: string; // "USDC"
  createdAt?: string; // ISO
  tokenExpiresAt?: string; // ISO
  from?: { name?: string; email?: string; owner?: string };
};

const DECIMALS = 6;

function fmtUsdc(units?: number) {
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

function shorten(s?: string, head = 4, tail = 4) {
  if (!s) return "";
  if (s.length <= head + tail + 1) return s;
  return `${s.slice(0, head)}…${s.slice(-tail)}`;
}

export default function ClaimBanner() {
  const { user, refresh } = useUser();

  // Items from provider
  const providerItems: PendingClaim[] = useMemo(
    () => (user?.pendingEmailClaims as unknown as PendingClaim[]) || [],
    [user?.pendingEmailClaims]
  );

  // Optional enrichment via list API (to fetch sender email/name)
  const [enrichedItems, setEnrichedItems] = useState<PendingClaim[] | null>(
    null
  );
  const token = (
    user as unknown as { pendingEmailClaimsToken?: string }
  )?.pendingEmailClaimsToken as string | undefined;

  useEffect(() => {
    let cancelled = false;
    const needsEnrich =
      !providerItems.length || providerItems.some((i) => !i?.from?.email);

    if (!token || !needsEnrich) {
      setEnrichedItems(null);
      return;
    }

    (async () => {
      try {
        const r = await fetch("/api/transfers/email/pending/list", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ token }),
        });
        const j = await r.json();
        if (!cancelled && r.ok && j?.ok && Array.isArray(j.items)) {
          setEnrichedItems(j.items);
        }
      } catch {
        // ignore; fall back to providerItems
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [token, providerItems]);

  // Final items to show
  const items = enrichedItems ?? providerItems;

  // Show banner only if there are claims
  const hasClaims =
    ((user as unknown as { hasPendingEmailClaims?: boolean })
      ?.hasPendingEmailClaims === true)
      ? true
      : Array.isArray(items) && items.length > 0;

  const [expanded, setExpanded] = useState(false);
  const [busyAll, setBusyAll] = useState(false);

  if (!hasClaims) return null;

  const totalUnits = items.reduce((acc, c) => acc + (c.amountUnits || 0), 0);
  const totalFmt = fmtUsdc(totalUnits);

  const VISIBLE_COUNT = 3;
  const visible = expanded ? items : items.slice(0, VISIBLE_COUNT);
  const showMore = items.length > VISIBLE_COUNT;

  const claimAll = async () => {
    const toastId = toast.loading("Claiming transfers…");
    setBusyAll(true);
    try {
      // No body => server will claim *all* pending claims for this user
      const r = await fetch("/api/transfers/user/claim", {
        method: "POST",
        credentials: "include",
      });
      const j = await r.json();
      if (!r.ok || !j?.ok) throw new Error(j?.error || `HTTP ${r.status}`);

      toast.success(
        j.claimedCount
          ? `Claimed ${j.claimedCount} transfer${j.claimedCount > 1 ? "s" : ""}`
          : "Nothing to claim",
        { id: toastId }
      );

      await refresh(); // Banner will disappear if none remain
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Claim failed", {
        id: toastId,
      });
    } finally {
      setBusyAll(false);
    }
  };

  return (
    <section className="mb-6 rounded-2xl border border-white/10 bg-gradient-to-br from-[#b6ff3e1a] to-transparent backdrop-blur-sm shadow-[0_10px_30px_-12px_rgba(182,255,62,0.25)]">
      <div className="flex flex-col gap-4 p-5 md:p-6">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <div className="flex items-start md:items-center gap-3">
            <div className="h-10 w-10 flex items-center justify-center rounded-xl bg-[rgb(182,255,62)]/20 text-[rgb(182,255,62)]">
              ✉️
            </div>
            <div>
              <h3 className="text-lg font-semibold text-foreground">
                You have {items.length} unclaimed transfer
                {items.length > 1 ? "s" : ""}
              </h3>
              <p className="text-sm text-muted-foreground">
                Total available:{" "}
                <span className="font-medium text-foreground">
                  {totalFmt} USDC
                </span>
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {showMore && (
              <button
                onClick={() => setExpanded((s) => !s)}
                className="rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm text-foreground hover:bg-white/10 transition"
              >
                {expanded
                  ? "Show less"
                  : `Show ${items.length - VISIBLE_COUNT} more`}
              </button>
            )}
            <button
              onClick={claimAll}
              disabled={busyAll}
              className="rounded-xl bg-[rgb(182,255,62)] px-4 py-2 text-sm font-semibold text-black hover:bg-[rgb(182,255,62)]/90 disabled:opacity-50 disabled:cursor-not-allowed shadow-lg"
            >
              {busyAll ? "Claiming…" : "Claim all"}
            </button>
          </div>
        </div>

        {/* List (no per-item claim button) */}
        <ul className="divide-y divide-white/10 rounded-xl border border-white/10 bg-white/[0.02]">
          {visible.map((c) => {
            const date = c.createdAt ? new Date(c.createdAt) : undefined;
            const dateStr = date
              ? date.toLocaleString(undefined, {
                  month: "short",
                  day: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                })
              : "—";
            const sender =
              c.from?.email ||
              c.from?.name ||
              (c.from?.owner ? shorten(c.from.owner) : "Unknown sender");

            return (
              <li
                key={c.id}
                className="flex items-center justify-between gap-3 px-4 py-3"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-muted-foreground">From</span>
                    <span className="truncate text-sm font-medium text-foreground">
                      {sender}
                    </span>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Sent {dateStr}
                    {c.tokenExpiresAt
                      ? ` • Expires ${new Date(
                          c.tokenExpiresAt
                        ).toLocaleDateString()}`
                      : ""}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-sm font-semibold text-foreground">
                    {fmtUsdc(c.amountUnits)} USDC
                  </div>
                </div>
              </li>
            );
          })}
        </ul>

        <p className="text-[11px] text-muted-foreground/80">
          Claims are settled on Solana. Network fees are covered by Haven.
        </p>
      </div>
    </section>
  );
}
