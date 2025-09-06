// app/api/user/update/route.ts
import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { connect } from "@/lib/db";
import User, { type Address } from "@/models/User";
import { verifySession } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** ---- New enums ---- */
const DisplayCurrencySchema = z.enum(["USD", "CAD", "EUR", "GBP", "AUD"]);
const RiskLevelSchema = z.enum(["low", "medium", "high"]);

/** ---- Schemas (all optional/partial) ---- */
const ProfileSchema = z.object({
  firstName: z.string().trim().max(100).optional(),
  lastName: z.string().trim().max(100).optional(),
  displayName: z.string().trim().max(100).optional(), // not persisted unless you add it later
});

const ContactSchema = z.object({
  // 🚫 We will ignore email on the server even if someone tries to send it.
  // Keep it here or remove it entirely — your call. Keeping it but ignoring adds safety.
  email: z.string().email().trim().toLowerCase().optional(),
  phoneNumber: z.string().trim().max(40).optional(),
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
  address: AddressSchema.nullable().optional(),
  countryISO: z.string().trim().length(2).optional(),
  // ✅ New, both optional
  displayCurrency: DisplayCurrencySchema.optional(),
  riskLevel: RiskLevelSchema.optional(),
});

/** ---- Helpers ---- */
function jerr(status: number, error: string, details?: unknown) {
  return NextResponse.json(
    { error, ...(details ? { details } : {}) },
    { status }
  );
}

/** ---- PATCH ---- */
export async function PATCH(req: NextRequest) {
  try {
    const cookie = req.cookies.get("__session")?.value;
    const claims = cookie ? verifySession(cookie) : null;
    if (!claims) return jerr(401, "Unauthorized");

    const raw = await req.json().catch(() => ({}));
    const parsed = BodySchema.safeParse(raw);
    if (!parsed.success)
      return jerr(400, "Invalid body", parsed.error.flatten());
    const {
      profile,
      contact,
      address,
      countryISO,
      displayCurrency,
      riskLevel,
    } = parsed.data;

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
      // displayName ignored unless you add it to the schema
    }

    // Contact (🚫 ignore email changes)
    if (contact) {
      if (contact.phoneNumber !== undefined) {
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

    // ✅ New: displayCurrency + riskLevel
    if (displayCurrency !== undefined) {
      user.displayCurrency = displayCurrency;
    }
    if (riskLevel !== undefined) {
      user.riskLevel = riskLevel;
    }

    await user.save();

    const result = {
      id: user.id,
      privyId: user.privyId,
      email: user.email,
      firstName: user.firstName ?? null,
      lastName: user.lastName ?? null,
      displayName:
        (user as unknown as { displayName?: string }).displayName ?? null,
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
    };

    return NextResponse.json(result, { status: 200 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return jerr(500, msg);
  }
}

export async function OPTIONS() {
  return NextResponse.json({ ok: true }, { status: 200 });
}
