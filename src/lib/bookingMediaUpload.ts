import { supabase } from '@/lib/supabase';
import { isVideoFile, type MediaType } from '@/lib/bookingMediaErrors';

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

export async function uploadBookingMedia(
  args: UploadBookingMediaArgs,
): Promise<UploadBookingMediaResult> {
  const { file: originalFile, bookingId, staffId, photoType, organizationIdFallback, extra, index } = args;

  const { data: bookingData, error: bookingError } = await supabase
    .from('bookings')
    .select('id, organization_id')
    .eq('id', bookingId)
    .maybeSingle<{ id: string; organization_id: string | null }>();

  if (bookingError) throw bookingError;
  if (!bookingData?.id) throw new Error('Selected booking was not found.');

  const organizationId = bookingData.organization_id || organizationIdFallback;
  if (!organizationId) throw new Error('Selected booking is missing an organization.');

  // Derived from the FILE, never from a UI mode. See the note at the top.
  const mediaType: MediaType = isVideoFile(originalFile) ? 'video' : 'photo';
  const file = mediaType === 'photo' ? await normalizeImage(originalFile) : originalFile;
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
    const { error: dbError } = await supabase.from('booking_photos').insert({
      booking_id: bookingId,
      photo_url: filePath,
      photo_type: photoType,
      media_type: mediaType,
      staff_id: staffId,
      organization_id: organizationId,
      ...extra,
    });
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
