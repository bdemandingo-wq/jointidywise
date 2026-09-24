// Best-effort messages to a cleaner, always from THEIR organization's own
// OpenPhone line and email identity. Never throws — a failed notice must not
// undo a payment that already went through.
import { sendOrgEmail } from "./send-org-email.ts";

export const PORTAL_URL = "https://www.jointidywise.com/staff";
export const FORGOT_URL = "https://www.jointidywise.com/staff/login";
export const APP_URL = "https://www.jointidywise.com/get-the-app";

function e164(raw: string): string | null {
  let d = raw.replace(/\D/g, "");
  if (d.length < 10) return null;
  if (d.length === 10) d = `1${d}`;
  return `+${d}`;
}

// deno-lint-ignore no-explicit-any
export async function sendStaffSms(supabase: any, organizationId: string, phone: string | null, content: string, tag: string): Promise<boolean> {
  try {
    const to = phone ? e164(phone) : null;
    if (!to) return false;
    const { data: s } = await supabase
      .from("organization_sms_settings")
      .select("openphone_api_key, openphone_phone_number_id, sms_enabled")
      .eq("organization_id", organizationId)
      .maybeSingle();
    if (!s?.sms_enabled || !s.openphone_api_key || !s.openphone_phone_number_id) {
      console.warn(`[${tag}] SMS not configured for org ${organizationId}`);
      return false;
    }
    let from = s.openphone_phone_number_id as string;
    const m = from.match(/phone-numbers\/([A-Za-z0-9]+)/);
    if (m) from = m[1];
    const r = await fetch("https://api.openphone.com/v1/messages", {
      method: "POST",
      headers: { Authorization: s.openphone_api_key.trim().replace(/^Bearer\s+/i, ""), "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [to], content }),
    });
    if (!r.ok) console.error(`[${tag}] staff SMS failed`, r.status, await r.text());
    return r.ok;
  } catch (e) {
    console.error(`[${tag}] staff SMS threw`, e);
    return false;
  }
}

export async function sendStaffEmail(organizationId: string, to: string | null, subject: string, html: string, tag: string): Promise<boolean> {
  try {
    if (!to) return false;
    const r = await sendOrgEmail({ organizationId, to, subject, html, templateName: "staff_payout_notice" });
    return !!(r as { success?: boolean }).success;
  } catch (e) {
    console.error(`[${tag}] staff email threw`, e);
    return false;
  }
}
