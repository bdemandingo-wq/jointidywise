// node --experimental-strip-types --test src/lib/adminNotificationFetch.test.ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { shouldFetchBellOnOpen } from './adminNotificationFetch.ts';

test('a cold bell fetches on open', () => {
  assert.equal(shouldFetchBellOnOpen(false), true);
});

test('a warm bell does not fetch on open', () => {
  assert.equal(shouldFetchBellOnOpen(true), false);
});

test('Clear all leaves an empty list in the cache, so open does not restore it', () => {
  const cache = new Map<string, unknown[]>();
  cache.set('org', []);
  assert.equal(cache.has('org'), true);
  assert.equal(shouldFetchBellOnOpen(cache.has('org')), false);
});

test('a realtime-only row stored in the cache blocks another open fetch', () => {
  const cache = new Map<string, { id: string }[]>();
  cache.set('org', [{ id: 'booking-update-1' }]);
  assert.equal(shouldFetchBellOnOpen(cache.has('org')), false);
});
