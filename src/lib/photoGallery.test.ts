import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stepGalleryIndex } from './photoGallery.ts';

test('does not wrap past either end', () => {
  assert.equal(stepGalleryIndex(0, 4, -1), 0);
  assert.equal(stepGalleryIndex(3, 4, 1), 3);
});
