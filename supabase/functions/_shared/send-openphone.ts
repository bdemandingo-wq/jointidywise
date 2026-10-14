/**
 * The only OpenPhone message send. Every SMS function goes through here so
 * a demo organization is skipped even when the caller forgot its own check.
 */
import { demoSendShouldSkip, recipientsFromJsonBody } from "./demo-guard.ts";

/** Message history reads may use this URL. Sends must call sendOpenPhoneMessage. */
export const OPENPHONE_MESSAGES_URL = "https://api.openphone.com/v1/messages";

export async function sendOpenPhoneMessage(
  init: RequestInit & { organizationId?: string | null },
): Promise<Response> {
  const organizationId = init.organizationId ?? null;
  const reason = await demoSendShouldSkip({
    channel: "sms",
    organizationId,
    recipients: recipientsFromJsonBody(init.body),
  });
  if (reason) {
    return new Response(JSON.stringify({ skipped: true, reason, demo: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }
  return fetch(OPENPHONE_MESSAGES_URL, {
    method: init.method,
    headers: init.headers,
    body: init.body,
    signal: init.signal,
  });
}
