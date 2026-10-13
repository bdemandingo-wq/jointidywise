/**
 * Loyalty pricing for TidyWise subscriptions.
 *
 * One config: list price, step, interval, and floor. Pro drops $5 every 6
 * months of continuous paid subscription until $77. Basic drops $3 until $39.
 * Cancel, or an unpaid end, restarts the business at the list price. A
 * past_due that recovers does not. Lifetime, Custom, and yearly plans are
 * not on this schedule.
 *
 * This file is the only copy. The Vite app and the edge functions both
 * import it. It has no Deno or DOM dependencies so node:test can load it.
 */

export const LOYALTY_PRICING = {
  /** Months of continuous paid subscription between price drops. */
  intervalMonths: 6,
  /** Stable Stripe coupon id prefix. Coupons are amount-off, forever, usd. */
  couponPrefix: "tw_loyalty_",
  /**
   * Attach the earned coupon this many days before renewal, and when
   * invoice.upcoming fires. proration_behavior stays "none", so Stripe
   * does not open a charge for the current period.
   */
  applyWindowDays: 7,
  plans: {
    basic: { listCents: 4900, stepCents: 300, floorCents: 3900 },
    pro: { listCents: 9700, stepCents: 500, floorCents: 7700 },
  },
} as const;

export type LoyaltyPlanId = keyof typeof LOYALTY_PRICING.plans;

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export function loyaltyPlanOf(plan: string | null | undefined, interval: string | null | undefined): LoyaltyPlanId | null {
  if (plan !== "basic" && plan !== "pro") return null;
  if (interval !== "month" && interval !== "monthly") return null;
  return plan;
}

export function isLifetimePlan(input: {
  lifetime?: boolean;
  planType?: string | null;
  grandfatheredLifetime?: boolean;
  productId?: string | null;
}): boolean {
  return input.lifetime === true
    || input.grandfatheredLifetime === true
    || input.planType === "lifetime"
    || input.productId === "lifetime";
}

/** Add calendar months in UTC. Month-end days clamp (Jan 31 + 1 month = Feb 28/29). */
export function addUtcMonths(iso: string, months: number): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) throw new Error("invalid date");
  if (months === 0) return d.toISOString();
  const day = d.getUTCDate();
  const base = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, 1));
  const year = base.getUTCFullYear();
  const month = base.getUTCMonth();
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(Date.UTC(
    year,
    month,
    Math.min(day, lastDay),
    d.getUTCHours(),
    d.getUTCMinutes(),
    d.getUTCSeconds(),
    d.getUTCMilliseconds(),
  )).toISOString();
}

export function formatLoyaltyDollars(cents: number): string {
  const dollars = cents / 100;
  const text = Number.isInteger(dollars) ? String(dollars) : dollars.toFixed(2);
  return `$${text}`;
}

/** UTC calendar date. The loyalty anniversary is a subscription instant, not an org business day. */
export function formatLoyaltyDate(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return iso;
  return `${MONTH_NAMES[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

export function completedLoyaltySteps(sinceIso: string, asOfIso: string): number {
  const since = Date.parse(sinceIso);
  const asOf = Date.parse(asOfIso);
  if (!Number.isFinite(since) || !Number.isFinite(asOf) || asOf < since) return 0;
  let steps = 0;
  while (steps < 240) {
    const boundary = Date.parse(addUtcMonths(sinceIso, (steps + 1) * LOYALTY_PRICING.intervalMonths));
    if (asOf < boundary) break;
    steps += 1;
  }
  return steps;
}

export interface LoyaltyQuote {
  plan: LoyaltyPlanId;
  listCents: number;
  priceCents: number;
  floorCents: number;
  stepCents: number;
  intervalMonths: number;
  steps: number;
  discountCents: number;
  nextDrop: { priceCents: number; on: string } | null;
  /** 0 at the start of the current 6-month window, 1 at the floor. */
  progress: number;
  atFloor: boolean;
}

function priceForSteps(plan: LoyaltyPlanId, steps: number): { priceCents: number; discountCents: number } {
  const cfg = LOYALTY_PRICING.plans[plan];
  const maxDiscount = cfg.listCents - cfg.floorCents;
  const discountCents = Math.min(Math.max(0, steps) * cfg.stepCents, maxDiscount);
  return { priceCents: cfg.listCents - discountCents, discountCents };
}

export function quoteLoyaltyPrice(plan: LoyaltyPlanId, continuousSince: string, asOf: string): LoyaltyQuote {
  const cfg = LOYALTY_PRICING.plans[plan];
  const steps = completedLoyaltySteps(continuousSince, asOf);
  const { priceCents, discountCents } = priceForSteps(plan, steps);
  const atFloor = priceCents <= cfg.floorCents;
  let nextDrop: LoyaltyQuote["nextDrop"] = null;
  let progress = 1;
  if (!atFloor) {
    const next = priceForSteps(plan, steps + 1);
    const on = addUtcMonths(continuousSince, (steps + 1) * LOYALTY_PRICING.intervalMonths);
    nextDrop = { priceCents: next.priceCents, on };
    const windowStart = Date.parse(addUtcMonths(continuousSince, steps * LOYALTY_PRICING.intervalMonths));
    const windowEnd = Date.parse(on);
    const now = Date.parse(asOf);
    const span = windowEnd - windowStart;
    progress = span <= 0 ? 1 : Math.min(1, Math.max(0, (now - windowStart) / span));
  }
  return {
    plan,
    listCents: cfg.listCents,
    priceCents,
    floorCents: cfg.floorCents,
    stepCents: cfg.stepCents,
    intervalMonths: LOYALTY_PRICING.intervalMonths,
    steps,
    discountCents,
    nextDrop,
    progress,
    atFloor,
  };
}

export function billingLoyaltyLine(quote: LoyaltyQuote): string {
  const price = `${formatLoyaltyDollars(quote.priceCents)}/mo`;
  const lowest = formatLoyaltyDollars(quote.floorCents);
  if (!quote.nextDrop) {
    return `Your price: ${price}. Lowest: ${lowest}`;
  }
  return `Your price: ${price}. Next drop: ${formatLoyaltyDollars(quote.nextDrop.priceCents)} on ${formatLoyaltyDate(quote.nextDrop.on)}. Lowest: ${lowest}`;
}

/** Shown in the cancel flow once a lower rate has been earned. Null at the list price. */
export function cancelLoyaltyWarning(quote: LoyaltyQuote): string | null {
  if (quote.priceCents >= quote.listCents) return null;
  return `You'll lose your ${formatLoyaltyDollars(quote.priceCents)} rate. If you come back you'll pay ${formatLoyaltyDollars(quote.listCents)}`;
}

export function pricingPageLoyaltyLine(): string {
  return `Your price drops every ${LOYALTY_PRICING.intervalMonths} months you stay.`;
}

export function loyaltyCouponId(plan: LoyaltyPlanId, discountCents: number): string {
  return `${LOYALTY_PRICING.couponPrefix}${plan}_${discountCents}`;
}

export function loyaltyCouponCreateParams(plan: LoyaltyPlanId, discountCents: number): {
  id: string;
  amount_off: number;
  currency: "usd";
  duration: "forever";
  name: string;
} {
  return {
    id: loyaltyCouponId(plan, discountCents),
    amount_off: discountCents,
    currency: "usd",
    duration: "forever",
    name: `Loyalty ${plan} ${formatLoyaltyDollars(discountCents)} off`,
  };
}

const CANCEL_STATUSES = new Set(["canceled", "cancelled"]);
const UNPAID_END_STATUSES = new Set(["unpaid", "incomplete_expired"]);

export interface LoyaltyClockInput {
  continuousSince: string | null;
  /** Set when an earlier cancel or unpaid end wiped the clock. */
  previousResetAt: string | null;
  status: string;
  cancelAtPeriodEnd: boolean;
  lifetime: boolean;
  plan: string | null;
  interval: string | null;
  /** Stripe subscription.start_date. Seeds the first clock, including the current subscriber. */
  subscriptionStart: string | null;
  /** Another active or past_due subscription still covers this org. */
  otherPaidSubscription: boolean;
  now: string;
}

export interface LoyaltyClockResult {
  continuousSince: string | null;
  resetReason: null | "cancelled" | "unpaid_ended";
  changed: boolean;
}

export function nextLoyaltyClock(input: LoyaltyClockInput): LoyaltyClockResult {
  const keep = (since: string | null): LoyaltyClockResult => ({
    continuousSince: since,
    resetReason: null,
    changed: since !== input.continuousSince,
  });

  if (input.lifetime) return keep(input.continuousSince);

  const status = input.status;
  const ended = CANCEL_STATUSES.has(status) || UNPAID_END_STATUSES.has(status);
  if (ended && !input.otherPaidSubscription) {
    if (input.continuousSince == null) {
      return { continuousSince: null, resetReason: null, changed: false };
    }
    return {
      continuousSince: null,
      resetReason: UNPAID_END_STATUSES.has(status) ? "unpaid_ended" : "cancelled",
      changed: true,
    };
  }

  // Still in the subscription: active, a pause, a trial on the same sub,
  // or a past_due that has not ended. cancel_at_period_end is not an end.
  const stillSubscribed = status === "active"
    || status === "past_due"
    || status === "paused"
    || status === "trialing";
  if (!stillSubscribed) return keep(input.continuousSince);

  if (input.continuousSince) return keep(input.continuousSince);

  // Do not start the clock on a trial, a pause, or a first invoice that is
  // already past_due. The paid streak starts when the subscription is active.
  if (status !== "active") return keep(null);
  if (!loyaltyPlanOf(input.plan, input.interval)) return keep(null);

  let start = input.subscriptionStart;
  if (!start) return keep(null);
  // Same subscription came back after a reset. Its original start_date is
  // still the old one, which would restore the rate they gave up.
  if (input.previousResetAt && Date.parse(start) <= Date.parse(input.previousResetAt)) {
    start = input.now;
  }
  return { continuousSince: start, resetReason: null, changed: true };
}

export interface LoyaltyCouponDecision {
  action: "noop" | "set" | "clear";
  couponId: string | null;
  discountCents: number;
  reason: string;
}

function hasLoyaltyCoupon(ids: readonly string[]): boolean {
  return ids.some((id) => id.startsWith(LOYALTY_PRICING.couponPrefix));
}

/**
 * Decide the coupon that should be on the subscription at the renewal
 * boundary. Idempotent: the same inputs return noop once the coupon matches.
 */
export function loyaltyCouponChange(input: {
  lifetime: boolean;
  plan: string | null;
  interval: string | null;
  continuousSince: string | null;
  appliedDiscountCents: number;
  existingCouponIds: readonly string[];
  now: string;
  renewalAt: string | null;
  invoiceUpcoming: boolean;
}): LoyaltyCouponDecision {
  const loyaltyIds = input.existingCouponIds.filter((id) => id.startsWith(LOYALTY_PRICING.couponPrefix));
  const clear = (reason: string): LoyaltyCouponDecision => ({
    action: "clear",
    couponId: null,
    discountCents: 0,
    reason,
  });
  const noop = (reason: string, discountCents = input.appliedDiscountCents): LoyaltyCouponDecision => ({
    action: "noop",
    couponId: loyaltyIds[0] ?? null,
    discountCents,
    reason,
  });

  const plan = loyaltyPlanOf(input.plan, input.interval);
  if (input.lifetime || !plan || !input.continuousSince) {
    if (loyaltyIds.length > 0 || input.appliedDiscountCents > 0) return clear(input.lifetime ? "lifetime" : "not_eligible");
    return noop(input.lifetime ? "lifetime" : "not_eligible", 0);
  }

  const nowQuote = quoteLoyaltyPrice(plan, input.continuousSince, input.now);
  const renewalAt = input.renewalAt;
  const renewalMs = renewalAt ? Date.parse(renewalAt) : NaN;
  const nowMs = Date.parse(input.now);
  const windowMs = LOYALTY_PRICING.applyWindowDays * 24 * 60 * 60 * 1000;
  const withinWindow = Number.isFinite(renewalMs) && renewalMs >= nowMs - 60_000 && renewalMs - nowMs <= windowMs;
  const renewalQuote = renewalAt && Number.isFinite(renewalMs)
    ? quoteLoyaltyPrice(plan, input.continuousSince, renewalAt)
    : nowQuote;

  // Before the renewal that earns the next step, keep today's price.
  // Inside the apply window (or on invoice.upcoming), use the price the
  // upcoming invoice should charge.
  let target = nowQuote;
  if ((input.invoiceUpcoming || withinWindow) && renewalQuote.discountCents >= nowQuote.discountCents) {
    target = renewalQuote;
  }

  if (target.discountCents === 0) {
    if (loyaltyIds.length > 0 || input.appliedDiscountCents > 0) return clear("list_price");
    return noop("list_price", 0);
  }

  const couponId = loyaltyCouponId(plan, target.discountCents);
  const already = loyaltyIds.length === 1
    && loyaltyIds[0] === couponId
    && input.appliedDiscountCents === target.discountCents;
  if (already) return noop("already_applied", target.discountCents);

  return {
    action: "set",
    couponId,
    discountCents: target.discountCents,
    reason: target === renewalQuote && target !== nowQuote ? "renewal" : "earned",
  };
}

export interface DiscountRef {
  id: string;
  couponId: string | null;
}

/** Keep referral and winback discounts. Replace only tw_loyalty_* coupons. */
export function nextSubscriptionDiscounts(
  existing: readonly DiscountRef[],
  loyaltyCouponIdToApply: string | null,
): Array<{ discount: string } | { coupon: string }> | "" {
  const kept = existing
    .filter((d) => !d.couponId || !d.couponId.startsWith(LOYALTY_PRICING.couponPrefix))
    .map((d) => ({ discount: d.id }));
  if (loyaltyCouponIdToApply) {
    return [...kept, { coupon: loyaltyCouponIdToApply }];
  }
  if (kept.length === 0) return "";
  return kept;
}
