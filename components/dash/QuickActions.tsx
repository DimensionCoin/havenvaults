// app/components/dash/QuickActions.tsx
"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Download, Upload, ArrowRightLeft, MoveRight, X } from "lucide-react";
import Buy from "@/components/actions/Buy";
import Deposit from "@/components/actions/Deposit";
import UserTransfer from "@/components/actions/UserTransfer";
import Sell from "@/components/actions/Sell";
import Withdraw from "@/components/actions/Withdraw";
import CancelTransfer from "@/components/actions/CancelTransfer"; // ⬅️ NEW
import { PublicKey } from "@solana/web3.js";
import Move from "../actions/Move";

/* -------------------------------- Types ---------------------------------- */

type AccountKind = "deposit" | "savings";

type MoveConfig = {
  depositOwner: string;
  savingsOwner: string;
  defaultFrom?: AccountKind;
  onSuccess?: (signature: string) => void;
};

type WithdrawConfig = {
  /** ONLY chequing is allowed for withdraws */
  depositOwner: string;
  onSuccess?: (signature: string) => void;
};

type TransferConfig = {
  /** Sender's chequing/deposit owner (base58). If omitted, UserTransfer uses context. */
  depositOwner?: string;
  onSuccess?: (signature: string) => void;
};

type QuickActionsProps = {
  disabled?: boolean;

  onDeposit?: () => void;
  onWithdraw?: () => void;
  onTransfer?: () => void;
  onMove?: () => void;

  move?: MoveConfig;
  withdraw?: WithdrawConfig;
  transfer?: TransferConfig;

  onMoveOpen?: () => void;
  onWithdrawOpen?: () => void;
  onTransferOpen?: () => void;
};

type ActiveModal = null | "deposit" | "withdraw" | "move" | "transfer";

/* ------------------------------ Component -------------------------------- */

export default function QuickActions({
  disabled,
  onDeposit,
  onWithdraw,
  onTransfer,
  onMove,
  move,
  withdraw,
  transfer,
  onMoveOpen,
  onWithdrawOpen,
  onTransferOpen,
}: QuickActionsProps) {
  const [activeModal, setActiveModal] = useState<ActiveModal>(null);
  const modalOpen = activeModal !== null;

  const openDepositModal = useCallback(() => {
    if (disabled) return;
    onDeposit?.();
    setActiveModal("deposit");
  }, [disabled, onDeposit]);

  const openWithdrawModal = useCallback(() => {
    if (disabled) return;
    onWithdraw?.();
    onWithdrawOpen?.();
    setActiveModal("withdraw");
  }, [disabled, onWithdraw, onWithdrawOpen]);

  const openMoveModal = useCallback(() => {
    if (disabled) return;
    onMove?.();
    onMoveOpen?.();
    setActiveModal("move");
  }, [disabled, onMove, onMoveOpen]);

  const openTransferModal = useCallback(() => {
    if (disabled) return;
    onTransfer?.();
    onTransferOpen?.();
    setActiveModal("transfer");
  }, [disabled, onTransfer, onTransferOpen]);

  // ESC to close + body scroll lock while any modal is open
  useEffect(() => {
    if (!modalOpen) return;
    const onKey = (e: KeyboardEvent) =>
      e.key === "Escape" && setActiveModal(null);
    window.addEventListener("keydown", onKey);

    const html = document.documentElement;
    const body = document.body;
    const prevHtml = html.style.overflow;
    const prevBody = body.style.overflow;
    html.style.overflow = "hidden";
    body.style.overflow = "hidden";

    return () => {
      window.removeEventListener("keydown", onKey);
      html.style.overflow = prevHtml;
      body.style.overflow = prevBody;
    };
  }, [modalOpen]);

  return (
    <section className="rounded-2xl border border-white/10 bg-black/20 p-4 md:p-5 backdrop-blur">
      <h3 className="mb-4 text-xs font-semibold uppercase tracking-wide text-white/80">
        Quick actions
      </h3>

      <div className="grid grid-cols-4 gap-1 md:grid-cols-4 text-xs">
        <ActionButton
          label="Deposit"
          icon={<Download size={12} aria-hidden />}
          onClick={openDepositModal}
          disabled={disabled}
        />
        <ActionButton
          label="Withdraw"
          icon={<Upload size={12} aria-hidden />}
          onClick={openWithdrawModal}
          disabled={disabled}
        />
        <ActionButton
          label="Transfer"
          icon={<ArrowRightLeft size={12} aria-hidden />}
          onClick={openTransferModal}
          disabled={disabled}
        />
        <ActionButton
          label="Move"
          icon={<MoveRight size={12} aria-hidden />}
          onClick={openMoveModal}
          disabled={disabled}
        />
      </div>

      {activeModal === "deposit" && (
        <DepositModal onClose={() => setActiveModal(null)} />
      )}

      {activeModal === "withdraw" && (
        <WithdrawModal
          withdraw={withdraw}
          onClose={() => setActiveModal(null)}
        />
      )}

      {activeModal === "move" && (
        <MoveModal move={move} onClose={() => setActiveModal(null)} />
      )}

      {activeModal === "transfer" && (
        <TransferModal
          transfer={transfer}
          onClose={() => setActiveModal(null)}
        />
      )}
    </section>
  );
}

/* ------------------------------ UI bits ---------------------------------- */

function ActionButton({
  label,
  icon,
  onClick,
  disabled,
}: {
  label: string;
  icon: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className="group flex items-center justify-center gap-2 border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/85 transition-all hover:border-[rgb(182,255,62)]/30 hover:bg-[rgb(182,255,62)]/10 disabled:opacity-50 rounded-full hover:shadow-xs shadow-[rgb(182,255,62)]"
    >
      <span className="flex h-4 w-4 items-center justify-center rounded-full bg-black/30">
        {icon}
      </span>
      <span className="text-xs md:text-md lg:text-md">{label}</span>
    </button>
  );
}

/* ------------------------------ Deposit Modal ---------------------------- */

function DepositModal({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<"bank" | "crypto">("bank");
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[9999]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="deposit-modal-title"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-xl backdrop-saturate-150"
        onClick={onClose}
        aria-hidden
      />
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute inset-0 bg-[radial-gradient(40%_30%_at_10%_85%,rgba(182,255,62,0.10),transparent),radial-gradient(35%_25%_at_90%_10%,rgba(182,255,62,0.08),transparent)]" />
      </div>

      {/* Scrollable wrapper */}
      <div className="relative mx-auto flex min-h-screen items-center justify-center p-4 overflow-y-auto overscroll-contain">
        {/* Panel */}
        <div className="pointer-events-auto w-full max-w-3xl rounded-2xl border border-white/10 bg-zinc-900/95 shadow-2xl flex max-h-[90vh] flex-col overflow-hidden">
          <h2 id="deposit-modal-title" className="sr-only">
            Deposit funds
          </h2>

          {/* Header */}
          <div className="flex items-center justify-between border-b border-white/10 px-4 py-3 shrink-0">
            <div className="flex items-center gap-1">
              <Tab
                active={tab === "bank"}
                onClick={() => setTab("bank")}
                label="Bank deposit"
              />
              <Tab
                active={tab === "crypto"}
                onClick={() => setTab("crypto")}
                label="Crypto deposit"
              />
            </div>
            <button
              className="rounded-lg border border-white/10 bg-white/5 p-1.5 hover:bg-white/10 transition"
              onClick={onClose}
              aria-label="Close"
            >
              <X size={16} />
            </button>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto p-4 md:p-6">
            {tab === "bank" ? (
              <Buy />
            ) : (
              <div className="min-h-[320px]">
                <Deposit />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

/* ----------------------------- Withdraw Modal ---------------------------- */

function WithdrawModal({
  onClose,
  withdraw,
}: {
  onClose: () => void;
  withdraw?: WithdrawConfig;
}) {
  const [tab, setTab] = useState<"bank" | "crypto">("bank");
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Validate key if provided
  const valid = useMemo(() => {
    if (!withdraw?.depositOwner) return true;
    try {
      new PublicKey(withdraw.depositOwner);
      return true;
    } catch {
      return false;
    }
  }, [withdraw]);

  if (!mounted) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[9999]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="withdraw-modal-title"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-xl backdrop-saturate-150"
        onClick={onClose}
        aria-hidden
      />
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute inset-0 bg-[radial-gradient(40%_30%_at_10%_85%,rgba(182,255,62,0.10),transparent),radial-gradient(35%_25%_at_90%_10%,rgba(182,255,62,0.08),transparent)]" />
      </div>

      {/* Scrollable wrapper */}
      <div className="relative mx-auto flex min-h-screen items-center justify-center p-4 overflow-y-auto overscroll-contain">
        {/* Panel */}
        <div className="pointer-events-auto w-full max-w-3xl rounded-2xl border border-white/10 bg-zinc-900/95 shadow-2xl flex max-h-[90vh] flex-col overflow-hidden">
          <h2 id="withdraw-modal-title" className="sr-only">
            Withdraw funds
          </h2>

          {/* Header */}
          <div className="flex items-center justify-between border-b border-white/10 px-4 py-3 shrink-0">
            <div className="flex items-center gap-1">
              <Tab
                active={tab === "bank"}
                onClick={() => setTab("bank")}
                label="Bank withdraw"
              />
              <Tab
                active={tab === "crypto"}
                onClick={() => setTab("crypto")}
                label="Crypto withdraw"
              />
            </div>
            <button
              className="rounded-lg border border-white/10 bg-white/5 p-1.5 hover:bg-white/10 transition"
              onClick={onClose}
              aria-label="Close"
            >
              <X size={16} />
            </button>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto p-4 md:p-6">
            {tab === "bank" ? (
              <Sell />
            ) : !valid ? (
              <div className="text-xs text-red-400">
                Invalid chequing (deposit) owner public key.
              </div>
            ) : (
              <div className="min-h-[320px]">
                <Withdraw
                  depositOwner={withdraw?.depositOwner ?? ""}
                  onSuccess={withdraw?.onSuccess}
                />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

/* ---------------------------- Transfer Modal ----------------------------- */

function TransferModal({
  onClose,
  transfer,
}: {
  onClose: () => void;
  transfer?: TransferConfig;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  type TransferTab = "send" | "unclaimed";
  const [tab, setTab] = useState<TransferTab>("send");

  // If a depositOwner is provided, validate it; otherwise UserTransfer will use context.
  const keyValid = useMemo(() => {
    if (!transfer?.depositOwner) return true;
    try {
      new PublicKey(transfer.depositOwner);
      return true;
    } catch {
      return false;
    }
  }, [transfer]);

  if (!mounted) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[9999]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="transfer-modal-title"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-xl backdrop-saturate-150"
        onClick={onClose}
        aria-hidden
      />
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute inset-0 bg-[radial-gradient(40%_30%_at_10%_85%,rgba(182,255,62,0.10),transparent),radial-gradient(35%_25%_at_90%_10%,rgba(182,255,62,0.08),transparent)]" />
      </div>

      {/* Scrollable wrapper */}
      <div className="relative mx-auto flex min-h-screen items-center justify-center p-4 overflow-y-auto overscroll-contain">
        {/* Panel */}
        <div className="pointer-events-auto w-full max-w-3xl rounded-2xl border border-white/10 bg-zinc-900/95 shadow-2xl flex max-h-[90vh] flex-col overflow-hidden">
          <h2 id="transfer-modal-title" className="sr-only">
            Transfer
          </h2>

          {/* Header with tabs */}
          <div className="flex items-center justify-between border-b border-white/10 px-4 py-3 shrink-0">
            <div className="flex items-center gap-1">
              <Tab
                active={tab === "send"}
                onClick={() => setTab("send")}
                label="Send"
              />
              <Tab
                active={tab === "unclaimed"}
                onClick={() => setTab("unclaimed")}
                label="Unclaimed (sent)"
              />
            </div>
            <button
              className="rounded-lg border border-white/10 bg-white/5 p-1.5 hover:bg-white/10 transition"
              onClick={onClose}
              aria-label="Close"
            >
              <X size={16} />
            </button>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto p-4 md:p-6">
            {tab === "send" ? (
              !keyValid ? (
                <div className="text-xs text-red-400">
                  Invalid chequing (deposit) owner public key.
                </div>
              ) : (
                <div className="min-h-[320px]">
                  <UserTransfer
                    fromOwnerBase58={transfer?.depositOwner}
                    onSuccess={(sig) => {
                      transfer?.onSuccess?.(sig);
                      onClose(); // optional auto-close on success
                    }}
                  />
                </div>
              )
            ) : (
              <div className="min-h-[320px]">
                {/* Lists your pending invites (sent) + lets you cancel */}
                <CancelTransfer />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

/* ------------------------------- Move Modal ------------------------------ */

function MoveModal({
  move,
  onClose,
}: {
  move?: MoveConfig;
  onClose: () => void;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const valid = useMemo(() => {
    if (!move) return false;
    try {
      new PublicKey(move.depositOwner);
      new PublicKey(move.savingsOwner);
      return true;
    } catch {
      return false;
    }
  }, [move]);

  if (!mounted) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[9999]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="move-modal-title"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-xl backdrop-saturate-150"
        onClick={onClose}
        aria-hidden
      />
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute inset-0 bg-[radial-gradient(40%_30%_at_10%_85%,rgba(182,255,62,0.10),transparent),radial-gradient(35%_25%_at_90%_10%,rgba(182,255,62,0.08),transparent)]" />
      </div>

      {/* Scrollable wrapper */}
      <div className="relative mx-auto flex min-h-screen items-center justify-center p-4 overflow-y-auto overscroll-contain">
        {/* Panel */}
        <div className="pointer-events-auto w-full max-w-lg rounded-2xl border border-white/10 bg-zinc-900/95 shadow-2xl flex max-h-[90vh] flex-col overflow-hidden">
          <h2 id="move-modal-title" className="sr-only">
            Move funds
          </h2>

          {/* Header */}
          <div className="flex items-center justify-between border-b border-white/10 px-4 py-3 shrink-0">
            <div className="text-sm font-semibold text-white/90">
              Move funds
            </div>
            <button
              className="rounded-lg border border-white/10 bg-white/5 p-1.5 hover:bg-white/10 transition"
              onClick={onClose}
              aria-label="Close"
            >
              <X size={16} />
            </button>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto p-4 md:p-6">
            {!move ? (
              <div className="text-xs text-yellow-300">
                Move is not configured. Pass the <code>move</code> prop to
                QuickActions with <code>depositOwner</code> and{" "}
                <code>savingsOwner</code>.
              </div>
            ) : !valid ? (
              <div className="text-xs text-red-400">
                Invalid owner public key(s) provided.
              </div>
            ) : (
              <Move
                depositOwner={move.depositOwner}
                savingsOwner={move.savingsOwner}
                defaultFrom={move.defaultFrom}
                onSuccess={move.onSuccess}
              />
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

/* --------------------------------- Tab ----------------------------------- */

function Tab({
  label,
  active,
  onClick,
  badge,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  badge?: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-medium transition border ${
        active
          ? "border-[rgb(182,255,62)]/30 bg-[rgb(182,255,62)]/15 text-[rgb(182,255,62)]"
          : "border-white/10 bg-white/5 text-white/70 hover:bg-white/10"
      }`}
    >
      {label}
      {badge}
    </button>
  );
}
