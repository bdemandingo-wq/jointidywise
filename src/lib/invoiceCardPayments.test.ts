import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { CARD_PAYMENTS_UNAVAILABLE, cardPaymentMethodLabel, invoiceNeedsReconnect, stripeConnectAvailable } from "./invoiceCardPayments.ts";

test("invoices name card payments unavailable when the org needs reconnect", () => {
  assert.equal(CARD_PAYMENTS_UNAVAILABLE, "Card payments unavailable");
  assert.equal(cardPaymentMethodLabel(true, true), "Card payments unavailable");
  assert.equal(cardPaymentMethodLabel(true, false), "Card payments unavailable");
  assert.equal(cardPaymentMethodLabel(false, true), "Debit/Credit Cards");
  assert.equal(cardPaymentMethodLabel(false, false), null);
});

test("needs_reconnect comes from the status field the edge function returns", () => {
  assert.equal(invoiceNeedsReconnect(null), false);
  assert.equal(invoiceNeedsReconnect({ needs_reconnect: true }), true);
  assert.equal(invoiceNeedsReconnect({ status: "needs_reconnect" }), true);
  assert.equal(invoiceNeedsReconnect({ needs_reconnect: false, status: "connected" }), false);
});

test("needs_reconnect is not an available card connection", () => {
  assert.equal(stripeConnectAvailable(null), false);
  assert.equal(stripeConnectAvailable({ connected: true }), true);
  assert.equal(stripeConnectAvailable({ is_connected: true }), true);
  assert.equal(stripeConnectAvailable({ is_connected: false, stripe_account_id: "acct_123" }), true);
  assert.equal(stripeConnectAvailable({
    connected: false,
    needs_reconnect: true,
    account_id: "acct_old",
  }), false);
  assert.equal(stripeConnectAvailable({
    is_connected: true,
    status: "needs_reconnect",
    stripe_account_id: "acct_old",
  }), false);
});

test("owner surfaces ask the status endpoint and treat needs_reconnect as unavailable", () => {
  const files = [
    "../components/admin/booking-form/steps/PaymentStep.tsx",
    "../hooks/useOnboardingChecklist.ts",
    "../hooks/useSidebarBadges.ts",
    "../components/admin/automation/HealthMonitorTab.tsx",
  ];
  for (const file of files) {
    const src = readFileSync(new URL(file, import.meta.url), "utf8");
    assert.match(src, /fetchOrgStripeStatus/, file);
    assert.doesNotMatch(src, /get_org_stripe_settings_safe/, file);
  }
});
