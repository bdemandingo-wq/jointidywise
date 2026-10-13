import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatDuration } from './formatDuration.ts';

for (const [minutes, expected] of [
  [90, '1.5–2 hrs'], [120, '2–3 hrs'], [180, '3–4 hrs'],
  [240, '4–5 hrs'], [300, '5–6 hrs'], [45, '45 min'],
  [0, '0 min'], [1, '1 min'], [59, '59 min'], [60, '1–2 hrs'],
  [150, '2.5–3 hrs'], [61, '1.02–2 hrs'], [30.5, '30.5 min'],
  [1440, '24–25 hrs'],
] as const) {
  test(`${minutes} minutes displays ${expected}`, () => {
    assert.equal(formatDuration(minutes), expected);
  });
}

for (const minutes of [null, undefined, -1, NaN, Infinity, -Infinity]) {
  test(`invalid duration ${String(minutes)} has no invented estimate`, () => {
    assert.equal(formatDuration(minutes), '—');
  });
}