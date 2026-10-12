import { test } from "node:test";
import assert from "node:assert/strict";
import {
  chooseCheckoutCoupon,
  dueWinbackEmail,
  extendedTrialEnd,
  safeOnboardingNext,
} from "./onboardingWinback.ts";

const HOUR = 60 * 60 * 1000;
const start = Date.parse("2026-10-01T00:00:00.000Z");

test("nothing is due before an hour, and a finished signup is silent", () => {
  const base = { startedAt: new Date(start).toISOString(), now: start + 30 * 60 * 1000 };
  assert.equal(dueWinbackEmail(base), null);
  assert.equal(dueWinbackEmail({ ...base, now: start + 2 * HOUR, completedAt: new Date(start).toISOString() }), null);
});

test("the 1 hour email is 50% off, and it is not sent after the free-month email", () => {
  assert.equal(dueWinbackEmail({
    startedAt: new Date(start).toISOString(),
    now: start + 90 * 60 * 1000,
  }), "half_off_first_month");
  assert.equal(dueWinbackEmail({
    startedAt: new Date(start).toISOString(),
    now: start + 25 * HOUR,
  }), "first_month_free");
  assert.equal(dueWinbackEmail({
    startedAt: new Date(start).toISOString(),
    email24hSentAt: new Date(start).toISOString(),
    now: start + 25 * HOUR,
  }), null);
});

test("a week-old abandonment is not emailed", () => {
  assert.equal(dueWinbackEmail({
    startedAt: new Date(start).toISOString(),
    now: start + 8 * 24 * HOUR,
  }), null);
});

test("30 days from signup replaces 14 and never shortens a longer trial", () => {
  const createdAt = new Date(start).toISOString();
  const extended = extendedTrialEnd({
    createdAt,
    currentEnd: new Date(start + 14 * 24 * HOUR).toISOString(),
    now: start + HOUR,
  });
  assert.equal(extended, new Date(start + 30 * 24 * HOUR).toISOString());
  assert.equal(extendedTrialEnd({
    createdAt,
    currentEnd: new Date(start + 60 * 24 * HOUR).toISOString(),
    now: start + HOUR,
  }), null);
});

test("the login return path only resumes onboarding", () => {
  assert.equal(safeOnboardingNext("/onboarding?winback=abc"), "/onboarding?winback=abc");
  assert.equal(safeOnboardingNext("https://evil.example/onboarding"), null);
  assert.equal(safeOnboardingNext("//evil.example"), null);
  assert.equal(safeOnboardingNext("/dashboard"), null);
});

test("a free month beats the referral coupon, and the coupons are not stacked", () => {
  assert.deepEqual(chooseCheckoutCoupon({
    winbackOffer: "first_month_free",
    referralCouponId: "referral_50",
  }), { coupon: "onboarding_first_month_free", source: "winback" });
  assert.deepEqual(chooseCheckoutCoupon({
    winbackOffer: null,
    referralCouponId: "referral_50",
  }), { coupon: "referral_50", source: "referral" });
});
