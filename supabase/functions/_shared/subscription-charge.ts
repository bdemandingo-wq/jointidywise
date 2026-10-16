import { stripeTrialEndUnix } from "./trial-end.ts";

/**
 * First-charge decision for create-subscription and the read-only preview.
 * The preview must call this function. Do not reimplement the 48-hour rule.
 *
 * Org plan_type trial: profiles.trial_ends_at through stripeTrialEndUnix.
 * At least 48 hours left sets trial_end and the card is charged then.
 * Under 48 hours, already ended, or a missing stamp sets neither trial_end
 * nor trial_period_days, so Stripe bills when checkout completes.
 * Any other existing plan: 14-day Stripe trial.
 * No user: 30-day Stripe trial, card optional.
 */

const DAY_SEC = 24 * 60 * 60;

export type SubscriptionChargeTiming = {
  billNow: boolean;
  /** ISO time of the first charge. Null when billNow, because the charge is today. */
  firstChargeAt: string | null;
  trialEndUnix: number | null;
  trialPeriodDays: number | null;
  paymentMethodCollection: "always" | "if_required";
};

export function subscriptionChargeTiming(opts: {
  hasUser: boolean;
  orgPlanType: string | null;
  trialEndsAt: string | null | undefined;
  nowMs?: number;
}): SubscriptionChargeTiming {
  const nowMs = opts.nowMs ?? Date.now();
  if (opts.hasUser && opts.orgPlanType === "trial") {
    const trialEnd = stripeTrialEndUnix(opts.trialEndsAt, nowMs);
    if (trialEnd != null) {
      return {
        billNow: false,
        firstChargeAt: new Date(trialEnd * 1000).toISOString(),
        trialEndUnix: trialEnd,
        trialPeriodDays: null,
        paymentMethodCollection: "always",
      };
    }
    return {
      billNow: true,
      firstChargeAt: null,
      trialEndUnix: null,
      trialPeriodDays: null,
      paymentMethodCollection: "always",
    };
  }
  if (opts.hasUser && opts.orgPlanType && opts.orgPlanType !== "trial") {
    return daysFromNow(14, "always", nowMs);
  }
  return daysFromNow(30, "if_required", nowMs);
}

function daysFromNow(
  days: number,
  paymentMethodCollection: "always" | "if_required",
  nowMs: number,
): SubscriptionChargeTiming {
  const endSec = Math.floor(nowMs / 1000) + days * DAY_SEC;
  return {
    billNow: false,
    firstChargeAt: new Date(endSec * 1000).toISOString(),
    trialEndUnix: null,
    trialPeriodDays: days,
    paymentMethodCollection,
  };
}

/**
 * Percents ensureOnboardingCoupon writes. Winback replaces a referral coupon
 * and the two are not stacked. half_off is 50, first month free is 100.
 */
export const WINBACK_PERCENT_OFF = {
  half_off_first_month: 50,
  first_month_free: 100,
} as const;

export type WinbackOffer = keyof typeof WINBACK_PERCENT_OFF;

export const WINBACK_COUPON_IDS: Record<WinbackOffer, string> = {
  half_off_first_month: "onboarding_half_off_first_month",
  first_month_free: "onboarding_first_month_free",
};

export function amountCentsAfterDiscounts(
  listCents: number,
  discount: { percentOff?: number | null; amountOffCents?: number | null } | null,
): number {
  if (!Number.isInteger(listCents) || listCents < 0) {
    throw new Error("List price cents must be a non-negative integer");
  }
  if (!discount) return listCents;
  let cents = listCents;
  if (discount.percentOff != null) {
    if (discount.percentOff < 0 || discount.percentOff > 100) {
      throw new Error("Discount percent is out of range");
    }
    cents = Math.round((listCents * (100 - discount.percentOff)) / 100);
  }
  if (discount.amountOffCents != null) {
    if (!Number.isInteger(discount.amountOffCents) || discount.amountOffCents < 0) {
      throw new Error("Discount amount cents must be a non-negative integer");
    }
    cents = Math.max(0, cents - discount.amountOffCents);
  }
  return cents;
}

export type CheckoutOrg = {
  id?: string;
  plan_type?: string;
  grandfathered_lifetime?: boolean;
};

export const CHECKOUT_MEMBERSHIP_SELECT =
  "role, organizations(id, plan_type, grandfathered_lifetime)";

export function orgFromMembership(row: {
  organizations?: CheckoutOrg | CheckoutOrg[] | null;
}): CheckoutOrg | null {
  const value = row.organizations;
  if (!value) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

/**
 * Same org choice as create-subscription. The requested org wins when this
 * user belongs to it. Otherwise a trial org, then owner/admin, then the first row.
 */
export function chooseCheckoutOrg(
  memberships: Array<{ role?: string; organizations?: CheckoutOrg | CheckoutOrg[] | null }>,
  requestedOrgId: string,
): { referredOrgId: string | null; orgPlanType: string | null; lifetime: boolean } {
  const requestedMembership = requestedOrgId
    ? memberships.find((row) => orgFromMembership(row)?.id === requestedOrgId)
    : undefined;
  const trialMembership = memberships.find((row) => orgFromMembership(row)?.plan_type === "trial");
  const ownerMembership = memberships.find((row) => row.role === "owner" || row.role === "admin");
  const chosen = requestedMembership ?? trialMembership ?? ownerMembership ?? memberships[0];
  const org = chosen ? orgFromMembership(chosen) : null;
  return {
    referredOrgId: org?.id ?? null,
    orgPlanType: org?.plan_type ?? null,
    lifetime: Boolean(org?.grandfathered_lifetime || org?.plan_type === "lifetime"),
  };
}

type DiscountQuery = {
  from: (table: string) => {
    select: (columns: string) => {
      eq: (column: string, value: string) => {
        in: (column: string, values: string[]) => {
          maybeSingle: () => Promise<{ data: Record<string, unknown> | null }>;
        };
        maybeSingle: () => Promise<{ data: Record<string, unknown> | null }>;
      };
    };
  };
};

export type CheckoutDiscountLookup = {
  referral: { couponId: string; referralRowId: string } | null;
  winbackOffer: WinbackOffer | null;
};

/**
 * Read-only. Does not stamp org_referrals or onboarding_winback and does not
 * create a Stripe coupon. Winback is preferred by the caller, matching
 * create-subscription, which drops the referral coupon when the winback
 * coupon is attached.
 */
export async function lookupCheckoutDiscount(
  admin: DiscountQuery,
  opts: { userId: string | null; referredOrgId: string | null; referralCouponId: string | null },
): Promise<CheckoutDiscountLookup> {
  let referral: CheckoutDiscountLookup["referral"] = null;
  try {
    if (opts.referralCouponId && opts.referredOrgId) {
      const { data: ref } = await admin
        .from("org_referrals")
        .select("id, status, referred_discount_applied_at, referred_first_payment_at")
        .eq("referred_org_id", opts.referredOrgId)
        .in("status", ["pending", "qualified"])
        .maybeSingle();
      if (ref && !ref.referred_first_payment_at && typeof ref.id === "string") {
        referral = { couponId: opts.referralCouponId, referralRowId: ref.id };
      }
    }
  } catch (e) {
    console.error("[referral] discount lookup failed:", e);
  }

  let winbackOffer: WinbackOffer | null = null;
  if (opts.userId) {
    try {
      const { data: winback } = await admin
        .from("onboarding_winback")
        .select("offer_used")
        .eq("user_id", opts.userId)
        .maybeSingle();
      const offer = winback?.offer_used;
      if (offer === "half_off_first_month" || offer === "first_month_free") {
        winbackOffer = offer;
      }
    } catch (e) {
      console.error("[winback] lookup failed:", e);
    }
  }

  return { referral, winbackOffer };
}
