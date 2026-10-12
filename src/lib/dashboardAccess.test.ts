import assert from "node:assert/strict";
import test from "node:test";
import { hasPaidDashboardAccess, UNPAID_ORG_TRIAL_PRODUCT_ID } from "./dashboardAccess.ts";

test("an unpaid org trial does not open the web dashboard", () => {
  assert.equal(
    hasPaidDashboardAccess({
      isFreeAccount: false,
      subscribed: true,
      productId: UNPAID_ORG_TRIAL_PRODUCT_ID,
      allowUnpaidOrgTrial: false,
    }),
    false,
  );
});

test("the same unpaid trial is allowed in the native app", () => {
  assert.equal(
    hasPaidDashboardAccess({
      isFreeAccount: false,
      subscribed: true,
      productId: UNPAID_ORG_TRIAL_PRODUCT_ID,
      allowUnpaidOrgTrial: true,
    }),
    true,
  );
});

test("a Stripe subscription, including a card trial, opens the dashboard", () => {
  assert.equal(
    hasPaidDashboardAccess({
      isFreeAccount: false,
      subscribed: true,
      productId: "prod_standard",
      allowUnpaidOrgTrial: false,
    }),
    true,
  );
});

test("lifetime, comped, and demo accounts open the dashboard", () => {
  for (const productId of ["lifetime", "comped", "owner_free"]) {
    assert.equal(
      hasPaidDashboardAccess({
        isFreeAccount: false,
        subscribed: true,
        productId,
        allowUnpaidOrgTrial: false,
      }),
      true,
    );
  }
  assert.equal(
    hasPaidDashboardAccess({
      isFreeAccount: true,
      subscribed: false,
      productId: null,
      allowUnpaidOrgTrial: false,
    }),
    true,
  );
});

test("no subscription stays closed", () => {
  assert.equal(
    hasPaidDashboardAccess({
      isFreeAccount: false,
      subscribed: false,
      productId: null,
      allowUnpaidOrgTrial: false,
    }),
    false,
  );
});
