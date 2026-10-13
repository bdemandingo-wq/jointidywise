import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  LIFETIME_ORG_NOT_READY,
  lifetimeCallerStatus,
  lifetimeOrgStatus,
} from "./lifetime-auth.ts";

const functionsDir = join(dirname(fileURLToPath(import.meta.url)), "..");

const USER = { id: "user-1", email: "owner@example.com" };

test("rejects a missing auth header", () => {
  const result = lifetimeCallerStatus({ authorization: null, anonKey: "anon", user: USER });
  assert.equal(result?.status, 401);
});

test("rejects the anon key even when a user object is present", () => {
  const result = lifetimeCallerStatus({
    authorization: "Bearer anon-key",
    anonKey: "anon-key",
    user: USER,
  });
  assert.equal(result?.status, 401);
});

test("rejects an invalid token that did not resolve to a user", () => {
  const result = lifetimeCallerStatus({
    authorization: "Bearer not-a-user",
    anonKey: "anon-key",
    user: null,
  });
  assert.equal(result?.status, 401);
});

test("accepts a bearer token that resolved to a user with an email", () => {
  assert.equal(
    lifetimeCallerStatus({
      authorization: "Bearer user-jwt",
      anonKey: "anon-key",
      user: USER,
    }),
    null,
  );
});

test("lifetime checkout functions reject anonymous callers and stamp the org", () => {
  for (const file of ["buy-lifetime/index.ts", "create-lifetime-checkout/index.ts"]) {
    const source = readFileSync(join(functionsDir, file), "utf8");
    assert.equal(source.includes("anonymous_checkout"), false, file);
    assert.equal(source.includes("customer_creation"), false, file);
    assert.match(source, /organization_id/, file);
    assert.match(source, /401/, file);
  }
});

test("requires an organization id on the checkout", () => {
  const missing = lifetimeOrgStatus(null);
  assert.equal(missing?.status, 409);
  assert.equal(missing?.code, LIFETIME_ORG_NOT_READY);
  assert.equal(lifetimeOrgStatus("  ")?.status, 409);
  assert.equal(lifetimeOrgStatus("org-1"), null);
});
