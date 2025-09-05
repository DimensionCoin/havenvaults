// app/api/user/update/route.ts
import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { connect } from "@/lib/db";
import User, { type Address } from "@/models/User";
import { verifySession } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** ---- Schemas (all optional/partial) ---- */
const ProfileSchema = z.object({
  firstName: z.string().trim().max(100).optional(),
  lastName: z.string().trim().max(100).optional(),
  // You don’t persist displayName in Mongo (optional UI alias),
  // but accept it so the client can send it; we just ignore it.
  displayName: z.string().trim().max(100).optional(),
});

const ContactSchema = z.object({
  email: z.string().email().trim().toLowerCase().optional(),
  phoneNumber: z.string().trim().max(40).optional(), // nullable by omission
});

const AddressSchema = z
  .object({
    line1: z.string().trim().min(1),
    line2: z.string().trim().optional(),
    city: z.string().trim().min(1),
    stateOrProvince: z.string().trim().min(1),
    postalCode: z.string().trim().min(1),
    country: z.string().trim().length(2), // ISO-2
  })
  .strict();

const BodySchema = z.object({
  profile: ProfileSchema.optional(),
  contact: ContactSchema.optional(),
  // address: pass an object to set/update, or null to clear
  address: AddressSchema.nullable().optional(),
  // keep countryISO in sync if you want to set it independently
  countryISO: z.string().trim().length(2).optional(),
});

/** ---- Helpers ---- */
function jerr(status: number, error: string, details?: unknown) {
  return NextResponse.json(
    { error, ...(details ? { details } : {}) },
    { status }
  );
}

/** ---- PATCH (the one your UI calls) ---- */
export async function PATCH(req: NextRequest) {
  try {
    // Auth
    const cookie = req.cookies.get("__session")?.value;
    const claims = cookie ? verifySession(cookie) : null;
    if (!claims) return jerr(401, "Unauthorized");

    // Parse body
    const raw = await req.json().catch(() => ({}));
    const parsed = BodySchema.safeParse(raw);
    if (!parsed.success)
      return jerr(400, "Invalid body", parsed.error.flatten());
    const { profile, contact, address, countryISO } = parsed.data;

    await connect();
    const user = await User.findById(claims.userId);
    if (!user) return jerr(404, "User not found");

    /** ---- Apply changes safely ---- */

    // Profile
    if (profile) {
      if (profile.firstName !== undefined)
        user.firstName = profile.firstName || undefined;
      if (profile.lastName !== undefined)
        user.lastName = profile.lastName || undefined;
      // displayName ignored (not in schema) — keep for future if you add it
    }

    // Contact
    if (contact) {
      if (contact.email !== undefined && contact.email !== user.email) {
        // Ensure uniqueness
        const dup = await User.findOne({ email: contact.email.toLowerCase() });
        if (dup && String(dup._id) !== String(user._id)) {
          return jerr(409, "Email already in use");
        }
        user.email = contact.email.toLowerCase();
        // you may also want to reset kyc or mark email-unverified here
      }
      if (contact.phoneNumber !== undefined) {
        // phoneNumber is select:false in schema; still writeable here
        (user as unknown as { phoneNumber?: string }).phoneNumber =
          contact.phoneNumber || undefined;
      }
    }

    // Address + countryISO
    if (address !== undefined) {
      if (address === null) {
        (user as unknown as { address?: Address }).address = undefined;
      } else {
        const addr: Address = {
          line1: address.line1,
          line2: address.line2 || "",
          city: address.city,
          stateOrProvince: address.stateOrProvince,
          postalCode: address.postalCode,
          country: address.country.toUpperCase(),
        };
        (user as unknown as { address?: Address }).address = addr;
        user.countryISO = address.country.toUpperCase();
      }
    }
    if (countryISO !== undefined) {
      user.countryISO = countryISO.toUpperCase();
    }

    await user.save();

    // Return a minimal public view (mirror your /api/user/me shape)
    const result = {
      id: user.id,
      privyId: user.privyId,
      email: user.email,
      firstName: user.firstName ?? null,
      lastName: user.lastName ?? null,
      displayName:
        (user as unknown as { displayName?: string }).displayName ?? null, // likely null unless you add to schema
      countryISO: user.countryISO ?? null,
      displayCurrency: user.displayCurrency,
      status: user.status,
      kycStatus: user.kycStatus,
      riskLevel: user.riskLevel,
      features: user.features,
      depositWallet: user.depositWallet ?? null,
      savingsWallet: user.savingsWallet ?? null,
      savingsConsent: user.savingsConsent ?? undefined,
      createdAt: user.createdAt?.toISOString(),
      updatedAt: user.updatedAt?.toISOString(),
      // address / phoneNumber are select:false normally; omit from public response
    };

    return NextResponse.json(result, { status: 200 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return jerr(500, msg);
  }
}

/** Optional: allow OPTIONS for any preflight (if you ever send custom headers) */
export async function OPTIONS() {
  return NextResponse.json({ ok: true }, { status: 200 });
}
