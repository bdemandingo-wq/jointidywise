import { test } from "node:test";
import assert from "node:assert/strict";
import { dueTrialReminder, trialDaysLeft } from "./trialClock.ts";

const DAY = 24 * 60 * 60 * 1000;
const start = Date.parse("2026-10-01T00:00:00.000Z");

test("days left is null once the trial has ended", () => {
  assert.equal(trialDaysLeft("2026-10-31T00:00:00.000Z", start + 30 * DAY), null);
});

test("a partial day still counts as a day left", () => {
  assert.equal(trialDaysLeft(new Date(start + 30 * DAY).toISOString(), start + 25 * DAY + 1000), 5);
});

test("day 25 of a 30-day trial is due once", () => {
  const end = new Date(start + 30 * DAY).toISOString();
  const created = new Date(start).toISOString();
  assert.equal(dueTrialReminder({
    createdAt: created,
    trialEndsAt: end,
    alreadySent: [],
    now: start + 24 * DAY + 1000,
  }), 25);
  assert.equal(dueTrialReminder({
    createdAt: created,
    trialEndsAt: end,
    alreadySent: [25],
    now: start + 26 * DAY,
  }), null);
});

test("day 29 is due, and a missed day 25 is not sent late", () => {
  const end = new Date(start + 30 * DAY).toISOString();
  const created = new Date(start).toISOString();
  assert.equal(dueTrialReminder({
    createdAt: created,
    trialEndsAt: end,
    alreadySent: [],
    now: start + 28 * DAY + 1000,
  }), 29);
});

test("a 14-day trial keeps its end and never gets a day-25 reminder", () => {
  const created = new Date(start).toISOString();
  const end = new Date(start + 14 * DAY).toISOString();
  assert.equal(dueTrialReminder({
    createdAt: created,
    trialEndsAt: end,
    alreadySent: [],
    now: start + 10 * DAY,
  }), null);
  assert.equal(dueTrialReminder({
    createdAt: created,
    trialEndsAt: end,
    alreadySent: [],
    now: start + 13 * DAY,
  }), null);
});

test("a 7-day trial never gets a day-25 reminder", () => {
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
    trialEndsAt: new Date(start + 30 * DAY).toISOString(),
    alreadySent: [],
    now: start + 30 * DAY + 1,
  }), null);
});
