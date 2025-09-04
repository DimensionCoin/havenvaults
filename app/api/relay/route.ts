// app/api/relay/route.ts
import "server-only";
import { NextResponse, NextRequest } from "next/server";
import { verifySession } from "@/lib/auth";
import { getCaip2 } from "@/lib/solana";
import { getPrivy } from "@/lib/privyServer";
import { connect } from "@/lib/db";
import User from "@/models/User";

import {
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
  Connection,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
  getAccount as getSplAccount,
} from "@solana/spl-token";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* ----------------------------- env + constants ---------------------------- */

function requiredEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

// RPC + USDC + treasury (public)
const SOLANA_RPC = requiredEnv("NEXT_PUBLIC_SOLANA_RPC");
const USDC_MINT_STR = requiredEnv("NEXT_PUBLIC_USDC_MINT");
const TREASURY_OWNER_STR = requiredEnv("NEXT_PUBLIC_APP_TREASURY_OWNER");

// Haven fee payer (Privy app wallet id + its public address)
const HAVEN_WALLET_ID = requiredEnv("HAVEN_FEEPAYER_WALLET_ID");
const HAVEN_PUBKEY_STR = requiredEnv("NEXT_PUBLIC_HAVEN_FEEPAYER_ADDRESS");

// Fees
const DECIMALS = 6; // USDC
const FEE_UI = 0.02; // 2 cents

const USDC_MINT = new PublicKey(USDC_MINT_STR);
const TREASURY_OWNER = new PublicKey(TREASURY_OWNER_STR);
const HAVEN_PUBKEY = new PublicKey(HAVEN_PUBKEY_STR);

/* --------------------------------- helpers -------------------------------- */

// Try __session first; fallback to Privy access token to resolve privyId
async function getPrivyIdFromRequest(req: NextRequest): Promise<string | null> {
  // 1) App session cookie (__session) -> JWT claims
  const sessionCookie = req.cookies.get("__session")?.value;
  const claims = sessionCookie ? verifySession(sessionCookie) : null;
  if (claims?.privyId) return claims.privyId;

  // 2) Privy access token (Authorization: Bearer ... or privy-token cookie)
  const accessToken = readPrivyAccessToken(req);
  if (!accessToken) return null;

  try {
    const client = getPrivy();
    const { userId } = await client.verifyAuthToken(accessToken);
    return userId ?? null; // did:privy:...
  } catch {
    return null;
  }
}

function readPrivyAccessToken(req: Request): string | null {
  const authz = req.headers.get("authorization");
  if (authz?.toLowerCase().startsWith("bearer ")) return authz.slice(7).trim();
  const cookie = req.headers.get("cookie");
  if (!cookie) return null;
  const match = cookie
    .split(";")
    .map((s) => s.trim())
    .find((c) => c.toLowerCase().startsWith("privy-token="));
  return match
    ? decodeURIComponent(match.substring("privy-token=".length))
    : null;
}

async function confirmSig(
  conn: Connection,
  signature: string,
  commitment: "confirmed" | "finalized" = "confirmed"
) {
  const bh = await conn.getLatestBlockhash(commitment);
  const res = await conn.confirmTransaction({ signature, ...bh }, commitment);
  if (res.value.err) {
    throw new Error(`On-chain error: ${JSON.stringify(res.value.err)}`);
  }
}

async function detectTokenProgramId(conn: Connection, mint: PublicKey) {
  const info = await conn.getAccountInfo(mint);
  if (!info) throw new Error("Mint not found on chain");
  const owner = info.owner.toBase58();
  if (owner === TOKEN_PROGRAM_ID.toBase58()) return TOKEN_PROGRAM_ID;
  if (owner === TOKEN_2022_PROGRAM_ID.toBase58()) return TOKEN_2022_PROGRAM_ID;
  return TOKEN_PROGRAM_ID;
}

function buildEnsureAtasTx(
  mint: PublicKey,
  tokenProgramId: PublicKey,
  from: PublicKey,
  to: PublicKey,
  treasury: PublicKey,
  feePayer: PublicKey,
  recentBlockhash: string
) {
  const owners = [from, to, treasury];
  const ixs: TransactionInstruction[] = owners.map((owner) =>
    createAssociatedTokenAccountIdempotentInstruction(
      feePayer, // payer (Haven)
      getAssociatedTokenAddressSync(mint, owner, false, tokenProgramId),
      owner,
      mint,
      tokenProgramId
    )
  );
  const msg = new TransactionMessage({
    payerKey: feePayer,
    recentBlockhash,
    instructions: ixs,
  }).compileToV0Message();
  return new VersionedTransaction(msg);
}

/** user-signed transfer (payer = Haven) */
function buildUserTransferTx(
  mint: PublicKey,
  tokenProgramId: PublicKey,
  sourceTokenAccount: PublicKey, // user's source token account
  fromOwner: PublicKey, // user authority
  toOwner: PublicKey,
  treasuryOwner: PublicKey,
  totalUi: number,
  feePayer: PublicKey,
  recentBlockhash: string
) {
  if (!Number.isFinite(totalUi) || totalUi <= FEE_UI) {
    throw new Error("Amount must be greater than 0.02 USDC");
  }

  const toUnits = (ui: number) => Math.round(ui * 1_000_000); // 6dp
  const total = toUnits(totalUi);
  const fee = toUnits(FEE_UI);
  const net = total - fee;

  const toAta = getAssociatedTokenAddressSync(
    mint,
    toOwner,
    false,
    tokenProgramId
  );
  const treasuryAta = getAssociatedTokenAddressSync(
    mint,
    treasuryOwner,
    false,
    tokenProgramId
  );

  const ixs: TransactionInstruction[] = [
    createTransferCheckedInstruction(
      sourceTokenAccount,
      mint,
      toAta,
      fromOwner,
      net,
      DECIMALS,
      [],
      tokenProgramId
    ),
    createTransferCheckedInstruction(
      sourceTokenAccount,
      mint,
      treasuryAta,
      fromOwner,
      fee,
      DECIMALS,
      [],
      tokenProgramId
    ),
  ];

  const msg = new TransactionMessage({
    payerKey: feePayer,
    recentBlockhash,
    instructions: ixs,
  }).compileToV0Message();

  return new VersionedTransaction(msg);
}

/* --------------------------------- types ---------------------------------- */
type Intent = { fromOwner: string; toOwner: string; totalAmountUi: number };
type RelayBody = { intent?: Intent; transaction?: string };

/* ---------------------------------- POST ---------------------------------- */

export async function POST(req: NextRequest) {
  try {
    // Resolve current user (app cookie OR Privy token)
    const privyId = await getPrivyIdFromRequest(req);
    if (!privyId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    let body: RelayBody | null = null;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json(
        { error: "Invalid or empty JSON body" },
        { status: 400 }
      );
    }

    await connect();
    const user = await User.findOne({ privyId }).lean();
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const privy = getPrivy();
    const caip2 = getCaip2();
    const conn = new Connection(SOLANA_RPC, "confirmed");

    /* ---------------- PATH A: client-signed base64 transaction ------------- */
    if (body?.transaction) {
      const raw = Buffer.from(body.transaction, "base64");
      const tx = VersionedTransaction.deserialize(raw);

      // Sanity: first static key (payer) must be Haven
      const feePayer = tx.message.staticAccountKeys[0];
      if (!feePayer.equals(HAVEN_PUBKEY)) {
        return NextResponse.json(
          { error: "Invalid fee payer in transaction" },
          { status: 403 }
        );
      }

      const { hash } = await privy.walletApi.solana.signAndSendTransaction({
        walletId: HAVEN_WALLET_ID,
        caip2,
        transaction: tx,
      });

      await confirmSig(conn, hash, "confirmed");
      return NextResponse.json({ signature: hash });
    }

    /* ---------------- PATH B: server-built “intent” (legacy) --------------- */
    const intent = body?.intent;
    if (!intent) {
      return NextResponse.json(
        {
          error:
            "Missing 'transaction' (preferred) or 'intent' (legacy) in body.",
        },
        { status: 400 }
      );
    }

    const from = new PublicKey(intent.fromOwner);
    const to = new PublicKey(intent.toOwner);
    const tokenProgramId = await detectTokenProgramId(conn, USDC_MINT);

    // Map fromOwner -> user's walletId (deposit or savings)
    const fromWalletIdMaybe =
      (user.depositWallet?.address === intent.fromOwner
        ? user.depositWallet?.walletId
        : undefined) ??
      (user.savingsWallet?.address === intent.fromOwner
        ? user.savingsWallet?.walletId
        : undefined);

    if (!fromWalletIdMaybe) {
      return NextResponse.json(
        { error: "Source wallet not recognized for this user" },
        { status: 400 }
      );
    }
    const fromWalletId: string = fromWalletIdMaybe;

    // fresh blockhash for both txs
    const { blockhash } = await conn.getLatestBlockhash("finalized");

    // 1) Ensure ATAs for from, to, treasury (payer = Haven)
    let ataSig: string | undefined;
    try {
      const ataTx = buildEnsureAtasTx(
        USDC_MINT,
        tokenProgramId,
        from,
        to,
        TREASURY_OWNER,
        HAVEN_PUBKEY,
        blockhash
      );
      const sent = await privy.walletApi.solana.signAndSendTransaction({
        walletId: HAVEN_WALLET_ID,
        caip2,
        sponsor: false,
        transaction: ataTx,
      });
      ataSig = sent.hash;
      if (ataSig) {
        await confirmSig(conn, ataSig, "confirmed");
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return NextResponse.json(
        { error: `ATA creation failed: ${msg}`, signature: ataSig },
        { status: 500 }
      );
    }

    // 2) Switch to user-scoped key so Privy can collect the user's signature
    const accessToken = readPrivyAccessToken(req);
    if (!accessToken) {
      return NextResponse.json(
        {
          error:
            "Missing Privy access token (Authorization header or privy-token cookie)",
        },
        { status: 401 }
      );
    }
    try {
      const { authorizationKey } = await privy.walletApi.generateUserSigner({
        userJwt: accessToken,
      });
      privy.walletApi.updateAuthorizationKey(authorizationKey);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return NextResponse.json(
        { error: `Auth key error: ${msg}` },
        { status: 401 }
      );
    }

    // 3) Select user's USDC source token account
    let srcAccount: PublicKey | null = null;
    let srcAmountUnits = 0;
    try {
      const list = await conn.getTokenAccountsByOwner(from, {
        mint: USDC_MINT,
      });
      for (const v of list.value) {
        if (!v.account.owner.equals(tokenProgramId)) continue;
        const pk = new PublicKey(v.pubkey);
        const acc = await getSplAccount(conn, pk, "confirmed", tokenProgramId);
        const amt = Number(acc.amount as unknown as bigint);
        if (amt > srcAmountUnits) {
          srcAmountUnits = amt;
          srcAccount = pk;
        }
      }
    } catch {
      // ignore, we’ll fallback to the ATA path
    }

    if (!srcAccount) {
      srcAccount = getAssociatedTokenAddressSync(
        USDC_MINT,
        from,
        false,
        tokenProgramId
      );
      try {
        const acc = await getSplAccount(
          conn,
          srcAccount,
          "confirmed",
          tokenProgramId
        );
        srcAmountUnits = Number(acc.amount as unknown as bigint);
      } catch {
        srcAmountUnits = 0;
      }
    }

    const wantUnits = Math.round(intent.totalAmountUi * 1_000_000);
    if (srcAmountUnits < wantUnits) {
      return NextResponse.json(
        {
          error: `Insufficient USDC. Have ${(
            srcAmountUnits / 1_000_000
          ).toFixed(6)}, need ${intent.totalAmountUi.toFixed(6)}`,
        },
        { status: 400 }
      );
    }

    // 4) Build sponsored transfer (payer = Haven) and send with sponsorship
    const xferTx = buildUserTransferTx(
      USDC_MINT,
      tokenProgramId,
      srcAccount,
      from,
      to,
      TREASURY_OWNER,
      intent.totalAmountUi,
      HAVEN_PUBKEY,
      blockhash
    );

    let sig: string | undefined;
    try {
      const sent = await privy.walletApi.solana.signAndSendTransaction({
        walletId: fromWalletId, // user's wallet for authority signature
        caip2,
        sponsor: true, // Privy adds Haven's payer signature
        transaction: xferTx,
      });
      sig = sent.hash;
      if (sig) {
        await confirmSig(conn, sig, "confirmed");
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return NextResponse.json(
        { error: `Broadcast failed: ${msg}`, signature: sig },
        { status: 500 }
      );
    }

    return NextResponse.json({ signature: sig });
  } catch (e) {
    if (e instanceof Response) throw e; // bubble thrown 401
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
