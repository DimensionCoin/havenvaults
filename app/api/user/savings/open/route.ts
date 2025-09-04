// app/api/user/savings/open/route.ts
import { NextResponse, NextRequest } from "next/server";
import { PrivyClient } from "@privy-io/server-auth";
import { connect } from "@/lib/db";
import User from "@/models/User"; // ← keep consistent with your schema file
import { ensureSecondSolanaWalletWithClient } from "@/lib/privy"; // ← important

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const APP_ID = process.env.PRIVY_APP_ID!;
const SECRET = process.env.PRIVY_SECRET_KEY!;
if (!APP_ID || !SECRET) throw new Error("Missing Privy env vars");

// Optional versioning for savings consent
const SAVINGS_CONSENT_VERSION = process.env.SAVINGS_TOS_VERSION ?? "2025-01";

type Body = { agree?: boolean };

// Local type for a consent entry to avoid `any`
type ConsentEntry = {
  type: "tos" | "privacy" | "risk" | "savings";
  version: string;
  acceptedAt: Date;
};

// Pull Privy access token from Authorization or cookie (privy-token)
function readAccessTokenFromRequest(req: NextRequest): string | null {
  const authz = req.headers.get("authorization");
  if (authz?.toLowerCase().startsWith("bearer ")) return authz.slice(7).trim();
  const cookie = req.headers.get("cookie");
  if (cookie) {
    const token = cookie
      .split(";")
      .map((s) => s.trim())
      .find((c) => c.toLowerCase().startsWith("privy-token="));
    if (token)
      return decodeURIComponent(token.substring("privy-token=".length));
  }
  return null;
}

export async function POST(req: NextRequest) {
  try {
    // --- read body ONCE ---
    const body = (await req.json().catch(() => ({}))) as Body;
    const agree = !!body.agree;

    // --- auth ---
    const accessToken = readAccessTokenFromRequest(req);
    if (!accessToken)
      return new NextResponse("Missing access token", { status: 401 });

    const client = new PrivyClient(APP_ID, SECRET);
    const claims = await client.verifyAuthToken(accessToken);
    const privyId = claims.userId; // did:privy:...

    // --- load user ---
    await connect();
    const user = await User.findOne({ privyId });
    if (!user) return new NextResponse("User not found", { status: 404 });

    // Idempotency: if savings wallet already exists, just return it
    if (user.savingsWallet?.address) {
      return NextResponse.json(
        {
          ok: true,
          alreadyHad: true,
          savingsWallet: user.savingsWallet,
          user: { id: user.id, savingsWallet: user.savingsWallet },
        },
        {
          headers: {
            "Cache-Control": "no-store",
            Vary: "Authorization, Cookie",
          },
        }
      );
    }

    // --- ensure a second embedded Solana wallet ---
    const created = await ensureSecondSolanaWalletWithClient(client, privyId);
    if (!created || !created.address) {
      return new NextResponse("Failed to create savings wallet", {
        status: 409,
      });
    }

    user.savingsWallet = {
      walletId: created.walletId,
      address: created.address,
      chainType: "solana",
    };

    // --- optional consent recording (idempotent by version) ---
    if (agree) {
      const hasThisVersion =
        Array.isArray(user.consents) &&
        user.consents.some(
          (c: ConsentEntry) =>
            c?.type === "savings" && c?.version === SAVINGS_CONSENT_VERSION
        );

      if (!hasThisVersion) {
        (user.consents as ConsentEntry[]).push({
          type: "savings",
          version: SAVINGS_CONSENT_VERSION,
          acceptedAt: new Date(),
        });
      }

      user.savingsConsent = {
        enabled: true,
        acceptedAt: new Date(),
        version: SAVINGS_CONSENT_VERSION,
      };
    }

    await user.save();

    return NextResponse.json(
      {
        ok: true,
        alreadyHad: false,
        savingsWallet: user.savingsWallet,
        user: { id: user.id, savingsWallet: user.savingsWallet },
      },
      {
        headers: { "Cache-Control": "no-store", Vary: "Authorization, Cookie" },
      }
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return new NextResponse(`Open savings failed: ${msg}`, { status: 400 });
  }
}
