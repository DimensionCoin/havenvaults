import mongoose, { Schema, models, model, InferSchemaType } from "mongoose";

/** ---------- Subtypes ---------- */

export type Address = {
  line1: string;
  line2?: string;
  city: string;
  stateOrProvince: string;
  postalCode: string;
  country: string; // ISO-3166 alpha-2
};

const AddressSchema = new Schema<Address>(
  {
    line1: { type: String, required: true, trim: true },
    line2: { type: String, default: "", trim: true },
    city: { type: String, required: true, trim: true },
    stateOrProvince: { type: String, required: true, trim: true },
    postalCode: { type: String, required: true, trim: true },
    country: {
      type: String,
      required: true,
      uppercase: true,
      minlength: 2,
      maxlength: 2,
    },
  },
  { _id: false }
);

type Consent = {
  type: "tos" | "privacy" | "risk" | "savings";
  version: string;
  acceptedAt: Date;
};

const ConsentSchema = new Schema<Consent>(
  {
    type: { type: String, required: true },
    version: { type: String, required: true },
    acceptedAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

type EmbeddedWallet = {
  walletId?: string; // Privy wallet id
  address?: string; // base58 (Solana)
  chainType: "solana"; // keep open if you add more later
};

const EmbeddedWalletSchema = new Schema<EmbeddedWallet>(
  {
    walletId: { type: String },
    address: { type: String, index: true },
    chainType: { type: String, enum: ["solana"], default: "solana" },
  },
  { _id: false }
);

/** ---------- Main schema ---------- */

const UserSchema = new Schema(
  {
    /** Primary identity (Privy DID) */
    privyId: { type: String, required: true, unique: true, index: true },

    /** Contact / profile */
    email: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      unique: true,
      index: true,
    },

    firstName: { type: String, trim: true },
    lastName: { type: String, trim: true },

    /** Locale / prefs */
    countryISO: {
      type: String,
      uppercase: true,
      minlength: 2,
      maxlength: 2,
      index: true,
    },
    displayCurrency: {
      type: String,
      uppercase: true,
      minlength: 3,
      maxlength: 3,
      default: "USD",
    },

    /** Optional PII (not selected by default) */
    address: { type: AddressSchema, select: false },
    dob: { type: Date, select: false },
    phoneNumber: { type: String, select: false },

    /** Lifecycle */
    status: {
      type: String,
      enum: ["pending", "active", "blocked", "closed"],
      default: "pending",
      index: true,
    },
    kycStatus: {
      type: String,
      enum: ["none", "pending", "approved", "rejected"],
      default: "none",
      index: true,
    },

    /** Risk */
    riskLevel: {
      type: String,
      enum: ["low", "medium", "high"],
      default: "low",
    },
    riskLevelUpdatedAt: { type: Date },

    /** Feature flags */
    features: {
      onramp: { type: Boolean, default: false },
      cards: { type: Boolean, default: false },
      lend: { type: Boolean, default: false },
    },

    /** Wallets */
    depositWallet: { type: EmbeddedWalletSchema, required: false },
    savingsWallet: { type: EmbeddedWalletSchema, required: false },

    /** Savings consent gate (quick flag + recorded in consents[]) */
    savingsConsent: {
      enabled: { type: Boolean, default: false },
      acceptedAt: { type: Date },
      version: { type: String, default: "" },
    },
    
    displayName: { type: String, trim: true },

    /** Legal consents audit trail */
    consents: { type: [ConsentSchema], default: [] },
  },
  {
    timestamps: true,
    versionKey: false, // ← no __v ever created, so no delete needed
    toJSON: {
      virtuals: true,
      transform(_doc, ret: Record<string, any>) {
        // normalize id and strip internals
        ret.id = ret._id?.toString();
        delete ret._id;
        return ret;
      },
    },
    toObject: {
      virtuals: true,
      transform(_doc, ret: Record<string, any>) {
        ret.id = ret._id?.toString();
        delete ret._id;
        return ret;
      },
    },
  }
);

UserSchema.pre("save", function (next) {
  if (this.isModified("email") && this.email)
    this.email = this.email.toLowerCase().trim();
  if (this.isModified("countryISO") && this.countryISO)
    this.countryISO = this.countryISO.toUpperCase();
  if (this.isModified("displayCurrency") && this.displayCurrency)
    this.displayCurrency = this.displayCurrency.toUpperCase();
  if (this.isModified("riskLevel")) this.riskLevelUpdatedAt = new Date();
  next();
});

export type IUser = InferSchemaType<typeof UserSchema>;
export default (models.User as mongoose.Model<IUser>) ||
  model<IUser>("User", UserSchema);
