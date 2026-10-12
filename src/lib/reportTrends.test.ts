import { test } from "node:test";
import assert from "node:assert/strict";
import { percentChange, trendDirection } from "./reportTrends.ts";

test("a zero prior period is not a fake percentage", () => {
  assert.equal(percentChange(0, 0), null);
  assert.equal(percentChange(90, 0), null);
  assert.equal(trendDirection(null), "neutral");
});

test("real movement is a rounded percent", () => {
  assert.equal(percentChange(118, 100), 18);
  assert.equal(percentChange(80, 100), -20);
  assert.equal(trendDirection(18), "up");
  assert.equal(trendDirection(-20), "down");
  assert.equal(trendDirection(0), "neutral");
});
