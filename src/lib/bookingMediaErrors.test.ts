import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  getUploadErrorMessage,
  isHeicFile,
  isVideoFile,
  MAX_MEDIA_PER_SELECTION,
  PHOTO_DECODE_ERROR,
  SELECTION_LIMIT_MESSAGE,
  takeSelection,
} from './bookingMediaErrors.ts';

const f = (name: string, type = '') => ({ name, type }) as File;

test('iOS .mov counts as video even with no MIME type', () => {
  assert.equal(isVideoFile(f('clip.MOV')), true);
  assert.equal(isVideoFile(f('clip.mov', '')), true);
  assert.equal(isVideoFile(f('a.mp4', 'video/mp4')), true);
  assert.equal(isVideoFile(f('a.jpg', 'image/jpeg')), false);
});

test('permission branch keeps BookingPhotoUpload s wider matching', () => {
  for (const m of ['new row violates row-level security policy',
                   'RLS check failed', 'operation not allowed']) {
    assert.match(getUploadErrorMessage(new Error(m), false), /permission denied/i, m);
  }
});

test('bucket branch survived the merge — StaffPhotosTab had none', () => {
  assert.match(getUploadErrorMessage(new Error('Bucket not found'), false), /storage is not set up/i);
});

test('size limits differ by media type', () => {
  assert.match(getUploadErrorMessage(new Error('Payload too large'), true), /100MB/);
  assert.match(getUploadErrorMessage(new Error('Payload too large'), false), /10MB/);
});

test('booking branch keeps StaffPhotosTab s clearer wording', () => {
  assert.match(getUploadErrorMessage(new Error('invalid uuid'), false), /the selected booking/i);
});

test('long unknown errors are not dumped at the user', () => {
  const long = 'x'.repeat(200);
  assert.equal(getUploadErrorMessage(new Error(long), false), 'Upload failed. Please try again.');
  assert.match(getUploadErrorMessage(new Error('odd thing'), false), /Failed to upload: odd thing/);
});

test('non-Error inputs do not throw', () => {
  for (const v of [null, undefined, 'a string', 42, {}]) {
    assert.equal(typeof getUploadErrorMessage(v, false), 'string');
  }
});

test('a photo the phone cannot decode keeps a clear message', () => {
  assert.equal(getUploadErrorMessage(new Error(PHOTO_DECODE_ERROR), false), PHOTO_DECODE_ERROR);
  assert.match(PHOTO_DECODE_ERROR, /couldn't read this photo/i);
});

test('one selection is capped at 30', () => {
  const files = Array.from({ length: 31 }, (_, i) => i);
  const taken = takeSelection(files);
  assert.equal(taken.overLimit, true);
  assert.equal(taken.accepted.length, MAX_MEDIA_PER_SELECTION);
  assert.deepEqual(taken.accepted, files.slice(0, 30));
  assert.equal(takeSelection(files.slice(0, 30)).overLimit, false);
  assert.equal(SELECTION_LIMIT_MESSAGE, 'Up to 30 at a time. Add the rest after these finish.');
});

test('HEIC and HEIF are recognized without dropping them from the picker', () => {
  assert.equal(isHeicFile(f('IMG_1.HEIC', '')), true);
  assert.equal(isHeicFile(f('IMG_1.heif', 'application/octet-stream')), true);
  assert.equal(isHeicFile(f('IMG_1.jpg', 'image/jpeg')), false);
  assert.equal(isVideoFile(f('clip.mp4', 'video/mp4')), true);
});
