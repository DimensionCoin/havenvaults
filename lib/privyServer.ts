import "server-only";
import { PrivyClient } from "@privy-io/server-auth";

const APP_ID = process.env.PRIVY_APP_ID!;
const SECRET = process.env.PRIVY_SECRET_KEY!;
const AUTH_PRIVKEY_B64 = process.env.PRIVY_AUTH_PRIVATE_KEY_B64!;

if (!APP_ID || !SECRET || !AUTH_PRIVKEY_B64) {
  throw new Error("Missing Privy env vars");
}

export function getPrivy() {
  const client = new PrivyClient(APP_ID, SECRET);
  // This makes the SDK add the privy-authorization-signature header for you.
  try {
    client.walletApi.updateAuthorizationKey(AUTH_PRIVKEY_B64);
  } catch {
    // noop: some SDK versions expose the method on walletsApi
  }
  // Fallback for older/newer SDK surface shapes without using ts-ignore/any
  type WalletsApiShape = { updateAuthorizationKey: (key: string) => void };
  type MaybeHasWalletsApi = { walletsApi?: WalletsApiShape };
  const withApi = client as unknown as MaybeHasWalletsApi;
  const alt = withApi.walletsApi;
  if (alt && typeof alt.updateAuthorizationKey === "function") {
    alt.updateAuthorizationKey(AUTH_PRIVKEY_B64);
  }
  return client;
}
