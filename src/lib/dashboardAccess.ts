/**
 * Who may see /dashboard.
 *
 * check-subscription is the source of truth. subscribed=true covers a paid
 * Stripe subscription, a Stripe trial (status trialing, card on file), a
 * card-free org trial (organizations.plan_type = 'trial' and
 * profiles.trial_ends_at still in the future — product_id "org_trial"),
 * the pre-2026-04-06 60-day org trial (also product_id "org_trial"),
 * lifetime, and comped access. An expired trial, or an org with no plan
 * and no lifetime access, comes back subscribed=false and stays out of
 * every admin route except the dashboard home, which shows an upgrade nudge.
 *
 * product_id "org_trial" is a valid trial, not a missing plan. Treating it
 * as unpaid sent every existing web trial org to /choose-plan.
 *
 * Zero imports so node:test can load this file with --experimental-strip-types.
 */

/**
 * Expired-trial and no-plan accounts stay on the dashboard home so the
 * upgrade nudge can render. Every other admin route still redirects.
 */
export function dashboardHomeKeepsExpiredTrial(pathname: string): boolean {
  return pathname === "/dashboard" || pathname === "/dashboard/";
}

/**
 * Where AdminRoute sends an account that cannot use the dashboard.
 * Native always uses the subscription wall. On the web, an existing
 * customer updates a card; a new account picks a plan.
 */
export function billingPaywallPath(opts: {
  native: boolean;
  paymentFailed?: boolean;
  subscriptionEnd?: string | null;
  productId?: string | null;
}): string {
  if (opts.native) return "/dashboard/subscription";
  const existingCustomer =
    opts.paymentFailed === true ||
    !!opts.subscriptionEnd ||
    (!!opts.productId && opts.productId !== "org_trial");
  return existingCustomer ? "/dashboard/subscription" : "/choose-plan";
}

export function hasPaidDashboardAccess(opts: {
  isFreeAccount: boolean;
  /** check-subscription subscribed flag. True for every active trial above. */
  subscribed: boolean;
  /**
   * check-subscription trial_active. Granted on its own so a trial flag
   * cannot be dropped if subscribed and trial_active ever disagree.
   */
  trialActive?: boolean;
}): boolean {
  if (opts.isFreeAccount) return true;
  if (opts.subscribed) return true;
  if (opts.trialActive) return true;
  return false;
}

export type SubscriptionCheckState = 'idle' | 'loading' | 'ready' | 'error';
export type SubscriptionRenderGate = 'ready' | 'skeleton' | 'error';

/**
 * The dashboard paints from a cached subscription while check-subscription
 * revalidates. With nothing cached, a check that has not succeeded still
 * holds the skeleton — an unanswered check used to render the product.
 */
export function subscriptionRenderGate(opts: {
  paywallAllowed: boolean;
  hasSubscription: boolean;
  check: SubscriptionCheckState;
}): SubscriptionRenderGate {
  if (opts.paywallAllowed || opts.hasSubscription) return 'ready';
  if (opts.check === 'idle' || opts.check === 'loading') return 'skeleton';
  return 'error';
}
