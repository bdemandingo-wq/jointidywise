// Loyalty price schedule and the continuous-subscription clock.
//
// Runner (no vitest in this repo; Node strips the types):
//   node --experimental-strip-types --test src/lib/loyaltyPricing.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  LOYALTY_PRICING,
  addUtcMonths,
  billingLoyaltyLine,
  cancelLoyaltyWarning,
  loyaltyCouponChange,
  loyaltyCouponCreateParams,
  nextLoyaltyClock,
  nextSubscriptionDiscounts,
  pricingPageLoyaltyLine,
  quoteLoyaltyPrice,
  type LoyaltyClockInput,
} from "../../supabase/functions/_shared/loyalty-pricing.ts";

const PRO_START = "2024-01-15T00:00:00.000Z";
const BASIC_START = "2024-01-01T00:00:00.000Z";

function clock(over: Partial<LoyaltyClockInput> = {}): LoyaltyClockInput {
  return {
    continuousSince: PRO_START,
    previousResetAt: null,
    status: "active",
    cancelAtPeriodEnd: false,
    lifetime: false,
    plan: "pro",
    interval: "month",
    subscriptionStart: PRO_START,
    otherPaidSubscription: false,
    now: "2026-01-15T00:00:00.000Z",
    ...over,
  };
}

test("step, interval, and floor live in one config", () => {
  assert.equal(LOYALTY_PRICING.intervalMonths, 2);
  assert.deepEqual(LOYALTY_PRICING.plans.pro, { listCents: 9700, stepCents: 400, floorCents: 6700 });
  assert.deepEqual(LOYALTY_PRICING.plans.basic, { listCents: 4900, stepCents: 200, floorCents: 3500 });
  assert.equal(pricingPageLoyaltyLine(), "Your price drops every 2 months you stay.");
});

test("pro drops $4 every 2 months and the last step lands on $67, not $65", () => {
  const at = (iso: string) => quoteLoyaltyPrice("pro", PRO_START, iso);
  const start = at(PRO_START);
  assert.equal(start.priceCents, 9700);
  assert.equal(start.nextDrop?.priceCents, 9300);
  assert.equal(start.nextDrop?.on, "2024-03-15T00:00:00.000Z");
  assert.equal(billingLoyaltyLine(start), "Your price: $97/mo. Next drop: $93 on March 15, 2024. Lowest: $67");

  assert.equal(at("2024-03-14T23:59:59.000Z").priceCents, 9700);
  assert.equal(at("2024-03-15T00:00:00.000Z").priceCents, 9300);
  assert.equal(at("2024-05-15T00:00:00.000Z").priceCents, 8900);
  assert.equal(at("2025-03-15T00:00:00.000Z").priceCents, 6900);
  assert.equal(at("2025-03-15T00:00:00.000Z").nextDrop?.priceCents, 6700);

  const floor = at("2025-05-15T00:00:00.000Z");
  assert.equal(floor.priceCents, 6700);
  assert.equal(floor.nextDrop, null);
  assert.equal(floor.atFloor, true);
  assert.equal(floor.progress, 1);
  assert.equal(billingLoyaltyLine(floor), "Your price: $67/mo. Lowest: $67");
  assert.equal(at("2028-01-15T00:00:00.000Z").priceCents, 6700);
});

test("basic drops $2 every 2 months and stops at $35", () => {
  const at = (months: number) => quoteLoyaltyPrice("basic", BASIC_START, addUtcMonths(BASIC_START, months));
  assert.equal(at(0).priceCents, 4900);
  assert.equal(at(2).priceCents, 4700);
  assert.equal(at(6).priceCents, 4300);
  assert.equal(at(12).priceCents, 3700);
  assert.equal(at(12).nextDrop?.priceCents, 3500);
  assert.equal(at(14).priceCents, 3500);
  assert.equal(at(14).nextDrop, null);
  assert.equal(at(36).priceCents, 3500);
});

test("the progress bar is the fraction of the current 2-month window", () => {
  const quote = quoteLoyaltyPrice("pro", PRO_START, PRO_START);
  const start = Date.parse(PRO_START);
  const end = Date.parse(quote.nextDrop!.on);
  const mid = new Date(start + (end - start) / 2).toISOString();
  const halfway = quoteLoyaltyPrice("pro", PRO_START, mid);
  assert.ok(Math.abs(halfway.progress - 0.5) < 0.001);
  assert.equal(quoteLoyaltyPrice("pro", PRO_START, PRO_START).progress, 0);
});

test("month-end anniversaries clamp in UTC", () => {
  assert.equal(addUtcMonths("2024-01-31T00:00:00.000Z", 1), "2024-02-29T00:00:00.000Z");
  assert.equal(addUtcMonths("2024-01-31T00:00:00.000Z", 6), "2024-07-31T00:00:00.000Z");
});

test("a past_due that recovers does not reset the clock", () => {
  const since = PRO_START;
  const late = nextLoyaltyClock(clock({ status: "past_due", continuousSince: since }));
  assert.equal(late.continuousSince, since);
  assert.equal(late.resetReason, null);
  assert.equal(late.changed, false);

  const recovered = nextLoyaltyClock(clock({
    status: "active",
    continuousSince: late.continuousSince,
    now: "2026-02-01T00:00:00.000Z",
  }));
  assert.equal(recovered.continuousSince, since);
  assert.equal(recovered.resetReason, null);
});

test("cancel at period end keeps the rate until the subscription actually ends", () => {
  const kept = nextLoyaltyClock(clock({ status: "active", cancelAtPeriodEnd: true }));
  assert.equal(kept.continuousSince, PRO_START);
  assert.equal(kept.resetReason, null);
});

test("cancellation resets, and coming back starts over at the list price", () => {
  const ended = nextLoyaltyClock(clock({ status: "canceled", now: "2026-03-01T00:00:00.000Z" }));
  assert.equal(ended.continuousSince, null);
  assert.equal(ended.resetReason, "cancelled");

  const returned = nextLoyaltyClock(clock({
    continuousSince: null,
    previousResetAt: "2026-03-01T00:00:00.000Z",
    status: "active",
    subscriptionStart: PRO_START,
    now: "2026-04-01T00:00:00.000Z",
  }));
  assert.equal(returned.continuousSince, "2026-04-01T00:00:00.000Z");
  const price = quoteLoyaltyPrice("pro", returned.continuousSince!, returned.continuousSince!);
  assert.equal(price.priceCents, 9700);
  assert.equal(cancelLoyaltyWarning(quoteLoyaltyPrice("pro", PRO_START, "2024-05-15T00:00:00.000Z")),
    "You'll lose your $89 rate. If you come back you'll pay $97");
});

test("a new subscription after cancel uses that subscription's own start", () => {
  const returned = nextLoyaltyClock(clock({
    continuousSince: null,
    previousResetAt: "2026-03-01T00:00:00.000Z",
    subscriptionStart: "2026-05-01T00:00:00.000Z",
    now: "2026-05-01T00:00:00.000Z",
  }));
  assert.equal(returned.continuousSince, "2026-05-01T00:00:00.000Z");
});

test("an unpaid end resets, and a second cancel of an empty clock does not", () => {
  const unpaid = nextLoyaltyClock(clock({ status: "unpaid" }));
  assert.equal(unpaid.continuousSince, null);
  assert.equal(unpaid.resetReason, "unpaid_ended");

  const expired = nextLoyaltyClock(clock({ status: "incomplete_expired" }));
  assert.equal(expired.resetReason, "unpaid_ended");

  const again = nextLoyaltyClock(clock({
    continuousSince: null,
    status: "canceled",
    previousResetAt: "2026-03-01T00:00:00.000Z",
  }));
  assert.equal(again.changed, false);
  assert.equal(again.resetReason, null);
});

test("ending one subscription does not reset the clock while another paid one is active", () => {
  const kept = nextLoyaltyClock(clock({ status: "canceled", otherPaidSubscription: true }));
  assert.equal(kept.continuousSince, PRO_START);
  assert.equal(kept.resetReason, null);
});

test("the current subscriber is seeded from the original subscription start", () => {
  const seeded = nextLoyaltyClock(clock({
    continuousSince: null,
    previousResetAt: null,
    subscriptionStart: "2023-06-01T00:00:00.000Z",
    now: "2026-10-13T00:00:00.000Z",
  }));
  assert.equal(seeded.continuousSince, "2023-06-01T00:00:00.000Z");
  assert.equal(seeded.changed, true);
  const quote = quoteLoyaltyPrice("pro", seeded.continuousSince!, "2026-10-13T00:00:00.000Z");
  assert.equal(quote.priceCents, 6700);
});

test("an existing clock is not replaced by the original start date", () => {
  const kept = nextLoyaltyClock(clock({
    continuousSince: "2025-02-01T00:00:00.000Z",
    subscriptionStart: "2023-06-01T00:00:00.000Z",
  }));
  assert.equal(kept.continuousSince, "2025-02-01T00:00:00.000Z");
  assert.equal(kept.changed, false);
});

test("lifetime, yearly, custom, and trials do not start a loyalty clock", () => {
  assert.equal(nextLoyaltyClock(clock({ lifetime: true, continuousSince: null })).changed, false);
  assert.equal(nextLoyaltyClock(clock({ lifetime: true })).continuousSince, PRO_START);
  assert.equal(nextLoyaltyClock(clock({
    continuousSince: null,
    interval: "year",
    subscriptionStart: PRO_START,
  })).continuousSince, null);
  assert.equal(nextLoyaltyClock(clock({
    continuousSince: null,
    plan: "custom",
  })).continuousSince, null);
  assert.equal(nextLoyaltyClock(clock({
    continuousSince: null,
    status: "trialing",
  })).continuousSince, null);
  assert.equal(nextLoyaltyClock(clock({
    continuousSince: null,
    status: "past_due",
  })).continuousSince, null);
});

test("a pause keeps the clock", () => {
  const paused = nextLoyaltyClock(clock({ status: "paused" }));
  assert.equal(paused.continuousSince, PRO_START);
  assert.equal(paused.resetReason, null);
});

test("the renewal coupon is idempotent and leaves other discounts alone", () => {
  const params = loyaltyCouponCreateParams("pro", 800);
  assert.equal(params.id, "tw_loyalty_pro_800");
  assert.equal(params.amount_off, 800);
  assert.equal(params.duration, "forever");
  assert.equal(params.currency, "usd");

  const earned = loyaltyCouponChange({
    lifetime: false,
    plan: "pro",
    interval: "month",
    continuousSince: PRO_START,
    appliedDiscountCents: 0,
    existingCouponIds: ["referral_100"],
    now: "2024-03-12T00:00:00.000Z",
    renewalAt: "2024-03-15T00:00:00.000Z",
    invoiceUpcoming: false,
  });
  assert.equal(earned.action, "set");
  assert.equal(earned.couponId, "tw_loyalty_pro_400");
  assert.equal(earned.discountCents, 400);

  const again = loyaltyCouponChange({
    lifetime: false,
    plan: "pro",
    interval: "month",
    continuousSince: PRO_START,
    appliedDiscountCents: 400,
    existingCouponIds: ["referral_100", "tw_loyalty_pro_400"],
    now: "2024-03-12T00:00:00.000Z",
    renewalAt: "2024-03-15T00:00:00.000Z",
    invoiceUpcoming: true,
  });
  assert.equal(again.action, "noop");
  assert.equal(again.reason, "already_applied");

  const tooEarly = loyaltyCouponChange({
    lifetime: false,
    plan: "pro",
    interval: "month",
    continuousSince: PRO_START,
    appliedDiscountCents: 0,
    existingCouponIds: [],
    now: "2024-02-01T00:00:00.000Z",
    renewalAt: "2024-02-15T00:00:00.000Z",
    invoiceUpcoming: false,
  });
  assert.equal(tooEarly.action, "noop");

  assert.deepEqual(
    nextSubscriptionDiscounts(
      [
        { id: "di_referral", couponId: "referral_100" },
        { id: "di_old", couponId: "tw_loyalty_pro_400" },
      ],
      "tw_loyalty_pro_800",
    ),
    [{ discount: "di_referral" }, { coupon: "tw_loyalty_pro_800" }],
  );
});

test("lifetime and a zero discount clear a loyalty coupon without touching others", () => {
  const lifetime = loyaltyCouponChange({
    lifetime: true,
    plan: "pro",
    interval: "month",
    continuousSince: PRO_START,
    appliedDiscountCents: 400,
    existingCouponIds: ["tw_loyalty_pro_400"],
    now: "2026-01-01T00:00:00.000Z",
    renewalAt: null,
    invoiceUpcoming: false,
  });
  assert.equal(lifetime.action, "clear");
  assert.equal(lifetime.reason, "lifetime");

  assert.deepEqual(
    nextSubscriptionDiscounts([{ id: "di_referral", couponId: "referral_100" }], null),
    [{ discount: "di_referral" }],
  );
  assert.equal(nextSubscriptionDiscounts([{ id: "di_loyalty", couponId: "tw_loyalty_basic_200" }], null), "");
});

test("the list price has no cancel warning", () => {
  assert.equal(cancelLoyaltyWarning(quoteLoyaltyPrice("pro", PRO_START, PRO_START)), null);
  assert.equal(cancelLoyaltyWarning(quoteLoyaltyPrice("basic", BASIC_START, addUtcMonths(BASIC_START, 2))),
    "You'll lose your $47 rate. If you come back you'll pay $49");
});
