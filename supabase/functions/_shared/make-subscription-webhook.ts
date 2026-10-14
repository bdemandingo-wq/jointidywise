/**
 * Make.com subscription confirmation. Demo organizations never fire it.
 */
import { demoSendShouldSkip } from "./demo-guard.ts";

const MAKE_SUBSCRIPTION_WEBHOOK_URL = "https://hook.us2.make.com/1dcdsn08refadbtlbj1v1j8uxel4dwil";

export async function postMakeSubscriptionWebhook(
  payload: Record<string, unknown>,
  context?: { organizationId?: string | null },
): Promise<void> {
  const email = typeof payload.email === "string" ? payload.email : null;
  const reason = await demoSendShouldSkip({
    channel: "make_subscription",
    organizationId: context?.organizationId,
    recipients: [email],
  });
  if (reason) return;
  await fetch(MAKE_SUBSCRIPTION_WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}
