/**
 * Who may see /dashboard.
 *
 * A paid Stripe subscription, lifetime purchase, comp, or allowlisted demo
 * account may. The unpaid organization trial (check-subscription product_id
 * "org_trial") may not, on the web: signup provisions plan_type 'trial' and
 * a 14-day trial_ends_at, and treating that as subscribed let a new account
 * open /dashboard without paying. Native keeps that trial because the web
 * paywall is not offered in the iOS app.
 *
 * Zero imports so node:test can load this file with --experimental-strip-types.
 */

export const UNPAID_ORG_TRIAL_PRODUCT_ID = "org_trial";

export function hasPaidDashboardAccess(opts: {
  isFreeAccount: boolean;
  subscribed: boolean;
  productId?: string | null;
  /** True on the iOS/Android shell, where the unpaid org trial is still allowed. */
  allowUnpaidOrgTrial: boolean;
}): boolean {
  if (opts.isFreeAccount) return true;
  if (!opts.subscribed) return false;
  if (opts.productId === UNPAID_ORG_TRIAL_PRODUCT_ID && !opts.allowUnpaidOrgTrial) return false;
  return true;
}
