import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_KEYWORD_ATTEMPTS,
  attemptsAfterClaim,
  canRetryKeyword,
} from "../../supabase/functions/_shared/keywordAttempts.ts";

test("a keyword under 5 attempts can be requeued", () => {
  assert.equal(MAX_KEYWORD_ATTEMPTS, 5);
  assert.equal(canRetryKeyword(0), true);
  assert.equal(canRetryKeyword(4), true);
  assert.equal(canRetryKeyword(null), true);
});

test("a keyword at 5 attempts stays failed", () => {
  assert.equal(canRetryKeyword(5), false);
  assert.equal(canRetryKeyword(6), false);
});

test("claiming a keyword increments attempts once", () => {
  assert.equal(attemptsAfterClaim(0), 1);
  assert.equal(attemptsAfterClaim(4), 5);
});
