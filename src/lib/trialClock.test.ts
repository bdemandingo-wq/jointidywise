import { test } from "node:test";
import assert from "node:assert/strict";
import { dueTrialReminder, trialDaysLeft } from "./trialClock.ts";

const DAY = 24 * 60 * 60 * 1000;
const start = Date.parse("2026-10-01T00:00:00.000Z");

test("days left is null once the trial has ended", () => {
  assert.equal(trialDaysLeft("2026-10-15T00:00:00.000Z", start + 14 * DAY), null);
});

test("a partial day still counts as a day left", () => {
  assert.equal(trialDaysLeft(new Date(start + 14 * DAY).toISOString(), start + 10 * DAY + 1000), 4);
});

test("day 10 of a 14-day trial is due once", () => {
  const end = new Date(start + 14 * DAY).toISOString();
  const created = new Date(start).toISOString();
  assert.equal(dueTrialReminder({
    createdAt: created,
    trialEndsAt: end,
    alreadySent: [],
    now: start + 9 * DAY + 1000,
  }), 10);
  assert.equal(dueTrialReminder({
    createdAt: created,
    trialEndsAt: end,
    alreadySent: [10],
    now: start + 11 * DAY,
  }), null);
});

test("day 13 is due, and a missed day 10 is not sent late", () => {
  const end = new Date(start + 14 * DAY).toISOString();
  const created = new Date(start).toISOString();
  assert.equal(dueTrialReminder({
    createdAt: created,
    trialEndsAt: end,
    alreadySent: [],
    now: start + 12 * DAY + 1000,
  }), 13);
});

test("a 7-day trial never gets a day-10 reminder", () => {
  const created = new Date(start).toISOString();
  const end = new Date(start + 7 * DAY).toISOString();
  assert.equal(dueTrialReminder({
    createdAt: created,
    trialEndsAt: end,
    alreadySent: [],
    now: start + 6 * DAY,
  }), null);
});

test("an ended trial is not reminded", () => {
  assert.equal(dueTrialReminder({
    createdAt: new Date(start).toISOString(),
    trialEndsAt: new Date(start + 14 * DAY).toISOString(),
    alreadySent: [],
    now: start + 14 * DAY + 1,
  }), null);
});
