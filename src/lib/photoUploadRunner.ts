import { Capacitor } from '@capacitor/core';
import { getUploadErrorMessage } from '@/lib/bookingMediaErrors';
import { uploadBookingMedia } from '@/lib/bookingMediaUpload';
import {
  getPhotoQueueSnapshot,
  getQueuedBlob,
  hydratePhotoQueue,
  isRetryableUploadError,
  markUploadFailed,
  reviveCaptureExif,
  markUploadFinished,
  markUploadStarted,
  pickNextUpload,
  subscribePhotoQueue,
} from '@/lib/photoUploadQueue';

let active = false;
let again = false;
let listenersReady = false;
let wakeWaiter: (() => void) | null = null;

function sleep(ms: number) {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      wakeWaiter = null;
      resolve();
    }, ms);
    // A new photo, or the app coming back, must not sit behind a backoff sleep.
    wakeWaiter = () => {
      clearTimeout(timer);
      wakeWaiter = null;
      resolve();
    };
  });
}

async function uploadOne(id: string) {
  const item = getPhotoQueueSnapshot().find((row) => row.id === id);
  const blob = getQueuedBlob(id);
  if (!item || !blob) {
    await markUploadFailed(id, new Error('That photo is no longer on this phone. Take it again.'), false);
    return;
  }
  await markUploadStarted(id);
  const file = new File([blob], item.fileName, { type: item.mimeType || blob.type });
  try {
    const result = await uploadBookingMedia({
      file,
      bookingId: item.bookingId,
      staffId: item.staffId,
      photoType: item.photoType,
      organizationIdFallback: item.organizationId,
      parsedExif: reviveCaptureExif(item.captureExif),
      liveCapture: item.liveCapture,
      idempotencyKey: item.id,
    });
    await markUploadFinished(id, result.filePath);
  } catch (error) {
    const isVideo = file.type.startsWith('video/') || file.name.toLowerCase().endsWith('.mov');
    const message = getUploadErrorMessage(error, isVideo);
    await markUploadFailed(id, new Error(message), isRetryableUploadError(error));
  }
}

async function drain() {
  await hydratePhotoQueue();
  for (;;) {
    const now = Date.now();
    const next = pickNextUpload(getPhotoQueueSnapshot(), now);
    if (!next) {
      const waiting = getPhotoQueueSnapshot()
        .filter((item) => item.status === 'pending')
        .map((item) => item.nextAttemptAt);
      if (!waiting.length) return;
      const delay = Math.max(250, Math.min(...waiting) - now);
      await sleep(delay);
      continue;
    }
    await uploadOne(next.id);
  }
}

/** One runner for the whole app, so leaving the photos tab does not cancel an upload. */
export function kickPhotoUploadRunner() {
  again = true;
  wakeWaiter?.();
  if (active) return;
  active = true;
  void (async () => {
    try {
      do {
        again = false;
        await drain();
      } while (again);
    } catch (error) {
      console.error('[photo-queue] runner stopped', error);
    } finally {
      active = false;
      if (again) kickPhotoUploadRunner();
    }
  })();
}

export function startPhotoUploadQueue() {
  void hydratePhotoQueue().then(() => kickPhotoUploadRunner());
  if (listenersReady || typeof document === 'undefined') return;
  listenersReady = true;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') kickPhotoUploadRunner();
  });
  subscribePhotoQueue(() => {
    if (getPhotoQueueSnapshot().some((item) => item.status === 'pending')) kickPhotoUploadRunner();
  });
  if (!Capacitor.isNativePlatform()) return;
  void import('@capacitor/app').then(({ App }) => App.addListener('appStateChange', ({ isActive }) => {
    if (isActive) kickPhotoUploadRunner();
  })).catch(() => {});
}
