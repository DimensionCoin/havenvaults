import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { connect } from "@/lib/db";
import User from "@/models/User";
import EmailClaim from "@/models/EmailClaim";
import { verifySession } from "@/lib/auth";
import { verifyClaimToken } from "@/lib/claim-token";
import { getCaip2 } from "@/lib/solana";
import { getPrivy } from "@/lib/privyServer";

import {
  Connection,
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
  TransactionInstruction,
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

// Escrow (Privy app wallet acting as escrow)
const ESCROW_WALLET_ID = process.env.HAVEN_FEEPAYER_WALLET_ID!; // Privy walletId
const ESCROW_PUBKEY = new PublicKey(
  (process.env.NEXT_PUBLIC_HAVEN_ESCROW_OWNER ??
    process.env.NEXT_PUBLIC_HAVEN_FEEPAYER_ADDRESS)!
);

const DECIMALS = 6;
// Keep batches modest to avoid tx size limits; tune if needed
const MAX_PER_TX = 8;

/* -------------------------------- schema -------------------------------- */

const BodySchema = z.object({ token: z.string().min(10) });

/* ------------------------------- helpers -------------------------------- */

function jerr(status: number, error: string, extra?: unknown) {
  return NextResponse.json(extra ? { error, extra } : { error }, { status });
}

function requireSession(req: NextRequest) {
  const cookie = req.cookies.get("__session")?.value;
  const claims = cookie ? verifySession(cookie) : null;
  if (!claims) {
    throw new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  }
  return claims; // { privyId, userId, email }
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

    const raw = await req.json().catch(() => ({}));
    const parsed = BodySchema.safeParse(raw);
    if (!parsed.success) return jerr(400, "Invalid body");

    // Validate token (but we’ll use it only to derive the intended recipient)
    const payload = verifyClaimToken(parsed.data.token);
    if (!payload?.recipientEmail || !payload?.expiresAt) {
      return jerr(401, "Invalid or expired token");
    }

    await connect();

    // Expired token? (We still won’t proceed if token is expired)
    if (Date.now() > new Date(payload.expiresAt).getTime()) {
      // Best-effort mark the exact token’s claim expired if it exists & pending
      if (payload.claimId) {
        const maybe = await EmailClaim.findOne({ tokenId: payload.claimId });
        if (maybe && maybe.status === "pending") {
          maybe.status = "expired";
          await maybe.save();
        }
      }
      return jerr(410, "This claim link has expired");
    }

    // Email must match token’s intended recipient
    const tokenEmail = payload.recipientEmail.toLowerCase();
    if ((session.email || "").toLowerCase() !== tokenEmail) {
      return jerr(403, "Email mismatch. Sign in with the invited email.");
    }

    // Ensure recipient user + deposit wallet
    const user = await User.findById(session.userId);
    if (!user) return jerr(404, "User record not found");

    const onboarded = user.status === "active" && user.kycStatus === "approved";
    const redirect = onboarded ? "/dashboard" : "/onboarding";

    if (!user.depositWallet?.address) {
      return jerr(409, "No deposit wallet on file. Please finish onboarding.");
    }
    const recipientOwner = new PublicKey(user.depositWallet.address);

    // ---- Gather ALL pending, non-expired claims for this email ----
    const now = new Date();
    const pending = await EmailClaim.find({
      recipientEmail: tokenEmail,
      status: "pending",
      tokenExpiresAt: { $gt: now },
    }).sort({ createdAt: 1 });

    if (pending.length === 0) {
      // Nothing to do – but we still give the client a redirect hint
      return NextResponse.json({
        ok: true,
        claimedCount: 0,
        signatures: [],
        redirect,
      });
    }

    // ---- Prepare Solana transfer(s) in batches ----
    const conn = new Connection(SOLANA_RPC, "confirmed");
    const tokenProgramId = await detectTokenProgramId(conn, USDC_MINT);

    const escrowAta = getAssociatedTokenAddressSync(
      USDC_MINT,
      ESCROW_PUBKEY,
      false,
      tokenProgramId
    );
    const recipientAta = getAssociatedTokenAddressSync(
      USDC_MINT,
      recipientOwner,
      false,
      tokenProgramId
    );

    // Ensure ATAs on the first tx only (idempotent)
    const ensureEscrowAtaIx = createAssociatedTokenAccountIdempotentInstruction(
      ESCROW_PUBKEY,
      escrowAta,
      ESCROW_PUBKEY,
      USDC_MINT,
      tokenProgramId
    );
    const ensureRecipientAtaIx =
      createAssociatedTokenAccountIdempotentInstruction(
        ESCROW_PUBKEY,
        recipientAta,
        recipientOwner,
        USDC_MINT,
        tokenProgramId
      );

    // Chunk claims
    const chunks: (typeof pending)[] = [];
    for (let i = 0; i < pending.length; i += MAX_PER_TX) {
      chunks.push(pending.slice(i, i + MAX_PER_TX));
    }

    const privy = getPrivy();
    const caip2 = getCaip2();
    const signatures: string[] = [];

    for (let idx = 0; idx < chunks.length; idx++) {
      const group = chunks[idx];

      const transferIxs: TransactionInstruction[] = group.map((cl) =>
        createTransferCheckedInstruction(
          escrowAta, // source (escrow ATA)
          USDC_MINT,
          recipientAta, // dest (recipient ATA)
          ESCROW_PUBKEY, // authority
          Number(cl.amountUnits),
          DECIMALS,
          [],
          tokenProgramId
        )
      );

      const instructions: TransactionInstruction[] =
        idx === 0
          ? [
              ensureEscrowAtaIx as TransactionInstruction,
              ensureRecipientAtaIx as TransactionInstruction,
              ...transferIxs,
            ]
          : transferIxs;

      const { blockhash } = await conn.getLatestBlockhash("finalized");
      const msg = new TransactionMessage({
        payerKey: ESCROW_PUBKEY,
        recentBlockhash: blockhash,
        instructions,
      }).compileToV0Message();
      const tx = new VersionedTransaction(msg);

      const { hash } = await privy.walletApi.solana.signAndSendTransaction({
        walletId: ESCROW_WALLET_ID,
        caip2,
        transaction: tx,
      });

      signatures.push(hash);

      // Mark this batch claimed (idempotent: only mutate status:pending)
      const ids = group.map((g) => g._id);
      await EmailClaim.updateMany(
        { _id: { $in: ids }, status: "pending" },
        {
          $set: {
            status: "claimed",
            claimedByUserId: user._id,
            claimSignature: hash,
            claimedAt: new Date(),
          },
        }
      );
    }

    return NextResponse.json({
      ok: true,
      claimedCount: pending.length,
      signatures,
      redirect,
    });
  } catch (e) {
    if (e instanceof Response) throw e;
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
