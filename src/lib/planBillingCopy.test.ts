// Runner (this file is executed; vitest is not installed and reports no suite):
//   node --experimental-strip-types --test src/lib/planBillingCopy.test.ts
// tsconfig.app.json sets allowImportingTsExtensions and excludes *.test.ts,
// so `tsc -p tsconfig.app.json` does not typecheck this import. Node does.
import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DOWNGRADE_EFFECT_NOTE,
  expiredTrialNudgeCopy,
  lifetimeSpotsToShow,
  planBillingAction,
  planChoicesFooter,
  renewalDisclosure,
  showPlanChoices,
  trialBillsOnCheckout,
  trialFirstChargeLine,
  trialEndDateLabel,
} from "./planBillingCopy.ts";
import { stripeTrialEndUnix } from "../../supabase/functions/_shared/trial-end.ts";
import { LIFETIME_SPOT_CAP } from "./publicPlans.ts";

test("basic and pro stay on checkout and custom is contact", () => {
  assert.equal(planBillingAction("basic"), "checkout");
  assert.equal(planBillingAction("pro"), "checkout");
  assert.equal(planBillingAction("custom"), "contact");
});

test("renewal disclosure names the real price and how to cancel", () => {
  assert.equal(
    renewalDisclosure(49),
    "Renews monthly at $49 until you cancel. Cancel anytime in Settings.",
  );
  assert.equal(
    renewalDisclosure(97),
    "Renews monthly at $97 until you cancel. Cancel anytime in Settings.",
  );
  assert.equal(
    renewalDisclosure(490, "yearly"),
    "Renews yearly at $490 until you cancel. Cancel anytime in Settings.",
  );
  assert.equal(renewalDisclosure(0), "");
});

test("trial charge copy follows stripeTrialEndUnix, the same rule as create-subscription", () => {
  // Nov 13, 11:00pm Eastern is already Nov 14 in UTC.
  const elevenPmEastern = "2026-11-14T04:00:00.000Z";
  const now = Date.parse("2026-10-16T12:00:00.000Z");
  assert.equal(trialEndDateLabel(elevenPmEastern, "America/New_York"), "Nov 13");
  assert.equal(trialEndDateLabel(elevenPmEastern, "UTC"), "Nov 14");
  assert.equal(trialEndDateLabel(null, "America/New_York"), null);
  assert.equal(trialEndDateLabel("not-a-date", "America/New_York"), null);
  assert.equal(trialEndDateLabel(elevenPmEastern, ""), null);

  assert.equal(stripeTrialEndUnix(elevenPmEastern, now) != null, true);
  assert.equal(trialBillsOnCheckout(elevenPmEastern, now), false);
  const eastern = trialFirstChargeLine({
    trialEndIso: elevenPmEastern,
    timeZone: "America/New_York",
    nowMs: now,
  });
  assert.equal(eastern, "Your first charge is Nov 13, 2026.");
  assert.equal(
    trialFirstChargeLine({ trialEndIso: elevenPmEastern, timeZone: "UTC", nowMs: now }),
    "Your first charge is Nov 14, 2026.",
  );

  const soon = new Date(now + 36 * 60 * 60 * 1000).toISOString();
  assert.equal(stripeTrialEndUnix(soon, now), null);
  assert.equal(trialBillsOnCheckout(soon, now), true);
  assert.equal(
    trialFirstChargeLine({ trialEndIso: soon, timeZone: "America/New_York", price: 97, nowMs: now }),
    "You'll be charged $97 today.",
  );
  assert.equal(
    trialFirstChargeLine({ trialEndIso: soon, timeZone: "America/New_York", nowMs: now }),
    null,
  );

  const exactly48h = new Date(now + 48 * 60 * 60 * 1000).toISOString();
  assert.equal(stripeTrialEndUnix(exactly48h, now) != null, true);
  assert.equal(trialBillsOnCheckout(exactly48h, now), false);
  assert.match(
    trialFirstChargeLine({ trialEndIso: exactly48h, timeZone: "America/New_York", price: 49, nowMs: now }) ?? "",
    /^Your first charge is /,
  );

  const justUnder = new Date(now + 48 * 60 * 60 * 1000 - 1000).toISOString();
  assert.equal(stripeTrialEndUnix(justUnder, now), null);
  assert.equal(
    trialFirstChargeLine({ trialEndIso: justUnder, timeZone: "America/New_York", price: 49, nowMs: now }),
    "You'll be charged $49 today.",
  );

  assert.equal(trialFirstChargeLine({ trialEndIso: null, timeZone: "America/New_York", price: 49, nowMs: now }), null);
  assert.equal(trialFirstChargeLine({ trialEndIso: "not-a-date", timeZone: "America/New_York", price: 49, nowMs: now }), null);
  assert.equal(trialFirstChargeLine({ trialEndIso: elevenPmEastern, timeZone: "Not/AZone", nowMs: now }), null);

  const innerPx = 375 - 32 - 40;
  assert.ok(eastern);
  assert.ok(eastern.length * 6.6 <= innerPx);
  assert.ok("You'll be charged $1970 today.".length * 6.6 <= innerPx);
});

test("the lifetime cap is one shared constant at 100", () => {
  assert.equal(LIFETIME_SPOT_CAP, 100);
  const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
  const cap = read("../../supabase/functions/_shared/lifetime-cap.ts");
  const plans = read("./publicPlans.ts");
  const seo = read("../components/seo/AuthSEOContent.tsx");
  const counter = read("../hooks/useLifetimeCounter.ts");
  const signup = read("../pages/SignupPage.tsx");
  const consumers = [
    "../../supabase/functions/create-lifetime-checkout/index.ts",
    "../../supabase/functions/get-lifetime-spots/index.ts",
    "../../supabase/functions/buy-lifetime/index.ts",
    "../../supabase/functions/generate-daily-blogs/index.ts",
    "../../supabase/functions/stripe-invoice-webhook/index.ts",
  ].map(read);
  assert.match(cap, /export const LIFETIME_SPOT_CAP = 100/);
  assert.match(plans, /lifetime-cap\.ts/);
  assert.doesNotMatch(plans, /LIFETIME_SPOT_CAP = 100/);
  assert.match(seo, /LIFETIME_SPOT_CAP/);
  assert.doesNotMatch(seo, /first 50 customers/);
  assert.match(counter, /LIFETIME_SPOT_CAP/);
  assert.match(signup, /LIFETIME_SPOT_CAP/);
  assert.doesNotMatch(signup, /one of 100 lifetime/);
  for (const source of consumers) {
    assert.match(source, /LIFETIME_SPOT_CAP/);
    assert.doesNotMatch(source, /TOTAL_SPOTS\s*=\s*100/);
    assert.doesNotMatch(source, /\?\?\s*100/);
    assert.doesNotMatch(source, /first 100 customers/);
    assert.doesNotMatch(source, /all 100 lifetime/);
    assert.doesNotMatch(source, /Spot #51/);
  }
});

test("an ended trial and a never-subscribed account get different dashboard nudges", () => {
  const now = Date.parse("2026-10-16T12:00:00.000Z");
  const ended = expiredTrialNudgeCopy("2026-10-01T00:00:00.000Z", now);
  assert.equal(ended.title, "Your trial has ended");
  assert.match(ended.detail, /Lifetime is \$300 once/);
  const future = expiredTrialNudgeCopy("2026-11-13T23:00:00.000Z", now);
  assert.equal(future.title, "Pick a plan to unlock the dashboard");
  assert.match(expiredTrialNudgeCopy(null, now).title, /Pick a plan/);
  assert.match(expiredTrialNudgeCopy("not-a-date", now).detail, /\$49/);
});

test("native trial and payment-failed accounts do not see checkout or portal copy", () => {
  const native = "Subscriptions are managed at jointidywise.com. This app cannot take a card.";
  assert.equal(
    planChoicesFooter({ canShowPaymentFlows: false, paymentFailed: true, orgTrial: false }),
    native,
  );
  assert.equal(
    planChoicesFooter({ canShowPaymentFlows: false, paymentFailed: false, orgTrial: true }),
    native,
  );
  assert.match(
    planChoicesFooter({ canShowPaymentFlows: true, paymentFailed: true, orgTrial: true }),
    /billing portal/,
  );
  assert.match(
    planChoicesFooter({ canShowPaymentFlows: true, paymentFailed: false, orgTrial: true }),
    /Stripe Checkout/,
  );
});

test("an invalid timezone does not throw", () => {
  assert.equal(trialEndDateLabel("2026-11-14T04:00:00.000Z", "Not/AZone"), null);
});

test("downgrade buttons say the change waits for renewal", () => {
  assert.equal(DOWNGRADE_EFFECT_NOTE, "Takes effect at your next renewal.");
});

test("lifetime and grandfathered accounts do not see the plan grid", () => {
  assert.equal(showPlanChoices({ lifetime: false, grandfathered: false }), true);
  assert.equal(showPlanChoices({ lifetime: true, grandfathered: false }), false);
  assert.equal(showPlanChoices({ lifetime: false, grandfathered: true }), false);
});

test("lifetime spots stay hidden unless both the count and the cap are real", () => {
  assert.equal(lifetimeSpotsToShow(null, 100), null);
  assert.equal(lifetimeSpotsToShow(12, null), null);
  assert.equal(lifetimeSpotsToShow(undefined, undefined), null);
  assert.equal(lifetimeSpotsToShow(1.5, 100), null);
  assert.equal(lifetimeSpotsToShow(-1, 100), null);
  assert.equal(lifetimeSpotsToShow(0, 0), null);
  assert.equal(lifetimeSpotsToShow(150, 100), null);
  assert.deepEqual(lifetimeSpotsToShow(97, 100), { remaining: 97, total: 100 });
  assert.deepEqual(lifetimeSpotsToShow(88, 100), { remaining: 88, total: 100 });
});
