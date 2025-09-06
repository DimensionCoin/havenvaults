// app/api/user/me/route.ts
import { NextRequest, NextResponse } from "next/server";
import { connect } from "@/lib/db";
import User from "@/models/User";
import EmailClaim from "@/models/EmailClaim"; // ✅ ensure this is imported
import { verifySession } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const token = req.cookies.get("__session")?.value;
    const session = token ? verifySession(token) : null;
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    await connect();
    const user = await User.findById(session.userId).lean();
    if (!user) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    // 🔎 Pending, non-expired email claims for this user's email, with sender info
    const now = new Date();
    const userEmail = (user.email || "").toLowerCase();

    let pendingEmailClaims: Array<{
      id: string;
      amountUnits: number;
      currency: string;
      tokenExpiresAt: string;
      createdAt: string;
      from?: { name?: string; email?: string; owner?: string };
    }> = [];

    if (userEmail) {
      // Pull the bare claims we need + fields to resolve sender
      const pendingDocs = await EmailClaim.find(
        {
          recipientEmail: userEmail,
          status: "pending",
          tokenExpiresAt: { $gt: now },
        },
        {
          _id: 1,
          amountUnits: 1,
          currency: 1,
          tokenExpiresAt: 1,
          createdAt: 1,
          senderUserId: 1,
          senderFromOwner: 1,
        }
      )
        .sort({ createdAt: -1 })
        .lean();

      // Lookup senders
      const senderIds = Array.from(
        new Set(
          pendingDocs
            .map((d) => (d.senderUserId ? String(d.senderUserId) : null))
            .filter(Boolean) as string[]
        )
      );

      const sendersById: Record<string, { name?: string; email?: string }> = {};
      if (senderIds.length) {
        const senders = await User.find(
          { _id: { $in: senderIds } },
          { firstName: 1, lastName: 1, email: 1 }
        ).lean();

        for (const s of senders) {
          const name =
            [s.firstName, s.lastName].filter(Boolean).join(" ").trim() ||
            undefined;
          sendersById[String(s._id)] = { name, email: s.email };
        }
      }

      pendingEmailClaims = pendingDocs.map((d) => {
        const sender =
          (d.senderUserId && sendersById[String(d.senderUserId)]) || undefined;
        return {
          id: String(d._id),
          amountUnits: Number(d.amountUnits || 0),
          currency: String(d.currency || "USDC"),
          tokenExpiresAt: new Date(d.tokenExpiresAt).toISOString(),
          createdAt: new Date(d.createdAt).toISOString(),
          from: {
            name: sender?.name,
            email: sender?.email, // ✅ this is what your banner wants to show
            owner: (d.senderFromOwner as string) || undefined,
          },
        };
      });
    }

    // Public-safe payload + pending claims
    const payload = {
      id: user._id.toString(),
      privyId: user.privyId,
      email: user.email,
      firstName: user.firstName ?? "",
      lastName: user.lastName ?? "",
      displayName:
        [user.firstName, user.lastName].filter(Boolean).join(" ") || null,
      countryISO: user.countryISO ?? null,
      displayCurrency: user.displayCurrency ?? "USD",
      status: user.status,
      kycStatus: user.kycStatus,
      riskLevel: user.riskLevel,
      features: user.features ?? { onramp: false, cards: false, lend: false },
      depositWallet: user.depositWallet ?? null,
      savingsWallet: user.savingsWallet ?? null,
      savingsConsent: user.savingsConsent ?? { enabled: false, version: "" },
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,

      // ✅ NEW/ENRICHED:
      hasPendingEmailClaims: pendingEmailClaims.length > 0,
      pendingEmailClaims,
    };

    return NextResponse.json(payload, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (e) {
    console.error("GET /api/user/me error:", e);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
