// app/settings/page.tsx
"use client";

import type React from "react";

import { useEffect, useMemo, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { useUser } from "@/providers/UserProvider";
import ExportKeysModal from "./ExportKeysModal";

type SaveState = "idle" | "saving" | "saved" | "error";

type AddressForm = {
  line1: string;
  line2: string;
  city: string;
  stateOrProvince: string;
  postalCode: string;
  countryISO: string; // ISO-2
};

export default function SettingsPage() {
  const { user, loading, refresh } = useUser();
  const { user: privyUser } = usePrivy();

  // ------------------------------ form state ------------------------------
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  // optional UI alias (not persisted unless you add to schema)
  const [displayName, setDisplayName] = useState("");

  const [email, setEmail] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");

  const [addr, setAddr] = useState<AddressForm>({
    line1: "",
    line2: "",
    city: "",
    stateOrProvince: "",
    postalCode: "",
    countryISO: "US",
  });

  // initial snapshot for dirty checks
  const [initial, setInitial] = useState<{
    firstName: string;
    lastName: string;
    displayName: string;
    email: string;
    phoneNumber: string;
    addr: AddressForm;
  } | null>(null);

  useEffect(() => {
    if (loading || !user) return;

    setFirstName(user.firstName ?? "");
    setLastName(user.lastName ?? "");
    setDisplayName((user as unknown as { displayName?: string }).displayName ?? "");

    setEmail(user.email ?? "");
    setPhoneNumber((user as unknown as { phoneNumber?: string }).phoneNumber ?? "");

    setAddr({
      line1: (user as unknown as { address?: { line1?: string } }).address?.line1 ?? "",
      line2: (user as unknown as { address?: { line2?: string } }).address?.line2 ?? "",
      city: (user as unknown as { address?: { city?: string } }).address?.city ?? "",
      stateOrProvince:
        (user as unknown as { address?: { stateOrProvince?: string } }).address?.stateOrProvince ?? "",
      postalCode:
        (user as unknown as { address?: { postalCode?: string } }).address?.postalCode ?? "",
      countryISO: user.countryISO ?? "US",
    });

    setInitial({
      firstName: user.firstName ?? "",
      lastName: user.lastName ?? "",
      displayName: (user as unknown as { displayName?: string }).displayName ?? "",
      email: user.email ?? "",
      phoneNumber: (user as unknown as { phoneNumber?: string }).phoneNumber ?? "",
      addr: {
        line1: (user as unknown as { address?: { line1?: string } }).address?.line1 ?? "",
        line2: (user as unknown as { address?: { line2?: string } }).address?.line2 ?? "",
        city: (user as unknown as { address?: { city?: string } }).address?.city ?? "",
        stateOrProvince:
          (user as unknown as { address?: { stateOrProvince?: string } }).address?.stateOrProvince ?? "",
        postalCode:
          (user as unknown as { address?: { postalCode?: string } }).address?.postalCode ?? "",
        countryISO: user.countryISO ?? "US",
      },
    });
  }, [loading, user]);

  // ------------------------------ diff/payload -----------------------------
  const diff = useMemo(() => {
    if (!initial) return null;

    const profileChanged =
      firstName !== initial.firstName ||
      lastName !== initial.lastName ||
      displayName !== initial.displayName ||
      phoneNumber !== initial.phoneNumber;

    const contactChanged = phoneNumber !== initial.phoneNumber;

    const addressChanged =
      addr.line1 !== initial.addr.line1 ||
      addr.line2 !== initial.addr.line2 ||
      addr.city !== initial.addr.city ||
      addr.stateOrProvince !== initial.addr.stateOrProvince ||
      addr.postalCode !== initial.addr.postalCode ||
      addr.countryISO !== initial.addr.countryISO;

    type UpdatePayload = {
      profile?: {
        firstName?: string;
        lastName?: string;
        displayName?: string;
      };
      contact?: {
        email?: string;
        phoneNumber?: string;
      };
      address?:
        | null
        | {
            line1: string;
            line2?: string;
            city: string;
            stateOrProvince: string;
            postalCode: string;
            country: string;
          };
      countryISO?: string;
    };
    const payload: UpdatePayload = {};
    if (profileChanged) {
      payload.profile = {
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        displayName: displayName.trim() || undefined,
      };
    }
    if (contactChanged) {
      payload.contact = {
        phoneNumber: phoneNumber.trim() || undefined,
      };
    }
    if (addressChanged) {
      const everyEmpty =
        !addr.line1.trim() &&
        !addr.line2.trim() &&
        !addr.city.trim() &&
        !addr.stateOrProvince.trim() &&
        !addr.postalCode.trim();

      payload.address = everyEmpty
        ? null
        : {
            line1: addr.line1.trim(),
            line2: addr.line2.trim() || undefined,
            city: addr.city.trim(),
            stateOrProvince: addr.stateOrProvince.trim(),
            postalCode: addr.postalCode.trim(),
            country: addr.countryISO.trim().toUpperCase(),
          };

      payload.countryISO = addr.countryISO.trim().toUpperCase();
    }

    const changed = profileChanged || contactChanged || addressChanged;
    return { changed, payload };
  }, [initial, firstName, lastName, displayName, phoneNumber, addr]);

  // ------------------------------- actions --------------------------------
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const disabled = loading || !user;

  const saveAll = async () => {
    if (!diff?.changed) return;
    try {
      setSaveState("saving");
      const r = await fetch("/api/user/update", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify(diff.payload),
      });
      if (!r.ok) {
        const text = await r.text();
        throw new Error(text || `Save failed (${r.status})`);
      }
      setSaveState("saved");
      await refresh();
      setInitial({
        firstName,
        lastName,
        displayName,
        email,
        phoneNumber,
        addr: { ...addr },
      });
      setTimeout(() => setSaveState("idle"), 900);
    } catch (e) {
      console.error(e);
      setSaveState("error");
      setTimeout(() => setSaveState("idle"), 1300);
    }
  };

  const resetAll = () => {
    if (!initial) return;
    setFirstName(initial.firstName);
    setLastName(initial.lastName);
    setDisplayName(initial.displayName);
    setEmail(initial.email);
    setPhoneNumber(initial.phoneNumber);
    setAddr({ ...initial.addr });
  };

  // Detect any embedded Solana wallet (to enable the button)
  const hasEmbeddedSolana = useMemo(() => {
    const raw = (privyUser as unknown as Record<string, unknown>)?.linkedAccounts as unknown;
    const accounts = Array.isArray(raw) ? (raw as unknown[]) : [];
    if (!accounts.length) return false;
    return accounts.some((acc) => {
      if (!acc || typeof acc !== "object") return false;
      const a = acc as Record<string, unknown>;
      return (
        a.type === "wallet" &&
        a.walletClientType === "privy" &&
        a.chainType === "solana"
      );
    });
  }, [privyUser]);

  // --------------- open/close modal; use a key to remount fresh ------------
  const [exportOpen, setExportOpen] = useState(false);
  const [exportOpenKey, setExportOpenKey] = useState(0);

  const openExport = () => {
    setExportOpenKey((k) => k + 1); // force a fresh mount each time
    setExportOpen(true);
  };

  // ------------------------------ loading UI ------------------------------
  if (loading) {
    return (
      <main className="mx-auto w-full max-w-3xl p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-7 w-40 bg-white/10 rounded" />
          <div className="h-40 w-full bg-white/5 rounded-2xl" />
          <div className="h-40 w-full bg-white/5 rounded-2xl" />
          <div className="h-40 w-full bg-white/5 rounded-2xl" />
        </div>
      </main>
    );
  }

  // ------------------------------- page UI --------------------------------
  return (
    <main className="mx-auto w-full max-w-3xl p-6">
      <div className="relative mb-8">
        {/* Background gradient effects */}
        <div className="absolute -top-20 -left-20 w-40 h-40 bg-[rgb(182,255,62)] opacity-[0.08] rounded-full blur-3xl" />
        <div className="absolute -top-10 -right-20 w-32 h-32 bg-[rgb(182,255,62)] opacity-[0.06] rounded-full blur-2xl" />

        <div className="relative backdrop-blur-sm bg-white/[0.02] border border-white/10 rounded-2xl p-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-foreground mb-2">
                Account Settings
              </h1>
              <p className="text-muted-foreground">
                Manage your Haven account information
              </p>
            </div>
            <div className="flex gap-3">
              <Button
                onClick={resetAll}
                disabled={disabled || !diff?.changed || saveState === "saving"}
                variant="outline"
              >
                Reset Changes
              </Button>
              <Button
                onClick={saveAll}
                disabled={disabled || !diff?.changed || saveState === "saving"}
                variant="default"
              >
                {saveState === "saving" ? "Saving…" : "Save Changes"}
              </Button>
              <SaveBadge state={saveState} />
            </div>
          </div>
        </div>
      </div>

      {/* Profile */}
      <Card title="Personal Information" icon="👤">
        <div className="grid gap-6 md:grid-cols-2">
          <Field label="First Name">
            <input
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              disabled={disabled}
              className="input"
              placeholder="Enter your first name"
            />
          </Field>
          <Field label="Last Name">
            <input
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              disabled={disabled}
              className="input"
              placeholder="Enter your last name"
            />
          </Field>
          <Field label="Phone Number (Optional)">
            <input
              inputMode="tel"
              value={phoneNumber}
              onChange={(e) => setPhoneNumber(e.target.value)}
              disabled={disabled}
              className="input"
              placeholder="+1 (555) 123-4567"
            />
          </Field>
          <div className="md:col-span-2">
            <Field label="Display Name (Optional)">
              <input
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                disabled={disabled}
                className="input"
                placeholder={"How you\u2019d like to be addressed"}
              />
            </Field>
          </div>
        </div>
      </Card>

      {/* Address */}
      <Card title="Mailing Address" icon="🏠">
        <div className="grid gap-6">
          <Field label="Street Address">
            <input
              value={addr.line1}
              onChange={(e) =>
                setAddr((s) => ({ ...s, line1: e.target.value }))
              }
              disabled={disabled}
              className="input"
              placeholder="123 Main Street"
            />
          </Field>
          <Field label="Apartment, Suite, etc. (Optional)">
            <input
              value={addr.line2}
              onChange={(e) =>
                setAddr((s) => ({ ...s, line2: e.target.value }))
              }
              disabled={disabled}
              className="input"
              placeholder="Apt 4B, Suite 200, etc."
            />
          </Field>
          <div className="grid gap-6 md:grid-cols-3">
            <Field label="City">
              <input
                value={addr.city}
                onChange={(e) =>
                  setAddr((s) => ({ ...s, city: e.target.value }))
                }
                disabled={disabled}
                className="input"
                placeholder="New York"
              />
            </Field>
            <Field label="State / Province">
              <input
                value={addr.stateOrProvince}
                onChange={(e) =>
                  setAddr((s) => ({ ...s, stateOrProvince: e.target.value }))
                }
                disabled={disabled}
                className="input"
                placeholder="NY"
              />
            </Field>
            <Field label="ZIP / Postal Code">
              <input
                value={addr.postalCode}
                onChange={(e) =>
                  setAddr((s) => ({ ...s, postalCode: e.target.value }))
                }
                disabled={disabled}
                className="input"
                placeholder="10001"
              />
            </Field>
          </div>
          <Field label="Country">
            <input
              value={addr.countryISO}
              onChange={(e) =>
                setAddr((s) => ({
                  ...s,
                  countryISO: e.target.value.toUpperCase(),
                }))
              }
              disabled={disabled}
              className="input"
              placeholder="US"
              maxLength={2}
            />
          </Field>
        </div>
      </Card>

      {/* Export Account Recovery Information */}
      <Card title="Account Recovery" icon="🔐">
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Your account recovery information allows you to restore access to
            your Haven account from another device. This information is highly
            sensitive and should be stored securely offline.
          </p>
          <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-xl">
            <p className="text-sm text-red-200">
              <strong>Security Warning:</strong> Never share your recovery
              information with anyone. Haven will never ask for this
              information. Anyone with access to this data can control your
              account.
            </p>
          </div>
          <Button
            onClick={openExport}
            disabled={disabled || !hasEmbeddedSolana}
            variant="outline"
            className="w-full sm:w-auto bg-transparent"
          >
            Export Recovery Information
          </Button>
          {!hasEmbeddedSolana && (
            <p className="text-sm text-muted-foreground">
              No recovery information available for this account type.
            </p>
          )}
        </div>
      </Card>

      {exportOpen && (
        <ExportKeysModal
          key={exportOpenKey}
          onClose={() => setExportOpen(false)}
        />
      )}
    </main>
  );
}

/* Updated UI helpers with Haven's design system */
function Card({
  title,
  icon,
  children,
}: {
  title: string;
  icon?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-8 backdrop-blur-sm bg-white/[0.02] border border-white/10 rounded-2xl p-6 hover:bg-white/[0.03] transition-colors">
      <div className="flex items-center gap-3 mb-6">
        {icon && <span className="text-xl">{icon}</span>}
        <h2 className="text-xl font-semibold text-foreground">{title}</h2>
      </div>
      {children}
    </section>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-2 block text-sm font-medium text-foreground/90">
        {label}
      </span>
      {children}
    </label>
  );
}

function Button({
  children,
  className = "",
  variant = "default",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  className?: string;
  variant?: "default" | "outline";
}) {
  const baseClasses =
    "rounded-xl px-6 py-3 font-medium transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed";
  const variantClasses = {
    default:
      "bg-[rgb(182,255,62)] text-black hover:bg-[rgb(182,255,62)]/90 shadow-lg hover:shadow-xl",
    outline:
      "border border-white/20 text-foreground hover:bg-white/10 backdrop-blur-sm",
  };

  return (
    <button
      {...props}
      className={`${baseClasses} ${variantClasses[variant]} ${className}`}
    >
      {children}
    </button>
  );
}

function SaveBadge({ state }: { state: SaveState }) {
  if (state === "saved")
    return (
      <div className="flex items-center gap-2 px-3 py-1 bg-green-500/20 border border-green-500/30 rounded-lg">
        <div className="w-2 h-2 bg-green-400 rounded-full"></div>
        <span className="text-xs text-green-400 font-medium">Saved</span>
      </div>
    );
  if (state === "error")
    return (
      <div className="flex items-center gap-2 px-3 py-1 bg-red-500/20 border border-red-500/30 rounded-lg">
        <div className="w-2 h-2 bg-red-400 rounded-full"></div>
        <span className="text-xs text-red-400 font-medium">Error</span>
      </div>
    );
  if (state === "saving")
    return (
      <div className="flex items-center gap-2 px-3 py-1 bg-[rgb(182,255,62)]/20 border border-[rgb(182,255,62)]/30 rounded-lg">
        <div className="w-2 h-2 bg-[rgb(182,255,62)] rounded-full animate-pulse"></div>
        <span className="text-xs text-[rgb(182,255,62)] font-medium">
          Saving…
        </span>
      </div>
    );
  return null;
}
