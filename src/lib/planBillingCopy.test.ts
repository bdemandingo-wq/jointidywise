// Runner (this file is executed; vitest is not installed and reports no suite):
//   node --experimental-strip-types --test src/lib/planBillingCopy.test.ts
// tsconfig.app.json sets allowImportingTsExtensions and excludes *.test.ts,
// so `tsc -p tsconfig.app.json` does not typecheck this import. Node does.
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
  trialChargeLine,
  trialEndDateLabel,
} from "./planBillingCopy.ts";

test("basic and pro stay on checkout and custom is contact", () => {
  assert.equal(planBillingAction("basic"), "checkout");
  assert.equal(planBillingAction("pro"), "checkout");
  assert.equal(planBillingAction("custom"), "contact");
});

test("renewal disclosure names the monthly price", () => {
  assert.equal(renewalDisclosure(49), "Renews monthly at $49 until you cancel.");
  assert.equal(renewalDisclosure(97), "Renews monthly at $97 until you cancel.");
});

test("a trial names the org-local end date and does not promise a charge date", () => {
  // Nov 13, 11:00pm Eastern is already Nov 14 in UTC.
  const elevenPmEastern = "2026-11-14T04:00:00.000Z";
  assert.equal(trialEndDateLabel(elevenPmEastern, "America/New_York"), "Nov 13");
  assert.equal(trialEndDateLabel(elevenPmEastern, "UTC"), "Nov 14");
  assert.equal(trialEndDateLabel(null, "America/New_York"), null);
  assert.equal(trialEndDateLabel("not-a-date", "America/New_York"), null);
  assert.equal(trialEndDateLabel(elevenPmEastern, ""), null);
  const line = trialChargeLine({ endDate: "Nov 13", daysLeft: 12 });
  assert.equal(line, "Free trial of Pro until Nov 13. 12 days left.");
  assert.equal(line.includes("first charge"), false);
  assert.equal(
    trialChargeLine({ endDate: "Nov 13", daysLeft: 1 }),
    "Free trial of Pro until Nov 13. 1 day left.",
  );
  assert.equal(
    trialChargeLine({ endDate: "Nov 13", daysLeft: null }),
    "Free trial of Pro until Nov 13.",
  );
  assert.equal(
    trialChargeLine({ endDate: null, daysLeft: 4 }),
    "Free trial of Pro. 4 days left.",
  );
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
