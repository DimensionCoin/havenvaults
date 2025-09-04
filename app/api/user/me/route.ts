// app/api/user/me/route.ts
import { NextRequest, NextResponse } from "next/server";
import { connect } from "@/lib/db";
import User from "@/models/User";
import { verifySession } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const token = req.cookies.get("__session")?.value;
    const claims = token ? verifySession(token) : null;
    if (!claims) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    await connect();
    const user = await User.findById(claims.userId).lean();

    if (!user) {
      // No Mongo user yet (e.g., skipped /api/auth/signup)
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    // Build a public-safe payload (no PII like full address/dob/phone)
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
      status: user.status, // "pending" | "active" | ...
      kycStatus: user.kycStatus, // "none" | "pending" | "approved" | "rejected"
      riskLevel: user.riskLevel,
      features: user.features ?? { onramp: false, cards: false, lend: false },
      depositWallet: user.depositWallet ?? null,
      savingsWallet: user.savingsWallet ?? null,
      savingsConsent: user.savingsConsent ?? { enabled: false, version: "" },
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };

    return NextResponse.json(payload, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (e) {
    console.error("GET /api/user/me error:", e);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
