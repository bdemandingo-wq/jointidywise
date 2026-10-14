// Core Gmail send logic. Importable from other edge functions.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { refreshGmailAccessToken } from "./gmail-refresh.ts";

export interface GmailSendInput {
  organization_id: string;
  to: string | string[];
  subject: string;
  html?: string;
  text?: string;
  from_name?: string;
  reply_to?: string;
  cc?: string | string[];
  bcc?: string | string[];
  attachments?: Array<{ filename: string; content: string; contentType?: string }>;
}

export async function sendViaGmail(req: GmailSendInput): Promise<
  { success: true; message_id: string } | { success: false; error: string; code?: string }
> {
  if (!req.organization_id) return { success: false, error: "organization_id required" };
  if (!req.to || !req.subject) return { success: false, error: "to and subject required" };

  const { demoSendShouldSkip } = await import("./demo-guard.ts");
  const recipients = Array.isArray(req.to) ? req.to : [req.to];
  const demoReason = await demoSendShouldSkip({
    channel: "email",
    organizationId: req.organization_id,
    recipients,
  });
  if (demoReason) {
    const { DemoSendBlocked } = await import("./demo-guard.ts");
    throw new DemoSendBlocked("email");
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data: conn } = await supabase
    .from("org_gmail_connections")
    .select("*")
    .eq("organization_id", req.organization_id)
    .maybeSingle();

  if (!conn) return { success: false, error: "no_connection", code: "NO_CONNECTION" };
  if (conn.status !== "active") return { success: false, error: `gmail_${conn.status}`, code: "INACTIVE" };

  let accessToken = conn.access_token as string | null;
  const expiresAt = conn.access_token_expires_at ? new Date(conn.access_token_expires_at).getTime() : 0;
  if (!accessToken || expiresAt - Date.now() < 60_000) {
    const r = await refreshGmailAccessToken(req.organization_id);
    if (!r.success) return { success: false, error: r.error, code: "REFRESH_FAILED" };
    accessToken = r.access_token;
  }

  const raw = buildMimeMessage({
    fromEmail: conn.google_email,
    fromName: req.from_name || conn.google_email,
    to: Array.isArray(req.to) ? req.to.join(", ") : req.to,
    cc: req.cc ? (Array.isArray(req.cc) ? req.cc.join(", ") : req.cc) : undefined,
    bcc: req.bcc ? (Array.isArray(req.bcc) ? req.bcc.join(", ") : req.bcc) : undefined,
    replyTo: req.reply_to,
    subject: req.subject,
    html: req.html,
    text: req.text,
    attachments: req.attachments,
  });

  const send = (token: string) =>
    fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ raw }),
    });

  let res = await send(accessToken!);
  if (res.status === 401) {
    const r = await refreshGmailAccessToken(req.organization_id);
    if (!r.success) {
      await logFailure(supabase, req, "401 + refresh failed: " + r.error);
      return { success: false, error: r.error, code: "AUTH_FAILED" };
    }
    res = await send(r.access_token);
  }

  if (!res.ok) {
    const errBody = await res.text();
    await logFailure(supabase, req, `${res.status} ${errBody.slice(0, 500)}`);
    let detail = errBody.slice(0, 300);
    try {
      const parsed = JSON.parse(errBody);
      detail = parsed?.error?.message || detail;
    } catch { /* ignore */ }
    return { success: false, error: `Gmail ${res.status}: ${detail}`, code: "SEND_FAILED" };
  }

  const data = await res.json();
  await supabase
    .from("org_gmail_connections")
    .update({ last_send_at: new Date().toISOString() })
    .eq("organization_id", req.organization_id);

  return { success: true, message_id: data.id };
}

async function logFailure(supabase: any, req: GmailSendInput, error: string) {
  try {
    await supabase.from("email_send_failures").insert({
      organization_id: req.organization_id,
      recipient: Array.isArray(req.to) ? req.to.join(",") : req.to,
      subject: req.subject,
      provider: "gmail",
      error,
    });
  } catch (e) {
    console.error("[gmail-send] failed to log failure", e);
  }
}

function buildMimeMessage(opts: {
  fromEmail: string;
  fromName: string;
  to: string;
  cc?: string;
  bcc?: string;
  replyTo?: string;
  subject: string;
  html?: string;
  text?: string;
  attachments?: Array<{ filename: string; content: string; contentType?: string }>;
}): string {
  const boundary = "mix_" + crypto.randomUUID().replace(/-/g, "");
  const altBoundary = "alt_" + crypto.randomUUID().replace(/-/g, "");
  const headers: string[] = [
    `From: "${escapeHeader(opts.fromName)}" <${opts.fromEmail}>`,
    `To: ${opts.to}`,
    `Subject: ${encodeSubject(opts.subject)}`,
    "MIME-Version: 1.0",
  ];
  if (opts.cc) headers.push(`Cc: ${opts.cc}`);
  if (opts.bcc) headers.push(`Bcc: ${opts.bcc}`);
  if (opts.replyTo) headers.push(`Reply-To: ${opts.replyTo}`);

  const hasAttach = (opts.attachments?.length ?? 0) > 0;
  const text = opts.text || (opts.html ? stripHtml(opts.html) : "");
  const html = opts.html;

  let body: string;
  if (hasAttach) {
    headers.push(`Content-Type: multipart/mixed; boundary="${boundary}"`);
    const parts: string[] = [];
    parts.push(`--${boundary}`);
    parts.push(`Content-Type: multipart/alternative; boundary="${altBoundary}"`);
    parts.push("");
    parts.push(altPart(altBoundary, text, html));
    for (const a of opts.attachments!) {
      parts.push(`--${boundary}`);
      parts.push(`Content-Type: ${a.contentType || "application/octet-stream"}; name="${a.filename}"`);
      parts.push("Content-Transfer-Encoding: base64");
      parts.push(`Content-Disposition: attachment; filename="${a.filename}"`);
      parts.push("");
      parts.push(a.content.match(/.{1,76}/g)?.join("\r\n") || a.content);
    }
    parts.push(`--${boundary}--`);
    body = parts.join("\r\n");
  } else if (html) {
    headers.push(`Content-Type: multipart/alternative; boundary="${altBoundary}"`);
    body = altPart(altBoundary, text, html);
  } else {
    headers.push('Content-Type: text/plain; charset="UTF-8"');
    headers.push("Content-Transfer-Encoding: 7bit");
    body = text;
  }

  const message = headers.join("\r\n") + "\r\n\r\n" + body;
  return base64UrlEncode(message);
}

function altPart(boundary: string, text: string, html?: string): string {
  const out: string[] = [];
  out.push(`--${boundary}`);
  out.push('Content-Type: text/plain; charset="UTF-8"');
  out.push("Content-Transfer-Encoding: 7bit");
  out.push("");
  out.push(text);
  if (html) {
    out.push(`--${boundary}`);
    out.push('Content-Type: text/html; charset="UTF-8"');
    out.push("Content-Transfer-Encoding: 7bit");
    out.push("");
    out.push(html);
  }
  out.push(`--${boundary}--`);
  return out.join("\r\n");
}

function escapeHeader(s: string): string { return s.replace(/"/g, "'"); }
function encodeSubject(s: string): string {
  // deno-lint-ignore no-control-regex
  if (/[^\x00-\x7F]/.test(s)) {
    return `=?UTF-8?B?${btoa(unescape(encodeURIComponent(s)))}?=`;
  }
  return s;
}
function stripHtml(h: string): string {
  return h.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
function base64UrlEncode(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
