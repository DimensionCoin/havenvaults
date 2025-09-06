// app/api/transfers/email/claim/route.ts
import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { randomUUID } from "crypto";

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
  if (!claims || !claims.userId || !claims.privyId) {
    throw new Response(
      JSON.stringify({ error: "Invalid session (missing userId or privyId)" }),
      {
        status: 401,
        headers: { "content-type": "application/json" },
      }
    );
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

// very tolerant extractor for embedded solana wallet from Privy user
function extractEmbeddedSolanaFromPrivyUser(
  u: unknown
): { walletId?: string; address?: string } | undefined {
  const obj = (u ?? {}) as Record<string, unknown>;
  const raw = obj["linkedAccounts"] as unknown;
  const list = Array.isArray(raw) ? (raw as unknown[]) : [];
  for (const acc of list) {
    if (!acc || typeof acc !== "object") continue;
    const a = acc as Record<string, unknown>;
    const type = (a["type"] ?? a["kind"]) as unknown;
    const chain = (a["chainType"] ?? a["chain"]) as unknown;
    const client =
      (a["walletClientType"] ?? a["clientType"] ?? a["connectorType"] ?? a["provider"]) as unknown;
    const isWallet = type === "wallet";
    const isSol = chain === "solana";
    const isEmbedded = client === "embedded" || client === "privy";
    if (isWallet && isSol && isEmbedded) {
      const walletIdUnknown = a["walletId"] ?? a["id"];
      const addressUnknown = a["address"] ?? a["walletAddress"];
      const walletId = typeof walletIdUnknown === "string" ? walletIdUnknown : undefined;
      const address = typeof addressUnknown === "string" ? addressUnknown : undefined;
      return { walletId, address };
    }
  }
  return undefined;
}

/* ---------------------------------- POST -------------------------------- */

export async function POST(req: NextRequest) {
  try {
    const session = requireSession(req);

    const raw = await req.json().catch(() => ({}));
    const parsed = BodySchema.safeParse(raw);
    if (!parsed.success) return jerr(400, "Invalid body");

    // Validate token (we use it to bind to intended recipient)
    const payload = verifyClaimToken(parsed.data.token);
    if (!payload?.recipientEmail || !payload?.expiresAt) {
      return jerr(401, "Invalid or expired token");
    }

    await connect();

    // Expired token?
    if (Date.now() > new Date(payload.expiresAt).getTime()) {
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
      return jerr(403, "Email mismatch. Sign in with the invited email.", {
        expected: tokenEmail,
        got: (session.email || "").toLowerCase(),
      });
    }

    // Load user
    const user = await User.findById(session.userId);
    if (!user) return jerr(404, "User record not found");

    // Ensure user has a deposit wallet (create embedded wallet in Privy if missing)
    if (!user.depositWallet?.address) {
      const privy = getPrivy();

      // Try reading any existing embedded Solana wallet
      let pUser = await privy.getUser(session.privyId);
      let sol = extractEmbeddedSolanaFromPrivyUser(pUser);

      // If none, create one
      if (!sol?.address) {
        const created = await privy.walletApi.createWallet({
          chainType: "solana",
          owner: { userId: session.privyId },
          idempotencyKey: randomUUID(),
        });

        // best-effort refresh & normalize
        pUser = await privy.getUser(session.privyId);
        sol = extractEmbeddedSolanaFromPrivyUser(pUser) ?? {
          walletId: created.id,
          address: created.address,
        };
      }

      if (!sol?.address) {
        return jerr(
          409,
          "Unable to create embedded wallet — please try again."
        );
      }

      type DepositWallet = { walletId?: string; address?: string; chainType: "solana" };
      user.depositWallet = {
        walletId: sol.walletId,
        address: sol.address,
        chainType: "solana",
      } as DepositWallet;
      await user.save();
    }

    // Recipient owner pubkey
    const recipientOwner = new PublicKey(user.depositWallet!.address!);

    // Gather ALL pending, non-expired claims for this email
    const now = new Date();
    const pending = await EmailClaim.find({
      recipientEmail: tokenEmail,
      status: "pending",
      tokenExpiresAt: { $gt: now },
    }).sort({ createdAt: 1 });

    // If nothing to do, still return a redirect hint
    const onboarded = user.status === "active" && user.kycStatus === "approved";
    const redirect = onboarded ? "/dashboard" : "/onboarding";

    if (pending.length === 0) {
      return NextResponse.json({
        ok: true,
        claimedCount: 0,
        signatures: [],
        redirect,
      });
    }

    // Prepare Solana transfers (batched)
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
          escrowAta,
          USDC_MINT,
          recipientAta,
          ESCROW_PUBKEY,
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
    // Keep the error readable; don’t dump stack in prod responses
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
