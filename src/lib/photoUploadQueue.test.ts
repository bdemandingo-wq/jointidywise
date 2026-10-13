import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyUploadFailure,
  applyUploadSuccess,
  isRetryableUploadError,
  photoVisibleToOrg,
  pickNextUpload,
  recoverInterrupted,
  retryDelayMs,
  type PhotoQueueItem,
} from './photoUploadQueue.ts';

function item(partial: Partial<PhotoQueueItem> & Pick<PhotoQueueItem, 'id'>): PhotoQueueItem {
  return {
    bookingId: 'b',
    staffId: 's',
    organizationId: 'o',
    photoType: 'before',
    fileName: 'a.jpg',
    mimeType: 'image/jpeg',
    liveCapture: true,
    captureExif: null,
    createdAt: 1,
    updatedAt: 1,
    attempts: 0,
    status: 'pending',
    nextAttemptAt: 0,
    ...partial,
  };
}

test('backoff grows and then caps', () => {
  assert.equal(retryDelayMs(1), 1000);
  assert.equal(retryDelayMs(2), 2000);
  assert.equal(retryDelayMs(3), 4000);
  assert.equal(retryDelayMs(8), 30_000);
});

test('permission and file-type errors are not retried', () => {
  assert.equal(isRetryableUploadError(new Error('new row violates row-level security policy')), false);
  assert.equal(isRetryableUploadError(new Error('Upload permission denied')), false);
  assert.equal(isRetryableUploadError(new Error('Payload too large')), false);
  assert.equal(isRetryableUploadError(new Error('Failed to fetch')), true);
  assert.equal(isRetryableUploadError(new Error('network timeout')), true);
});

test('a failed photo does not remove one that already uploaded', () => {
  const uploaded = applyUploadSuccess(item({ id: 'a', status: 'uploading' }), 'org/job/photo.jpg', 10);
  const failed = applyUploadFailure(
    item({ id: 'b', status: 'uploading', createdAt: 2 }),
    'Upload failed. Check your connection and try again.',
    true,
    10,
  );
  const list = [uploaded, failed];
  assert.equal(list.find((row) => row.id === 'a')?.status, 'done');
  assert.equal(list.find((row) => row.id === 'a')?.remotePath, 'org/job/photo.jpg');
  assert.equal(failed.status, 'pending');
  assert.equal(failed.attempts, 1);
  assert.ok(failed.nextAttemptAt > 10);
});

test('retries stop with the error still attached', () => {
  let row = item({ id: 'a', status: 'uploading', attempts: 4 });
  row = applyUploadFailure(row, 'Upload failed. Check your connection and try again.', true, 50);
  assert.equal(row.status, 'error');
  assert.match(row.error ?? '', /connection/i);
});

test('an interrupted upload is pending again after a reload', () => {
  const rows = recoverInterrupted([
    item({ id: 'a', status: 'uploading' }),
    item({ id: 'b', status: 'done', remotePath: 'kept.jpg' }),
  ], 20);
  assert.equal(rows[0].status, 'pending');
  assert.equal(rows[1].status, 'done');
  assert.equal(rows[1].remotePath, 'kept.jpg');
});

test('the runner takes the oldest photo that is ready, one at a time', () => {
  const now = 100;
  const next = pickNextUpload([
    item({ id: 'later', createdAt: 5, nextAttemptAt: 0 }),
    item({ id: 'waiting', createdAt: 1, nextAttemptAt: 500 }),
    item({ id: 'first', createdAt: 2, nextAttemptAt: 0 }),
  ], now);
  assert.equal(next?.id, 'first');
});

test('a photo with no org on the joined booking still stays visible', () => {
  assert.equal(photoVisibleToOrg('org-1', null, 'org-1'), true);
  assert.equal(photoVisibleToOrg(null, null, 'org-1'), true);
  assert.equal(photoVisibleToOrg(null, 'org-2', 'org-1'), false);
  assert.equal(photoVisibleToOrg('org-1', 'org-2', 'org-1'), true);
});
