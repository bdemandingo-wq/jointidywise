/**
 * Which file an admin download should use.
 *
 * photo_url is the unstamped copy for photos saved after this change.
 * stamped_photo_url is the same picture with the bar painted in.
 * Older rows have only photo_url. When proof_stamped is true, that file
 * already has the bar and the unstamped original was not kept.
 * When the burn never happened, Download with timestamp paints the bar
 * in the browser from the row. It does not paint a second bar on a file
 * that already has one.
 */

import { formatPropertyAddress, proofStampLines } from '@/lib/photoProofStamp';

export interface DownloadablePhoto {
  photo_url: string;
  stamped_photo_url?: string | null;
  proof_stamped?: boolean | null;
  media_type?: string | null;
  captured_at?: string | null;
  created_at?: string | null;
  timestamp_source?: string | null;
  capture_latitude?: number | null;
  capture_longitude?: number | null;
  booking?: {
    booking_number?: number | null;
    address?: string | null;
    apt_suite?: string | null;
    city?: string | null;
    state?: string | null;
    zip_code?: string | null;
  } | null;
}

export type PhotoDownloadKind = 'original' | 'timestamp';

export interface PhotoDownloadPlan {
  action: 'file' | 'render' | 'unavailable';
  path: string | null;
  message: string | null;
}

export const ORIGINAL_NOT_KEPT =
  'This photo was saved with the timestamp already painted on it. An unstamped copy was not kept.';

export const VIDEO_NOT_STAMPED = 'Videos are not stamped. Download the file instead.';

export function stampedSiblingPath(filePath: string): string {
  const slash = filePath.lastIndexOf('/');
  const dir = slash >= 0 ? filePath.slice(0, slash + 1) : '';
  const name = slash >= 0 ? filePath.slice(slash + 1) : filePath;
  const dot = name.lastIndexOf('.');
  const base = dot > 0 ? name.slice(0, dot) : name;
  return `${dir}${base}-stamped.jpg`;
}

function isVideo(photo: DownloadablePhoto): boolean {
  return photo.media_type === 'video' || /\.(mp4|mov|m4v)(?:\?|$)/i.test(photo.photo_url);
}

/** The picture to show. Prefer the painted file when we stored one separately. */
export function displayPhotoPath(photo: { photo_url: string; stamped_photo_url?: string | null }): string {
  return photo.stamped_photo_url || photo.photo_url;
}

export function planPhotoDownload(photo: DownloadablePhoto, kind: PhotoDownloadKind): PhotoDownloadPlan {
  if (kind === 'original') {
    if (!isVideo(photo) && photo.proof_stamped === true && !photo.stamped_photo_url) {
      return { action: 'unavailable', path: null, message: ORIGINAL_NOT_KEPT };
    }
    return { action: 'file', path: photo.photo_url, message: null };
  }
  if (isVideo(photo)) return { action: 'unavailable', path: null, message: VIDEO_NOT_STAMPED };
  if (photo.stamped_photo_url) return { action: 'file', path: photo.stamped_photo_url, message: null };
  if (photo.proof_stamped === true) return { action: 'file', path: photo.photo_url, message: null };
  return { action: 'render', path: photo.photo_url, message: null };
}

/** Full bar: Taken/Uploaded · date · Job # · address · GPS. */
export function downloadStampLines(photo: DownloadablePhoto, businessTimeZone: string): string[] {
  const raw = photo.captured_at || photo.created_at;
  const parsed = raw ? new Date(raw) : new Date();
  const at = Number.isNaN(parsed.getTime()) ? new Date() : parsed;
  const label = photo.timestamp_source === 'exif' ? 'Taken' as const : 'Uploaded' as const;
  return proofStampLines({
    label,
    at,
    businessTimeZone: businessTimeZone || 'America/New_York',
    bookingNumber: photo.booking?.booking_number,
    address: formatPropertyAddress({
      address: photo.booking?.address,
      apt_suite: photo.booking?.apt_suite,
      city: photo.booking?.city,
      state: photo.booking?.state,
      zip_code: photo.booking?.zip_code,
    }),
    latitude: photo.capture_latitude ?? null,
    longitude: photo.capture_longitude ?? null,
  });
}

export function downloadFileName(photo: DownloadablePhoto, kind: PhotoDownloadKind): string {
  const job = photo.booking?.booking_number != null ? `job-${photo.booking.booking_number}` : 'photo';
  if (kind === 'timestamp') return `${job}-timestamp.jpg`;
  const leaf = photo.photo_url.split('/').pop() || 'photo.jpg';
  const ext = leaf.includes('.') ? leaf.split('.').pop() : 'jpg';
  return `${job}-original.${ext}`;
}
