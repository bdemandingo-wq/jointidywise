/**
 * Onboarding winback decisions. The edge function
 * supabase/functions/send-onboarding-winback copies dueWinbackEmail;
 * keep the two in step.
 *
 * The 30-day trial replaces 14 days measured from profile creation.
 * It never shortens a longer trial that is already on the account.
 */

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

export type WinbackOffer = "trial_30" | "half_off_first_month" | "first_month_free";

export const WINBACK_COUPON_IDS: Record<Exclude<WinbackOffer, "trial_30">, string> = {
  half_off_first_month: "onboarding_half_off_first_month",
  first_month_free: "onboarding_first_month_free",
};

export function dueWinbackEmail(opts: {
  startedAt: string;
  completedAt?: string | null;
  email1hSentAt?: string | null;
  email24hSentAt?: string | null;
  now?: number;
}): "half_off_first_month" | "first_month_free" | null {
  if (opts.completedAt) return null;
  const started = Date.parse(opts.startedAt);
  if (!Number.isFinite(started)) return null;
  const now = opts.now ?? Date.now();
  const age = now - started;
  if (age < HOUR_MS) return null;
  // Past a week the offer is stale. Do not email a long-abandoned signup.
  if (age > 7 * DAY_MS) return null;
  if (age >= DAY_MS && !opts.email24hSentAt) return "first_month_free";
  if (age < DAY_MS && !opts.email1hSentAt) return "half_off_first_month";
  return null;
}

/** New trial end if 30 days from signup is later than what they have. */
export function extendedTrialEnd(opts: {
  createdAt: string;
  currentEnd?: string | null;
  now?: number;
}): string | null {
  const start = Date.parse(opts.createdAt);
  if (!Number.isFinite(start)) return null;
  const target = start + 30 * DAY_MS;
  const now = opts.now ?? Date.now();
  if (target <= now) return null;
  const current = opts.currentEnd ? Date.parse(opts.currentEnd) : NaN;
  if (Number.isFinite(current) && target <= current) return null;
  return new Date(target).toISOString();
}

/** Login may only resume this wizard. Anything else is ignored. */
export function safeOnboardingNext(value: string | null | undefined): string | null {
  if (!value) return null;
  if (!value.startsWith("/onboarding")) return null;
  if (value.startsWith("//") || value.includes("://") || value.includes("\\")) return null;
  return value;
}

export function chooseCheckoutCoupon(opts: {
  winbackOffer: string | null | undefined;
  referralCouponId: string | null | undefined;
}): { coupon: string; source: "winback" | "referral" } | null {
  if (opts.winbackOffer === "first_month_free" || opts.winbackOffer === "half_off_first_month") {
    return { coupon: WINBACK_COUPON_IDS[opts.winbackOffer], source: "winback" };
  }
  if (opts.referralCouponId) return { coupon: opts.referralCouponId, source: "referral" };
  return null;
}
