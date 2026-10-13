import { test } from "node:test";
import assert from "node:assert/strict";
import { isRetryableLifetimeBody } from "./lifetimeCheckout.ts";

test("retries only while the new account's org is still being created", () => {
  assert.equal(isRetryableLifetimeBody({ code: "org_not_ready" }), true);
  assert.equal(
    isRetryableLifetimeBody({ error: "Your workspace is still being set up. Try again in a moment." }),
    true,
  );
  assert.equal(isRetryableLifetimeBody({ error: "Sign in to claim a lifetime spot." }), false);
  assert.equal(isRetryableLifetimeBody({ error: "Lifetime offer is sold out." }), false);
  assert.equal(isRetryableLifetimeBody(null), false);
});
