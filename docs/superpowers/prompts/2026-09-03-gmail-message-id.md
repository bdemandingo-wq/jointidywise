# Stamp real Message-ID on Gmail SMTP sends

## File to edit
`supabase/functions/_shared/send-org-email.ts`

## Problem
`sendViaGmailSmtp()` returns `gmail-${crypto.randomUUID()}` as the id (line 215). That value is invented after the fact and appears in NO email header, so bounces can never be matched to sends. The Resend path is fine — leave it alone.

## Change

In `sendViaGmailSmtp()`, replace lines 192-215 with:

```typescript
  try {
    const html = opts.html + (settings.email_footer ? `<br/><br/><p style="color:#666;font-size:12px;">${settings.email_footer}</p>` : "");
    const text = opts.text ?? "This email requires an HTML-capable client.";

    // Stamp a real RFC-compliant Message-ID so bounces can be matched to sends.
    const domain = settings.smtp_email!.split("@")[1];
    const messageId = `<tw-${crypto.randomUUID()}@${domain}>`;

    // Bypass denomailer's buggy quoted-printable encoder — build MIME parts with base64 instead.
    await client.send({
      from,
      to: toArr(opts.to),
      cc: toArr(opts.cc),
      bcc: toArr(opts.bcc),
      replyTo,
      subject: opts.subject,
      headers: { "Message-ID": messageId },
      mimeContent: [
        { mimeType: 'text/plain; charset="utf-8"', content: b64(text), transferEncoding: "base64" },
        { mimeType: 'text/html; charset="utf-8"', content: b64(html), transferEncoding: "base64" },
      ],
      attachments: (opts.attachments ?? []).map((a) => ({
        filename: a.filename,
        content: a.content,
        encoding: "base64",
        contentType: a.content_type ?? "application/octet-stream",
      })),
    });
    await client.close();
    return { ok: true, id: messageId };
```

## What changed (3 things)
1. **Before `client.send()`**: extract domain from `settings.smtp_email` and generate `messageId = <tw-UUID@domain>`
2. **In `client.send()`**: added `headers: { "Message-ID": messageId }` — denomailer 1.6.0 supports this via its `Headers` interface (`Record<string, string>`)
3. **Return value**: changed from `gmail-${crypto.randomUUID()}` to `messageId` — this flows through to `email_send_log.message_id` via `providerId` (line ~324)

## What NOT to change
- The Resend path (`sendViaResend`) — leave completely alone
- The `logSend` function — it already stores `providerId` as `message_id`, so the real header value lands automatically
- No new columns or migrations needed

## Verification
- The generated Message-ID matches RFC 2822: `<local-part@domain>`
- Domain is derived from the org's own smtp_email, not hardcoded
- The id stored in email_send_log is the exact string that appears in the email's Message-ID header, so a bounce notification containing that header can be matched

Deploy the `send-org-email` shared module (it's used by multiple functions). Confirm deployed, not just committed.
