import assert from "node:assert/strict";
import test from "node:test";
import { hasPaidDashboardAccess, subscriptionRenderGate } from "./dashboardAccess.ts";

test("a card-free org trial opens the dashboard", () => {
  assert.equal(
    hasPaidDashboardAccess({
      isFreeAccount: false,
      subscribed: true,
      trialActive: true,
    }),
    true,
  );
});

test("an older org trial reported only as subscribed still opens the dashboard", () => {
  assert.equal(
    hasPaidDashboardAccess({
      isFreeAccount: false,
      subscribed: true,
      trialActive: false,
    }),
    true,
  );
});

test("a Stripe card trial opens the dashboard", () => {
  assert.equal(
    hasPaidDashboardAccess({
      isFreeAccount: false,
      subscribed: true,
      trialActive: true,
    }),
    true,
  );
});

test("lifetime, comped, and demo accounts open the dashboard", () => {
  assert.equal(
    hasPaidDashboardAccess({
      isFreeAccount: false,
      subscribed: true,
    }),
    true,
  );
  assert.equal(
    hasPaidDashboardAccess({
      isFreeAccount: true,
      subscribed: false,
    }),
    true,
  );
});

test("no plan, no trial, and no lifetime stays closed", () => {
  assert.equal(
    hasPaidDashboardAccess({
      isFreeAccount: false,
      subscribed: false,
      trialActive: false,
    }),
    false,
  );
});

test("a trial_active flag opens the dashboard even if subscribed is false", () => {
  assert.equal(
    hasPaidDashboardAccess({
      isFreeAccount: false,
      subscribed: false,
      trialActive: true,
    }),
    true,
  );
});

test("a cached subscription paints the dashboard while the check is still in flight", () => {
  assert.equal(
    subscriptionRenderGate({ paywallAllowed: false, hasSubscription: true, check: "loading" }),
    "ready",
  );
});

test("no cached subscription keeps the skeleton until the check returns", () => {
  assert.equal(
    subscriptionRenderGate({ paywallAllowed: false, hasSubscription: false, check: "loading" }),
    "skeleton",
  );
  assert.equal(
    subscriptionRenderGate({ paywallAllowed: false, hasSubscription: false, check: "idle" }),
    "skeleton",
  );
});

test("a failed check with nothing cached stays locked", () => {
  assert.equal(
    subscriptionRenderGate({ paywallAllowed: false, hasSubscription: false, check: "error" }),
    "error",
  );
});

test("billing pages stay reachable while the check is unknown", () => {
  assert.equal(
    subscriptionRenderGate({ paywallAllowed: true, hasSubscription: false, check: "loading" }),
    "ready",
  );
});
