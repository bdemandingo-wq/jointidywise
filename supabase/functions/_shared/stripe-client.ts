/**
 * The only `new Stripe` in the edge functions. Pass organizationId when the
 * call acts for a cleaning business. Demo orgs are refused before the client
 * is constructed: the preview org, demo_mode_enabled, and the same
 * name/slug/email rules as public.is_demo_or_test. A paying active or
 * past_due plan other than Lifetime is never demo. Webhook signature
 * verification uses createStripeClientUnchecked.
 */
import Stripe from "https://esm.sh/stripe@18.5.0";
import { assertStripeClientAllowed } from "./demo-org.ts";
import { demoModeEnabledForOrg } from "./demo-guard.ts";

export const STRIPE_API_VERSION = "2025-08-27.basil" as const;

type StripeConfig = Stripe.StripeConfig & { organizationId?: string | null };

/** Webhook verification and other inbound reads. Not a customer charge. */
export function createStripeClientUnchecked(key: string, config?: Stripe.StripeConfig): Stripe {
  return new Stripe(key || "sk_placeholder", {
    apiVersion: STRIPE_API_VERSION,
    ...config,
  });
}

export async function createStripeClient(key: string, config?: StripeConfig): Promise<Stripe> {
  const organizationId = config?.organizationId ?? null;
  await assertStripeClientAllowed({
    organizationId,
    isDemoOrg: (orgId) => demoModeEnabledForOrg(null, orgId),
  });
  const { organizationId: _drop, ...stripeConfig } = config ?? {};
  return createStripeClientUnchecked(key, stripeConfig);
}
