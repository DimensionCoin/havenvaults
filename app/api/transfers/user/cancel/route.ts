// app/api/transfers/user/cancel/route.ts
import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { connect } from "@/lib/db";
import EmailClaim from "@/models/EmailClaim";
import User from "@/models/User";
import { verifySession } from "@/lib/auth";
import { getCaip2 } from "@/lib/solana";
import { getPrivy } from "@/lib/privyServer";

import {
  Connection,
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";

import {
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
} from "@solana/spl-token";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* ------------------------------ env / const ------------------------------ */

const SOLANA_RPC = process.env.NEXT_PUBLIC_SOLANA_RPC!;
const USDC_MINT = new PublicKey(process.env.NEXT_PUBLIC_USDC_MINT!);

// Escrow (Privy app wallet acting as escrow/authority)
const ESCROW_WALLET_ID = process.env.HAVEN_FEEPAYER_WALLET_ID!; // Privy walletId
const ESCROW_PUBKEY = new PublicKey(
  (process.env.NEXT_PUBLIC_HAVEN_ESCROW_OWNER ??
    process.env.NEXT_PUBLIC_HAVEN_FEEPAYER_ADDRESS)!
);

const DECIMALS = 6;
const MAX_PER_TX = 8; // keep batch modest to avoid tx size limits

/* -------------------------------- schema -------------------------------- */

const BodySchema = z.object({
  // Optional list; if omitted, cancel ALL pending claims sent by this user
  claimIds: z.array(z.string().min(8)).optional(),
});

/* ------------------------------- helpers -------------------------------- */

function jerr(status: number, error: string, extra?: unknown) {
  return NextResponse.json(extra ? { error, extra } : { error }, { status });
}

function requireSession(req: NextRequest) {
  const cookie = req.cookies.get("__session")?.value;
  const claims = cookie ? verifySession(cookie) : null;
  if (!claims || !claims.userId || !claims.privyId) {
    throw new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  }
  return claims as { userId: string; privyId: string; email?: string };
}

async function detectTokenProgramId(conn: Connection, mint: PublicKey) {
  const info = await conn.getAccountInfo(mint);
  if (!info) throw new Error("Mint not found on chain");
  return info.owner.equals(TOKEN_2022_PROGRAM_ID)
    ? TOKEN_2022_PROGRAM_ID
    : TOKEN_PROGRAM_ID;
}

/* ---------------------------------- POST -------------------------------- */

export async function POST(req: NextRequest) {
  try {
    const session = requireSession(req);
    await connect();

    // Ensure the user exists (mostly for sanity/logical authorization)
    const user = await User.findById(session.userId).lean();
    if (!user) return jerr(404, "User record not found");

    const raw = await req.json().catch(() => ({}));
    const parsed = BodySchema.safeParse(raw);
    if (!parsed.success) return jerr(400, "Invalid body");

    // Build query: only this user's pending claims
    const baseQuery: Record<string, unknown> = {
      senderUserId: user._id,
      status: "pending",
    };

    if (parsed.data.claimIds?.length) {
      baseQuery._id = { $in: parsed.data.claimIds };
    }

    // Load pending claims (no expiry check; still "pending" = cancellable)
    const pending = await EmailClaim.find(baseQuery)
      .sort({ createdAt: 1 })
      .lean();

    if (pending.length === 0) {
      return NextResponse.json({
        ok: true,
        canceledCount: 0,
        signatures: [],
      });
    }

    // Prepare Solana
    const conn = new Connection(SOLANA_RPC, "confirmed");
    const tokenProgramId = await detectTokenProgramId(conn, USDC_MINT);

    // Shared escrow ATA
    const escrowAta = getAssociatedTokenAddressSync(
      USDC_MINT,
      ESCROW_PUBKEY,
      false,
      tokenProgramId
    );

    const ensureEscrowAtaIx = createAssociatedTokenAccountIdempotentInstruction(
      ESCROW_PUBKEY, // payer
      escrowAta,
      ESCROW_PUBKEY, // owner of ATA
      USDC_MINT,
      tokenProgramId
    );

    // Chunk into manageable txs
    const chunks: (typeof pending)[] = [];
    for (let i = 0; i < pending.length; i += MAX_PER_TX) {
      chunks.push(pending.slice(i, i + MAX_PER_TX));
    }

    const privy = getPrivy();
    const caip2 = getCaip2();
    const signatures: string[] = [];

    for (const group of chunks) {
      const instructions: TransactionInstruction[] = [];

      // Ensure escrow ATA once (front of tx)
      instructions.push(ensureEscrowAtaIx as TransactionInstruction);

      // For each unique sender owner in this group, ensure destination ATA
      const uniqueOwners = new Set<string>();
      for (const cl of group) {
        const ownerStr = String(cl.senderFromOwner);
        if (!uniqueOwners.has(ownerStr)) {
          uniqueOwners.add(ownerStr);

          const ownerPk = new PublicKey(ownerStr);
          const ownerAta = getAssociatedTokenAddressSync(
            USDC_MINT,
            ownerPk,
            false,
            tokenProgramId
          );

          const ensureOwnerAta =
            createAssociatedTokenAccountIdempotentInstruction(
              ESCROW_PUBKEY, // payer
              ownerAta,
              ownerPk, // owner of ATA (sender)
              USDC_MINT,
              tokenProgramId
            );
          instructions.push(ensureOwnerAta as TransactionInstruction);
        }
      }

      // Add the refund transfers (escrow → original sender)
      for (const cl of group) {
        const ownerPk = new PublicKey(String(cl.senderFromOwner));
        const ownerAta = getAssociatedTokenAddressSync(
          USDC_MINT,
          ownerPk,
          false,
          tokenProgramId
        );
        const amountUnits = Number(cl.amountUnits || 0);

        if (!(amountUnits > 0)) continue;

        const ix = createTransferCheckedInstruction(
          escrowAta, // source
          USDC_MINT,
          ownerAta, // destination (sender)
          ESCROW_PUBKEY, // authority
          amountUnits,
          DECIMALS,
          [],
          tokenProgramId
        );
        instructions.push(ix);
      }

      // If this group has no value to return (shouldn't happen), skip
      if (instructions.length <= 1) {
        continue;
      }

      const { blockhash } = await conn.getLatestBlockhash("finalized");
      const msg = new TransactionMessage({
        payerKey: ESCROW_PUBKEY,
        recentBlockhash: blockhash,
        instructions,
      }).compileToV0Message();

      const tx = new VersionedTransaction(msg);

      // Sign & send via Privy app wallet (escrow)
      const { hash } = await privy.walletApi.solana.signAndSendTransaction({
        walletId: ESCROW_WALLET_ID,
        caip2,
        transaction: tx,
      });

      signatures.push(hash);

      // Mark this batch as canceled (idempotent: only if still pending)
      const ids = group.map((g) => g._id);
      await EmailClaim.updateMany(
        { _id: { $in: ids }, status: "pending" },
        { $set: { status: "canceled" } }
      );
    }

    return NextResponse.json({
      ok: true,
      canceledCount: pending.length,
      signatures,
    });
  } catch (e) {
    if (e instanceof Response) throw e;
    const msg = e instanceof Error ? e.message : String(e);
    console.error("POST /api/transfers/user/cancel error:", e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
