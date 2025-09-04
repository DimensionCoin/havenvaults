import { NextResponse } from "next/server";
import { privy, extractEmail, extractEmbeddedSolana } from "@/lib/privy";
import { connect } from "@/lib/db";
import User from "@/models/User";
import type { IUser } from "@/models/User";
import jwt from "jsonwebtoken";
import { randomUUID } from "crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const JWT_SECRET = process.env.JWT_SECRET!;
const SESSION_DURATION = 60 * 60 * 24 * 7; // 7 days
if (!JWT_SECRET) throw new Error("Missing JWT_SECRET");

type DepositWallet = { walletId?: string; address?: string; chainType: "solana" };

// Read token from Authorization: Bearer ... or JSON {accessToken}
async function getAccessToken(req: Request) {
  const auth = req.headers.get("authorization");
  if (auth?.startsWith("Bearer ")) return auth.slice(7).trim();
  try {
    const body = await req.json().catch(() => null);
    if (body?.accessToken) return String(body.accessToken);
  } catch {}
  return null;
}

export async function POST(req: Request) {
  const accessToken = await getAccessToken(req);
  if (!accessToken) {
    return NextResponse.json(
      { error: "Missing access token" },
      { status: 400 }
    );
  }

  try {
    // 1) Verify Privy token → DID/session
    const claims = await privy.verifyAuthToken(accessToken);
    const privyId = claims.userId;

    // 2) Fetch Privy user (fresh)
    let privyUser = await privy.getUser(privyId);

    // 3) Extract email (direct or via linked Google account)
    const email = extractEmail(privyUser);
    if (!email) {
      return NextResponse.json(
        { error: "No email on Privy account" },
        { status: 422 }
      );
    }

    // 4) Ensure Solana embedded wallet exists. If not, create it server-side.
    let solWallet = extractEmbeddedSolana(privyUser);
    if (!solWallet) {
      try {
        const idem = randomUUID();
        const created = await privy.walletApi.createWallet({
          chainType: "solana",
          owner: { userId: privyId },
          idempotencyKey: idem,
        });

        // Re-fetch user to get the linkedAccounts array updated
        privyUser = await privy.getUser(privyId);
        solWallet = extractEmbeddedSolana(privyUser) ?? {
          walletId: created.id,
          address: created.address,
          chainType: "solana",
        };
      } catch (e) {
        // If wallet creation fails, proceed without blocking signup; you can handle later in onboarding
        console.error("Privy wallet create failed:", e);
      }
    }

    // 5) Upsert user in our DB
    await connect();

    let user = await User.findOne({ privyId });
    if (!user) {
      // guard duplicate email
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
      // backfill wallet for existing user with no wallet
      user.depositWallet = solWallet as DepositWallet;
      await user.save();
    }

    // 6) App session cookie (JWT)
    const sessionToken = jwt.sign(
      { sub: user.privyId, userId: user._id.toString(), email: user.email },
      JWT_SECRET,
      { expiresIn: SESSION_DURATION }
    );

    const onboarded = user.status === "active" && user.kycStatus === "approved";

    const res = NextResponse.json({
      status: "ok",
      onboarded,
      user: { id: user.id, email: user.email },
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
  } catch (err) {
    console.error("Signup finalize error:", err);
    return NextResponse.json(
      { error: "Invalid token or server error" },
      { status: 401 }
    );
  }
}
