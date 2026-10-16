// Shared fields for TidyWise plan checkout (Basic/Pro/Custom and Lifetime).
// Buyers stay on jointidywise.com. The browser mounts Embedded Checkout
// with the client secret; Stripe redirects the webview to the return page
// when the session finishes. Do not also send success_url or cancel_url —
// Stripe rejects that combination.

import { billingPublishableKey } from "./billing-stripe.ts";

export function embeddedCheckoutParams(origin: string): {
  ui_mode: "embedded";
  return_url: string;
  redirect_on_completion: "always";
} {
  const base = origin.replace(/\/$/, "");
  return {
    ui_mode: "embedded",
    return_url: `${base}/billing/return?session_id={CHECKOUT_SESSION_ID}`,
    redirect_on_completion: "always",
  };
}

/**
 * Billing-account publishable key. Public by design.
 * STRIPE_BILLING_PUBLISHABLE_KEY, then STRIPE_PUBLISHABLE_KEY only while
 * STRIPE_PLATFORM_ACCOUNT_ID is unset and STRIPE_CONNECT_PLATFORM_SWITCHED
 * is off.
 * Must be the same Stripe account as the billing secret.
 */
export function readPublishableKey(): string | null {
  return billingPublishableKey();
}

export function embeddedCheckoutBody(
  clientSecret: string | null | undefined,
  publishableKey: string,
): { clientSecret: string; publishableKey: string } {
  if (!clientSecret) {
    throw new Error("Stripe did not return a checkout client secret. Nothing was charged.");
  }
  return { clientSecret, publishableKey };
}
