// app/settings/page.tsx
"use client";

import type React from "react";
import { useEffect, useMemo, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { useUser } from "@/providers/UserProvider";
import ExportKeysModal from "./ExportKeysModal";
import { toast } from "react-hot-toast"; // ✅ toasts

type SaveState = "idle" | "saving" | "saved" | "error";

type AddressForm = {
  line1: string;
  line2: string;
  city: string;
  stateOrProvince: string;
  postalCode: string;
  countryISO: string; // ISO-2
};

const CURRENCIES = ["USD", "CAD", "EUR", "GBP", "AUD"] as const;
type DisplayCurrency = (typeof CURRENCIES)[number];
type RiskLevel = "low" | "medium" | "high";

export default function SettingsPage() {
  const { user, loading, refresh } = useUser();
  const { user: privyUser } = usePrivy();

  // ------------------------------ form state ------------------------------
  // Keep fields empty by default and use placeholders from `user`
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");

  const [addr, setAddr] = useState<AddressForm>({
    line1: "",
    line2: "",
    city: "",
    stateOrProvince: "",
    postalCode: "",
    countryISO: "",
  });

  const [displayCurrency, setDisplayCurrency] = useState<DisplayCurrency | "">(
    ""
  );
  const [riskLevel, setRiskLevel] = useState<RiskLevel | "">("");

  // --- Export modal state ---
  const [exportOpen, setExportOpen] = useState(false);
  const [exportOpenKey, setExportOpenKey] = useState(0);
  const openExport = () => {
    setExportOpenKey((k) => k + 1);
    setExportOpen(true);
  };

  // Reset to blank whenever user changes (so placeholders reflect latest)
  useEffect(() => {
    setFirstName("");
    setLastName("");
    setDisplayName("");
    setPhoneNumber("");
    setAddr({
      line1: "",
      line2: "",
      city: "",
      stateOrProvince: "",
      postalCode: "",
      countryISO: "",
    });
    setDisplayCurrency("");
    setRiskLevel("");
  }, [user?.id]);

  // ------------------------------ diff/payload -----------------------------
  const diff = useMemo(() => {
    if (!user) return null;

    // Use the *current user values* as baseline; only send if the user picked something
    const payload: {
      profile?: { firstName?: string; lastName?: string; displayName?: string };
      contact?: { phoneNumber?: string };
      address?: null | {
        line1: string;
        line2?: string;
        city: string;
        stateOrProvince: string;
        postalCode: string;
        country: string; // ISO-2
      };
      countryISO?: string; // keep in sync with address.country
      displayCurrency?: DisplayCurrency;
      riskLevel?: RiskLevel;
    } = {};

    let changed = false;

    // Profile
    if (firstName || lastName || displayName) {
      const pf: Record<string, string | undefined> = {};
      if (firstName && firstName !== (user.firstName ?? "")) {
        pf.firstName = firstName.trim();
      }
      if (lastName && lastName !== (user.lastName ?? "")) {
        pf.lastName = lastName.trim();
      }
      if (
        displayName &&
        displayName !==
          ((user as unknown as { displayName?: string }).displayName ?? "")
      ) {
        pf.displayName = displayName.trim() || undefined;
      }
      if (Object.keys(pf).length) {
        payload.profile = pf;
        changed = true;
      }
    }

    // Phone (email is intentionally not editable)
    if (
      phoneNumber &&
      phoneNumber !==
        ((user as unknown as { phoneNumber?: string })?.phoneNumber ?? "")
    ) {
      payload.contact = { phoneNumber: phoneNumber.trim() || undefined };
      changed = true;
    }

    // Address: if the user typed anything in any address field, we either send a full address or null
    const anyAddrInput =
      addr.line1 ||
      addr.line2 ||
      addr.city ||
      addr.stateOrProvince ||
      addr.postalCode ||
      addr.countryISO;

    if (anyAddrInput) {
      const everyEmpty =
        !addr.line1.trim() &&
        !addr.line2.trim() &&
        !addr.city.trim() &&
        !addr.stateOrProvince.trim() &&
        !addr.postalCode.trim();

      if (everyEmpty) {
        payload.address = null;
        payload.countryISO = user.countryISO ?? undefined;
        changed = true;
      } else {
        const country = (addr.countryISO || user.countryISO || "US")
          .trim()
          .toUpperCase();

        const currentAddr = (
          user as unknown as {
            address?: {
              line1?: string;
              line2?: string;
              city?: string;
              stateOrProvince?: string;
              postalCode?: string;
            };
          }
        ).address;
        payload.address = {
          line1: (addr.line1 || currentAddr?.line1 || "").trim(),
          line2: (addr.line2 || currentAddr?.line2 || "").trim() || undefined,
          city: (addr.city || currentAddr?.city || "").trim(),
          stateOrProvince: (
            addr.stateOrProvince || currentAddr?.stateOrProvince || ""
          ).trim(),
          postalCode: (addr.postalCode || currentAddr?.postalCode || "").trim(),
          country,
        };
        payload.countryISO = country;
        changed = true;
      }
    }

    // Display currency
    if (displayCurrency && displayCurrency !== user.displayCurrency) {
      payload.displayCurrency = displayCurrency;
      changed = true;
    }

    // Risk level
    if (riskLevel && riskLevel !== user.riskLevel) {
      payload.riskLevel = riskLevel;
      changed = true;
    }

    return { changed, payload };
  }, [
    user,
    firstName,
    lastName,
    displayName,
    phoneNumber,
    addr,
    displayCurrency,
    riskLevel,
  ]);

  // ------------------------------- actions --------------------------------
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const disabled = loading || !user;

  const saveAll = async () => {
    if (!diff?.changed) {
      toast("No changes to save"); // uses your theme
      return;
    }

    setSaveState("saving");

    const run = async () => {
      const r = await fetch("/api/user/update", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify(diff.payload),
      });
      if (!r.ok) {
        const text = await r.text();
        // surface server error message if available
        throw new Error(
          text || (r.statusText || `Save failed (${r.status})`).toString()
        );
      }

      // refresh user, then clear form fields so placeholders reflect latest data
      await refresh();
      setFirstName("");
      setLastName("");
      setDisplayName("");
      setPhoneNumber("");
      setAddr({
        line1: "",
        line2: "",
        city: "",
        stateOrProvince: "",
        postalCode: "",
        countryISO: "",
      });
      setDisplayCurrency("");
      setRiskLevel("");
    };

    await toast.promise(run(), {
      loading: "Saving changes…",
      success: "Settings saved",
      error: (e) => e.message || "Save failed",
    });

    // flip the local UI badge
    setSaveState("saved");
    setTimeout(() => setSaveState("idle"), 900);
  };

  const resetAll = () => {
    // Just clear local edits — placeholders keep showing current user values
    setFirstName("");
    setLastName("");
    setDisplayName("");
    setPhoneNumber("");
    setAddr({
      line1: "",
      line2: "",
      city: "",
      stateOrProvince: "",
      postalCode: "",
      countryISO: "",
    });
    setDisplayCurrency("");
    setRiskLevel("");
    toast("Changes reset"); // nice little confirmation
  };

  // Detect embedded Solana wallet (unchanged)
  const hasEmbeddedSolana = useMemo(() => {
    const raw = (privyUser as unknown as Record<string, unknown>)
      ?.linkedAccounts as unknown;
    const accounts = Array.isArray(raw) ? (raw as unknown[]) : [];
    if (!accounts.length) return false;
    return accounts.some((a) => {
      if (!a || typeof a !== "object") return false;
      const o = a as Record<string, unknown>;
      return (
        o.type === "wallet" &&
        o.walletClientType === "privy" &&
        o.chainType === "solana"
      );
    });
  }, [privyUser]);

  // ------------------------------ loading UI ------------------------------
  if (loading) {
    return (
      <main className="mx-auto w-full max-w-4xl p-6">
        <HeaderSkeleton />
        <SectionSkeleton />
        <SectionSkeleton />
        <SectionSkeleton />
      </main>
    );
  }

  // ------------------------------- page UI --------------------------------
  return (
    <main className="mx-auto w-full max-w-4xl p-6">
      {/* Page header with identity + status badges */}
      <section className="mb-8 rounded-2xl border border-white/10 bg-white/[0.02] backdrop-blur-sm">
        <div className="flex flex-col gap-6 p-6 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[rgb(182,255,62)]/20 text-[rgb(182,255,62)] font-bold">
              {getInitials(
                (user?.firstName ?? "") + " " + (user?.lastName ?? "")
              )}
            </div>
            <div>
              <h1 className="text-2xl font-bold text-foreground">
                {user?.firstName || user?.lastName
                  ? `${user?.firstName ?? ""} ${user?.lastName ?? ""}`.trim()
                  : "Your Haven Account"}
              </h1>
              <p className="text-sm text-muted-foreground">
                {user?.email}
                {user?.displayCurrency ? (
                  <>
                    {" "}
                    • Display:{" "}
                    <span className="font-medium">{user.displayCurrency}</span>
                  </>
                ) : null}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge
              label={`Status: ${user?.status ?? "pending"}`}
              tone={user?.status === "active" ? "green" : "amber"}
            />
            <StatusBadge
              label={`KYC: ${user?.kycStatus ?? "none"}`}
              tone={
                user?.kycStatus === "approved"
                  ? "green"
                  : user?.kycStatus === "pending"
                  ? "amber"
                  : "slate"
              }
            />
            <StatusBadge
              label={`Risk: ${user?.riskLevel ?? "low"}`}
              tone={
                user?.riskLevel === "high"
                  ? "red"
                  : user?.riskLevel === "medium"
                  ? "amber"
                  : "slate"
              }
            />
          </div>
        </div>

        {/* Sticky actions */}
        <div className="flex flex-col gap-3 border-t border-white/10 p-4 md:flex-row md:items-center md:justify-end">
          <div className="flex items-center gap-2">
            <Button
              onClick={resetAll}
              disabled={disabled || saveState === "saving"}
              variant="outline"
              className="px-5 py-2 bg-transparent"
            >
              Reset Changes
            </Button>
            <Button
              onClick={saveAll}
              disabled={disabled || !diff?.changed || saveState === "saving"}
              variant="default"
              className="px-5 py-2"
            >
              {saveState === "saving" ? "Saving…" : "Save Changes"}
            </Button>
            <SaveBadge state={saveState} />
          </div>
        </div>
      </section>

      {/* Profile (Name + Phone + Display Name + Email read-only) */}
      <Card title="Personal Information" icon="👤">
        <div className="grid gap-6 md:grid-cols-2">
          <Field label="First Name">
            <input
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              disabled={disabled}
              className="input"
              placeholder={user?.firstName || "Enter your first name"}
            />
          </Field>
          <Field label="Last Name">
            <input
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              disabled={disabled}
              className="input"
              placeholder={user?.lastName || "Enter your last name"}
            />
          </Field>

          <Field label="Email (read-only)">
            <input
              value={user?.email ?? ""}
              readOnly
              disabled
              className="input opacity-70"
            />
          </Field>

          <Field label="Phone Number (Optional)">
            <input
              inputMode="tel"
              value={phoneNumber}
              onChange={(e) => setPhoneNumber(e.target.value)}
              disabled={disabled}
              className="input"
              placeholder={
                ((user as unknown as { phoneNumber?: string }).phoneNumber ??
                  "") || "+1 (555) 123-4567"
              }
            />
          </Field>

          <div className="md:col-span-2">
            <Field label="Display Name (Optional)">
              <input
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                disabled={disabled}
                className="input"
                placeholder={
                  ((user as unknown as { displayName?: string }).displayName ??
                    "") ||
                  "How you'd like to be addressed"
                }
              />
            </Field>
          </div>
        </div>
      </Card>

      {/* Preferences: Display Currency + Risk Level */}
      <Card title="Preferences" icon="⚙️">
        <div className="grid gap-6 md:grid-cols-2">
          <Field label="Display Currency">
            <select
              value={displayCurrency}
              onChange={(e) =>
                setDisplayCurrency(e.target.value as DisplayCurrency)
              }
              disabled={disabled}
              className="input"
            >
              <option value="">
                {user?.displayCurrency
                  ? `Current: ${user.displayCurrency}`
                  : "Select currency"}
              </option>
              {CURRENCIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Risk Level">
            <select
              value={riskLevel}
              onChange={(e) => setRiskLevel(e.target.value as RiskLevel)}
              disabled={disabled}
              className="input"
            >
              <option value="">
                {user?.riskLevel
                  ? `Current: ${user.riskLevel}`
                  : "Select risk level"}
              </option>
              <option value="low">low</option>
              <option value="medium">medium</option>
              <option value="high">high</option>
            </select>
          </Field>
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
              placeholder={
                (
                  user as unknown as {
                    address?: { line1?: string };
                  }
                ).address?.line1 || "123 Main Street"
              }
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
              placeholder={
                (
                  user as unknown as {
                    address?: { line2?: string };
                  }
                ).address?.line2 || "Apt 4B, Suite 200"
              }
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
                placeholder={
                  (
                    user as unknown as {
                      address?: { city?: string };
                    }
                  ).address?.city || "New York"
                }
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
                placeholder={
                  (
                    user as unknown as {
                      address?: { stateOrProvince?: string };
                    }
                  ).address?.stateOrProvince || "NY / ON"
                }
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
                placeholder={
                  (
                    user as unknown as {
                      address?: { postalCode?: string };
                    }
                  ).address?.postalCode || "10001"
                }
              />
            </Field>
          </div>
          <Field label="Country (ISO-2)">
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
              placeholder={user?.countryISO || "US"}
              maxLength={2}
            />
          </Field>
        </div>
      </Card>

      {/* Security / Recovery */}
      <Card title="Security & Recovery" icon="🔐">
        <div className="grid gap-6 md:grid-cols-2">
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Your account recovery information allows you to restore access to
              your Haven account from another device. Store it securely offline.
            </p>
            <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-xl">
              <p className="text-sm text-red-200">
                <strong>Security Warning:</strong> Never share recovery
                information. Anyone with access can control your account.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button
                onClick={openExport}
                disabled={disabled || !hasEmbeddedSolana}
                variant="outline"
                className="bg-transparent"
              >
                Export Recovery Information
              </Button>
              {!hasEmbeddedSolana && (
                <span className="text-xs text-muted-foreground">
                  No recovery data available for this account type.
                </span>
              )}
            </div>
          </div>

          <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
            <h3 className="mb-3 text-sm font-semibold text-foreground/90">
              Login & Compliance
            </h3>
            <ul className="space-y-2 text-sm text-muted-foreground">
              <li>
                • Login Provider:{" "}
                <span className="font-medium">
                  {privyUser ? "Privy" : "Not connected"}
                </span>
              </li>
              <li>
                • KYC Status:{" "}
                <span className="font-medium">{user?.kycStatus ?? "none"}</span>
              </li>
              <li>
                • Account Status:{" "}
                <span className="font-medium">{user?.status ?? "pending"}</span>
              </li>
              <li>
                • Display Currency:{" "}
                <span className="font-medium">
                  {user?.displayCurrency ?? "—"}
                </span>
              </li>
              <li>
                • Risk Level:{" "}
                <span className="font-medium">{user?.riskLevel ?? "—"}</span>
              </li>
            </ul>
          </div>
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

/* ---------- UI helpers ---------- */
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
    "rounded-xl font-medium transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap";
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
        <div className="h-2 w-2 rounded-full bg-green-400" />
        <span className="text-xs font-medium text-green-400">Saved</span>
      </div>
    );
  if (state === "error")
    return (
      <div className="flex items-center gap-2 px-3 py-1 bg-red-500/20 border border-red-500/30 rounded-lg">
        <div className="h-2 w-2 rounded-full bg-red-400" />
        <span className="text-xs font-medium text-red-400">Error</span>
      </div>
    );
  if (state === "saving")
    return (
      <div className="flex items-center gap-2 px-3 py-1 bg-[rgb(182,255,62)]/20 border border-[rgb(182,255,62)]/30 rounded-lg">
        <div className="h-2 w-2 rounded-full bg-[rgb(182,255,62)] animate-pulse" />
        <span className="text-xs font-medium text-[rgb(182,255,62)]">
          Saving…
        </span>
      </div>
    );
  return null;
}

function StatusBadge({
  label,
  tone = "slate",
}: {
  label: string;
  tone?: "green" | "amber" | "red" | "slate";
}) {
  const map: Record<string, string> = {
    green:
      "bg-green-500/15 text-green-300 border-green-500/25 shadow-[0_0_20px_rgba(34,197,94,0.2)]",
    amber:
      "bg-amber-500/15 text-amber-200 border-amber-500/25 shadow-[0_0_20px_rgba(245,158,11,0.15)]",
    red: "bg-red-500/15 text-red-200 border-red-500/25 shadow-[0_0_20px_rgba(239,68,68,0.15)]",
    slate:
      "bg-white/10 text-slate-200 border-white/15 shadow-[0_0_20px_rgba(148,163,184,0.08)]",
  };
  return (
    <span
      className={`inline-flex items-center gap-2 rounded-xl border px-3 py-1 text-xs font-medium ${map[tone]}`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current opacity-80" />
      {label}
    </span>
  );
}

function HeaderSkeleton() {
  return (
    <section className="mb-8 rounded-2xl border border-white/10 bg-white/[0.02] p-6">
      <div className="flex items-center gap-4">
        <div className="h-12 w-12 rounded-full bg-white/10 animate-pulse" />
        <div className="space-y-2">
          <div className="h-5 w-40 bg-white/10 rounded animate-pulse" />
          <div className="h-4 w-64 bg-white/10 rounded animate-pulse" />
        </div>
      </div>
    </section>
  );
}
function SectionSkeleton() {
  return (
    <section className="mb-8 rounded-2xl border border-white/10 bg-white/[0.02] p-6">
      <div className="h-6 w-40 bg-white/10 rounded mb-4 animate-pulse" />
      <div className="h-24 w-full bg-white/5 rounded animate-pulse" />
    </section>
  );
}

function getInitials(name: string) {
  const parts = (name || "")
    .split(" ")
    .map((p) => p.trim())
    .filter(Boolean);
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? parts[parts.length - 1][0] ?? "" : "";
  return (first + last).toUpperCase() || "U";
}
