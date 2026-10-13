import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mediaPageRange, hasMoreMedia, mergeMedia, adjacentMedia } from './bookingMediaGallery.ts';

test('inclusive pages contain exactly 40 records without overlap', () => {
  assert.deepEqual(mediaPageRange(0), [0, 39]);
  assert.deepEqual(mediaPageRange(1), [40, 79]);
  assert.deepEqual(mediaPageRange(2), [80, 119]);
});
test('a full page continues and a short or empty page stops', () => {
  assert.equal(hasMoreMedia(40), true);
  assert.equal(hasMoreMedia(39), false);
  assert.equal(hasMoreMedia(0), false);
});
test('legacy/direct overlap is deduplicated with a stable ID tiebreaker', () => {
  const a = { id: 'a', created_at: '2026-10-13T00:00:00Z' };
  const b = { id: 'b', created_at: a.created_at };
  assert.deepEqual(mergeMedia([[a, b], [a]]), [b, a]);
});
test('prefetch only immediate photos in filtered order, skipping videos', () => {
  const photos = [{ id: 'a', video: false }, { id: 'b', video: true }, { id: 'c', video: false }, { id: 'd', video: false }];
  assert.deepEqual(adjacentMedia(photos, 0, p => p.video), []);
  assert.deepEqual(adjacentMedia(photos, 2, p => p.video), [photos[3]]);
  assert.deepEqual(adjacentMedia([photos[0], photos[3], photos[2]], 1, p => p.video), [photos[0], photos[2]]);
  assert.deepEqual(adjacentMedia(photos, 3, p => p.video), [photos[2]]);
  assert.deepEqual(adjacentMedia(photos, -1, p => p.video), []);
});