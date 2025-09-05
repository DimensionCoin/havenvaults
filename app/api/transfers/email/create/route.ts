import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { connect } from "@/lib/db";
import User from "@/models/User";
import EmailClaim from "@/models/EmailClaim";
import { verifySession } from "@/lib/auth";
import { sendClaimEmail } from "@/lib/resend";
import { signClaimToken } from "@/lib/claim-token";
import { randomUUID } from "node:crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* ------------------------------ constants -------------------------------- */

const DECIMALS = 6;             // USDC
const FEE_UI = 0.02;            // fixed processing fee your relay takes
const DEFAULT_APP_URL = "http://localhost:3000";

// Escrow public address where funds live until the claim is completed.
const ESCROW_OWNER =
  process.env.NEXT_PUBLIC_HAVEN_ESCROW_OWNER ??
  process.env.NEXT_PUBLIC_HAVEN_FEEPAYER_ADDRESS ??
  "";

/* -------------------------------- schema --------------------------------- */

const BodySchema = z.object({
  recipientEmail: z.string().email(),
  fromOwner: z.string().min(32, "Invalid sender owner public key"),
  amountUi: z.number().positive(),
  note: z.string().min(0).max(160).optional(),
  idempotencyKey: z.string().min(1).max(128).optional(),
});

type Body = z.infer<typeof BodySchema>;

/* ------------------------------- helpers --------------------------------- */

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

const normEmail = (s: string) => s.trim().toLowerCase();

function jerr(status: number, error: string, details?: unknown) {
  return NextResponse.json(
    { error, ...(details ? { details } : {}) },
    { status }
  );
}

/** Build an origin that preserves cookies both locally and on Vercel. */
function getOriginFrom(req: NextRequest): string {
  try {
    const u = new URL(req.url);
    return `${u.protocol}//${u.host}`;
  } catch {
    return process.env.NEXT_PUBLIC_APP_URL || DEFAULT_APP_URL;
  }
}

/* ---------------------------------- POST ---------------------------------- */

export async function POST(req: NextRequest) {
  try {
    if (!ESCROW_OWNER) {
      return jerr(500, "Escrow owner is not configured on the server");
    }

    const session = requireSession(req);

    const raw = (await req.json().catch(() => null)) as unknown;
    const parsed = BodySchema.safeParse(raw);
    if (!parsed.success) {
      return jerr(400, "Invalid body", parsed.error.flatten());
    }

    const { recipientEmail, fromOwner, amountUi, note, idempotencyKey } =
      parsed.data as Body;

    if (amountUi <= FEE_UI) {
      return jerr(400, "Amount must be greater than $0.02");
    }

    await connect();
    const sender = await User.findById(session.userId);
    if (!sender) return jerr(404, "Sender not found");

    // Reuse a pending claim if idempotency key matches
    if (idempotencyKey) {
      const existing = await EmailClaim.findOne({
        idempotencyKey,
        status: "pending",
        recipientEmail: normEmail(recipientEmail),
        senderUserId: sender._id,
      }).lean();
      if (existing) {
        return NextResponse.json({
          ok: true,
          claimId: String(existing._id),
          escrowSignature: existing.escrowSignature,
          idempotencyHit: true,
        });
      }
    }

    // 1) Move funds → ESCROW via your relay (server-built intent path).
    const origin = getOriginFrom(req); // ← preserves cookies/session
    const relayUrl = `${origin}/api/relay`;

    const relayRes = await fetch(relayUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        // forward *exact* cookies we received so /api/relay sees the same session
        cookie: req.headers.get("cookie") ?? "",
      },
      body: JSON.stringify({
        intent: {
          fromOwner,
          toOwner: ESCROW_OWNER,
          totalAmountUi: amountUi,
        },
      }),
    });

    const relayJson = (await relayRes.json().catch(() => ({}))) as {
      signature?: string;
      error?: string;
    };

    if (!relayRes.ok || !relayJson.signature) {
      // Log useful context to server logs
      console.error("[email/create] relay failed", {
        status: relayRes.status,
        statusText: relayRes.statusText,
        bodyError: relayJson?.error,
        url: relayUrl,
        fromOwner,
        toOwner: ESCROW_OWNER,
        amountUi,
      });
      return jerr(
        502,
        "Escrow transfer failed",
        relayJson?.error ?? `HTTP ${relayRes.status}`
      );
    }

    // 2) Persist claim
    const expires = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7); // 7 days
    const claimTokenId = randomUUID();
    const amountUnits = Math.round(amountUi * 10 ** DECIMALS);

    const claimDoc = await EmailClaim.create({
      senderUserId: sender._id,
      senderFromOwner: fromOwner,
      recipientEmail: normEmail(recipientEmail),
      amountUnits,
      currency: "USDC",
      escrowSignature: relayJson.signature,
      escrowWalletAddress: ESCROW_OWNER,
      tokenId: claimTokenId,
      tokenExpiresAt: expires,
      note: note?.trim() || undefined,
      idempotencyKey,
      status: "pending",
    });

    // 3) Email recipient with signed claim link
    const claimToken = signClaimToken({
      claimId: claimTokenId,
      recipientEmail: normEmail(recipientEmail),
      expiresAt: expires,
    });

    await sendClaimEmail({
      recipientEmail: normEmail(recipientEmail),
      amountUi,
      senderEmail: session.email,
      claimToken,
      note,
    });

    return NextResponse.json({
      ok: true,
      claimId: String(claimDoc._id),
      escrowSignature: relayJson.signature,
    });
  } catch (e) {
    if (e instanceof Response) throw e; // bubbled from requireSession
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[email/create] 500", msg);
    return jerr(500, msg);
  }
}
