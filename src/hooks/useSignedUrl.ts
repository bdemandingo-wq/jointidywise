import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';

/**
 * Hook to generate signed URLs for private storage buckets
 * Signed URLs expire after the specified duration (default 1 hour)
 */
export function useSignedUrl(
  bucket: string,
  path: string | null,
  expiresIn: number = 3600 // 1 hour default
) {
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!path) {
      setSignedUrl(null);
      return;
    }

    const generateUrl = async () => {
      setLoading(true);
      setError(null);
      
      try {
        const { data, error: signError } = await supabase.storage
          .from(bucket)
          .createSignedUrl(path, expiresIn);

        if (signError) throw signError;
        setSignedUrl(data.signedUrl);
      } catch (err) {
        console.error('Error generating signed URL:', err);
        setError(err instanceof Error ? err : new Error('Failed to generate signed URL'));
        setSignedUrl(null);
      } finally {
        setLoading(false);
      }
    };

    generateUrl();
  }, [bucket, path, expiresIn]);

  return { signedUrl, loading, error };
}

/**
 * Utility to extract the storage path from a full URL or path
 * Handles both old public URLs and new path-only storage
 */
export function extractStoragePath(urlOrPath: string | null): string | null {
  if (!urlOrPath) return null;
  
  // If it's already just a path (no http), return as-is
  if (!urlOrPath.startsWith('http')) {
    return urlOrPath;
  }
  
  // Extract path from full Supabase storage URL
  // Format: https://xxx.supabase.co/storage/v1/object/public/bucket-name/path
  const match = urlOrPath.match(/\/storage\/v1\/object\/(?:public|sign)\/[^/]+\/(.+)/);
  if (match) {
    return decodeURIComponent(match[1].split('?')[0]);
  }
  
  return urlOrPath;
}

/**
 * Generate a signed URL on-demand (non-hook version for edge cases)
 */
export interface SignedUrlTransform {
  width?: number;
  height?: number;
  quality?: number;
  resize?: 'cover' | 'contain' | 'fill';
}

// #14 perf fix: gallery grids were re-requesting a fresh signed URL for
// every image on every mount, then downloading multi-MB originals.
// Cache signed URLs in memory for the session, and allow a transform so
// grids request server-resized thumbnails instead of originals.
const signedUrlCache = new Map<string, { url: string; expiresAt: number }>();
const pendingSignedUrls = new Map<string, Promise<string | null>>();

export async function getSignedUrl(
  bucket: string,
  path: string,
  expiresIn: number = 3600,
  transform?: SignedUrlTransform
): Promise<string | null> {
  try {
    const storagePath = extractStoragePath(path);
    if (!storagePath) return null;

    const cacheKey = `${bucket}:${storagePath}:${JSON.stringify(transform ?? {})}`;
    const cached = signedUrlCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now() + 60_000) {
      return cached.url;
    }

    const pending = pendingSignedUrls.get(cacheKey);
    if (pending) return pending;
    const task = (async () => {
      const { data, error } = await supabase.storage.from(bucket)
        .createSignedUrl(storagePath, expiresIn, transform ? { transform } : undefined);
      if (error) throw error;
      if (signedUrlCache.size >= 500) {
        const oldest = signedUrlCache.keys().next().value;
        if (oldest) signedUrlCache.delete(oldest);
      }
      signedUrlCache.set(cacheKey, { url: data.signedUrl, expiresAt: Date.now() + expiresIn * 1000 });
      return data.signedUrl;
    })();
    pendingSignedUrls.set(cacheKey, task);
    try { return await task; } finally { pendingSignedUrls.delete(cacheKey); }
  } catch (err) {
    console.error('Error generating signed URL:', err);
    return null;
  }
}
