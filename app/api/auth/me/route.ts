import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { verifySession } from "@/lib/auth";
import { connect } from "@/lib/db";
import User from "@/models/User";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const jar = await cookies();
  const token = jar.get("__session")?.value;
  if (!token) return NextResponse.json({ user: null }, { status: 200 });

  const claims = verifySession(token);
  if (!claims) return NextResponse.json({ user: null }, { status: 200 });

  await connect();
  const user = await User.findById(claims.userId).lean();

  if (!user) return NextResponse.json({ user: null }, { status: 200 });

  // a very light public shape
  const publicUser = {
    id: user._id.toString(),
    email: user.email,
    status: user.status,
    kycStatus: user.kycStatus,
    displayCurrency: user.displayCurrency,
    depositWallet: user.depositWallet,
  };

  return NextResponse.json({ user: publicUser }, { status: 200 });
}
