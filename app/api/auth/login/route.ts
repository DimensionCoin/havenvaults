// app/api/auth/login/route.ts
import { NextResponse } from "next/server";
import { connect } from "@/lib/db";
import User from "@/models/User";
import { signSession } from "@/lib/auth";
import { privy } from "@/lib/privy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SESSION_DURATION = 60 * 60 * 24 * 7; // 7 days

export async function POST(req: Request) {
  // Safely parse JSON body
  const body = await req.json().catch(() => null);
  const accessToken = body?.accessToken;
  if (!accessToken) {
    return NextResponse.json({ error: "Missing token" }, { status: 400 });
  }

  try {
    // 1) Verify the Privy token → get DID
    const claims = await privy.verifyAuthToken(accessToken);
    const privyId = claims.userId;

    // 2) Optionally fetch Privy user (not strictly required here)
    // const pUser = await privy.getUser(privyId);

    // 3) DB lookup
    await connect();
    const user = await User.findOne({ privyId });

    if (!user) {
      // If you want to send them through onboarding:
      return NextResponse.json(
        { status: "onboarding_required" },
        { status: 404 }
      );
    }

    // 4) Sign your app session
    const sessionToken = signSession(
      { privyId, userId: user._id.toString(), email: user.email },
      SESSION_DURATION
    );

    // 5) Return and set cookie
    const res = NextResponse.json({
      status: "ok",
      onboarded: user.status === "active" && user.kycStatus === "approved",
    });

    res.cookies.set({
      name: "__session",
      value: sessionToken,
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: SESSION_DURATION,
    });

    return res;
  } catch (e) {
    console.error("login error:", e);
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
}
