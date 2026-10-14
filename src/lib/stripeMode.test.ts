import { test } from "node:test";
import assert from "node:assert/strict";
import {
  billingNextStep,
  hasChangeableStripeSubscription,
  isActiveOrgTrial,
  readReportedStripeMode,
  shouldRedirectChoosePlanToDashboard,
  stripeKeyMode,
} from "./stripeMode.ts";

test("stripe key prefix is the mode checkout will use", () => {
  assert.equal(stripeKeyMode("sk_live_abc"), "live");
  assert.equal(stripeKeyMode("rk_live_abc"), "live");
  assert.equal(stripeKeyMode("sk_test_abc"), "test");
  assert.equal(stripeKeyMode("rk_test_abc"), "test");
  assert.equal(stripeKeyMode(""), "unset");
  assert.equal(stripeKeyMode(null), "unset");
  assert.equal(stripeKeyMode("pk_live_abc"), "unknown");
});

test("an unpaid org trial is checkout, not the billing portal", () => {
  assert.equal(billingNextStep({ product_id: "org_trial", payment_failed: false }), "checkout");
  assert.equal(billingNextStep({ product_id: null }), "checkout");
  assert.equal(billingNextStep(null), "checkout");
  assert.equal(
    billingNextStep({ product_id: "prod_example" }),
    "portal",
  );
  assert.equal(
    billingNextStep({ product_id: null, payment_failed: true }),
    "portal",
  );
  assert.equal(billingNextStep({ product_id: "lifetime" }), "lifetime");
  assert.equal(
    hasChangeableStripeSubscription({ subscribed: true, product_id: "org_trial" }),
    false,
  );
  assert.equal(
    hasChangeableStripeSubscription({ subscribed: true, product_id: "prod_abc" }),
    true,
  );
});

test("an active org trial leaves /choose-plan unless they asked to upgrade", () => {
  assert.equal(isActiveOrgTrial({ product_id: "org_trial", subscribed: true, trial_active: true }), true);
  assert.equal(isActiveOrgTrial({ product_id: "org_trial", subscribed: false, trial_active: false }), false);
  assert.equal(isActiveOrgTrial({ product_id: null, subscribed: false }), false);
  assert.equal(
    shouldRedirectChoosePlanToDashboard({ hasDashboardAccess: true, upgradeRequested: false }),
    true,
  );
  assert.equal(
    shouldRedirectChoosePlanToDashboard({ hasDashboardAccess: true, upgradeRequested: true }),
    false,
  );
  assert.equal(
    shouldRedirectChoosePlanToDashboard({ hasDashboardAccess: false, upgradeRequested: false }),
    false,
  );
});

test("a missing stripe_mode field is unreported, not guessed", () => {
  assert.equal(readReportedStripeMode({ subscribed: true }), "unreported");
  assert.equal(readReportedStripeMode({ stripe_mode: "live" }), "live");
  assert.equal(readReportedStripeMode(null), "unreported");
});
