import { getSignedUrl, extractStoragePath } from '@/hooks/useSignedUrl';
import { isUnsupportedImageTransformation } from '@/lib/thumbnailCapability';

// Session-only feature detection. Never persist signed URLs or capabilities.
const unsupportedBuckets = new Set<string>();
const probes = new Map<string, Promise<boolean>>();

export async function thumbnailSupported(bucket: string, url: string): Promise<boolean> {
  if (unsupportedBuckets.has(bucket)) return false;
  const previous = probes.get(bucket);
  if (previous) return previous;
  const probe = (async () => {
    const response = await fetch(url, { method: 'GET', headers: { Range: 'bytes=0-0' } });
    if (response.ok) { await response.body?.cancel(); return true; }
    const message = await response.text();
    if (isUnsupportedImageTransformation(response.status, message)) {
      unsupportedBuckets.add(bucket);
      return false;
    }
    // Missing individual media and auth/network failures are not plan detection.
    probes.delete(bucket);
    throw new Error('Could not load this thumbnail');
  })();
  probes.set(bucket, probe);
  try { return await probe; } catch (error) { probes.delete(bucket); throw error; }
}

export async function mediaThumbnailUrl(bucket: string, path: string, width: number): Promise<string | null> {
  if (unsupportedBuckets.has(bucket)) return getSignedUrl(bucket, path);
  const url = await getSignedUrl(bucket, path, 3600, { width, quality: 70, resize: 'contain' });
  if (!url) throw new Error('Could not sign thumbnail');
  return await thumbnailSupported(bucket, url) ? url : getSignedUrl(bucket, path);
}

const prefetched = new Map<string, number>();
export async function prefetchMediaOriginal(bucket: string, path: string) {
  const key = `${bucket}:${extractStoragePath(path)}`;
  if ((prefetched.get(key) ?? 0) > Date.now()) return;
  prefetched.set(key, Date.now() + 5 * 60 * 1000);
  if (prefetched.size > 200) {
    const first = prefetched.keys().next().value;
    if (first) prefetched.delete(first);
  }
  const url = await getSignedUrl(bucket, path);
  if (!url) { prefetched.delete(key); return; }
  const image = new Image();
  image.onerror = () => prefetched.delete(key);
  image.src = url;
}