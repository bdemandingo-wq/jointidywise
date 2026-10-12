import { Capacitor } from '@capacitor/core';
import { supabase } from '@/lib/supabase';
import type { Database } from '@/integrations/supabase/types';
import { isVideoFile, type MediaType } from '@/lib/bookingMediaErrors';
import {
  burnProofStamp,
  chooseStampGps,
  deviceTimeZone,
  formatPropertyAddress,
  isMissingProofColumn,
  mergeCaptureExif,
  parseImageExif,
  parsePluginExif,
  proofStampLines,
  resolveProofClock,
  type GeoPoint,
  type TimestampSource,
} from '@/lib/photoProofStamp';

export { isVideoFile, getUploadErrorMessage } from '@/lib/bookingMediaErrors';
export type { MediaType } from '@/lib/bookingMediaErrors';

/**
 * The one way to upload a booking photo or video.
 *
 * There were three near-identical copies of this — BookingPhotoUpload,
 * StaffPhotosTab and PropertyInspectionUpload — and they had drifted apart in
 * three ways, one of which was writing wrong data:
 *
 *  1. `media_type` was taken from a UI mode toggle in one copy and derived from
 *     the file in another. Someone in "photo" mode picking a .mov had the video
 *     recorded as a photo, permanently. Now derived here, from the file, so no
 *     caller can get it wrong.
 *  2. Two copies had their own `getUploadErrorMessage` with different match
 *     terms and different wording for the same failure.
 *  3. PropertyInspectionUpload had no rollback at all, so a failed insert left
 *     the uploaded object orphaned in storage.
 *
 * Merged deliberately rather than by keeping whichever copy was touched last —
 * see the notes on each behaviour below.
 */

export interface UploadBookingMediaArgs {
  file: File;
  bookingId: string;
  staffId: string;
  /** Storage folder segment and the `photo_type` column: before / after / inspection … */
  photoType: string;
  /** Used only when the booking row has no organization_id of its own. */
  organizationIdFallback?: string | null;
  /** Extra booking_photos columns — inspection_note, issue_category. */
  extra?: Record<string, unknown>;
  /** Disambiguates filenames inside a batch uploaded in the same millisecond. */
  index?: number;
  /**
   * Capacitor Camera's `exif` object. The data-URL it returns has already
   * dropped the EXIF segment, so this is the only capture time on iOS.
   */
  captureExif?: unknown;
  /** True when the cleaner just took the photo, not when they picked one from the library. */
  liveCapture?: boolean;
}

export interface UploadBookingMediaResult {
  filePath: string;
  mediaType: MediaType;
  organizationId: string;
}

/**
 * Upload one file and record it. Throws on failure, having already removed the
 * storage object if it was written — so a caller never has to remember the
 * rollback, which is exactly what one of the three copies forgot.
 */
/** MIME types the booking-photos bucket accepts. Anything else is rejected
 *  by storage with an opaque error, so images are re-encoded to JPEG first. */
const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

/**
 * iPhones hand over HEIC/HEIF (and occasionally an empty type) from the photo
 * library. Storage rejects those outright, which surfaced to cleaners as a
 * bare "upload failed". Re-encode to JPEG in the browser when we can; if the
 * browser cannot decode it, fall through and let storage give its own error.
 */
interface ProofColumns {
  captured_at: string;
  timestamp_source: TimestampSource;
  capture_latitude: number | null;
  capture_longitude: number | null;
  proof_stamped: boolean;
}

/**
 * A short budget, raced here rather than inside the geolocation call.
 * The platform timeout does not start until the permission prompt is
 * dismissed, and a cleaner waiting on that must not sit on a spinner
 * while the photo is ready. A fix that is already granted comes back
 * from cache well inside this window.
 */
function readCaptureGps(): Promise<GeoPoint | null> {
  return new Promise((resolve) => {
    const giveUp = setTimeout(() => resolve(null), 2500);
    const finish = (point: GeoPoint | null) => {
      clearTimeout(giveUp);
      resolve(point);
    };
    void (async () => {
      try {
        if (Capacitor.isNativePlatform()) {
          const { Geolocation } = await import('@capacitor/geolocation');
          const pos = await Geolocation.getCurrentPosition({
            enableHighAccuracy: false,
            timeout: 2500,
            maximumAge: 120_000,
          });
          const latitude = pos.coords.latitude;
          const longitude = pos.coords.longitude;
          finish(Number.isFinite(latitude) && Number.isFinite(longitude) ? { latitude, longitude } : null);
          return;
        }
        if (typeof navigator === 'undefined' || !navigator.geolocation) {
          finish(null);
          return;
        }
        navigator.geolocation.getCurrentPosition(
          (pos) => finish({ latitude: pos.coords.latitude, longitude: pos.coords.longitude }),
          () => finish(null),
          { enableHighAccuracy: false, timeout: 2500, maximumAge: 120_000 },
        );
      } catch {
        finish(null);
      }
    })();
  });
}

async function normalizeImage(file: File): Promise<File> {
  if (ALLOWED_IMAGE_TYPES.includes(file.type)) return file;
  try {
    const bitmap = await createImageBitmap(file);
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', 0.9),
    );
    if (!blob) return file;
    const base = file.name.replace(/\.[^.]+$/, '');
    return new File([blob], `${base}.jpg`, { type: 'image/jpeg' });
  } catch {
    return file;
  }
}

type BookingPhotoInsert = Database['public']['Tables']['booking_photos']['Insert'];

async function insertBookingPhoto(row: BookingPhotoInsert & Partial<ProofColumns>) {
  return supabase.from('booking_photos').insert(row as BookingPhotoInsert);
}

async function preparePhotoFile(args: {
  file: File;
  bookingNumber: number | null;
  address: string | null;
  businessTimeZone: string;
  captureExif: unknown;
  liveCapture: boolean;
  deviceGps: GeoPoint | null;
  uploadedAt: Date;
}): Promise<{ file: File; proof: ProofColumns }> {
  const bytes = new Uint8Array(await args.file.arrayBuffer());
  const exif = mergeCaptureExif(parseImageExif(bytes), parsePluginExif(args.captureExif));
  const clock = resolveProofClock({
    exif,
    uploadedAt: args.uploadedAt,
    deviceTimeZone: deviceTimeZone(),
  });
  const gps = chooseStampGps({
    exifGps: exif?.latitude != null && exif?.longitude != null
      ? { latitude: exif.latitude, longitude: exif.longitude }
      : null,
    deviceGps: args.deviceGps,
    liveCapture: args.liveCapture,
  });
  const lines = proofStampLines({
    label: clock.label,
    at: clock.at,
    businessTimeZone: args.businessTimeZone,
    bookingNumber: args.bookingNumber,
    address: args.address,
    latitude: gps?.latitude ?? null,
    longitude: gps?.longitude ?? null,
  });

  let file = args.file;
  let stamped = false;
  try {
    file = await burnProofStamp(args.file, lines);
    stamped = true;
  } catch (firstError) {
    // HEIC that the canvas cannot decode is re-encoded to JPEG first, then
    // stamped. A second failure uploads the unstamped file: losing the
    // cleaner's photo is worse than a missing bar, and the viewer overlays
    // the stored time when proof_stamped is false.
    const normalized = await normalizeImage(args.file);
    if (normalized !== args.file) {
      try {
        file = await burnProofStamp(normalized, lines);
        stamped = true;
      } catch (secondError) {
        console.error('[booking-photos] proof stamp failed', secondError);
        file = normalized;
      }
    } else {
      console.error('[booking-photos] proof stamp failed', firstError);
    }
  }

  return {
    file,
    proof: {
      captured_at: clock.at.toISOString(),
      timestamp_source: clock.source,
      capture_latitude: gps?.latitude ?? null,
      capture_longitude: gps?.longitude ?? null,
      proof_stamped: stamped,
    },
  };
}

export async function uploadBookingMedia(
  args: UploadBookingMediaArgs,
): Promise<UploadBookingMediaResult> {
  const {
    file: originalFile,
    bookingId,
    staffId,
    photoType,
    organizationIdFallback,
    extra,
    index,
    captureExif,
    liveCapture = false,
  } = args;
  const uploadedAt = new Date();

  const { data: bookingData, error: bookingError } = await supabase
    .from('bookings')
    .select('id, organization_id, booking_number, address, apt_suite, city, state, zip_code')
    .eq('id', bookingId)
    .maybeSingle<{
      id: string;
      organization_id: string | null;
      booking_number: number;
      address: string | null;
      apt_suite: string | null;
      city: string | null;
      state: string | null;
      zip_code: string | null;
    }>();

  if (bookingError) throw bookingError;
  if (!bookingData?.id) throw new Error('Selected booking was not found.');

  const organizationId = bookingData.organization_id || organizationIdFallback;
  if (!organizationId) throw new Error('Selected booking is missing an organization.');

  // Derived from the FILE, never from a UI mode. See the note at the top.
  const mediaType: MediaType = isVideoFile(originalFile) ? 'video' : 'photo';

  let file = originalFile;
  let proof: ProofColumns | null = null;
  if (mediaType === 'photo') {
    const [settingsRes, deviceGps] = await Promise.all([
      supabase
        .from('business_settings')
        .select('timezone')
        .eq('organization_id', organizationId)
        .maybeSingle<{ timezone: string | null }>(),
      readCaptureGps(),
    ]);
    if (settingsRes.error) {
      console.error('[booking-photos] timezone lookup failed; stamping in America/New_York', settingsRes.error);
    }
    const prepared = await preparePhotoFile({
      file: originalFile,
      bookingNumber: bookingData.booking_number,
      address: formatPropertyAddress(bookingData),
      businessTimeZone: settingsRes.data?.timezone || 'America/New_York',
      captureExif,
      liveCapture,
      deviceGps,
      uploadedAt,
    });
    file = prepared.file;
    proof = prepared.proof;
  } else {
    proof = {
      captured_at: uploadedAt.toISOString(),
      timestamp_source: 'upload',
      capture_latitude: null,
      capture_longitude: null,
      proof_stamped: false,
    };
  }

  const ext = file.name.split('.').pop() || (mediaType === 'video' ? 'mp4' : 'jpg');
  const suffix = index === undefined ? '' : `_${index}`;
  const filePath = `${organizationId}/${bookingId}/${staffId}/${photoType}/${Date.now()}${suffix}.${ext}`;

  const { error: uploadError } = await supabase.storage
    .from('booking-photos')
    .upload(filePath, file, {
      upsert: false,
      // .mov from iOS often arrives with an empty type; storage then falls
      // back to a type the bucket does not accept.
      contentType: file.type || (mediaType === 'video' ? 'video/quicktime' : 'image/jpeg'),
    });
  if (uploadError) throw uploadError;


  try {
    const baseRow: BookingPhotoInsert = {
      booking_id: bookingId,
      photo_url: filePath,
      photo_type: photoType,
      media_type: mediaType,
      staff_id: staffId,
      organization_id: organizationId,
      ...extra,
    };
    // created_at is left to the database default so the row keeps the upload
    // instant even when captured_at is the earlier EXIF time.
    let { error: dbError } = await insertBookingPhoto({ ...baseRow, ...proof });
    if (dbError && proof && isMissingProofColumn(dbError)) {
      console.warn(
        '[booking-photos] proof columns are not on the live table yet. The stamp is in the image; created_at still records the upload. Run the booking photo proof migration.',
        dbError.message,
      );
      ({ error: dbError } = await insertBookingPhoto(baseRow));
    }
    if (dbError) throw dbError;
  } catch (e) {
    // The object is written but unreferenced. Remove it rather than leave it
    // paid for and invisible. Best-effort: a failed cleanup must not replace
    // the caller's real error with a second, less useful one.
    await supabase.storage.from('booking-photos').remove([filePath]).catch(() => {});
    throw e;
  }

  return { filePath, mediaType, organizationId };
}
