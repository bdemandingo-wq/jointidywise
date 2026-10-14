import { test } from "node:test";
import assert from "node:assert/strict";
import { isCustomPriceMissing } from "./priceNotConfigured.ts";

function httpError(body: unknown) {
  const text = JSON.stringify(body);
  return {
    context: {
      clone() {
        return { json: async () => JSON.parse(text) };
      },
    },
  };
}

test("a custom price_not_configured response is the contact fallback", async () => {
  assert.equal(
    await isCustomPriceMissing(httpError({
      code: "price_not_configured",
      plan: "custom",
      error: "Stripe price for custom monthly is not configured.",
    })),
    true,
  );
});

test("the message the deployed function already returns is the contact fallback", async () => {
  assert.equal(
    await isCustomPriceMissing(httpError({
      error: "Stripe price for custom yearly is not configured on the server yet.",
    })),
    true,
  );
});

test("a missing basic or pro price is not the contact fallback", async () => {
  assert.equal(
    await isCustomPriceMissing(httpError({
      code: "price_not_configured",
      plan: "pro",
      error: "Stripe price for pro monthly is not configured.",
    })),
    false,
  );
  assert.equal(
    await isCustomPriceMissing(httpError({
      error: "Stripe price for basic monthly is not configured.",
    })),
    false,
  );
});
