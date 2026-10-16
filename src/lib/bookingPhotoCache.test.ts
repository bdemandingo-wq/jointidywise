import assert from 'node:assert/strict';
import { test } from 'node:test';
import { withoutMediaId, type MediaGalleryCache } from './bookingPhotoCache.ts';

test('withoutMediaId drops the row from every loaded page and keeps page params', () => {
  const cache: MediaGalleryCache<{ id: string; name: string }> = {
    pageParams: [0, 1],
    pages: [
      { source: 'direct', page: 0, rows: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }] },
      { source: 'legacy', page: 0, rows: [{ id: 'b', name: 'B2' }, { id: 'c', name: 'C' }] },
    ],
  };
  const next = withoutMediaId(cache, 'b');
  assert.deepEqual(next?.pageParams, [0, 1]);
  assert.deepEqual(next?.pages[0].rows.map((row) => row.id), ['a']);
  assert.deepEqual(next?.pages[1].rows.map((row) => row.id), ['c']);
  assert.equal(cache.pages[0].rows.length, 2);
});

test('withoutMediaId leaves a missing cache alone', () => {
  assert.equal(withoutMediaId(undefined, 'a'), undefined);
});
