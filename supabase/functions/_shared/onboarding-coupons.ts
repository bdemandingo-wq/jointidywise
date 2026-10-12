import Stripe from "https://esm.sh/stripe@18.5.0";

/**
 * Coupons for the onboarding winback emails. Created with stripe.coupons.create
 * against STRIPE_SECRET_KEY, so a live key mints live coupons and a test key
 * mints test coupons. IDs are stable. Nothing here is a test-mode-only id.
 *
 * duration is repeating/1 month, not once. Checkout with a trial issues a $0
 * invoice, and a once coupon is consumed by that invoice, so the first real
 * month would not be discounted.
 */
export const ONBOARDING_COUPONS = {
  half_off_first_month: {
    id: "onboarding_half_off_first_month",
    percent_off: 50,
    name: "Onboarding — 50% off first month",
  },
  first_month_free: {
    id: "onboarding_first_month_free",
    percent_off: 100,
    name: "Onboarding — first month free",
  },
} as const;

export type OnboardingCouponOffer = keyof typeof ONBOARDING_COUPONS;

export async function ensureOnboardingCoupon(
  stripe: Stripe,
  offer: OnboardingCouponOffer,
): Promise<string> {
  const spec = ONBOARDING_COUPONS[offer];
  try {
    const existing = await stripe.coupons.retrieve(spec.id);
    if (existing && !(existing as { deleted?: boolean }).deleted) return existing.id;
  } catch {
    // Missing coupon. Create it below.
  }
  const created = await stripe.coupons.create({
    id: spec.id,
    percent_off: spec.percent_off,
    duration: "repeating",
    duration_in_months: 1,
    name: spec.name,
  });
  return created.id;
}
