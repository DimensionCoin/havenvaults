import { verifyClaimToken } from "@/lib/claim-token";
import ClaimAutoFlow from "./ClaimAutoFlow";

type Props = { params: Promise<{ token: string }> };

export default async function ClaimPage({ params }: Props) {
  const { token } = await params;
  const decoded = decodeURIComponent(token);

  const payload = verifyClaimToken(decoded);
  // Do not redirect here; the client flow will show errors and guide the user.
  const recipientEmailExpected = payload?.recipientEmail?.toLowerCase() || null;
  const expiresAt = payload?.expiresAt || null;

  return (
    <main className="mx-auto max-w-lg px-6 py-16">
      <h1 className="text-2xl font-semibold mb-2">Claim your money</h1>
      <p className="text-sm text-muted-foreground mb-6">
        We’ll verify your email with Privy, create your Haven wallet, and
        deliver the funds automatically.
      </p>

      <ClaimAutoFlow
        token={decoded}
        recipientEmailExpected={recipientEmailExpected}
        expiresAt={expiresAt}
      />

      <p className="text-xs text-muted-foreground mt-6">
        If you close this page, you can use the same email link again until it
        expires.
      </p>
    </main>
  );
}
