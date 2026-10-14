/**
 * The only Resend email send (HTTP and the Resend SDK). Demo organizations
 * and sample recipients are logged and skipped.
 */
import { Resend } from "https://esm.sh/resend@2.0.0";
import { demoSendShouldSkip, recipientsFromJsonBody } from "./demo-guard.ts";

export async function sendResendEmail(
  init: RequestInit & { organizationId?: string | null },
): Promise<Response> {
  const organizationId = init.organizationId ?? null;
  const reason = await demoSendShouldSkip({
    channel: "email",
    organizationId,
    recipients: recipientsFromJsonBody(init.body),
  });
  if (reason) {
    return new Response(JSON.stringify({ id: "demo-skipped", skipped: true, reason }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }
  return fetch("https://api.resend.com/emails", {
    method: init.method,
    headers: init.headers,
    body: init.body,
    signal: init.signal,
  });
}

export async function sendResendSdkEmail(
  apiKey: string,
  payload: Record<string, unknown> & { to?: string | string[] },
  context?: { organizationId?: string | null },
): Promise<{ data: { id: string } | null; error: { message: string } | null }> {
  const to = payload.to;
  const recipients = Array.isArray(to) ? to : to ? [to] : [];
  const reason = await demoSendShouldSkip({
    channel: "email",
    organizationId: context?.organizationId,
    recipients,
  });
  if (reason) {
    return { data: { id: "demo-skipped" }, error: null };
  }
  const resend = new Resend(apiKey);
  const result = await resend.emails.send(payload as never);
  return result as { data: { id: string } | null; error: { message: string } | null };
}
