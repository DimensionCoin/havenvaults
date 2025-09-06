// app/api/transfers/user/sent/list/route.ts (sketch)
import { NextRequest, NextResponse } from "next/server";
import { connect } from "@/lib/db";
import EmailClaim from "@/models/EmailClaim";
import { verifySession } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const token = req.cookies.get("__session")?.value;
  const claims = token ? verifySession(token) : null;
  if (!claims)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  await connect();
  const now = new Date();

  const items = await EmailClaim.find(
    {
      senderUserId: claims.userId,
      status: "pending",
      tokenExpiresAt: { $gt: now },
    },
    {
      _id: 1,
      recipientEmail: 1,
      amountUnits: 1,
      currency: 1,
      createdAt: 1,
      tokenExpiresAt: 1,
      escrowSignature: 1,
    }
  )
    .sort({ createdAt: -1 })
    .lean();

  return NextResponse.json({
    ok: true,
    items: items.map((i) => ({
      id: String(i._id),
      recipientEmail: i.recipientEmail,
      amountUnits: Number(i.amountUnits || 0),
      currency: String(i.currency || "USDC"),
      createdAt:
        i.createdAt?.toISOString?.() ?? new Date(i.createdAt).toISOString(),
      tokenExpiresAt:
        i.tokenExpiresAt?.toISOString?.() ??
        new Date(i.tokenExpiresAt).toISOString(),
      escrowSignature: i.escrowSignature,
    })),
  });
}
