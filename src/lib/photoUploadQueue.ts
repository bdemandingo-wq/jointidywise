/**
 * Cleaner photo queue.
 *
 * Photos used to live only in React state on StaffPhotosTab and
 * BookingPhotoUpload. Two things then made a batch disappear on a weak
 * in-home connection:
 *
 *  1. An effect revoked every object URL whenever that state changed, so
 *     thumbnails went blank on the first progress update.
 *  2. After one or two uploads succeeded, the tab invalidated the gallery
 *     query and deleted the "done" rows from state. A failed refetch — or
 *     the iOS webview reloading when the camera backgrounded the app —
 *     replaced the whole screen with an error, including photos that had
 *     already uploaded. The files were never written anywhere that survives
 *     a remount.
 *
 * The queue below is the durable copy. Each photo is its own record, a
 * failure does not remove the others, and a successful upload stays visible.
 */

import { isVideoFile } from '@/lib/bookingMediaErrors';
import { mergeCaptureExif, parseImageExif, parsePluginExif, type CaptureExif } from '@/lib/photoProofStamp';

export const MAX_UPLOAD_ATTEMPTS = 5;
export const PHOTO_QUEUE_DB = 'tidywise-photo-queue';
export const PHOTO_QUEUE_STORE = 'items';
const LOCAL_INDEX_KEY = 'tw-photo-queue-v1';
const LOCAL_BLOB_PREFIX = 'tw-photo-blob:';
/** localStorage quota is small. Only the compressed fallback goes there. */
const LOCAL_BLOB_LIMIT = 800_000;

export type PhotoQueueStatus = 'pending' | 'uploading' | 'done' | 'error';

export interface PhotoQueueItem {
  id: string;
  bookingId: string;
  staffId: string;
  organizationId: string;
  photoType: string;
  fileName: string;
  mimeType: string;
  liveCapture: boolean;
  captureExif: unknown;
  createdAt: number;
  updatedAt: number;
  attempts: number;
  status: PhotoQueueStatus;
  error?: string;
  nextAttemptAt: number;
  remotePath?: string;
  /** Session-only. Never written to IndexedDB or localStorage. */
  previewUrl?: string;
}

export interface StoredPhotoQueueItem extends PhotoQueueItem {
  blob: Blob | null;
}

export function retryDelayMs(attempt: number): number {
  const n = Math.max(1, Math.floor(attempt));
  return Math.min(30_000, 1000 * 2 ** (n - 1));
}

/** Permission, type, and size failures will not succeed on a retry. */
export function isRetryableUploadError(error: unknown): boolean {
  const raw = error instanceof Error ? error.message : String(error ?? '');
  const msg = raw.toLowerCase();
  if (!msg.trim()) return true;
  if (
    msg.includes('security') || msg.includes('policy') || msg.includes('permission') ||
    msg.includes('row-level') ||
    msg.includes('rls') || msg.includes('not allowed') || msg.includes('violates') ||
    msg.includes('bucket') || msg.includes('mime') || msg.includes('not supported') ||
    msg.includes('payload') || msg.includes('too large') || msg.includes('photo must') ||
    msg.includes('video must') || msg.includes('only jpg') || msg.includes('booking') ||
    msg.includes('uuid') || msg.includes('missing an organization')
  ) {
    return false;
  }
  return true;
}

/**
 * A photo stays on screen unless we positively know it belongs to another
 * business. A missing booking embed used to hide photos that had uploaded.
 */
export function photoVisibleToOrg(
  photoOrg: string | null | undefined,
  bookingOrg: string | null | undefined,
  activeOrg: string,
): boolean {
  const org = photoOrg || bookingOrg || null;
  return org == null || org === activeOrg;
}

/** A reload mid-upload must not leave the row stuck on "uploading" forever. */
export function recoverInterrupted(items: readonly PhotoQueueItem[], now: number): PhotoQueueItem[] {
  return items.map((item) => (
    item.status === 'uploading'
      ? { ...item, status: 'pending', updatedAt: now, nextAttemptAt: Math.min(item.nextAttemptAt, now) }
      : item
  ));
}

export function pickNextUpload(items: readonly PhotoQueueItem[], now: number): PhotoQueueItem | null {
  const ready = items
    .filter((item) => item.status === 'pending' && item.nextAttemptAt <= now)
    .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
  return ready[0] ?? null;
}

export function applyUploadSuccess(item: PhotoQueueItem, remotePath: string, now: number): PhotoQueueItem {
  return {
    ...item,
    status: 'done',
    remotePath,
    error: undefined,
    updatedAt: now,
    previewUrl: undefined,
  };
}

export function applyUploadFailure(
  item: PhotoQueueItem,
  error: string,
  retryable: boolean,
  now: number,
): PhotoQueueItem {
  const attempts = item.attempts + 1;
  if (retryable && attempts < MAX_UPLOAD_ATTEMPTS) {
    return {
      ...item,
      status: 'pending',
      attempts,
      error,
      nextAttemptAt: now + retryDelayMs(attempts),
      updatedAt: now,
    };
  }
  return {
    ...item,
    status: 'error',
    attempts,
    error,
    updatedAt: now,
  };
}

/** Dates do not survive a JSON backup, so capture time is stored as an ISO string. */
export function reviveCaptureExif(value: unknown): CaptureExif | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const takenAt = typeof raw.takenAt === 'string' ? new Date(raw.takenAt) : raw.takenAt instanceof Date ? raw.takenAt : undefined;
  const wall = raw.wallClock;
  const wallClock = wall && typeof wall === 'object' ? wall as CaptureExif['wallClock'] : undefined;
  const latitude = typeof raw.latitude === 'number' ? raw.latitude : undefined;
  const longitude = typeof raw.longitude === 'number' ? raw.longitude : undefined;
  if ((!takenAt || Number.isNaN(takenAt.getTime())) && !wallClock && latitude == null) return null;
  return {
    takenAt: takenAt && !Number.isNaN(takenAt.getTime()) ? takenAt : undefined,
    wallClock,
    latitude,
    longitude,
  };
}

function storedExif(exif: CaptureExif | null): CaptureExif | null {
  if (!exif) return null;
  return {
    takenAt: exif.takenAt ? new Date(exif.takenAt.toISOString()) : undefined,
    wallClock: exif.wallClock,
    latitude: exif.latitude,
    longitude: exif.longitude,
  };
}

export function withoutSessionFields(item: PhotoQueueItem): PhotoQueueItem {
  const { previewUrl: _preview, ...rest } = item;
  return rest;
}

const MAX_EDGE = 1920;
const JPEG_QUALITY = 0.8;

/**
 * Shrink a photo before it is stored or uploaded. A full iPhone frame plus
 * the proof-stamp canvas is enough to get the webview killed on a job site.
 * Videos are unchanged. If the browser cannot decode the file, the original
 * is kept and the upload path reports its own error.
 */
export async function compressImageFile(file: File): Promise<File> {
  if (isVideoFile(file)) return file;
  if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') return file;
  try {
    const bitmap = await createImageBitmap(file);
    try {
      const longest = Math.max(bitmap.width, bitmap.height);
      const scale = longest > 0 ? Math.min(1, MAX_EDGE / longest) : 1;
      const alreadySmall = scale === 1 && file.type === 'image/jpeg' && file.size < 1_500_000;
      if (alreadySmall) return file;
      const width = Math.max(1, Math.round(bitmap.width * scale));
      const height = Math.max(1, Math.round(bitmap.height * scale));
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return file;
      ctx.drawImage(bitmap, 0, 0, width, height);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY));
      if (!blob) return file;
      const base = file.name.replace(/\.[^.]+$/, '') || 'photo';
      return new File([blob], `${base}.jpg`, { type: 'image/jpeg', lastModified: Date.now() });
    } finally {
      bitmap.close?.();
    }
  } catch {
    return file;
  }
}

type Listener = () => void;

interface MemoryEntry {
  item: PhotoQueueItem;
  blob: Blob | null;
}

const memory = new Map<string, MemoryEntry>();
const listeners = new Set<Listener>();
let snapshot: PhotoQueueItem[] = [];
let hydratePromise: Promise<void> | null = null;

function publish() {
  snapshot = [...memory.values()]
    .map((entry) => entry.item)
    .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
  listeners.forEach((listener) => listener());
}

export function subscribePhotoQueue(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getPhotoQueueSnapshot(): PhotoQueueItem[] {
  return snapshot;
}

export function getQueuedBlob(id: string): Blob | null {
  return memory.get(id)?.blob ?? null;
}

function remember(item: PhotoQueueItem, blob: Blob | null, revokePrevious = false) {
  const prev = memory.get(item.id);
  let previewUrl = item.previewUrl ?? prev?.item.previewUrl;
  if (item.status === 'done') {
    if (previewUrl?.startsWith('blob:')) URL.revokeObjectURL(previewUrl);
    previewUrl = undefined;
    blob = null;
  } else if (!previewUrl && blob) {
    previewUrl = URL.createObjectURL(blob);
  } else if (revokePrevious && prev?.item.previewUrl && prev.item.previewUrl !== previewUrl) {
    URL.revokeObjectURL(prev.item.previewUrl);
  }
  memory.set(item.id, { item: { ...item, previewUrl }, blob });
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is not available on this device.'));
      return;
    }
    const request = indexedDB.open(PHOTO_QUEUE_DB, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(PHOTO_QUEUE_STORE)) {
        db.createObjectStore(PHOTO_QUEUE_STORE, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Could not open the photo queue.'));
  });
}

function idbRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Photo queue storage failed.'));
  });
}

async function idbPut(record: StoredPhotoQueueItem): Promise<void> {
  const db = await openDb();
  try {
    const tx = db.transaction(PHOTO_QUEUE_STORE, 'readwrite');
    tx.objectStore(PHOTO_QUEUE_STORE).put(record);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('Could not save the photo on this phone.'));
      tx.onabort = () => reject(tx.error ?? new Error('Could not save the photo on this phone.'));
    });
  } finally {
    db.close();
  }
}

async function idbDelete(id: string): Promise<void> {
  const db = await openDb();
  try {
    const tx = db.transaction(PHOTO_QUEUE_STORE, 'readwrite');
    tx.objectStore(PHOTO_QUEUE_STORE).delete(id);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('Could not update the photo queue.'));
    });
  } finally {
    db.close();
  }
}

async function idbAll(): Promise<StoredPhotoQueueItem[]> {
  const db = await openDb();
  try {
    const tx = db.transaction(PHOTO_QUEUE_STORE, 'readonly');
    const rows = await idbRequest(tx.objectStore(PHOTO_QUEUE_STORE).getAll());
    return (rows ?? []) as StoredPhotoQueueItem[];
  } finally {
    db.close();
  }
}

function readLocalIndex(): PhotoQueueItem[] {
  try {
    const raw = localStorage.getItem(LOCAL_INDEX_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as PhotoQueueItem[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeLocalIndex() {
  try {
    const rows = [...memory.values()].map((entry) => withoutSessionFields(entry.item));
    localStorage.setItem(LOCAL_INDEX_KEY, JSON.stringify(rows));
  } catch {
    // Quota or private mode. IndexedDB and memory still hold the queue.
  }
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error ?? new Error('Could not read the photo.'));
    reader.readAsDataURL(blob);
  });
}

function dataUrlToBlob(dataUrl: string): Blob | null {
  const comma = dataUrl.indexOf(',');
  if (comma < 0) return null;
  const header = dataUrl.slice(0, comma);
  const mime = /data:(.*?);/.exec(header)?.[1] || 'image/jpeg';
  try {
    const binary = atob(dataUrl.slice(comma + 1));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type: mime });
  } catch {
    return null;
  }
}

async function writeLocalBlob(id: string, blob: Blob | null) {
  try {
    if (!blob || blob.size > LOCAL_BLOB_LIMIT) {
      localStorage.removeItem(LOCAL_BLOB_PREFIX + id);
      return;
    }
    localStorage.setItem(LOCAL_BLOB_PREFIX + id, await blobToDataUrl(blob));
  } catch {
    try { localStorage.removeItem(LOCAL_BLOB_PREFIX + id); } catch { /* ignore */ }
  }
}

function readLocalBlob(id: string): Blob | null {
  try {
    const raw = localStorage.getItem(LOCAL_BLOB_PREFIX + id);
    return raw ? dataUrlToBlob(raw) : null;
  } catch {
    return null;
  }
}

async function persist(item: PhotoQueueItem, blob: Blob | null) {
  remember(item, blob);
  publish();
  writeLocalIndex();
  const stored: StoredPhotoQueueItem = { ...withoutSessionFields(memory.get(item.id)?.item ?? item), blob };
  try {
    await idbPut(stored);
  } catch (error) {
    console.error('[photo-queue] IndexedDB write failed; keeping a local copy', error);
    await writeLocalBlob(item.id, blob);
  }
  if (blob && blob.size <= LOCAL_BLOB_LIMIT) {
    await writeLocalBlob(item.id, blob);
  }
}

export async function hydratePhotoQueue(): Promise<void> {
  if (!hydratePromise) {
    hydratePromise = (async () => {
      const now = Date.now();
      let rows: StoredPhotoQueueItem[] = [];
      try {
        rows = await idbAll();
      } catch (error) {
        console.error('[photo-queue] IndexedDB read failed; using the local backup', error);
      }
      if (rows.length === 0) {
        rows = readLocalIndex().map((item) => ({ ...item, blob: readLocalBlob(item.id) }));
      }
      const recovered = recoverInterrupted(rows.map((row) => ({
        ...withoutSessionFields(row),
        captureExif: reviveCaptureExif(row.captureExif),
      })), now);
      recovered.forEach((item) => {
        const blob = rows.find((row) => row.id === item.id)?.blob ?? null;
        remember(item, item.status === 'done' ? null : blob);
      });
      publish();
      if (recovered.some((item, index) => item.status !== rows[index]?.status)) {
        await Promise.all(recovered.map(async (item) => {
          const blob = memory.get(item.id)?.blob ?? null;
          try {
            await idbPut({ ...withoutSessionFields(item), blob });
          } catch {
            // The in-memory queue still resumes.
          }
        }));
        writeLocalIndex();
      }
    })();
  }
  await hydratePromise;
}

export interface EnqueueBookingPhotoInput {
  file: File;
  bookingId: string;
  staffId: string;
  organizationId: string;
  photoType: string;
  liveCapture?: boolean;
  captureExif?: unknown;
}

export async function enqueueBookingPhoto(input: EnqueueBookingPhotoInput): Promise<PhotoQueueItem> {
  await hydratePhotoQueue();
  const bytes = new Uint8Array(await input.file.arrayBuffer());
  const captureExif = mergeCaptureExif(parseImageExif(bytes), parsePluginExif(input.captureExif));
  const file = await compressImageFile(input.file);
  const now = Date.now();
  const item: PhotoQueueItem = {
    id: crypto.randomUUID(),
    bookingId: input.bookingId,
    staffId: input.staffId,
    organizationId: input.organizationId,
    photoType: input.photoType,
    fileName: file.name,
    mimeType: file.type || (isVideoFile(file) ? 'video/quicktime' : 'image/jpeg'),
    liveCapture: !!input.liveCapture && !isVideoFile(file),
    captureExif: storedExif(captureExif),
    createdAt: now,
    updatedAt: now,
    attempts: 0,
    status: 'pending',
    nextAttemptAt: now,
  };
  await persist(item, file);
  return memory.get(item.id)?.item ?? item;
}

export async function markUploadStarted(id: string): Promise<PhotoQueueItem | null> {
  const entry = memory.get(id);
  if (!entry || entry.item.status === 'done') return entry?.item ?? null;
  const next: PhotoQueueItem = { ...entry.item, status: 'uploading', error: undefined, updatedAt: Date.now() };
  await persist(next, entry.blob);
  return memory.get(id)?.item ?? next;
}

export async function markUploadFinished(id: string, remotePath: string): Promise<void> {
  const entry = memory.get(id);
  if (!entry) return;
  const next = applyUploadSuccess(entry.item, remotePath, Date.now());
  if (entry.item.previewUrl?.startsWith('blob:')) URL.revokeObjectURL(entry.item.previewUrl);
  await persist({ ...next, previewUrl: undefined }, null);
}

export async function markUploadFailed(id: string, error: unknown, retryable = isRetryableUploadError(error)): Promise<PhotoQueueItem | null> {
  const entry = memory.get(id);
  if (!entry) return null;
  const message = error instanceof Error ? error.message : String(error ?? 'Upload failed.');
  const next = applyUploadFailure(entry.item, message, retryable, Date.now());
  await persist(next, entry.blob);
  return memory.get(id)?.item ?? next;
}

export async function retryQueuedPhoto(id: string): Promise<void> {
  await hydratePhotoQueue();
  const entry = memory.get(id);
  if (!entry || entry.item.status === 'done' || entry.item.status === 'uploading') return;
  const next: PhotoQueueItem = {
    ...entry.item,
    status: 'pending',
    attempts: 0,
    error: undefined,
    nextAttemptAt: Date.now(),
    updatedAt: Date.now(),
  };
  await persist(next, entry.blob);
}

export async function dismissQueuedPhoto(id: string): Promise<void> {
  const entry = memory.get(id);
  if (!entry || entry.item.status === 'uploading') return;
  if (entry.item.previewUrl?.startsWith('blob:')) URL.revokeObjectURL(entry.item.previewUrl);
  memory.delete(id);
  publish();
  writeLocalIndex();
  try { localStorage.removeItem(LOCAL_BLOB_PREFIX + id); } catch { /* ignore */ }
  try { await idbDelete(id); } catch (error) {
    console.error('[photo-queue] could not remove a local photo', error);
  }
}

/** Test-only reset. Not used by the app. */
export function resetPhotoQueueForTests() {
  memory.forEach((entry) => {
    if (entry.item.previewUrl?.startsWith('blob:')) URL.revokeObjectURL(entry.item.previewUrl);
  });
  memory.clear();
  snapshot = [];
  hydratePromise = null;
  listeners.clear();
}
