// emails/PaymentInvite.tsx
type PaymentInviteEmailProps = {
  recipientEmail: string;
  senderName: string;
  amount: string;
  claimUrl: string;
  note?: string; // ⬅️ allow optional note
};

export function PaymentInviteEmail({
  recipientEmail,
  senderName,
  amount,
  claimUrl,
  note,
}: PaymentInviteEmailProps) {
  return (
    <div>
      <p>Hi {recipientEmail},</p>
      <p>
        {senderName} has sent you {amount} on Haven.
      </p>
      {note && (
        <blockquote
          style={{
            padding: "8px 12px",
            margin: "12px 0",
            background: "#f9f9f9",
            borderLeft: "4px solid #b6ff3e",
          }}
        >
          {note}
        </blockquote>
      )}
      <p>
        <a href={claimUrl}>Click here to claim your funds →</a>
      </p>
    </div>
  );
}
