import "server-only";
import { connect } from "@/lib/db";
import User, { type IUser } from "@/models/User";

export class NotFoundError extends Error {
  constructor(m = "Resource not found") {
    super(m);
    this.name = "NotFoundError";
  }
}
export class ConflictError extends Error {
  constructor(m = "Conflict") {
    super(m);
    this.name = "ConflictError";
  }
}
export class ValidationError extends Error {
  constructor(m = "Validation error") {
    super(m);
    this.name = "ValidationError";
  }
}

export type CreateUserInput = {
  privyId: string; // did:privy:...
  email: string;
  firstName?: string;
  lastName?: string;
  countryISO?: string;
  displayCurrency?: string;
  // wallets at creation time
  depositWallet: { walletId: string; address: string; chainType: "solana" };
  savingsWallet: { walletId: string; address: string; chainType: "solana" };
};

export async function createUserIfMissing(
  input: CreateUserInput
): Promise<IUser> {
  await connect();

  const existing = await User.findOne({ privyId: input.privyId }).lean<IUser>();
  if (existing) return existing;

  // email uniqueness (lowercase)
  const email = input.email.toLowerCase().trim();
  const emailTaken = await User.exists({ email });
  if (emailTaken) throw new ConflictError("Email already registered.");

  const created = await User.create({
    privyId: input.privyId,
    email,
    firstName: input.firstName,
    lastName: input.lastName,
    countryISO: input.countryISO,
    displayCurrency: input.displayCurrency,
    kycStatus: "none",
    status: "active", // mark active on sign-up; you can bump to 'pending' if you add KYC later
    depositWallet: input.depositWallet,
    savingsWallet: input.savingsWallet,
    features: { onramp: true, cards: false, lend: false },
  });

  return created.toObject();
}

export async function enableSavingsConsent(privyId: string, version = "1.0.0") {
  await connect();
  const now = new Date();

  const doc = await User.findOneAndUpdate(
    { privyId },
    {
      $set: {
        "savingsConsent.enabled": true,
        "savingsConsent.acceptedAt": now,
        "savingsConsent.version": version,
      },
      $push: { consents: { type: "savings", version, acceptedAt: now } },
    },
    { new: true }
  ).lean<IUser>();
  if (!doc) throw new NotFoundError("User not found");
  return doc;
}

export async function getUserByPrivyId(privyId: string): Promise<IUser> {
  await connect();
  const doc = await User.findOne({ privyId }).lean<IUser>();
  if (!doc) throw new NotFoundError("User not found");
  return doc;
}
