// node --experimental-strip-types --test src/lib/trackingVisibility.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  clusterNearby,
  isLocationOffEnRoute,
  pausedLastSeenLabel,
  pickNextJob,
  showsMapPin,
  shouldRequestDrivingEta,
  trackingPinState,
} from './trackingVisibility.ts';

const NOW = Date.parse('2026-10-14T15:00:00.000Z');
const START = '2026-10-14T16:00:00.000Z';
const PAST = '2026-10-14T14:00:00.000Z';

const base = {
  isActive: true,
  latitude: 40.7,
  longitude: -74.0,
  recordedAt: new Date(NOW - 30_000).toISOString(),
  scheduledAt: START,
  bookingStatus: 'confirmed',
  now: NOW,
};

test('a fresh fix is a live pin', () => {
  const state = trackingPinState(base);
  assert.equal(state, 'live');
  assert.equal(showsMapPin(state), true);
});

test('a stale fix stays visible only until the scheduled start', () => {
  const paused = trackingPinState({ ...base, recordedAt: new Date(NOW - 5 * 60_000).toISOString() });
  assert.equal(paused, 'paused');
  assert.equal(showsMapPin(paused), true);
  const afterStart = trackingPinState({
    ...base,
    recordedAt: new Date(NOW - 5 * 60_000).toISOString(),
    scheduledAt: PAST,
  });
  assert.equal(afterStart, 'hidden');
  assert.equal(showsMapPin(afterStart), false);
});

test('cancelled, no-show, and a started job drop the pin even while the row is active', () => {
  for (const bookingStatus of ['cancelled', 'no_show', 'in_progress', 'completed']) {
    assert.equal(trackingPinState({ ...base, bookingStatus }), 'hidden', bookingStatus);
  }
});

test('an inactive row is hidden', () => {
  assert.equal(trackingPinState({ ...base, isActive: false }), 'hidden');
});

test('declined or missing location is never a pin, including the paused style', () => {
  for (const coords of [
    { latitude: null, longitude: null },
    { latitude: Number.NaN, longitude: 1 },
    { latitude: 91, longitude: 0 },
  ]) {
    const state = trackingPinState({
      ...base,
      ...coords,
      recordedAt: new Date(NOW - 5 * 60_000).toISOString(),
    });
    assert.equal(state, 'location_off');
    assert.equal(showsMapPin(state), false);
  }
});

test('on the way with location off stays in the list only while the job is still open', () => {
  assert.equal(isLocationOffEnRoute({ bookingStatus: 'confirmed', hasUsableFix: false }), true);
  assert.equal(isLocationOffEnRoute({ bookingStatus: 'confirmed', hasUsableFix: true }), false);
  assert.equal(isLocationOffEnRoute({ bookingStatus: 'cancelled', hasUsableFix: false }), false);
  assert.equal(isLocationOffEnRoute({ bookingStatus: 'no_show', hasUsableFix: false }), false);
  assert.equal(isLocationOffEnRoute({ bookingStatus: 'in_progress', hasUsableFix: false }), false);
});

test('paused label uses the last recorded fix', () => {
  assert.equal(pausedLastSeenLabel(new Date(NOW - 4 * 60_000).toISOString(), NOW), 'Paused · last seen 4 min ago');
  assert.equal(pausedLastSeenLabel(new Date(NOW - 10_000).toISOString(), NOW), 'Paused · last seen just now');
});

test('driving ETA is skipped while stale and at most once a minute', () => {
  assert.equal(shouldRequestDrivingEta(null, NOW, false), true);
  assert.equal(shouldRequestDrivingEta(null, NOW, true), false);
  assert.equal(shouldRequestDrivingEta(NOW - 10_000, NOW, false), false);
  assert.equal(shouldRequestDrivingEta(NOW - 60_000, NOW, false), true);
});

test('next job is the earliest upcoming open booking today', () => {
  const picked = pickNextJob([
    { scheduledAt: PAST, status: 'confirmed', isDraft: false, name: 'Early' },
    { scheduledAt: '2026-10-14T18:00:00.000Z', status: 'cancelled', isDraft: false, name: 'Gone' },
    { scheduledAt: '2026-10-14T17:00:00.000Z', status: 'confirmed', isDraft: false, name: 'Maria' },
    { scheduledAt: '2026-10-14T19:00:00.000Z', status: 'confirmed', isDraft: true, name: 'Draft' },
  ], NOW);
  assert.equal(picked?.name, 'Maria');
  assert.equal(pickNextJob([{ scheduledAt: PAST, status: 'confirmed', isDraft: false }], NOW), null);
});

test('nearby fixes cluster and a distant fix stays alone', () => {
  const groups = clusterNearby([
    { id: 'a', lat: 40.7, lng: -74 },
    { id: 'b', lat: 40.7004, lng: -74.0002 },
    { id: 'c', lat: 41.0, lng: -74 },
  ]);
  assert.equal(groups.length, 2);
  assert.deepEqual(groups[0].map((item) => item.id), ['a', 'b']);
  assert.deepEqual(groups[1].map((item) => item.id), ['c']);
});

test('tracking rows are readable by an org admin and by the cleaner who owns the row', () => {
  const dir = join(process.cwd(), 'supabase/migrations');
  const sql = readdirSync(dir)
    .filter((name) => name.endsWith('.sql'))
    .sort()
    .map((name) => readFileSync(join(dir, name), 'utf8'))
    .join('\n');
  const droppedAt = sql.lastIndexOf('DROP POLICY IF EXISTS "Anyone can view tracking by token"');
  assert.ok(droppedAt >= 0);
  const afterDrop = sql.slice(droppedAt);
  assert.doesNotMatch(afterDrop, /CREATE POLICY "Anyone can view tracking by token"/);
  assert.match(afterDrop, /CREATE POLICY "Org admins can view tracking"[\s\S]*is_org_admin\(organization_id\)/);
  assert.match(afterDrop, /CREATE POLICY "Staff can view own tracking"[\s\S]*s\.user_id = auth\.uid\(\)/);
  assert.doesNotMatch(afterDrop, /cleaner_location_tracking[\s\S]{0,400}USING \(true\)/);
  assert.doesNotMatch(afterDrop, /CREATE POLICY "[^"]*customer[^"]*"\s+ON public\.cleaner_location_tracking/i);
});
