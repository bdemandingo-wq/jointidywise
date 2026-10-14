/**
 * The only OpenPhone message send. Every SMS function goes through here so
 * a demo organization is skipped even when the caller forgot its own check.
 */
import { DemoSendBlocked, demoSendShouldSkip, recipientsFromJsonBody } from "./demo-guard.ts";

/** Message history reads may use this URL. Sends must call sendOpenPhoneMessage. */
export const OPENPHONE_MESSAGES_URL = "https://api.openphone.com/v1/messages";

export async function sendOpenPhoneMessage(
  init: RequestInit & { organizationId?: string | null; requestedReply?: boolean },
): Promise<Response> {
  const organizationId = init.organizationId ?? null;
  const reason = await demoSendShouldSkip({
    channel: "sms",
    organizationId,
    recipients: recipientsFromJsonBody(init.body),
    requestedReply: init.requestedReply === true,
  });
  if (reason) throw new DemoSendBlocked("sms");
  return fetch(OPENPHONE_MESSAGES_URL, {
    method: init.method,
    headers: init.headers,
    body: init.body,
    signal: init.signal,
  });
}
