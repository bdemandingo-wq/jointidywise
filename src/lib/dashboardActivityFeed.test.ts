import { test } from "node:test";
import assert from "node:assert/strict";
import { DASHBOARD_ACTIVITY_FEED_ENABLED } from "./dashboardActivityFeed.ts";

test("the admin Happening on TidyWise card stays off", () => {
  assert.equal(DASHBOARD_ACTIVITY_FEED_ENABLED, false);
});
