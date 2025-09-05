// lib/claim-token.ts
import jwt from "jsonwebtoken";

/**
 * SECRET for claim tokens. Add to your env:
 *   CLAIM_TOKEN_SECRET=your-long-random-string
 */
const CLAIM_TOKEN_SECRET = process.env.CLAIM_TOKEN_SECRET!;
if (!CLAIM_TOKEN_SECRET) {
  throw new Error("Missing CLAIM_TOKEN_SECRET");
}

/** Normalized payload your app expects everywhere */
export interface ClaimTokenPayload {
  claimId: string; // ID you stored on EmailClaim.tokenId
  recipientEmail: string; // lowercase email of intended recipient
  expiresAt: string; // ISO string
}

/** Internal: normalize Date | string to ISO string */
function toIsoString(d: Date | string): string {
  return typeof d === "string" ? new Date(d).toISOString() : d.toISOString();
}

/**
 * Sign a claim token.
 * Accepts Date | string for expiresAt, normalizes to ISO, and sets standard JWT `exp`.
 */
export function signClaimToken(input: {
  claimId: string;
  recipientEmail: string;
  expiresAt: Date | string;
}): string {
  const expiresAtIso = toIsoString(input.expiresAt);
  const expSeconds = Math.floor(new Date(expiresAtIso).getTime() / 1000);

  return jwt.sign(
    {
      claimId: input.claimId,
      recipientEmail: input.recipientEmail.toLowerCase(),
      expiresAt: expiresAtIso,
      exp: expSeconds,
    },
    CLAIM_TOKEN_SECRET
  );
}

/**
 * Verify a claim token and normalize to ClaimTokenPayload.
 * Back-compat: also accepts old keys { cid, eml }.
 */
export function verifyClaimToken(token: string): ClaimTokenPayload | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const raw = jwt.verify(token, CLAIM_TOKEN_SECRET) as any;

    const claimId: unknown = raw?.claimId ?? raw?.cid;
    const recipientEmail: unknown =
      (raw?.recipientEmail ?? raw?.eml)?.toLowerCase?.() ??
      raw?.recipientEmail?.toLowerCase?.() ??
      raw?.eml?.toLowerCase?.();

    const expiresAtIso: string | undefined =
      typeof raw?.expiresAt === "string"
        ? new Date(raw.expiresAt).toISOString()
        : typeof raw?.exp === "number"
        ? new Date(raw.exp * 1000).toISOString()
        : undefined;

    if (
      typeof claimId === "string" &&
      typeof recipientEmail === "string" &&
      typeof expiresAtIso === "string"
    ) {
      return { claimId, recipientEmail, expiresAt: expiresAtIso };
    }
    return null;
  } catch {
    return null;
  }
}
