/**
 * The only `new Stripe` in the edge functions. Pass organizationId when the
 * call acts for a cleaning business or a TidyWise subscription org. Demo
 * mode throws before any Stripe request is made.
 */
import Stripe from "https://esm.sh/stripe@18.5.0";
import { DemoSendBlocked, demoSendShouldSkip } from "./demo-guard.ts";

export const STRIPE_API_VERSION = "2025-08-27.basil" as const;

type StripeConfig = Stripe.StripeConfig & { organizationId?: string | null };

/** Webhook verification and other inbound reads. Not a customer send. */
export function createStripeClientUnchecked(key: string, config?: Stripe.StripeConfig): Stripe {
  return new Stripe(key || "sk_placeholder", {
    apiVersion: STRIPE_API_VERSION,
    ...config,
  });
}

export async function createStripeClient(key: string, config?: StripeConfig): Promise<Stripe> {
  const organizationId = config?.organizationId ?? null;
  const reason = await demoSendShouldSkip({
    channel: "stripe",
    organizationId,
  });
  if (reason) throw new DemoSendBlocked("stripe");
  const { organizationId: _drop, ...stripeConfig } = config ?? {};
  return createStripeClientUnchecked(key, stripeConfig);
}
