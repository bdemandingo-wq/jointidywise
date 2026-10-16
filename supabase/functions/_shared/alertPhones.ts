import { sendOpenPhoneMessage, type SmsSupabaseClient } from "./send-sms.ts";

/**
 * business_settings.notification_phone may hold several numbers separated by
 * commas, semicolons or new lines. Returns unique E.164 numbers (US default).
 */
export function parseAlertPhones(raw: string | null | undefined): string[] {
  if (!raw) return [];
  const out = new Set<string>();
  for (const part of raw.split(/[,;\n]+/)) {
    let d = part.replace(/\D/g, '');
    if (d.length < 10) continue;
    if (d.length === 10) d = `1${d}`;
    out.add(`+${d}`);
  }
  return [...out];
}

/** Send the same text to extra alert numbers (best effort, logged). */
export async function sendToExtraAlertPhones(
  phones: string[],
  from: string,
  authHeader: string,
  content: string,
  tag: string,
  scope: { supabase: SmsSupabaseClient; organizationId: string },
): Promise<void> {
  for (const to of phones) {
    try {
      const sent = await sendOpenPhoneMessage({
        supabase: scope.supabase,
        organizationId: scope.organizationId,
        to,
        content,
        from,
        apiKey: authHeader,
        tag,
      });
      if (sent.skipped) continue;
      if (!sent.response.ok) {
        console.error(`[${tag}] extra alert SMS to ${to} failed:`, sent.response.status, await sent.response.text());
      }
    } catch (e) {
      console.error(`[${tag}] extra alert SMS to ${to} threw:`, e);
    }
  }
}
