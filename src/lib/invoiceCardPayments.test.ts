import assert from "node:assert/strict";
import { test } from "node:test";
import { CARD_PAYMENTS_UNAVAILABLE, cardPaymentMethodLabel, invoiceNeedsReconnect } from "./invoiceCardPayments.ts";

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
