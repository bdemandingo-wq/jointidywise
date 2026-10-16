import { test } from "node:test";
import assert from "node:assert/strict";
import {
  lifetimeSpotsToShow,
  planBillingAction,
  renewalDisclosure,
  trialStatusLine,
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

test("trial status states 30 days of Pro and the live days left", () => {
  assert.equal(trialStatusLine(null), "Free trial: 30 days of Pro.");
  assert.equal(trialStatusLine(12), "Free trial: 30 days of Pro. 12 days left.");
  assert.equal(trialStatusLine(1), "Free trial: 30 days of Pro. 1 day left.");
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
