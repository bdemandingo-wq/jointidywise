import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PHOTO_DECODE_ERROR, PHOTO_MAX_BYTES } from './bookingMediaErrors.ts';
import {
  applyUploadFailure,
  applyUploadSuccess,
  compressImageFile,
  enqueueBookingPhoto,
  fittedPhotoSize,
  getPhotoQueueSnapshot,
  getQueuedBlob,
  isRetryableUploadError,
  PHOTO_MAX_EDGE,
  photoVisibleToOrg,
  pickNextUpload,
  prepareQueuedPhoto,
  recoverInterrupted,
  resetPhotoQueueForTests,
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

test('a photo the phone cannot read is not retried on its own', () => {
  assert.equal(isRetryableUploadError(new Error(PHOTO_DECODE_ERROR)), false);
});

test('the long edge is capped at 1600', () => {
  assert.equal(PHOTO_MAX_EDGE, 1600);
  assert.deepEqual(fittedPhotoSize(4032, 3024), { width: 1600, height: 1200 });
  assert.deepEqual(fittedPhotoSize(800, 600), { width: 800, height: 600 });
});

function trackReads(name: string, type: string, bytes = [1, 2, 3, 4]) {
  const file = new File([new Uint8Array(bytes)], name, { type });
  let reads = 0;
  const original = file.arrayBuffer.bind(file);
  Object.defineProperty(file, 'arrayBuffer', {
    value: () => {
      reads += 1;
      return original();
    },
  });
  return { file, get reads() { return reads; } };
}

const queueInput = {
  bookingId: 'b',
  staffId: 's',
  organizationId: 'o',
  photoType: 'before',
};

async function withSilentQueue(run: () => Promise<void>) {
  resetPhotoQueueForTests();
  const write = console.error;
  console.error = () => {};
  try {
    await run();
  } finally {
    console.error = write;
    resetPhotoQueueForTests();
  }
}

test('selecting photos does not read them; prepare reads one at a time', async () => {
  await withSilentQueue(async () => {
    const first = trackReads('a.jpg', 'image/jpeg');
    const second = trackReads('b.jpg', 'image/jpeg');
    const a = await enqueueBookingPhoto({ ...queueInput, file: first.file });
    const b = await enqueueBookingPhoto({ ...queueInput, file: second.file });
    assert.equal(first.reads, 0);
    assert.equal(second.reads, 0);
    assert.equal(a.prepared, false);
    await prepareQueuedPhoto(a.id);
    assert.equal(first.reads, 1);
    assert.equal(second.reads, 0);
    const ready = getPhotoQueueSnapshot().find((row) => row.id === a.id);
    assert.equal(ready?.status, 'pending');
    assert.equal(ready?.prepared, true);
    await prepareQueuedPhoto(b.id);
    assert.equal(second.reads, 1);
  });
});

test('a video is queued without being decoded', async () => {
  await withSilentQueue(async () => {
    const clip = trackReads('clip.MOV', 'video/quicktime');
    const item = await enqueueBookingPhoto({ ...queueInput, file: clip.file });
    assert.equal(item.prepared, true);
    assert.equal(item.mimeType, 'video/quicktime');
    await prepareQueuedPhoto(item.id);
    assert.equal(clip.reads, 0);
    assert.equal(getQueuedBlob(item.id), clip.file);
  });
});

test('an unreadable HEIC becomes an error instead of the raw file', async () => {
  await withSilentQueue(async () => {
    const heic = trackReads('IMG.HEIC', 'image/heic');
    const item = await enqueueBookingPhoto({ ...queueInput, file: heic.file });
    const prepared = await prepareQueuedPhoto(item.id);
    assert.equal(prepared?.status, 'error');
    assert.equal(prepared?.error, PHOTO_DECODE_ERROR);
    assert.equal(getQueuedBlob(item.id)?.type, 'image/heic');
    assert.notEqual(prepared?.prepared, true);
  });
});

test('a photo over 10MB is queued, then rejected only if it is still too big', async () => {
  await withSilentQueue(async () => {
    const big = new File([new Uint8Array(PHOTO_MAX_BYTES + 32)], 'big.jpg', { type: 'image/jpeg' });
    const item = await enqueueBookingPhoto({ ...queueInput, file: big });
    assert.equal(item.status, 'pending');
    const prepared = await prepareQueuedPhoto(item.id);
    assert.equal(prepared?.status, 'error');
    assert.match(prepared?.error ?? '', /10MB/);
  });
});

test('the 10MB check uses the compressed file', async () => {
  const previousDocument = globalThis.document;
  const previousDecode = globalThis.createImageBitmap;
  let closed = 0;
  let drawn: { width: number; height: number } | null = null;
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => ({
      drawImage(_image: unknown, _x: number, _y: number, width: number, height: number) {
        drawn = { width, height };
      },
    }),
    toBlob: (done: (blob: Blob | null) => void) => {
      done(new Blob([new Uint8Array(80)], { type: 'image/jpeg' }));
    },
  };
  globalThis.createImageBitmap = (async () => ({
    width: 4032,
    height: 3024,
    close: () => { closed += 1; },
  })) as typeof createImageBitmap;
  globalThis.document = { createElement: () => canvas } as unknown as Document;
  try {
    await withSilentQueue(async () => {
      const big = new File([new Uint8Array(PHOTO_MAX_BYTES + 32)], 'iphone.jpg', { type: 'image/jpeg' });
      const item = await enqueueBookingPhoto({ ...queueInput, file: big });
      const prepared = await prepareQueuedPhoto(item.id);
      assert.equal(prepared?.status, 'pending');
      assert.equal(prepared?.prepared, true);
      assert.equal(prepared?.mimeType, 'image/jpeg');
      assert.ok((getQueuedBlob(item.id)?.size ?? Infinity) < PHOTO_MAX_BYTES);
      assert.deepEqual(drawn, { width: 1600, height: 1200 });
      assert.equal(closed, 1);
      assert.equal(canvas.width, 0);
      assert.equal(canvas.height, 0);
    });
  } finally {
    globalThis.document = previousDocument;
    globalThis.createImageBitmap = previousDecode;
  }
});

test('a failed HEIC decode is an error and a failed JPEG decode keeps the JPEG', async () => {
  const previousDocument = globalThis.document;
  const previousDecode = globalThis.createImageBitmap;
  globalThis.createImageBitmap = (async () => {
    throw new Error('decode failed');
  }) as typeof createImageBitmap;
  globalThis.document = { createElement: () => ({}) } as unknown as Document;
  try {
    const heic = new File([new Uint8Array([1, 2, 3])], 'IMG.HEIC', { type: 'image/heic' });
    await assert.rejects(compressImageFile(heic), (error: unknown) => {
      assert.equal(error instanceof Error ? error.message : '', PHOTO_DECODE_ERROR);
      return true;
    });
    const jpeg = new File([new Uint8Array([1, 2, 3])], 'ok.jpg', { type: 'image/jpeg' });
    assert.equal(await compressImageFile(jpeg), jpeg);
  } finally {
    globalThis.document = previousDocument;
    globalThis.createImageBitmap = previousDecode;
  }
});

test('a photo with no org on the joined booking still stays visible', () => {
  assert.equal(photoVisibleToOrg('org-1', null, 'org-1'), true);
  assert.equal(photoVisibleToOrg(null, null, 'org-1'), true);
  assert.equal(photoVisibleToOrg(null, 'org-2', 'org-1'), false);
  assert.equal(photoVisibleToOrg('org-1', 'org-2', 'org-1'), true);
});
