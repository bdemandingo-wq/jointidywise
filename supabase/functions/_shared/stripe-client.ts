/**
 * The only `new Stripe` in the edge functions. Pass organizationId when the
 * call acts for a cleaning business or a TidyWise subscription org.
 * A real org with demo mode on still gets a client: payouts, charges,
 * invoices, and subscription changes are not sends. Only the public
 * preview org id is blocked.
 */
import Stripe from "https://esm.sh/stripe@18.5.0";
import { stripeClientBlockReason } from "./demo-org.ts";
import { DemoSendBlocked } from "./demo-guard.ts";

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
  const reason = stripeClientBlockReason(organizationId);
  if (reason) {
    console.log(`[demo-block] skipped stripe reason=${reason} org=${organizationId ?? "none"}`);
    throw new DemoSendBlocked("stripe");
  }
  const { organizationId: _drop, ...stripeConfig } = config ?? {};
  return createStripeClientUnchecked(key, stripeConfig);
}
