/**
 * Platform Stripe mode, derived from the secret key prefix.
 *
 * Checkout uses `STRIPE_BILLING_SECRET_KEY` (falling back to `STRIPE_SECRET_KEY`)
 * in the edge function environment. There is
 * no separate test/live switch in code. `sk_live_` / `rk_live_` mint `cs_live_`
 * sessions. `sk_test_` / `rk_test_` mint `cs_test_` sessions. This module only
 * classifies a prefix. It never selects or rewrites a key.
 *
 * The edge copy lives in `supabase/functions/_shared/stripe-key-mode.ts`.
 * Keep the two prefix checks identical.
 */

export type StripeKeyMode = "live" | "test" | "unset" | "unknown";

export function stripeKeyMode(secret: string | null | undefined): StripeKeyMode {
  if (!secret || !secret.trim()) return "unset";
  const key = secret.trim();
  if (key.startsWith("sk_live_") || key.startsWith("rk_live_")) return "live";
  if (key.startsWith("sk_test_") || key.startsWith("rk_test_")) return "test";
  return "unknown";
}

/** What check-subscription actually returned, including "the field is missing". */
export type ReportedStripeMode = StripeKeyMode | "unreported";

export function readReportedStripeMode(subscription: unknown): ReportedStripeMode {
  if (!subscription || typeof subscription !== "object") return "unreported";
  const mode = (subscription as { stripe_mode?: unknown }).stripe_mode;
  if (mode === "live" || mode === "test" || mode === "unset" || mode === "unknown") {
    return mode;
  }
  return "unreported";
}

export type BillingNextStep = "portal" | "checkout" | "lifetime" | "comped";

/**
 * Where "Update payment method" / plan buttons should send an admin.
 *
 * A real Stripe subscription (product id `prod_…`) or a failed payment can
 * open the billing portal. An unpaid org trial has `subscribed: true` and
 * `product_id: "org_trial"` but no Stripe customer, so the portal 500s.
 */
export function billingNextStep(subscription: {
  product_id?: string | null;
  payment_failed?: boolean;
} | null | undefined): BillingNextStep {
  const id = subscription?.product_id ?? "";
  if (id === "lifetime") return "lifetime";
  if (id === "comped" || id === "owner_free") return "comped";
  if (subscription?.payment_failed) return "portal";
  if (typeof id === "string" && id.startsWith("prod_")) return "portal";
  return "checkout";
}

/** True when Stripe has a subscription we can prorate, not an in-app trial. */
export function hasChangeableStripeSubscription(subscription: {
  subscribed?: boolean;
  product_id?: string | null;
} | null | undefined): boolean {
  const id = subscription?.product_id ?? "";
  return subscription?.subscribed === true && typeof id === "string" && id.startsWith("prod_");
}

/**
 * check-subscription reports product_id "org_trial" only while the trial
 * still grants access (plan_type trial with trial_ends_at in the future, or
 * the older pre-cutoff org trial). An expired trial comes back subscribed
 * false and without that product id.
 */
export function isActiveOrgTrial(subscription: {
  product_id?: string | null;
  subscribed?: boolean;
  trial_active?: boolean;
} | null | undefined): boolean {
  if (subscription?.product_id !== "org_trial") return false;
  return subscription.subscribed === true || subscription.trial_active === true;
}

/**
 * Settings → Plan heading. "Trial (Pro)" only when organizations.plan_type
 * is trial. A subscription product id or trial_active flag is not a second
 * vote. A paid plan name is unchanged. CSS capitalize is not used:
 * "Trial (Pro)" must keep the capital P.
 */
export function planSectionLabel(opts: {
  rawPlanType?: string | null;
}): string {
  const raw = (opts.rawPlanType ?? "").trim().toLowerCase();
  if (raw === "trial") return "Trial (Pro)";
  const word = raw || "free";
  return word.charAt(0).toUpperCase() + word.slice(1);
}

/**
 * /choose-plan is the paywall for accounts without dashboard access.
 * An active org trial has that access, so it returns to the dashboard
 * unless the admin opened this page to upgrade.
 */
export function shouldRedirectChoosePlanToDashboard(opts: {
  hasDashboardAccess: boolean;
  upgradeRequested: boolean;
}): boolean {
  return opts.hasDashboardAccess && !opts.upgradeRequested;
}
