// node --experimental-strip-types --test src/lib/dashboardLoad.test.ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { dashboardSideReads } from './dashboardLoad.ts';

test('a paid dashboard with the activity feed off skips growth and lifetime', () => {
  assert.deepEqual(
    dashboardSideReads({ upcomingReady: true, showUpgrade: false, feedEnabled: false }),
    { growth: false, lifetime: false },
  );
});

test('the trial upgrade card still loads both numbers', () => {
  assert.deepEqual(
    dashboardSideReads({ upcomingReady: true, showUpgrade: true, feedEnabled: false }),
    { growth: true, lifetime: true },
  );
});

test('growth waits until the jobs list is on screen', () => {
  assert.deepEqual(
    dashboardSideReads({ upcomingReady: false, showUpgrade: true, feedEnabled: true }),
    { growth: false, lifetime: false },
  );
});

test('the activity feed can request growth without the upgrade card', () => {
  assert.deepEqual(
    dashboardSideReads({ upcomingReady: true, showUpgrade: false, feedEnabled: true }),
    { growth: true, lifetime: false },
  );
});
