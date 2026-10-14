// node --experimental-strip-types --test src/lib/trialEnd.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { trialDaysLeft } from "./trialClock.ts";
import {
  extendShortCardFreeTrial,
  resolveCardFreeTrial,
  stripeCheckoutTrialDays,
  stripeTrialEndUnix,
} from "../../supabase/functions/_shared/trial-end.ts";

const NOW = Date.parse("2026-10-01T15:00:00.000Z");
const DAY_MS = 24 * 60 * 60 * 1000;

test("a partial day keeps the exact profile second and display ceils it", () => {
  const endsAt = new Date(NOW + 12 * DAY_MS + 10 * 60 * 60 * 1000).toISOString();
  const unix = stripeTrialEndUnix(endsAt, NOW);
  assert.equal(unix, Math.floor(Date.parse(endsAt) / 1000));
  assert.ok(unix! * 1000 <= Date.parse(endsAt));
  assert.equal(stripeCheckoutTrialDays(unix!, NOW), 13);
  assert.equal(trialDaysLeft(endsAt, NOW), 13);
});

test("day 0 of a 30-day trial shows 30 and does not move the timestamp", () => {
  const endsAt = new Date(NOW + 30 * DAY_MS - 60 * 1000).toISOString();
  const unix = stripeTrialEndUnix(endsAt, NOW);
  assert.equal(unix, Math.floor(Date.parse(endsAt) / 1000));
  assert.equal(stripeCheckoutTrialDays(unix!, NOW), 30);
  assert.equal(trialDaysLeft(endsAt, NOW), 30);
});

test("an exact day boundary keeps the profile timestamp", () => {
  const endsAt = new Date(NOW + 13 * DAY_MS).toISOString();
  const unix = stripeTrialEndUnix(endsAt, NOW);
  assert.equal(unix, Math.floor(Date.parse(endsAt) / 1000));
  assert.equal(stripeCheckoutTrialDays(unix!, NOW), 13);
});

test("a missing trial stamp is 30 days from created_at and a stored date is kept", () => {
  const createdAt = new Date(NOW - 60 * 1000).toISOString();
  const missing = resolveCardFreeTrial({ trialEndsAt: null, createdAt, nowMs: NOW });
  assert.equal(missing.stampMissing, true);
  assert.equal(missing.active, true);
  assert.equal(missing.trialEndIso, new Date(Date.parse(createdAt) + 30 * DAY_MS).toISOString());

  const past = new Date(NOW - DAY_MS).toISOString();
  const stored = resolveCardFreeTrial({ trialEndsAt: past, createdAt, nowMs: NOW });
  assert.equal(stored.stampMissing, false);
  assert.equal(stored.active, false);
  assert.equal(stored.trialEndIso, new Date(past).toISOString());
});

test("a 14-day stamp is lengthened to created_at + 30 days and a longer stamp is kept", () => {
  const createdAt = new Date(NOW - 2 * DAY_MS).toISOString();
  const shortEnd = new Date(Date.parse(createdAt) + 14 * DAY_MS).toISOString();
  const extended = extendShortCardFreeTrial({ trialEndsAt: shortEnd, createdAt, nowMs: NOW });
  assert.equal(extended.extended, true);
  assert.equal(extended.active, true);
  assert.equal(extended.trialEndIso, new Date(Date.parse(createdAt) + 30 * DAY_MS).toISOString());

  const longerEnd = new Date(Date.parse(createdAt) + 45 * DAY_MS).toISOString();
  const kept = extendShortCardFreeTrial({ trialEndsAt: longerEnd, createdAt, nowMs: NOW });
  assert.equal(kept.extended, false);
  assert.equal(kept.trialEndIso, new Date(longerEnd).toISOString());

  const expiredStart = new Date(NOW - 40 * DAY_MS).toISOString();
  const expiredEnd = new Date(Date.parse(expiredStart) + 14 * DAY_MS).toISOString();
  const tooOld = extendShortCardFreeTrial({ trialEndsAt: expiredEnd, createdAt: expiredStart, nowMs: NOW });
  assert.equal(tooOld.extended, false);
  assert.equal(tooOld.trialEndIso, new Date(expiredEnd).toISOString());
});

test("under 48 hours does not send a trial_end", () => {
  const endsAt = new Date(NOW + 36 * 60 * 60 * 1000).toISOString();
  assert.equal(stripeTrialEndUnix(endsAt, NOW), null);
  assert.equal(stripeTrialEndUnix("not-a-date", NOW), null);
  assert.equal(stripeTrialEndUnix(null, NOW), null);
});
