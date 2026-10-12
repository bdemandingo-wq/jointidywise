import { test } from "node:test";
import assert from "node:assert/strict";
import {
  billingNextStep,
  hasChangeableStripeSubscription,
  readReportedStripeMode,
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
    billingNextStep({ product_id: "prod_Tg3zSKe9hRHLZy" }),
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

test("a missing stripe_mode field is unreported, not guessed", () => {
  assert.equal(readReportedStripeMode({ subscribed: true }), "unreported");
  assert.equal(readReportedStripeMode({ stripe_mode: "live" }), "live");
  assert.equal(readReportedStripeMode(null), "unreported");
});
