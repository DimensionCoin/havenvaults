// app/api/auth/onboarding/route.ts
import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { z } from "zod";

import { connect } from "@/lib/db";
import User, { type Address } from "@/models/User";
import { verifySession } from "@/lib/auth";
import { privy, extractEmail, extractEmbeddedSolana } from "@/lib/privy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TOS_VERSION = process.env.TOS_VERSION ?? "2025-01";
const PRIVACY_VERSION = process.env.PRIVACY_VERSION ?? "2025-01";

/** Validation */
const AddressSchema = z.object({
  line1: z.string().min(1),
  line2: z.string().optional().default(""),
  city: z.string().min(1),
  stateOrProvince: z.string().min(1),
  postalCode: z.string().min(1),
  country: z
    .string()
    .length(2)
    .transform((s) => s.toUpperCase()),
});

const OnboardingSchema = z.object({
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  countryISO: z
    .string()
    .length(2)
    .transform((s) => s.toUpperCase()),
  // FIX: .toUpperCase() isn't a Zod method; use transform()
  displayCurrency: z
    .string()
    .length(3)
    .transform((s) => s.toUpperCase())
    .optional(),
  phoneNumber: z.string().min(6).optional(),
  dob: z.string().refine((v) => !Number.isNaN(Date.parse(v)), "Invalid date"),
  address: AddressSchema,
  consents: z
    .object({ tos: z.boolean().optional(), privacy: z.boolean().optional() })
    .optional(),
});

// Local types to keep TS simple for Turbopack
type DepositWallet = {
  walletId?: string;
  address?: string;
  chainType: "solana";
};

type ConsentEntry = {
  type: "tos" | "privacy" | "risk" | "savings";
  version: string;
  acceptedAt: Date;
};

export async function POST(req: NextRequest) {
  try {
    // 1) Authenticate via your app session cookie FROM REQUEST
    const sessionToken = req.cookies.get("__session")?.value;
    const claims = sessionToken ? verifySession(sessionToken) : null;
    if (!claims) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const { privyId, userId } = claims;

    // 2) Parse & validate body
    const body = await req.json().catch(() => ({}));
    const parsed = OnboardingSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", details: parsed.error.flatten() },
        { status: 422 }
      );
    }
    const data = parsed.data;

    // 3) DB lookup (by id, fallback to privyId)
    await connect();
    let user = await User.findById(userId);
    if (!user) {
      user = await User.findOne({ privyId });
      if (!user) {
        // Seed a lightweight record from Privy if somehow missing
        const pUser = await privy.getUser(privyId);
        const emailLower = extractEmail(pUser) ?? undefined;
        const maybeWallet = extractEmbeddedSolana(pUser) ?? undefined;

        user = await User.create({
          privyId,
          email: emailLower,
          status: "pending",
          kycStatus: "none",
          displayCurrency: data.displayCurrency ?? "USD",
          depositWallet: maybeWallet ?? undefined,
        });
      }
    }

    // 4) Ensure embedded Solana wallet exists; create if missing
    if (!user.depositWallet?.address) {
      let sol = extractEmbeddedSolana(await privy.getUser(privyId));
      if (!sol) {
        const created = await privy.walletApi.createWallet({
          chainType: "solana",
          owner: { userId: privyId },
          idempotencyKey: randomUUID(),
        });

        // best effort: re-fetch so shapes match your extractor; fallback to create response
        sol =
          extractEmbeddedSolana(await privy.getUser(privyId)) ??
          ({
            walletId: created.id,
            address: created.address,
            chainType: "solana" as const,
          } as const);
      }

      const depositWallet: DepositWallet = {
        walletId: sol.walletId,
        address: sol.address,
        chainType: "solana",
      };
      user.depositWallet = depositWallet;
    }

    // 5) Apply KYC/profile fields
    user.firstName = data.firstName;
    user.lastName = data.lastName;
    user.countryISO = data.countryISO;
    if (data.displayCurrency) user.displayCurrency = data.displayCurrency;
    if (data.phoneNumber) user.phoneNumber = data.phoneNumber;
    user.dob = new Date(data.dob);
    const addr: Address = {
      line1: data.address.line1,
      line2: data.address.line2 ?? "",
      city: data.address.city,
      stateOrProvince: data.address.stateOrProvince,
      postalCode: data.address.postalCode,
      country: data.address.country,
    };
    user.address = addr;

    // 6) Consents (idempotent per version)
    if (!Array.isArray(user.consents)) {
      user.consents = [] as unknown as typeof user.consents;
    }
    const list = user.consents as unknown as ConsentEntry[];
    const pushOnce = (type: "tos" | "privacy", version: string) => {
      if (!list.some((c) => c.type === type && c.version === version)) {
        list.push({ type, version, acceptedAt: new Date() });
      }
    };
    if (data.consents?.tos) pushOnce("tos", TOS_VERSION);
    if (data.consents?.privacy) pushOnce("privacy", PRIVACY_VERSION);

    // 7) Instant-approval gate (name + full address + DOB already validated above)
    const hasFullAddress =
      !!data.address?.line1 &&
      !!data.address?.city &&
      !!data.address?.stateOrProvince &&
      !!data.address?.postalCode &&
      !!data.address?.country &&
      data.address.country.length === 2;

    const readyForInstantApproval = hasFullAddress && !!data.dob;

    user.kycStatus = readyForInstantApproval ? "approved" : "pending";
    user.status = readyForInstantApproval ? "active" : "pending";

    await user.save();

    // 8) Return minimal safe payload
    return NextResponse.json(
      {
        ok: true,
        kycStatus: user.kycStatus,
        status: user.status,
        user: {
          id: user.id,
          privyId: user.privyId,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          countryISO: user.countryISO,
          displayCurrency: user.displayCurrency,
          phoneNumber: user.phoneNumber ?? null,
          depositWallet: user.depositWallet ?? null,
        },
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err) {
    console.error("Onboarding error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
