/**
 * In-app upgrade during an org trial.
 *
 * The card-free 30 days live on profiles.trial_ends_at. When that user
 * adds a card, Stripe's trial_end is that exact unix second — never a
 * later whole-day boundary, and never a fresh trial_period_days. Checkout
 * labels the trial by flooring whole 24-hour periods, so the dashboard
 * uses the same floor (`trialDaysLeft`).
 *
 * Stripe rejects trial_end inside 48 hours. That case returns null and
 * the caller collects a card and bills immediately.
 */

const DAY_SEC = 24 * 60 * 60;
export const MIN_STRIPE_TRIAL_LEAD_SEC = 48 * 60 * 60;

export function stripeTrialEndUnix(
  trialEndsAt: string | null | undefined,
  nowMs = Date.now(),
): number | null {
  if (!trialEndsAt) return null;
  const endsMs = Date.parse(trialEndsAt);
  if (!Number.isFinite(endsMs)) return null;
  const trialEnd = Math.floor(endsMs / 1000);
  const stripeNow = Math.floor(nowMs / 1000);
  if (trialEnd - stripeNow < MIN_STRIPE_TRIAL_LEAD_SEC) return null;
  return trialEnd;
}

/** Whole days Stripe Checkout displays for a trial_end unix timestamp. */
export function stripeCheckoutTrialDays(trialEndUnix: number, nowMs: number): number {
  return Math.floor((trialEndUnix - Math.floor(nowMs / 1000)) / DAY_SEC);
}
