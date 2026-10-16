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
  trialFirstChargeLine,
  trialEndDateLabel,
} from "./planBillingCopy.ts";
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

test("a trial always names the org-local end as the first charge", () => {
  // Nov 13, 11:00pm Eastern is already Nov 14 in UTC.
  const elevenPmEastern = "2026-11-14T04:00:00.000Z";
  const now = Date.parse("2026-10-16T12:00:00.000Z");
  assert.equal(trialEndDateLabel(elevenPmEastern, "America/New_York"), "Nov 13");
  assert.equal(trialEndDateLabel(elevenPmEastern, "UTC"), "Nov 14");
  assert.equal(trialEndDateLabel(null, "America/New_York"), null);
  assert.equal(trialEndDateLabel("not-a-date", "America/New_York"), null);
  assert.equal(trialEndDateLabel(elevenPmEastern, ""), null);
  const eastern = trialFirstChargeLine({
    trialEndIso: elevenPmEastern,
    timeZone: "America/New_York",
  });
  assert.equal(eastern, "Your first charge is Nov 13, 2026.");
  assert.equal(
    trialFirstChargeLine({ trialEndIso: elevenPmEastern, timeZone: "UTC" }),
    "Your first charge is Nov 14, 2026.",
  );
  // Inside 48 hours the line still names the trial end. It does not switch to "today".
  const soon = new Date(now + 36 * 60 * 60 * 1000).toISOString();
  const soonLine = trialFirstChargeLine({ trialEndIso: soon, timeZone: "America/New_York" });
  assert.equal(soonLine, "Your first charge is Oct 17, 2026.");
  assert.equal(soonLine?.includes("today"), false);
  assert.equal(trialFirstChargeLine({ trialEndIso: null, timeZone: "America/New_York" }), null);
  assert.equal(trialFirstChargeLine({ trialEndIso: "not-a-date", timeZone: "America/New_York" }), null);
  assert.equal(trialFirstChargeLine({ trialEndIso: elevenPmEastern, timeZone: "Not/AZone" }), null);
  // text-xs (~6.6px) inside a 375px phone after 16px page padding and 20px card padding.
  const innerPx = 375 - 32 - 40;
  assert.ok(eastern);
  assert.ok(eastern.length * 6.6 <= innerPx);
});

test("the lifetime cap is one shared constant at 100", () => {
  assert.equal(LIFETIME_SPOT_CAP, 100);
  const seo = readFileSync(new URL("../components/seo/AuthSEOContent.tsx", import.meta.url), "utf8");
  const counter = readFileSync(new URL("../hooks/useLifetimeCounter.ts", import.meta.url), "utf8");
  assert.match(seo, /LIFETIME_SPOT_CAP/);
  assert.doesNotMatch(seo, /first 50 customers/);
  assert.match(counter, /LIFETIME_SPOT_CAP/);
  assert.doesNotMatch(counter, /TOTAL_SPOTS\s*=\s*100/);
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
