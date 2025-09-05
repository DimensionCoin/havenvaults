// app/api/wallet/export/route.ts
import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { verifySession } from "@/lib/auth";
import { connect } from "@/lib/db";
import User from "@/models/User";
import { getPrivy } from "@/lib/privyServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * SECURITY MODEL
 * - Requires app session cookie (__session)
 * - Requires a fresh Privy access token (Authorization: Bearer <token>)
 * - Requires EXPORT_WALLETS_ENABLED="true" in env to enable
 * - Returns an *encrypted keystore* only (never raw private key)
 */

const ENABLED = process.env.EXPORT_WALLETS_ENABLED === "true";

const BodySchema = z.object({
  /** 8+ character encryption passphrase for the keystore (PBKDF/scrypt/etc. by provider) */
  passphrase: z.string().min(8).max(200),
  /**
   * Choose which wallet to export:
   * - Provide walletId explicitly, OR
   * - Provide walletKind: "deposit" | "savings"
   */
  walletId: z.string().min(10).optional(),
  walletKind: z.enum(["deposit", "savings"]).optional(),
});

function jerr(status: number, error: string, details?: unknown) {
  return NextResponse.json(
    { error, ...(details ? { details } : {}) },
    { status }
  );
}

/** Pull a Privy access token from Authorization or JSON body (last-resort) */
async function getPrivyAccessToken(req: NextRequest) {
  const authz = req.headers.get("authorization");
  if (authz?.toLowerCase().startsWith("bearer ")) return authz.slice(7).trim();
  // body fallback (not preferred, but handy for dev tools/forms)
  try {
    const raw = await req.json().catch(() => ({}));
    if (raw?.accessToken) return String(raw.accessToken);
  } catch {}
  return null;
}

export async function POST(req: NextRequest) {
  try {
    if (!ENABLED) {
      return jerr(403, "Key export is disabled by the server.");
    }

    // 1) App session check
    const cookie = req.cookies.get("__session")?.value;
    const claims = cookie ? verifySession(cookie) : null;
    if (!claims) return jerr(401, "Unauthorized");

    // 2) Input validation
    const raw = await req.json().catch(() => ({}));
    const parsed = BodySchema.safeParse(raw);
    if (!parsed.success)
      return jerr(400, "Invalid body", parsed.error.flatten());
    const { passphrase, walletId: explicitWalletId, walletKind } = parsed.data;

    // 3) Require a *fresh* Privy user access token (proves presence)
    const privyAccessToken = (await getPrivyAccessToken(req)) || null; // must be provided by client via Authorization header ideally
    if (!privyAccessToken) {
      return jerr(401, "Missing Privy access token");
    }

    // 4) Verify Privy token → Cross-check identity
    const privy = getPrivy();
    const tokenClaims = await privy.verifyAuthToken(privyAccessToken);
    if (!tokenClaims || tokenClaims.userId !== claims.privyId) {
      return jerr(403, "Privy token does not match current user");
    }

    // 5) Resolve walletId
    await connect();
    const user = await User.findById(claims.userId);
    if (!user) return jerr(404, "User not found");

    let walletId: string | undefined = explicitWalletId;

    if (!walletId) {
      const src =
        walletKind === "savings"
          ? user.savingsWallet
          : // default to deposit if not specified
            user.depositWallet;

      walletId = src?.walletId;
    }

    if (!walletId) {
      return jerr(
        409,
        "No wallet found for export. Make sure a deposit or savings wallet exists."
      );
    }

    // 6) Call Privy to export the encrypted keystore for this wallet
    // NOTE: Your Privy org/app must have wallet export enabled.
    // The response shape is provider-specific; we pass it through verbatim.
    type ExportFn = (args: { walletId: string; passphrase: string }) => Promise<unknown>;
    let exported: unknown;
    try {
      const api = privy.walletApi as { exportWallet?: ExportFn } | unknown;
      const exportFn = (api && typeof api === "object"
        ? (api as { exportWallet?: ExportFn }).exportWallet
        : undefined) as ExportFn | undefined;
      if (typeof exportFn === "function") {
        exported = await exportFn({ walletId, passphrase });
      } else {
        throw new Error(
          "Wallet export is not enabled for this app. Contact Privy support."
        );
      }
    } catch (e: unknown) {
      const fallback = "Export failed (provider error)";
      const err = (e && typeof e === "object"
        ? (e as { message?: string; response?: { data?: { error?: string } } })
        : undefined) || {};
      const msg = err.response?.data?.error ?? err.message ?? fallback;
      return jerr(502, msg);
    }

    // 7) Return as a downloadable JSON keystore
    const filename = `haven-keystore-${walletId.slice(0, 8)}.json`;
    return new NextResponse(JSON.stringify(exported, null, 2), {
      status: 200,
      headers: {
        "content-type": "application/json",
        "content-disposition": `attachment; filename="${filename}"`,
        "cache-control": "no-store",
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return jerr(500, msg);
  }
}
