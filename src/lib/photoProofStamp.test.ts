import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  chooseStampGps,
  formatPropertyAddress,
  isMissingProofColumn,
  mergeCaptureExif,
  parseImageExif,
  parsePluginExif,
  proofOverlayLabel,
  proofStampLines,
  resolveProofClock,
} from './photoProofStamp.ts';
import { inBeforeAfterOrder, stepGalleryIndex } from './photoGallery.ts';

function u16(n: number): number[] {
  return [n & 0xff, (n >> 8) & 0xff];
}
function u32(n: number): number[] {
  return [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >> 24) & 0xff];
}

/** Little-endian JPEG with DateTimeOriginal and OffsetTimeOriginal. */
function jpegWithExif(date: string, offset: string): Uint8Array {
  const dateBytes = [...date, '\0'].map((c) => c.charCodeAt(0));
  const offsetBytes = [...offset, '\0'].map((c) => c.charCodeAt(0));
  const exifIfd = 26;
  const dateAt = 56;
  const offsetAt = dateAt + dateBytes.length;
  const tiff = [
    0x49, 0x49, 0x2a, 0x00,
    ...u32(8),
    ...u16(1),
    ...u16(0x8769), ...u16(4), ...u32(1), ...u32(exifIfd),
    ...u32(0),
    ...u16(2),
    ...u16(0x9003), ...u16(2), ...u32(dateBytes.length), ...u32(dateAt),
    ...u16(0x9011), ...u16(2), ...u32(offsetBytes.length), ...u32(offsetAt),
    ...u32(0),
    ...dateBytes,
    ...offsetBytes,
  ];
  const payload = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00, ...tiff];
  const size = payload.length + 2;
  return Uint8Array.from([
    0xff, 0xd8,
    0xff, 0xe1, (size >> 8) & 0xff, size & 0xff,
    ...payload,
    0xff, 0xd9,
  ]);
}

test('gallery stops at the ends instead of wrapping', () => {
  assert.equal(stepGalleryIndex(0, 8, -1), 0);
  assert.equal(stepGalleryIndex(7, 8, 1), 7);
  assert.equal(stepGalleryIndex(2, 8, 1), 3);
  assert.equal(stepGalleryIndex(2, 8, -1), 1);
  assert.equal(stepGalleryIndex(0, 1, 1), 0);
});

test('before/after grouping keeps each stage together without reordering inside it', () => {
  const mixed = [
    { id: 'a-new', photo_type: 'after' },
    { id: 'b-new', photo_type: 'before' },
    { id: 'note', photo_type: 'inspection' },
    { id: 'b-old', photo_type: 'before' },
    { id: 'a-old', photo_type: 'after' },
  ];
  assert.deepEqual(
    inBeforeAfterOrder(mixed).map((item) => item.id),
    ['b-new', 'b-old', 'a-new', 'a-old', 'note'],
  );
});

test('gallery keeps a before/after group in the order it was given', () => {
  const grouped = [
    { id: 'b1', photo_type: 'before' },
    { id: 'b2', photo_type: 'before' },
    { id: 'a1', photo_type: 'after' },
    { id: 'o1', photo_type: 'other' },
  ];
  const seen: string[] = [];
  let index = 0;
  seen.push(grouped[index].id);
  while (true) {
    const next = stepGalleryIndex(index, grouped.length, 1);
    if (next === index) break;
    index = next;
    seen.push(grouped[index].id);
  }
  assert.deepEqual(seen, ['b1', 'b2', 'a1', 'o1']);
});

test('jpeg exif date with offset becomes that absolute instant', () => {
  const bytes = jpegWithExif('2026:01:15 14:00:00', '-06:00');
  const exif = parseImageExif(bytes);
  assert.ok(exif?.takenAt);
  assert.equal(exif.takenAt.toISOString(), '2026-01-15T20:00:00.000Z');
  assert.equal(exif.wallClock, undefined);
});

test('jpeg without exif does not invent a capture time', () => {
  assert.equal(parseImageExif(Uint8Array.from([0xff, 0xd8, 0xff, 0xd9])), null);
});

test('heic-style bytes still yield a wall clock when the date string is present', () => {
  const text = 'ftypheic....2026:07:04 09:30:15....';
  const bytes = Uint8Array.from(text.split('').map((c) => c.charCodeAt(0)));
  const exif = parseImageExif(bytes);
  assert.deepEqual(exif?.wallClock, {
    year: 2026, month: 7, day: 4, hour: 9, minute: 30, second: 15,
  });
});

test('capacitor exif dictionary supplies taken time and gps', () => {
  const exif = parsePluginExif({
    '{Exif}': { DateTimeOriginal: '2026:07:04 13:00:00', OffsetTimeOriginal: '-04:00' },
    '{GPS}': { Latitude: 30.2672, LatitudeRef: 'N', Longitude: 97.7431, LongitudeRef: 'W' },
  });
  assert.equal(exif?.takenAt?.toISOString(), '2026-07-04T17:00:00.000Z');
  assert.equal(exif?.latitude, 30.2672);
  assert.equal(exif?.longitude, -97.7431);
});

test('file exif and plugin gps merge, and an absolute time wins over a wall clock', () => {
  const merged = mergeCaptureExif(
    { wallClock: { year: 2026, month: 1, day: 1, hour: 0, minute: 0, second: 0 } },
    { takenAt: new Date('2026-07-04T17:00:00.000Z'), latitude: 1, longitude: 2 },
  );
  assert.equal(merged?.takenAt?.toISOString(), '2026-07-04T17:00:00.000Z');
  assert.equal(merged?.wallClock, undefined);
  assert.equal(merged?.latitude, 1);
  assert.equal(merged?.longitude, 2);
});

test('missing exif is labeled Uploaded at the upload instant', () => {
  const uploadedAt = new Date('2026-06-01T16:05:00.000Z');
  const clock = resolveProofClock({ exif: null, uploadedAt, deviceTimeZone: 'America/Chicago' });
  assert.equal(clock.source, 'upload');
  assert.equal(clock.label, 'Uploaded');
  assert.equal(clock.at.toISOString(), uploadedAt.toISOString());
});

test('wall clock is read in the device zone and labeled Taken', () => {
  const clock = resolveProofClock({
    exif: { wallClock: { year: 2026, month: 1, day: 15, hour: 14, minute: 0, second: 0 } },
    uploadedAt: new Date('2026-01-15T20:30:00.000Z'),
    deviceTimeZone: 'America/Chicago',
  });
  assert.equal(clock.source, 'exif');
  assert.equal(clock.label, 'Taken');
  assert.equal(clock.at.toISOString(), '2026-01-15T20:00:00.000Z');
});

test('a future exif clock falls back to upload time', () => {
  const uploadedAt = new Date('2026-06-01T16:00:00.000Z');
  const clock = resolveProofClock({
    exif: { takenAt: new Date('2027-01-01T00:00:00.000Z') },
    uploadedAt,
    deviceTimeZone: 'UTC',
  });
  assert.equal(clock.source, 'upload');
  assert.equal(clock.at.toISOString(), uploadedAt.toISOString());
});

test('stamp lines carry the label, job, address, and gps', () => {
  const lines = proofStampLines({
    label: 'Taken',
    at: new Date('2026-01-15T20:00:00.000Z'),
    businessTimeZone: 'America/New_York',
    bookingNumber: 1042,
    address: formatPropertyAddress({
      address: '123 Main St',
      apt_suite: 'Apt 4',
      city: 'Austin',
      state: 'TX',
      zip_code: '78701',
    }),
    latitude: 30.2672,
    longitude: -97.7431,
  });
  assert.match(lines[0], /^Taken · /);
  assert.match(lines[0], /Jan/);
  assert.match(lines[0], /3:00/);
  assert.match(lines[0], /PM/);
  assert.equal(lines[1], 'Job #1042 · 123 Main St Apt 4, Austin, TX, 78701');
  assert.equal(lines[2], 'GPS 30.26720, -97.74310');
});

test('device gps is kept for a live capture and dropped for a library upload', () => {
  const device = { latitude: 40.7, longitude: -74.0 };
  const exif = { latitude: 30.2, longitude: -97.7 };
  assert.deepEqual(chooseStampGps({ exifGps: exif, deviceGps: device, liveCapture: true }), exif);
  assert.deepEqual(chooseStampGps({ exifGps: null, deviceGps: device, liveCapture: true }), device);
  assert.equal(chooseStampGps({ exifGps: null, deviceGps: device, liveCapture: false }), null);
});

test('existing photos overlay the stored timestamp; stamped photos do not', () => {
  const legacy = proofOverlayLabel(
    { created_at: '2026-01-15T20:00:00.000Z' },
    'America/New_York',
  );
  assert.match(legacy ?? '', /^Uploaded · /);
  assert.match(legacy ?? '', /3:00/);
  assert.equal(proofOverlayLabel({
    proof_stamped: true,
    timestamp_source: 'exif',
    captured_at: '2026-01-15T20:00:00.000Z',
    created_at: '2026-01-15T20:05:00.000Z',
  }, 'America/New_York'), null);
  const failedStamp = proofOverlayLabel({
    proof_stamped: false,
    timestamp_source: 'exif',
    captured_at: '2026-01-15T20:00:00.000Z',
    created_at: '2026-01-15T20:05:00.000Z',
  }, 'America/New_York');
  assert.match(failedStamp ?? '', /^Taken · /);
});

test('missing proof columns are recognizable so the upload can still land', () => {
  assert.equal(isMissingProofColumn({ code: '42703', message: 'column captured_at does not exist' }), true);
  assert.equal(isMissingProofColumn({ code: 'PGRST204', message: "Could not find the 'captured_at' column of 'booking_photos' in the schema cache" }), true);
  assert.equal(isMissingProofColumn({ code: '23502', message: 'null value' }), false);
  assert.equal(isMissingProofColumn(null), false);
});
