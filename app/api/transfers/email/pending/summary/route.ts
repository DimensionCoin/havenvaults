// app/api/transfers/email/pending/summary/route.ts
import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { connect } from "@/lib/db";
import EmailClaim from "@/models/EmailClaim";
import { verifySession } from "@/lib/auth";
import { verifyClaimToken } from "@/lib/claim-token";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DECIMALS = 6;

const Body = z.object({
  token: z.string().min(10),
});

export async function POST(req: NextRequest) {
  // 1) Auth
  const cookie = req.cookies.get("__session")?.value;
  const claims = cookie ? verifySession(cookie) : null;
  if (!claims)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // 2) Parse body
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  // 3) Verify token & email match
  const payload = verifyClaimToken(parsed.data.token);
  if (!payload?.recipientEmail) {
    return NextResponse.json({ error: "Bad token" }, { status: 401 });
  }
  const email = payload.recipientEmail.toLowerCase();

  if ((claims.email || "").toLowerCase() !== email) {
    return NextResponse.json({ error: "Email mismatch" }, { status: 403 });
  }

  // Optional: enforce token not expired for this summary as well
  if (payload.expiresAt && Date.now() > new Date(payload.expiresAt).getTime()) {
    return NextResponse.json(
      { error: "This claim link has expired" },
      { status: 410 }
    );
  }

  // 4) Aggregate summary without loading all docs
  await connect();
  const now = new Date();

  const [agg] = await EmailClaim.aggregate([
    {
      $match: {
        recipientEmail: email,
        status: "pending",
        tokenExpiresAt: { $gt: now },
      },
    },
    {
      $group: {
        _id: null,
        count: { $count: {} }, // MongoDB 5.0+: use $sum: 1 if needed
        totalUnits: { $sum: { $toLong: "$amountUnits" } },
      },
    },
  ]);

  const count = agg?.count ?? 0;
  const totalUnits = Number(agg?.totalUnits ?? 0);
  const totalUi = totalUnits / 10 ** DECIMALS;

  return NextResponse.json({
    ok: true,
    count,
    totalUnits,
    totalUi,
    currency: "USDC",
  });
}
