//   node --experimental-strip-types --test src/lib/emailUnsubscribe.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { outcomeFromUnsubscribeResponse } from "./emailUnsubscribeOutcome.ts";

test("a real opt-out names the address and keeps transactional mail", () => {
  const outcome = outcomeFromUnsubscribeResponse(200, {
    ok: true,
    email: "owner@example.com",
    orgName: null,
  });
  assert.equal(outcome.status, "success");
  if (outcome.status !== "success") return;
  assert.match(outcome.detail, /owner@example.com/);
  assert.match(outcome.detail, /essential account and transactional emails/);
  assert.doesNotMatch(outcome.detail, /Morning Briefs.*from Other Co/);
});

test("an org token names that business only", () => {
  const outcome = outcomeFromUnsubscribeResponse(200, {
    ok: true,
    email: "client@example.com",
    orgName: "Bright Mops",
  });
  assert.equal(outcome.status, "success");
  if (outcome.status !== "success") return;
  assert.match(outcome.detail, /Bright Mops/);
  assert.match(outcome.detail, /booking confirmations and invoices/);
});

test("a token with no row, including a test send, is a graceful success", () => {
  for (const [status, payload] of [
    [404, null],
    [200, { ok: true, unknownToken: true }],
  ] as const) {
    const outcome = outcomeFromUnsubscribeResponse(status, payload);
    assert.equal(outcome.status, "success");
    if (outcome.status !== "success") continue;
    assert.match(outcome.detail, /no longer receive marketing emails from TidyWise/);
    assert.doesNotMatch(outcome.detail, /@/);
  }
});

test("a failed write is not reported as unsubscribed", () => {
  const outcome = outcomeFromUnsubscribeResponse(500, { ok: false });
  assert.equal(outcome.status, "error");
  const html = outcomeFromUnsubscribeResponse(200, null);
  assert.equal(html.status, "success");
});

test("a missing token is not a success", () => {
  assert.equal(outcomeFromUnsubscribeResponse(400, { ok: false }).status, "missing_token");
});
