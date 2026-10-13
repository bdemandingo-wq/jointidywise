import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ORIGINAL_NOT_KEPT,
  downloadFileName,
  downloadStampLines,
  planPhotoDownload,
  stampedSiblingPath,
} from './photoDownload.ts';

const both = {
  photo_url: 'org/booking/staff/before/abc.jpg',
  stamped_photo_url: 'org/booking/staff/before/abc-stamped.jpg',
  proof_stamped: true,
  media_type: 'photo',
  captured_at: '2026-01-15T20:00:00.000Z',
  timestamp_source: 'exif' as const,
  capture_latitude: 30.2672,
  capture_longitude: -97.7431,
  booking: {
    booking_number: 1042,
    address: '123 Main St',
    city: 'Austin',
    state: 'TX',
    zip_code: '78701',
  },
};

test('a new photo downloads the unstamped file and the painted file separately', () => {
  assert.deepEqual(planPhotoDownload(both, 'original'), {
    action: 'file',
    path: both.photo_url,
    message: null,
  });
  assert.deepEqual(planPhotoDownload(both, 'timestamp'), {
    action: 'file',
    path: both.stamped_photo_url,
    message: null,
  });
});

test('an older stamped photo has no unstamped original to give back', () => {
  const legacy = { ...both, stamped_photo_url: null };
  assert.equal(planPhotoDownload(legacy, 'original').action, 'unavailable');
  assert.equal(planPhotoDownload(legacy, 'original').message, ORIGINAL_NOT_KEPT);
  assert.deepEqual(planPhotoDownload(legacy, 'timestamp'), {
    action: 'file',
    path: legacy.photo_url,
    message: null,
  });
});

test('a photo that was never painted is stamped in the browser on download', () => {
  const plain = { ...both, stamped_photo_url: null, proof_stamped: false };
  assert.equal(planPhotoDownload(plain, 'original').action, 'file');
  assert.equal(planPhotoDownload(plain, 'original').path, plain.photo_url);
  assert.equal(planPhotoDownload(plain, 'timestamp').action, 'render');
  assert.equal(planPhotoDownload(plain, 'timestamp').path, plain.photo_url);
});

test('videos are not stamped', () => {
  const video = { ...both, media_type: 'video', photo_url: 'org/clip.mov', stamped_photo_url: null, proof_stamped: false };
  assert.equal(planPhotoDownload(video, 'timestamp').action, 'unavailable');
  assert.equal(planPhotoDownload(video, 'original').path, video.photo_url);
});

test('the painted file sits next to the original', () => {
  assert.equal(
    stampedSiblingPath('org/booking/staff/before/abc.jpg'),
    'org/booking/staff/before/abc-stamped.jpg',
  );
});

test('a client-side stamp uses the stored time, job, address, and gps', () => {
  const lines = downloadStampLines(both, 'America/New_York');
  assert.match(lines[0], /^Taken · /);
  assert.equal(lines[1], 'Job #1042 · 123 Main St, Austin, TX, 78701');
  assert.equal(lines[2], 'GPS 30.26720, -97.74310');
  assert.equal(downloadFileName(both, 'timestamp'), 'job-1042-timestamp.jpg');
  assert.equal(downloadFileName(both, 'original'), 'job-1042-original.jpg');
});
