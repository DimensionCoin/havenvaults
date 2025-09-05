// app/api/transfers/email/claim/route.ts
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

const SOLANA_RPC = process.env.NEXT_PUBLIC_SOLANA_RPC!;
const USDC_MINT = new PublicKey(process.env.NEXT_PUBLIC_USDC_MINT!);

// Escrow (Privy app wallet acting as escrow)
const ESCROW_WALLET_ID = process.env.HAVEN_FEEPAYER_WALLET_ID!; // Privy walletId
const ESCROW_PUBKEY = new PublicKey(
  (process.env.NEXT_PUBLIC_HAVEN_ESCROW_OWNER ??
    process.env.NEXT_PUBLIC_HAVEN_FEEPAYER_ADDRESS)!
);

const DECIMALS = 6;

const BodySchema = z.object({ token: z.string().min(10) });

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

function jerr(status: number, error: string) {
  return NextResponse.json({ error }, { status });
}

export async function POST(req: NextRequest) {
  try {
    const session = requireSession(req);
    const raw = await req.json().catch(() => ({}));
    const parsed = BodySchema.safeParse(raw);
    if (!parsed.success) return jerr(400, "Invalid body");

    const payload = verifyClaimToken(parsed.data.token);
    if (!payload?.claimId || !payload?.recipientEmail || !payload?.expiresAt) {
      return jerr(401, "Invalid or expired token");
    }

    await connect();

    // Expired?
    if (Date.now() > new Date(payload.expiresAt).getTime()) {
      const maybe = await EmailClaim.findOne({ tokenId: payload.claimId });
      if (maybe && maybe.status === "pending") {
        maybe.status = "expired";
        await maybe.save();
      }
      return jerr(410, "This claim link has expired");
    }

    // Email must match token
    if (
      (session.email || "").toLowerCase() !==
      payload.recipientEmail.toLowerCase()
    ) {
      return jerr(403, "Email mismatch. Sign in with the invited email.");
    }

    // Load claim
    const claim = await EmailClaim.findOne({ tokenId: payload.claimId });
    if (!claim) return jerr(404, "Claim not found");

    // Idempotency
    if (claim.status === "claimed") {
      // Figure out where to send the user
      const user = await User.findById(session.userId);
      const onboarded = !!(
        user &&
        user.status === "active" &&
        user.kycStatus === "approved"
      );
      return NextResponse.json({
        ok: true,
        alreadyClaimed: true,
        signature: claim.claimSignature,
        redirect: onboarded ? "/dashboard" : "/onboarding",
      });
    }
    if (claim.status !== "pending") {
      return jerr(409, `Claim cannot be fulfilled (status: ${claim.status})`);
    }

    // Recipient must exist & have deposit wallet
    const user = await User.findById(session.userId);
    if (!user) return jerr(404, "User record not found");

    const onboarded = user.status === "active" && user.kycStatus === "approved";
    const redirect = onboarded ? "/dashboard" : "/onboarding";

    if (!user.depositWallet?.address) {
      return jerr(409, "No deposit wallet on file. Please finish onboarding.");
    }
    const recipientOwner = new PublicKey(user.depositWallet.address);

    // Build escrow → recipient transfer
    const conn = new Connection(SOLANA_RPC, "confirmed");
    const tokenProgramId = await detectTokenProgramId(conn, USDC_MINT);

    const ensureEscrowAtaIx = createAssociatedTokenAccountIdempotentInstruction(
      ESCROW_PUBKEY,
      getAssociatedTokenAddressSync(
        USDC_MINT,
        ESCROW_PUBKEY,
        false,
        tokenProgramId
      ),
      ESCROW_PUBKEY,
      USDC_MINT,
      tokenProgramId
    );
    const ensureRecipientAtaIx =
      createAssociatedTokenAccountIdempotentInstruction(
        ESCROW_PUBKEY,
        getAssociatedTokenAddressSync(
          USDC_MINT,
          recipientOwner,
          false,
          tokenProgramId
        ),
        recipientOwner,
        USDC_MINT,
        tokenProgramId
      );

    const xferIx = createTransferCheckedInstruction(
      getAssociatedTokenAddressSync(
        USDC_MINT,
        ESCROW_PUBKEY,
        false,
        tokenProgramId
      ),
      USDC_MINT,
      getAssociatedTokenAddressSync(
        USDC_MINT,
        recipientOwner,
        false,
        tokenProgramId
      ),
      ESCROW_PUBKEY,
      Number(claim.amountUnits),
      DECIMALS,
      [],
      tokenProgramId
    );

    const { blockhash } = await conn.getLatestBlockhash("finalized");
    const msg = new TransactionMessage({
      payerKey: ESCROW_PUBKEY,
      recentBlockhash: blockhash,
      instructions: [
        ensureEscrowAtaIx as TransactionInstruction,
        ensureRecipientAtaIx as TransactionInstruction,
        xferIx,
      ],
    }).compileToV0Message();
    const tx = new VersionedTransaction(msg);

    const privy = getPrivy();
    const caip2 = getCaip2();
    const { hash } = await privy.walletApi.solana.signAndSendTransaction({
      walletId: ESCROW_WALLET_ID,
      caip2,
      transaction: tx,
    });

    // Mark claimed
    claim.status = "claimed";
    claim.claimedByUserId = user._id;
    claim.claimSignature = hash;
    claim.claimedAt = new Date();
    await claim.save();

    return NextResponse.json({ ok: true, signature: hash, redirect });
  } catch (e) {
    if (e instanceof Response) throw e;
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
