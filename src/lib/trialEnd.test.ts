// node --experimental-strip-types --test src/lib/trialEnd.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { trialDaysLeft } from "./trialClock.ts";
import {
  stripeCheckoutTrialDays,
  stripeTrialEndUnix,
} from "../../supabase/functions/_shared/trial-end.ts";

const NOW = Date.parse("2026-10-01T15:00:00.000Z");
const DAY_MS = 24 * 60 * 60 * 1000;

test("partial day is extended so Checkout's floor matches the app's ceil", () => {
  const endsAt = new Date(NOW + 12 * DAY_MS + 10 * 60 * 60 * 1000).toISOString();
  const unix = stripeTrialEndUnix(endsAt, NOW);
  assert.ok(unix != null);
  assert.ok(unix * 1000 >= Date.parse(endsAt));
  assert.equal(stripeCheckoutTrialDays(unix, NOW), trialDaysLeft(endsAt, NOW));
  assert.equal(trialDaysLeft(endsAt, NOW), 13);
});

test("an exact day boundary keeps the profile timestamp", () => {
  const endsAt = new Date(NOW + 13 * DAY_MS).toISOString();
  const unix = stripeTrialEndUnix(endsAt, NOW);
  assert.equal(unix, Math.floor(Date.parse(endsAt) / 1000));
  assert.equal(stripeCheckoutTrialDays(unix!, NOW), 13);
});

test("under 48 hours does not send a trial_end", () => {
  const endsAt = new Date(NOW + 36 * 60 * 60 * 1000).toISOString();
  assert.equal(stripeTrialEndUnix(endsAt, NOW), null);
  assert.equal(stripeTrialEndUnix("not-a-date", NOW), null);
  assert.equal(stripeTrialEndUnix(null, NOW), null);
});
