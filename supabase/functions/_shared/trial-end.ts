/**
 * Stripe Checkout labels a trial by flooring whole 24-hour periods.
 * The dashboard labels the same timestamp with ceil (`trialDaysLeft`).
 * A trial that ends in 12 days and 10 hours is "12 days free" in Checkout
 * and "13 days left" in the app.
 *
 * This returns a unix `trial_end` that is never earlier than the profile
 * timestamp and lands on a whole-day boundary from now, so Checkout's
 * floored count equals the app's ceiled count. Stripe rejects trial_end
 * inside 48 hours; that case returns null and the caller collects a card.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const DAY_SEC = 24 * 60 * 60;
export const MIN_STRIPE_TRIAL_LEAD_SEC = 48 * 60 * 60;

export function stripeTrialEndUnix(
  trialEndsAt: string | null | undefined,
  nowMs = Date.now(),
): number | null {
  if (!trialEndsAt) return null;
  const endsMs = Date.parse(trialEndsAt);
  if (!Number.isFinite(endsMs)) return null;
  const remainingMs = endsMs - nowMs;
  if (remainingMs < MIN_STRIPE_TRIAL_LEAD_SEC * 1000) return null;

  const appDays = Math.max(1, Math.ceil(remainingMs / DAY_MS));
  const stripeNow = Math.floor(nowMs / 1000);
  const aligned = stripeNow + appDays * DAY_SEC;
  const notBefore = Math.ceil(endsMs / 1000);
  const trialEnd = Math.max(aligned, notBefore);
  if (trialEnd - stripeNow < MIN_STRIPE_TRIAL_LEAD_SEC) return null;
  return trialEnd;
}

/** Whole days Stripe Checkout displays for a trial_end unix timestamp. */
export function stripeCheckoutTrialDays(trialEndUnix: number, nowMs: number): number {
  return Math.floor((trialEndUnix - Math.floor(nowMs / 1000)) / DAY_SEC);
}
