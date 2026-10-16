import Stripe from "https://esm.sh/stripe@18.5.0";
import { connectPlatformFromEnv, selectBillingPublishableKey, selectBillingSecret } from "./connect-platform.ts";

/**
 * TidyWise's own Stripe account: subscriptions, lifetime, plan changes,
 * loyalty, AI credits, ad management, winback coupons, and the billing ledger.
 *
 * Prefer the explicit STRIPE_BILLING_* variables. STRIPE_SECRET_KEY is the
 * Connect platform key (whichever platform account the owner names; no
 * account id is hardcoded). It is a billing fallback only while
 * STRIPE_PLATFORM_ACCOUNT_ID is unset and STRIPE_CONNECT_PLATFORM_SWITCHED
 * is off. Naming the platform account drops the fallback immediately, so
 * a swapped Connect secret cannot charge subscriptions.
 *
 * Before setting STRIPE_PLATFORM_ACCOUNT_ID or the switch flag, and before
 * swapping STRIPE_SECRET_KEY, set STRIPE_BILLING_SECRET_KEY,
 * STRIPE_BILLING_PUBLISHABLE_KEY, and STRIPE_BILLING_WEBHOOK_SECRET to the
 * existing billing account. After either gate, a missing billing key
 * returns empty.
 */
export function billingSecretKey(): string {
  const config = connectPlatformFromEnv();
  return selectBillingSecret({
    billingSecret: Deno.env.get("STRIPE_BILLING_SECRET_KEY"),
    connectSecret: Deno.env.get("STRIPE_SECRET_KEY"),
    switched: config.switched,
    platformAccountId: config.platformAccountId,
  });
}

/** Connect platform secret. Never the billing account. */
export function connectSecretKey(): string {
  return (Deno.env.get("STRIPE_SECRET_KEY") || "").trim();
}

/** Publishable key for embedded checkout. Must be the same Stripe account as billingSecretKey(). */
export function billingPublishableKey(): string | null {
  const config = connectPlatformFromEnv();
  return selectBillingPublishableKey({
    billingPublishable: Deno.env.get("STRIPE_BILLING_PUBLISHABLE_KEY"),
    connectPublishable: Deno.env.get("STRIPE_PUBLISHABLE_KEY"),
    switched: config.switched,
    platformAccountId: config.platformAccountId,
  });
}

export const BILLING_KEY_MISSING = "STRIPE_BILLING_SECRET_KEY is not set";

/**
 * Payment method configuration on the billing account.
 * An id from the old account (pmc_…) is rejected by the new account.
 * Unset means omit payment_method_configuration and use the account default.
 */
export function billingPaymentMethodConfiguration(): string | null {
  const id = (Deno.env.get("STRIPE_BILLING_PMC_ID") || "").trim();
  return id || null;
}

export const STRIPE_API_VERSION = "2025-08-27.basil" as const;

export function billingStripe(): Stripe {
  return new Stripe(billingSecretKey(), { apiVersion: STRIPE_API_VERSION });
}

export type StripeWebhookAccount = "connect" | "billing";

/**
 * stripe-invoice-webhook receives events from both accounts.
 * The secret that verifies the signature picks the client:
 * STRIPE_WEBHOOK_SECRET -> Connect (STRIPE_SECRET_KEY),
 * STRIPE_BILLING_WEBHOOK_SECRET -> billing account.
 */
export async function verifyStripeWebhook(
  body: string,
  signature: string,
): Promise<{ event: Stripe.Event; stripe: Stripe; account: StripeWebhookAccount }> {
  const connectWebhook = (Deno.env.get("STRIPE_WEBHOOK_SECRET") || "").trim();
  const billingWebhook = (Deno.env.get("STRIPE_BILLING_WEBHOOK_SECRET") || "").trim();
  const attempts: { secret: string; key: string; account: StripeWebhookAccount }[] = [];
  if (connectWebhook) {
    attempts.push({ secret: connectWebhook, key: connectSecretKey(), account: "connect" });
  }
  if (billingWebhook && billingWebhook !== connectWebhook) {
    const key = billingSecretKey();
    // An empty key means the platform account is named or the switch is on,
    // and STRIPE_BILLING_SECRET_KEY was not set. Do not verify billing
    // events with a placeholder client.
    if (key) attempts.push({ secret: billingWebhook, key, account: "billing" });
  }
  if (attempts.length === 0) {
    if (billingWebhook && !billingSecretKey()) {
      throw new Error("STRIPE_BILLING_SECRET_KEY is not set");
    }
    throw new Error("Webhook secret not configured");
  }

  let lastMessage = "Webhook signature verification failed";
  for (const attempt of attempts) {
    const stripe = new Stripe(attempt.key || "sk_placeholder", { apiVersion: STRIPE_API_VERSION });
    try {
      const event = await stripe.webhooks.constructEventAsync(body, signature, attempt.secret);
      return { event, stripe, account: attempt.account };
    } catch (err) {
      lastMessage = err instanceof Error ? err.message : String(err);
    }
  }
  throw new Error(lastMessage);
}
