import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DOWNGRADE_EFFECT_NOTE,
  lifetimeSpotsToShow,
  planBillingAction,
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

test("a trial names the real end date as the first charge and keeps days left", () => {
  assert.equal(trialEndDateLabel("2026-11-13T23:00:00.000Z"), "Nov 13");
  assert.equal(trialEndDateLabel(null), null);
  assert.equal(trialEndDateLabel("not-a-date"), null);
  assert.equal(
    trialChargeLine({ chargeDate: "Nov 13", daysLeft: 12 }),
    "Free trial of Pro until Nov 13. Add a card and your first charge is Nov 13. 12 days left.",
  );
  assert.equal(
    trialChargeLine({ chargeDate: "Nov 13", daysLeft: 1 }),
    "Free trial of Pro until Nov 13. Add a card and your first charge is Nov 13. 1 day left.",
  );
  assert.equal(
    trialChargeLine({ chargeDate: "Nov 13", daysLeft: null }),
    "Free trial of Pro until Nov 13. Add a card and your first charge is Nov 13.",
  );
  assert.equal(
    trialChargeLine({ chargeDate: null, daysLeft: 4 }),
    "Free trial of Pro. 4 days left.",
  );
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
  assert.deepEqual(lifetimeSpotsToShow(88, 100), { remaining: 88, total: 100 });
});
