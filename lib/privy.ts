// lib/privy.ts
import { randomUUID } from "crypto";
import { PrivyClient } from "@privy-io/server-auth";

/** ──────────────────────────
 *  Privy client (shared)
 *  ────────────────────────── */
const APP_ID = process.env.PRIVY_APP_ID!;
const SECRET = process.env.PRIVY_SECRET_KEY!;
if (!APP_ID || !SECRET) throw new Error("Missing Privy env vars");

export const privy = new PrivyClient(APP_ID, SECRET);

/** ──────────────────────────
 *  Email helper (kept as-is)
 *  ────────────────────────── */
export function extractEmail(user: unknown): string | undefined {
  const u = (user ?? {}) as Record<string, unknown>;

  // direct: user.email.address
  const emailField = u["email"] as unknown;
  if (emailField && typeof emailField === "object") {
    const addr = (emailField as Record<string, unknown>)["address"];
    if (typeof addr === "string") {
      return addr.toLowerCase().trim();
    }
  }

  // linked accounts: search for an email-like field
  const linkedRaw = u["linkedAccounts"] as unknown;
  const linked = Array.isArray(linkedRaw) ? (linkedRaw as unknown[]) : [];
  for (const a of linked) {
    if (!a || typeof a !== "object") continue;
    const ao = a as Record<string, unknown>;
    const candidate = [ao["email"], ao["emailAddress"], ao["address"]].find(
      (v): v is string => typeof v === "string"
    );
    if (candidate && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(candidate)) {
      return candidate.toLowerCase().trim();
    }
  }
  return undefined;
}

/** ──────────────────────────
 *  Wallet helpers (existing + new)
 *  ────────────────────────── */

// Existing: find a single embedded Solana wallet (first match)
export function extractEmbeddedSolana(
  user: unknown
): { walletId?: string; address?: string; chainType: "solana" } | undefined {
  const u = (user ?? {}) as Record<string, unknown>;
  const accountsRaw = u["linkedAccounts"] as unknown;
  const accounts = Array.isArray(accountsRaw) ? (accountsRaw as unknown[]) : [];

  for (const a of accounts) {
    if (!a || typeof a !== "object") continue;
    const ao = a as Record<string, unknown>;
    const type = (ao["type"] ?? ao["kind"]) as unknown;
    const chain = (ao["chainType"] ?? ao["chain"]) as unknown;
    const client =
      (ao["walletClientType"] ?? ao["clientType"] ?? ao["connectorType"]) as unknown;

    const isWallet = type === "wallet";
    const isSolana = chain === "solana";
    const isEmbedded = client === "embedded" || client === "privy";

    if (isWallet && isSolana && isEmbedded) {
      const walletIdUnknown = ao["walletId"] ?? ao["id"];
      const addressUnknown = ao["address"] ?? ao["walletAddress"];
      const walletId = typeof walletIdUnknown === "string" ? walletIdUnknown : undefined;
      const address = typeof addressUnknown === "string" ? addressUnknown : undefined;
      return { walletId, address, chainType: "solana" };
    }
  }
  return undefined;
}

// NEW: get all embedded Solana wallets (in order they appear)
export function extractAllEmbeddedSolana(
  user: unknown
): Array<{ walletId?: string; address?: string; chainType: "solana" }> {
  const out: Array<{ walletId?: string; address?: string; chainType: "solana" }> = [];
  const u = (user ?? {}) as Record<string, unknown>;
  const accountsRaw = u["linkedAccounts"] as unknown;
  const accounts = Array.isArray(accountsRaw) ? (accountsRaw as unknown[]) : [];

  for (const a of accounts) {
    if (!a || typeof a !== "object") continue;
    const ao = a as Record<string, unknown>;
    const type = (ao["type"] ?? ao["kind"]) as unknown;
    const chain = (ao["chainType"] ?? ao["chain"]) as unknown;
    const client =
      (ao["walletClientType"] ?? ao["clientType"] ?? ao["connectorType"]) as unknown;

    const isWallet = type === "wallet";
    const isSolana = chain === "solana";
    const isEmbedded = client === "embedded" || client === "privy";

    if (isWallet && isSolana && isEmbedded) {
      const walletIdUnknown = ao["walletId"] ?? ao["id"];
      const addressUnknown = ao["address"] ?? ao["walletAddress"];
      const walletId = typeof walletIdUnknown === "string" ? walletIdUnknown : undefined;
      const address = typeof addressUnknown === "string" ? addressUnknown : undefined;
      out.push({ walletId, address, chainType: "solana" });
    }
  }

  return out;
}

/** ──────────────────────────
 *  Ensure/create SECOND embedded Solana wallet
 *  ────────────────────────── */

/**
 * Ensure the user has at least two embedded Solana wallets.
 * Returns the "second" wallet (existing or newly created).
 */
export async function ensureSecondSolanaWalletWithClient(
  client: PrivyClient,
  privyId: string
): Promise<{ walletId?: string; address: string }> {
  if (!client) throw new Error("Privy client required");
  if (!privyId) throw new Error("Missing privyId");

  // 1) read what the user already has
  const pUser = await client.getUser(privyId);
  let wallets = extractAllEmbeddedSolana(pUser).filter((w) => !!w.address);

  // 2) if there are already 2+, return the second one
  if (wallets.length >= 2 && wallets[1]?.address) {
    return {
      walletId: wallets[1].walletId,
      address: wallets[1].address!,
    };
  }

  // 3) otherwise, create another embedded Solana wallet for this user
  const created = await client.walletApi.createWallet({
    chainType: "solana",
    owner: { userId: privyId },
    idempotencyKey: randomUUID(),
  });

  // 4) re-fetch user → normalize via helpers; if still <2, fall back to created
  const refreshed = await client.getUser(privyId);
  wallets = extractAllEmbeddedSolana(refreshed).filter((w) => !!w.address);

  if (wallets.length >= 2 && wallets[1]?.address) {
    return {
      walletId: wallets[1].walletId,
      address: wallets[1].address!,
    };
  }

  return { walletId: created.id, address: created.address };
}

/**
 * Convenience wrapper that uses the shared `privy` instance above.
 * Same return shape as the function-with-client.
 */
export async function ensureSecondSolanaWallet(
  privyId: string
): Promise<{ walletId?: string; address: string }> {
  return ensureSecondSolanaWalletWithClient(privy, privyId);
}
