import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { PrivyClient } from "@privy-io/server-auth";
import { connect } from "@/lib/db";
import User from "@/models/User";
import jwt from "jsonwebtoken";

// ✅ Top-level runtime declaration
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Session config
const JWT_SECRET = process.env.JWT_SECRET!;
const SESSION_DURATION = 60 * 60 * 24 * 7; // 7 days

const APP_ID = process.env.PRIVY_APP_ID!;
const SECRET = process.env.PRIVY_SECRET_KEY!;
if (!APP_ID || !SECRET) throw new Error("Missing Privy env vars");

const privy = new PrivyClient(APP_ID, SECRET);

export async function POST(req: Request) {
  const { accessToken } = await req.json();
  if (!accessToken)
    return NextResponse.json({ error: "Missing token" }, { status: 400 });

  try {
    // 1. Verify token with Privy
    const user = await privy.getUser(accessToken);
    const privyId = user.id;

    // 2. Connect to DB
    await connect();

    // 3. Lookup user
    const existingUser = await User.findOne({ privyId });
    if (!existingUser) {
      return NextResponse.json(
        { status: "onboarding_required" },
        { status: 404 }
      );
    }

    // 4. Create JWT session token
    const sessionToken = jwt.sign(
      {
        privyId,
        userId: existingUser._id.toString(),
        email: existingUser.email,
      },
      JWT_SECRET,
      { expiresIn: SESSION_DURATION }
    );

    // ✅ 5. Set secure HttpOnly cookie
    const cookieStore = await cookies(); 
    cookieStore.set({
      name: "__session",
      value: sessionToken,
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: SESSION_DURATION,
    });


    return NextResponse.json({
      status: "ok",
      user: { email: existingUser.email },
    });
  } catch (err) {
    console.error("Session error:", err);
    return NextResponse.json(
      { error: "Invalid token or server error" },
      { status: 401 }
    );
  }
}
