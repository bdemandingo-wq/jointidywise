import assert from "node:assert/strict";
import test from "node:test";
import { hasPaidDashboardAccess } from "./dashboardAccess.ts";

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
