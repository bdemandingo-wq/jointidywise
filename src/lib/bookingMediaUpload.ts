import { Capacitor } from '@capacitor/core';
import { supabase } from '@/lib/supabase';
import type { Database } from '@/integrations/supabase/types';
import { isVideoFile, PHOTO_DECODE_ERROR, type MediaType } from '@/lib/bookingMediaErrors';
import { stampedSiblingPath } from '@/lib/photoDownload';
import {
  burnProofStamp,
  chooseStampGps,
  deviceTimeZone,
  formatPropertyAddress,
  isMissingColumn,
  isMissingProofColumn,
  mergeCaptureExif,
  parseImageExif,
  parsePluginExif,
  proofStampLines,
  resolveProofClock,
  type CaptureExif,
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
  /**
   * EXIF already parsed from the original file. Compression strips the
   * segment, so the queue passes this in beside the smaller JPEG.
   */
  parsedExif?: CaptureExif | null;
  /** True when the cleaner just took the photo, not when they picked one from the library. */
  liveCapture?: boolean;
  /**
   * Stable id for this photo. A retry uploads to the same path and will not
   * insert a second row if the first attempt already saved it.
   */
  idempotencyKey?: string;
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
 * library. Re-encode to JPEG when the phone can decode it. If it cannot, fail
 * with a clear message — do not upload the raw HEIC.
 */
interface ProofColumns {
  captured_at: string;
  timestamp_source: TimestampSource;
  capture_latitude: number | null;
  capture_longitude: number | null;
  proof_stamped: boolean;
  stamped_photo_url?: string | null;
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
  let bitmap: ImageBitmap | null = null;
  let canvas: HTMLCanvasElement | null = null;
  try {
    bitmap = await createImageBitmap(file);
    canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error(PHOTO_DECODE_ERROR);
    ctx.drawImage(bitmap, 0, 0);
    const blob = await new Promise<Blob | null>((resolve) => {
      canvas?.toBlob(resolve, 'image/jpeg', 0.9);
    });
    if (!blob) throw new Error(PHOTO_DECODE_ERROR);
    const base = file.name.replace(/\.[^.]+$/, '') || 'photo';
    return new File([blob], `${base}.jpg`, { type: 'image/jpeg' });
  } catch (error) {
    if (error instanceof Error && error.message === PHOTO_DECODE_ERROR) throw error;
    throw new Error(PHOTO_DECODE_ERROR);
  } finally {
    bitmap?.close?.();
    if (canvas) {
      canvas.width = 0;
      canvas.height = 0;
    }
  }
}

type BookingPhotoInsert = Database['public']['Tables']['booking_photos']['Insert'] & {
  stamped_photo_url?: string | null;
};

async function findSavedPhoto(filePath: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('booking_photos')
    .select('id')
    .eq('photo_url', filePath)
    .limit(1);
  if (error) throw error;
  return !!data?.length;
}

async function insertBookingPhoto(row: BookingPhotoInsert) {
  return supabase.from('booking_photos').insert(row as Database['public']['Tables']['booking_photos']['Insert']);
}

async function preparePhotoFile(args: {
  file: File;
  bookingNumber: number | null;
  address: string | null;
  businessTimeZone: string;
  captureExif: unknown;
  parsedExif?: CaptureExif | null;
  liveCapture: boolean;
  deviceGps: GeoPoint | null;
  uploadedAt: Date;
}): Promise<{ original: File; stamped: File | null; proof: ProofColumns }> {
  const bytes = new Uint8Array(await args.file.arrayBuffer());
  const exif = mergeCaptureExif(
    mergeCaptureExif(parseImageExif(bytes), args.parsedExif ?? null),
    parsePluginExif(args.captureExif),
  );
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

  // The unstamped file is what we keep as the original. The painted JPEG
  // is a second object. A failed burn still uploads the original: losing
  // the cleaner's photo is worse than a missing bar, and the viewer can
  // paint the bar on download from the columns below.
  let original = args.file;
  let stamped: File | null = null;
  try {
    stamped = await burnProofStamp(original, lines);
  } catch (firstError) {
    const normalized = await normalizeImage(original);
    if (normalized !== original) {
      original = normalized;
      try {
        stamped = await burnProofStamp(normalized, lines);
      } catch (secondError) {
        console.error('[booking-photos] proof stamp failed', secondError);
        stamped = null;
      }
    } else {
      console.error('[booking-photos] proof stamp failed', firstError);
    }
  }

  return {
    original,
    stamped,
    proof: {
      captured_at: clock.at.toISOString(),
      timestamp_source: clock.source,
      capture_latitude: gps?.latitude ?? null,
      capture_longitude: gps?.longitude ?? null,
      proof_stamped: !!stamped,
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
    parsedExif,
    liveCapture = false,
    idempotencyKey,
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
  let stampedFile: File | null = null;
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
      parsedExif,
      liveCapture,
      deviceGps,
      uploadedAt,
    });
    file = prepared.original;
    stampedFile = prepared.stamped;
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
  const safeKey = idempotencyKey?.replace(/[^a-zA-Z0-9_-]/g, '') ?? '';
  const filePath = safeKey
    ? `${organizationId}/${bookingId}/${staffId}/${photoType}/${safeKey}.${ext}`
    : `${organizationId}/${bookingId}/${staffId}/${photoType}/${Date.now()}${suffix}.${ext}`;

  const alreadySaved = await findSavedPhoto(filePath);
  if (alreadySaved) return { filePath, mediaType, organizationId };

  const created: string[] = [];
  const uploadObject = async (path: string, body: File, contentType: string) => {
    const { error } = await supabase.storage.from('booking-photos').upload(path, body, {
      upsert: false,
      contentType,
    });
    if (!error) {
      created.push(path);
      return;
    }
    // A retry must not delete a file the previous attempt already stored.
    if (/already exists|duplicate/i.test(error.message)) return;
    throw error;
  };

  await uploadObject(
    filePath,
    file,
    file.type || (mediaType === 'video' ? 'video/quicktime' : 'image/jpeg'),
  );

  let stampedPath: string | null = null;
  if (stampedFile && proof) {
    stampedPath = stampedSiblingPath(filePath);
    try {
      await uploadObject(stampedPath, stampedFile, 'image/jpeg');
      proof = { ...proof, proof_stamped: true, stamped_photo_url: stampedPath };
    } catch (stampError) {
      console.error('[booking-photos] stamped copy failed; the original is still saved', stampError);
      proof = { ...proof, proof_stamped: false };
      stampedPath = null;
    }
  }

  const dropCreated = async (path: string | null) => {
    if (!path || !created.includes(path)) return;
    await supabase.storage.from('booking-photos').remove([path]).catch(() => {});
    const index = created.indexOf(path);
    if (index >= 0) created.splice(index, 1);
  };

  try {
    if (await findSavedPhoto(filePath)) return { filePath, mediaType, organizationId };
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
    const withProof: BookingPhotoInsert = proof
      ? { ...baseRow, ...proof }
      : baseRow;
    let { error: dbError } = await insertBookingPhoto(withProof);
    if (dbError && stampedPath && isMissingColumn(dbError, 'stamped_photo_url')) {
      console.warn(
        '[booking-photos] stamped_photo_url is not on the live table yet. The original and the proof columns are saved; Download with timestamp paints the bar in the browser. Run the booking photo original migration.',
        dbError.message,
      );
      await dropCreated(stampedPath);
      const { stamped_photo_url: _ignored, ...proofWithoutPath } = proof ?? {};
      ({ error: dbError } = await insertBookingPhoto({
        ...baseRow,
        ...proofWithoutPath,
        proof_stamped: false,
      }));
    }
    if (dbError && proof && isMissingProofColumn(dbError)) {
      console.warn(
        '[booking-photos] proof columns are not on the live table yet. The unstamped photo is saved. Run the booking photo proof migration.',
        dbError.message,
      );
      await dropCreated(stampedPath);
      ({ error: dbError } = await insertBookingPhoto(baseRow));
    }
    if (dbError) throw dbError;
  } catch (e) {
    if (created.length) {
      await supabase.storage.from('booking-photos').remove(created).catch(() => {});
    }
    throw e;
  }

  return { filePath, mediaType, organizationId };
}
