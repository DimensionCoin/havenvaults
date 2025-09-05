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

  const text = [
    `You’ve received money on Haven`,
    `${senderEmail} sent you $${amountUi.toFixed(2)} USD.`,
    note ? `Note: "${note}"` : "",
    `Claim your funds: ${claimUrl}`,
  ]
    .filter(Boolean)
    .join("\n\n");

  const html = `
    <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Ubuntu,Arial,sans-serif">
      <h2>You’ve received money on Haven</h2>
      <p><b>${escapeHtml(senderEmail)}</b> sent you <b>$${amountUi.toFixed(
    2
  )} USD</b>.</p>
      ${note ? `<p><i>“${escapeHtml(note)}”</i></p>` : ""}
      <p>Click the button below to claim your funds. You can off-ramp to your bank or create a Haven account to keep the funds.</p>
      <p style="margin:24px 0">
        <a href="${claimUrl}"
           style="background:#B6FF3E;color:#000;text-decoration:none;padding:12px 16px;border-radius:10px;display:inline-block;">
          Claim funds
        </a>
      </p>
      <p style="color:#666">If the button doesn’t work, copy and paste this link:<br>${claimUrl}</p>
    </div>
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
