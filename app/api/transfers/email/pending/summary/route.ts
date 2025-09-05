import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { connect } from "@/lib/db";
import EmailClaim from "@/models/EmailClaim";
import User from "@/models/User";
import { verifySession } from "@/lib/auth";
import { verifyClaimToken } from "@/lib/claim-token";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DECIMALS = 6;

const Body = z.object({
  token: z.string().min(10),
});

export async function POST(req: NextRequest) {
  // 1) App session (cookie)
  const cookie = req.cookies.get("__session")?.value;
  const claims = cookie ? verifySession(cookie) : null;
  if (!claims)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // 2) Body
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success)
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });

  // 3) Token + email match
  const payload = verifyClaimToken(parsed.data.token);
  if (!payload?.recipientEmail) {
    return NextResponse.json({ error: "Bad token" }, { status: 401 });
  }
  const email = payload.recipientEmail.toLowerCase();

  if ((claims.email || "").toLowerCase() !== email) {
    return NextResponse.json({ error: "Email mismatch" }, { status: 403 });
  }

  // Optional expiry check (keeps UX consistent with summary)
  if (payload.expiresAt && Date.now() > new Date(payload.expiresAt).getTime()) {
    return NextResponse.json(
      { error: "This claim link has expired" },
      { status: 410 }
    );
  }

  // 4) Query all pending, non-expired, oldest first
  await connect();
  const now = new Date();

  const pending = await EmailClaim.find(
    {
      recipientEmail: email,
      status: "pending",
      tokenExpiresAt: { $gt: now },
    },
    {
      // projection: only what we need
      _id: 1,
      senderUserId: 1,
      senderFromOwner: 1,
      amountUnits: 1,
      currency: 1,
      createdAt: 1,
      tokenId: 1,
    }
  )
    .sort({ createdAt: 1 })
    .lean();

  // Look up sender records in one pass (if present)
  const senderIds = pending
    .map((p) => (p.senderUserId ? String(p.senderUserId) : null))
    .filter(Boolean) as string[];

  const sendersById: Record<string, { name?: string; email?: string }> = {};
  if (senderIds.length) {
    const users = await User.find(
      { _id: { $in: senderIds } },
      { firstName: 1, lastName: 1, email: 1 }
    ).lean();

    for (const u of users) {
      const name =
        [u.firstName, u.lastName].filter(Boolean).join(" ").trim() || undefined;
      sendersById[String(u._id)] = { name, email: u.email };
    }
  }

  // shape items for UI
  const items = pending.map((p) => {
    const units = Number(p.amountUnits || 0);
    const amountUi = units / 10 ** DECIMALS;

    const sender =
      (p.senderUserId && sendersById[String(p.senderUserId)]) || undefined;

    return {
      id: String(p._id),
      tokenId: p.tokenId as string,
      amountUnits: units,
      amountUi,
      currency: p.currency as string,
      createdAt: p.createdAt as Date,
      from: {
        name: sender?.name,
        email: sender?.email,
        owner: p.senderFromOwner as string | undefined, // fallback (escrow owner/owner string)
      },
    };
  });

  return NextResponse.json({ ok: true, items });
}
