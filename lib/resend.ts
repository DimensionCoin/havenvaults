// lib/resend.ts
import { Resend } from "resend";

const RESEND_API_KEY = process.env.RESEND_API_KEY || "";
const FROM_EMAIL =
  process.env.EMAIL_FROM || "Haven Vaults <transfer@havenvaults.com>";
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

// Create client only if key is present (dev safe)
const resend: Resend | null = RESEND_API_KEY
  ? new Resend(RESEND_API_KEY)
  : null;

type ResendSendResult = {
  data?: { id?: string } | null;
  error?: {
    name?: string;
    message: string;
    statusCode?: number;
    details?: unknown;
  } | null;
};

export async function sendClaimEmail(opts: {
  recipientEmail: string; // who receives the email
  amountUi: number; // e.g. 12.34
  senderEmail: string; // the sender’s email (reply-to)
  claimToken: string; // signed token that maps to the EmailClaim
  note?: string;
}): Promise<{ id?: string } | null> {
  const { recipientEmail, amountUi, senderEmail, claimToken, note } = opts;

  const claimUrl = `${APP_URL}/claim/${encodeURIComponent(claimToken)}`;
  const subject = `You’ve received $${amountUi.toFixed(2)} on Haven`;

  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>You’ve Received $${amountUi.toFixed(2)} USD on Haven</title>
  <style type="text/css">
    /* Resets */
    body { margin: 0; padding: 0; font-family: Arial, Helvetica, sans-serif; }
    a { color: #B6FF3E; text-decoration: none; }
    a:hover { text-decoration: underline; }
    img { border: none; display: block; }
    table { border-collapse: collapse; width: 100%; max-width: 600px; }

    /* Responsive design */
    @media only screen and (max-width: 600px) {
      .container { padding: 16px !important; }
      .header h1 { font-size: 20px !important; }
      .content h2 { font-size: 18px !important; }
      .content p { font-size: 14px !important; line-height: 22px !important; }
      .cta-button a { padding: 10px 20px !important; font-size: 14px !important; }
      .footer p { font-size: 11px !important; }
    }
  </style>
</head>
<body style="background-color: #080A0C; color: #F5F5F5;">
  <table align="center" class="container" style="max-width: 600px; margin: 0 auto; padding: 20px;">
    <tr>
      <td>
        <!-- Header -->
        <table class="header" style="text-align: center; padding: 20px 0;">
          <tr>
            <td>
              <img src="https://your-cdn.com/haven-logo.png" alt="Haven Vaults" style="max-width: 120px; margin: 0 auto;">
              <h1 style="font-size: 24px; font-weight: 600; color: #F5F5F5; margin: 12px 0 0;">Haven Vaults</h1>
            </td>
          </tr>
        </table>

        <!-- Main Content -->
        <table class="content" style="background-color: #14171A; border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 12px; padding: 24px;">
          <tr>
            <td>
              <h2 style="font-size: 20px; font-weight: 600; color: #F5F5F5; margin: 0 0 16px;">You’ve Received $${amountUi.toFixed(
                2
              )} USD</h2>
              <p style="font-size: 16px; line-height: 24px; color: #F5F5F5; margin: 0 0 16px;">
                <strong>${escapeHtml(
                  senderEmail
                )}</strong> sent you <strong>$${amountUi.toFixed(
    2
  )} USD</strong> via Haven Vaults.
              </p>
              ${
                note
                  ? `<p style="font-size: 16px; line-height: 24px; color: #A1A1AA; font-style: italic; margin: 0 0 16px;">“${escapeHtml(
                      note
                    )}”</p>`
                  : ""
              }
              <p style="font-size: 16px; line-height: 24px; color: #F5F5F5; margin: 0 0 24px;">
                Claim your funds securely by clicking below. You can transfer to your bank or create a Haven account to manage your funds.
              </p>

              <!-- CTA Button -->
              <table class="cta-button" style="text-align: center; margin: 24px 0;">
                <tr>
                  <td>
                    <a href="${claimUrl}" style="display: inline-block; background-color: #B6FF3E; color: #000000; text-decoration: none; padding: 12px 24px; border-radius: 10px; font-size: 16px; font-weight: 600;">Claim Your Funds</a>
                  </td>
                </tr>
              </table>

              <!-- Fallback Link -->
              <p style="font-size: 14px; line-height: 20px; color: #A1A1AA; margin: 0;">
                If the button doesn’t work, copy this link:<br>
                <a href="${claimUrl}" style="color: #B6FF3E; text-decoration: underline; word-break: break-all;">${claimUrl}</a>
              </p>
            </td>
          </tr>
        </table>

        <!-- Footer -->
        <table class="footer" style="text-align: center; padding: 20px 0; font-size: 12px; color: #A1A1AA;">
          <tr>
            <td>
              <p style="margin: 0;">Haven Vaults: Secure USDC transfers powered by Solana.</p>
              <p style="margin: 8px 0 0;">
                <a href="${APP_URL}/privacy" style="color: #B6FF3E;">Privacy Policy</a> | 
                <a href="${APP_URL}/terms" style="color: #B6FF3E;">Terms of Service</a> | 
                <a href="${APP_URL}/unsubscribe?token=${encodeURIComponent(
    claimToken
  )}" style="color: #B6FF3E;">Unsubscribe</a>
              </p>
              <p style="margin: 8px 0 0;">© ${new Date().getFullYear()} Haven Vaults. All rights reserved.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
`;

  const text = `
Haven Vaults

You’ve received $${amountUi.toFixed(2)} USD

${senderEmail} sent you $${amountUi.toFixed(2)} USD via Haven Vaults.
${note ? `Note: "${note}"` : ""}

Claim your funds: ${claimUrl}

You can transfer the money to your bank or create a Haven account to manage your funds.

---

Haven Vaults: Secure USDC transfers powered by Solana.
Privacy Policy: ${APP_URL}/privacy
Terms of Service: ${APP_URL}/terms
Unsubscribe: ${APP_URL}/unsubscribe?token=${encodeURIComponent(claimToken)}
© ${new Date().getFullYear()} Haven Vaults. All rights reserved.
`;

  if (!resend) {
    // Dev mode: don’t hard fail if no API key set
    console.log("[mailer] (dev) would send:", {
      to: recipientEmail,
      subject,
      claimUrl,
      note,
    });
    return { id: "dev-mail" };
  }

  const result = await resend.emails.send({
    from: FROM_EMAIL, // must be a verified sender/domain in Resend
    to: recipientEmail,
    subject,
    html,
    text,
    replyTo: senderEmail, // ✅ camelCase for the SDK typings
  });
  
  const r = result as unknown as ResendSendResult;
  if (r.error) {
    const err = r.error;
    console.error(
      "[mailer] Resend error:",
      JSON.stringify(
        {
          name: err?.name,
          message: err?.message,
          statusCode: err?.statusCode,
          details: err?.details,
        },
        null,
        2
      )
    );
    throw new Error(err?.message || "Email send failed");
  }
  
  return r.data ?? null;
}

function escapeHtml(s: string) {
  return s.replace(
    /[&<>"']/g,
    (ch) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[
        ch
      ] as string)
  );
}
