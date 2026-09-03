// Unified customer-facing org email sender.
// - Routes to Gmail SMTP when the org has email_send_method='gmail_smtp' AND credentials configured.
// - Auto-fallback: if Gmail SMTP fails or the daily limit is reached, the send falls back
//   to Resend (TidyWise platform sender) so customer-facing emails keep flowing. The fallback
//   is logged in org_email_send_failures so the org can see it happened.
// - When Gmail is NOT configured, sends directly via Resend.

//
// Platform / system emails (auth, admin notifications, digests) do NOT use this helper —
// they call Resend directly with the platform key.

import { parseRecipients } from "./email-address.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";
import {
  getOrgEmailSettings,
  formatEmailFrom,
  getReplyTo,
  type OrgEmailSettings,
} from "./get-org-email-settings.ts";

const GMAIL_CONSUMER_LIMIT = 500;
const GMAIL_WORKSPACE_LIMIT = 2000;

export interface SendOrgEmailOptions {
  organizationId: string;
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  cc?: string | string[];
  bcc?: string | string[];
  replyTo?: string;
  attachments?: Array<{ filename: string; content: string; content_type?: string }>;
  // If provided, overrides the org from_name/from_email (rare).
  fromOverride?: string;
  /** Logical template/kind of email, e.g. "invoice", "booking-confirmation". Stored in email_send_log. */
  templateName?: string;
  /** Stable idempotency/correlation key, e.g. `invoice-<id>`. Defaults to the provider message id. */
  messageId?: string;
  /** Extra context stored on the log row (invoice id, booking id, ...). */
  metadata?: Record<string, unknown>;
  /**
   * Bypass the hard-bounce suppression list. Set ONLY for auth mail
   * (password reset, magic link, verification, workspace invites) — blocking
   * those would lock a real user out of their own account.
   */
  ignoreSuppression?: boolean;
}

export interface SendOrgEmailResult {
  success: boolean;
  id?: string;
  method: "gmail_smtp" | "resend" | "none";
  fellBack?: boolean;
  error?: string;
}

/**
 * Normalise a recipient field into deliverable addresses.
 *
 * This used to be `Array.isArray(v) ? v : [v]`, which wrapped a stored value
 * verbatim. Nine customers had typed comma-separated addresses into a
 * single-value field — accounts plus a person, property-management teams — so
 * `"a@x.com, b@y.com"` reached the provider as ONE malformed address and the
 * entire send failed. None of them got mail rather than some of them, silently,
 * since February.
 *
 * parseRecipients splits on commas, trims, drops invalid parts and dedupes. A
 * list where one address has a typo now delivers to the rest instead of failing
 * whole — the caller can compare lengths if it wants to report the difference.
 */
function toArr(v: string | string[] | undefined): string[] {
  return parseRecipients(v);
}

function gmailDailyLimit(settings: OrgEmailSettings): number {
  return settings.gmail_account_type === "workspace" ? GMAIL_WORKSPACE_LIMIT : GMAIL_CONSUMER_LIMIT;
}

async function currentGmailDailyCount(orgId: string): Promise<number> {
  const url = Deno.env.get("SUPABASE_URL")!;
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(url, key);
  const today = new Date().toISOString().slice(0, 10);
  const { data } = await supabase
    .from("org_email_daily_sends")
    .select("sent_count")
    .eq("organization_id", orgId)
    .eq("sent_on", today)
    .eq("method", "gmail_smtp")
    .maybeSingle();
  return (data?.sent_count as number | undefined) ?? 0;
}

async function incrementDailyCount(orgId: string, method: "gmail_smtp" | "resend") {
  const url = Deno.env.get("SUPABASE_URL")!;
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(url, key);
  await supabase.rpc("increment_org_email_daily_send", {
    _organization_id: orgId,
    _method: method,
    _delta: 1,
  });
}

async function logFailure(
  orgId: string,
  method: string,
  fellBackTo: string | null,
  recipient: string,
  subject: string,
  error: string,
) {
  const url = Deno.env.get("SUPABASE_URL")!;
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(url, key);
  try {
    await supabase.rpc("log_org_email_send_failure", {
      _organization_id: orgId,
      _method: method,
      _fell_back_to: fellBackTo,
      _recipient: recipient,
      _subject: subject,
      _error_message: error.slice(0, 4000),
    });
  } catch (e) {
    console.error("[send-org-email] Could not log failure:", e);
  }
}

/**
 * Record every send attempt — success as well as failure — in public.email_send_log.
 *
 * Before this existed only failures were persisted (org_email_send_failures), so
 * "did invoice 76 actually send?" was unanswerable: the absence of a row meant
 * nothing. Now every path writes exactly one row, and `message_id` lets a caller
 * look a specific email up later.
 */
async function logSend(
  opts: SendOrgEmailOptions,
  args: {
    status: "sent" | "failed";
    method: string;
    recipient: string;
    providerId?: string;
    error?: string;
    fellBack?: boolean;
  },
) {
  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(url, key);
    await supabase.from("email_send_log").insert({
      organization_id: opts.organizationId,
      message_id: opts.messageId ?? args.providerId ?? `send-${crypto.randomUUID()}`,
      template_name: opts.templateName ?? "org_email",
      recipient_email: args.recipient || "unknown",
      status: args.status,
      error_message: args.error ? args.error.slice(0, 4000) : null,
      metadata: {
        ...(opts.metadata ?? {}),
        subject: opts.subject,
        method: args.method,
        fell_back: args.fellBack ?? false,
        provider_id: args.providerId ?? null,
        recipients: toArr(opts.to),
        cc: toArr(opts.cc),
      },
    });
  } catch (e) {
    console.error("[send-org-email] Could not write email_send_log:", e);
  }
}

function b64(s: string): string {
  return btoa(unescape(encodeURIComponent(s)));
}

async function sendViaGmailSmtp(
  settings: OrgEmailSettings,
  opts: SendOrgEmailOptions,
  from: string,
  replyTo: string,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  if (!settings.smtp_email || !settings.smtp_app_password) {
    return { ok: false, error: "Gmail SMTP credentials not configured" };
  }
  const client = new SMTPClient({
    connection: {
      hostname: "smtp.gmail.com",
      port: 465,
      tls: true,
      auth: { username: settings.smtp_email, password: settings.smtp_app_password },
    },
  });
  try {
    const html = opts.html + (settings.email_footer ? `<br/><br/><p style="color:#666;font-size:12px;">${settings.email_footer}</p>` : "");
    const text = opts.text ?? "This email requires an HTML-capable client.";
    // Stamp a real Message-ID so bounces landing in the org's Gmail inbox can be
    // matched back to this send via email_send_log.message_id.
    const domain = settings.smtp_email.includes("@")
      ? settings.smtp_email.split("@")[1]
      : "tidywise.local";
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
  } catch (e: any) {
    try { await client.close(); } catch (_) { /* ignore */ }
    return { ok: false, error: e?.message ?? String(e) };
  }
}

async function sendViaResend(
  settings: OrgEmailSettings,
  opts: SendOrgEmailOptions,
  from: string,
  replyTo: string,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const key = settings.resend_api_key || Deno.env.get("RESEND_API_KEY");
  if (!key) {
    return { ok: false, error: "No Resend API key configured (add one in Email Settings or contact support)." };
  }
  const payload: Record<string, unknown> = {
    from,
    to: toArr(opts.to),
    reply_to: replyTo,
    subject: opts.subject,
    html: opts.html + (settings.email_footer ? `<br/><br/><p style="color:#666;font-size:12px;">${settings.email_footer}</p>` : ""),
  };
  if (opts.cc) payload.cc = toArr(opts.cc);
  if (opts.bcc) payload.bcc = toArr(opts.bcc);
  if (opts.text) payload.text = opts.text;
  if (opts.attachments?.length) {
    payload.attachments = opts.attachments.map((a) => ({
      filename: a.filename,
      content: a.content,
      content_type: a.content_type,
    }));
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    return { ok: false, error: body?.message || `Resend HTTP ${res.status}` };
  }
  return { ok: true, id: body?.id ?? "resend-unknown" };
}

/**
 * High-level org sender. Handles Gmail SMTP → Resend fallback, daily limits, and failure logging.
 */
export async function sendOrgEmail(opts: SendOrgEmailOptions): Promise<SendOrgEmailResult> {
  const settingsResult = await getOrgEmailSettings(opts.organizationId);
  if (!settingsResult.success || !settingsResult.settings) {
    // Settings-missing failures were previously unlogged — the customer email
    // silently never sent and the owner never found out. Persist it per-org.
    await logFailure(
      opts.organizationId,
      "none",
      null,
      toArr(opts.to)[0] ?? "",
      opts.subject,
      settingsResult.error ?? "Email settings not configured",
    );
    await logSend(opts, {
      status: "failed",
      method: "none",
      recipient: toArr(opts.to)[0] ?? "",
      error: settingsResult.error ?? "Email settings not configured",
    });
    return { success: false, method: "none", error: settingsResult.error };
  }
  const settings = settingsResult.settings;
  const from = opts.fromOverride ?? formatEmailFrom(settings);
  const replyTo = opts.replyTo ?? getReplyTo(settings);
  const recipients = toArr(opts.to);
  const primaryRecipient = recipients[0] ?? "";

  // Fail here, not at the provider. With validation in toArr an unusable
  // address parses to [], and sending that yields "Invalid `to` field" from
  // Resend or "No valid emails provided!" from Gmail — accurate but useless,
  // since neither names the value or the customer. Those two messages are
  // exactly what this fix was diagnosed from.
  if (recipients.length === 0) {
    const raw = Array.isArray(opts.to) ? opts.to.join(", ") : String(opts.to ?? "");
    const error = `No valid recipient address. Stored value: ${JSON.stringify(raw)}`;
    await logFailure(opts.organizationId, "none", null, raw.slice(0, 255), opts.subject, error);
    await logSend(opts, { status: "failed", method: "none", recipient: raw.slice(0, 255), error });
    return { success: false, method: "none", error };
  }

  // Hard-bounce suppression. Addresses that permanently bounced for this org
  // are not retried — repeated hard bounces damage the org's sending
  // reputation. Auth mail (password reset, magic link, verification) sets
  // ignoreSuppression: a stale bounce must never lock a user out.
  //
  // FAIL OPEN: if the lookup itself errors we send anyway. A database hiccup
  // must not silently stop a customer's invoices.
  if (!opts.ignoreSuppression) {
    try {
      const url = Deno.env.get("SUPABASE_URL")!;
      const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
      const sb = createClient(url, key);
      const all = [...recipients, ...toArr(opts.cc), ...toArr(opts.bcc)];
      const lowered = Array.from(new Set(all.map((a) => a.toLowerCase())));
      const { data: suppressed, error: supErr } = await sb
        .from("email_suppressions")
        .select("email")
        .eq("organization_id", opts.organizationId)
        .in("email", lowered);
      if (supErr) throw supErr;

      const blocked = new Set((suppressed ?? []).map((r: { email: string }) => String(r.email).toLowerCase()));
      if (blocked.size > 0) {
        if (blocked.has(primaryRecipient.toLowerCase())) {
          const error = `Recipient suppressed after hard bounce: ${primaryRecipient}`;
          await logFailure(opts.organizationId, "none", null, primaryRecipient, opts.subject, error);
          await logSend(opts, { status: "failed", method: "none", recipient: primaryRecipient, error });
          return { success: false, method: "none", error };
        }
        const keep = (list: string[]) => list.filter((a) => !blocked.has(a.toLowerCase()));
        opts = {
          ...opts,
          to: keep(recipients),
          cc: keep(toArr(opts.cc)),
          bcc: keep(toArr(opts.bcc)),
        };
        console.warn(`[send-org-email] Dropped suppressed cc/bcc recipients for org ${opts.organizationId}`);
      }
    } catch (e) {
      console.error("[send-org-email] Suppression lookup failed; sending anyway:", e);
    }
  }

  const wantsGmail =

    settings.email_send_method === "gmail_smtp" &&
    !!settings.smtp_email &&
    !!settings.smtp_app_password;

  if (wantsGmail) {
    const dailyCount = await currentGmailDailyCount(opts.organizationId);
    const limit = gmailDailyLimit(settings);
    let gmailError: string | null = null;
    if (dailyCount >= limit) {
      gmailError = `Daily Gmail send limit reached (${dailyCount}/${limit})`;
      console.warn(`[send-org-email] ${gmailError} for org ${opts.organizationId}; falling back to Resend.`);
    } else {
      const gmailRes = await sendViaGmailSmtp(settings, opts, from, replyTo);
      if (gmailRes.ok) {
        await incrementDailyCount(opts.organizationId, "gmail_smtp");
        await logSend(opts, {
          status: "sent",
          method: "gmail_smtp",
          recipient: primaryRecipient,
          providerId: gmailRes.id,
        });
        return { success: true, id: gmailRes.id, method: "gmail_smtp" };
      }
      gmailError = gmailRes.error;
      console.error(`[send-org-email] Gmail SMTP failed for org ${opts.organizationId}:`, gmailError);
    }

    // Auto-fallback to Resend (TidyWise platform sender) so customer emails
    // don't silently stop for the rest of the day. The UI promises this.
    const fallbackRes = await sendViaResend(settings, opts, from, replyTo);
    if (fallbackRes.ok) {
      await incrementDailyCount(opts.organizationId, "resend");
      await logFailure(opts.organizationId, "gmail_smtp", "resend", primaryRecipient, opts.subject, gmailError ?? "gmail unavailable");
      await logSend(opts, {
        status: "sent",
        method: "resend",
        recipient: primaryRecipient,
        providerId: fallbackRes.id,
        fellBack: true,
        error: gmailError ?? undefined,
      });
      return { success: true, id: fallbackRes.id, method: "resend", fellBack: true };
    }
    const combined = `Gmail failed (${gmailError}); Resend fallback also failed: ${fallbackRes.error}`;
    await logFailure(opts.organizationId, "gmail_smtp", "resend", primaryRecipient, opts.subject, combined);
    await logSend(opts, {
      status: "failed",
      method: "gmail_smtp",
      recipient: primaryRecipient,
      error: combined,
      fellBack: true,
    });
    return { success: false, method: "none", error: combined, fellBack: true };
  }


  // Default path: Resend
  const resendRes = await sendViaResend(settings, opts, from, replyTo);
  if (resendRes.ok) {
    await incrementDailyCount(opts.organizationId, "resend");
    await logSend(opts, {
      status: "sent",
      method: "resend",
      recipient: primaryRecipient,
      providerId: resendRes.id,
    });
    return { success: true, id: resendRes.id, method: "resend" };
  }
  // Resend-only path failure was previously unlogged. Persist it per-org.
  await logFailure(opts.organizationId, "resend", null, primaryRecipient, opts.subject, resendRes.error);
  await logSend(opts, {
    status: "failed",
    method: "resend",
    recipient: primaryRecipient,
    error: resendRes.error,
  });
  return { success: false, method: "none", error: resendRes.error };
}
