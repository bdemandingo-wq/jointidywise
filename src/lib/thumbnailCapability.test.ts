import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isUnsupportedImageTransformation } from './thumbnailCapability.ts';
test('unsupported plans fall back but missing media/auth/network errors do not', () => {
  assert.equal(isUnsupportedImageTransformation(400, 'Image transformations are not supported on this plan'), true);
  assert.equal(isUnsupportedImageTransformation(501, 'Image resizing not enabled'), true);
  assert.equal(isUnsupportedImageTransformation(404, 'Object not found'), false);
  assert.equal(isUnsupportedImageTransformation(403, 'Invalid JWT'), false);
  assert.equal(isUnsupportedImageTransformation(500, 'Transform upstream unavailable'), false);
});