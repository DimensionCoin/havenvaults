// app/api/auth/signup/route.ts
import { NextResponse, NextRequest } from "next/server";
import { privy, extractEmail, extractEmbeddedSolana } from "@/lib/privy";
import { connect } from "@/lib/db";
import User from "@/models/User";
import type { IUser } from "@/models/User";
import jwt from "jsonwebtoken";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const JWT_SECRET = process.env.JWT_SECRET!;
const SESSION_DURATION = 60 * 60 * 24 * 7; // 7 days

type DepositWallet = {
  walletId?: string;
  address?: string;
  chainType: "solana";
};

export async function POST(req: NextRequest) {
  if (!JWT_SECRET) {
    return NextResponse.json(
      { error: "Server misconfigured" },
      { status: 500 }
    );
  }

  const url = new URL(req.url);
  const wantRedirect =
    url.searchParams.get("redirect") === "1" ||
    url.searchParams.get("redirect") === "true";

  const body = await req.json().catch(() => null);
  const auth = req.headers.get("authorization");
  const headerToken = auth?.startsWith("Bearer ") ? auth.slice(7).trim() : null;
  const accessToken =
    headerToken ?? (body?.accessToken ? String(body.accessToken) : null);

  if (!accessToken) {
    return NextResponse.json(
      { error: "Missing access token" },
      { status: 400 }
    );
  }

  try {
    // 1) Verify Privy token
    const claims = await privy.verifyAuthToken(accessToken);
    const privyId = claims.userId;

    // 2) Fresh Privy user
    let privyUser = await privy.getUser(privyId);

    // 3) Email (must exist)
    const email = extractEmail(privyUser);
    if (!email) {
      return NextResponse.json(
        { error: "No email on Privy account" },
        { status: 422 }
      );
    }

    // 4) Rely on Privy auto-create for embedded Solana wallet.
    //    Give it a moment to appear (auto-link can be async).
    let solWallet = extractEmbeddedSolana(privyUser);
    if (!solWallet) {
      for (let i = 0; i < 4 && !solWallet; i++) {
        await new Promise((r) => setTimeout(r, 250));
        privyUser = await privy.getUser(privyId);
        solWallet = extractEmbeddedSolana(privyUser);
      }
    }

    // 5) Upsert user
    await connect();
    let user = await User.findOne({ privyId });
    if (!user) {
      const dup = await User.findOne({ email });
      if (dup) {
        return NextResponse.json(
          { error: "Email already registered with another account" },
          { status: 409 }
        );
      }

      const doc: Partial<IUser> & { depositWallet?: DepositWallet } = {
        privyId,
        email,
        status: "pending",
        kycStatus: "none",
        displayCurrency: "USD",
      };
      if (solWallet) doc.depositWallet = solWallet;

      user = await User.create(doc);
    } else if (!user.depositWallet && solWallet) {
      user.depositWallet = solWallet as DepositWallet;
      await user.save();
    }

    // 6) Set app session cookie
    const sessionToken = jwt.sign(
      { sub: user.privyId, userId: user._id.toString(), email: user.email },
      JWT_SECRET,
      { expiresIn: SESSION_DURATION }
    );

    const json = NextResponse.json({
      status: "ok",
      onboarded: user.status === "active" && user.kycStatus === "approved",
      user: { id: user.id, email: user.email },
    });

    json.cookies.set({
      name: "__session",
      value: sessionToken,
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: SESSION_DURATION,
    });

    if (wantRedirect) {
      return NextResponse.redirect(new URL("/onboarding", url.origin), {
        headers: json.headers,
      });
    }

    return json;
  } catch (err) {
    console.error("Signup finalize error:", err);
    return NextResponse.json(
      { error: "Invalid token or server error" },
      { status: 401 }
    );
  }
}
