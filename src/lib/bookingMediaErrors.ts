/**
 * Pure helpers for booking media uploads — no I/O, so they can be unit tested.
 * The upload itself lives in bookingMediaUpload.ts, which re-exports these.
 *
 * These were duplicated across BookingPhotoUpload and StaffPhotosTab with
 * different signatures and different behaviour. Merged deliberately, per
 * behaviour, rather than by keeping whichever copy was edited last — the notes
 * on each branch say which copy won and why.
 */

export type MediaType = 'photo' | 'video';

/** `.mov` files often arrive with an empty or non-video MIME type on iOS. */
export function isVideoFile(file: File): boolean {
  return file.type.startsWith('video/') || file.name.toLowerCase().endsWith('.mov');
}

/**
 * The customer-facing reason an upload failed.
 *
 * Match terms are the union of both previous copies — BookingPhotoUpload's set
 * was a strict superset except for nothing, so it wins outright: it adds
 * `not allowed` to the permission branch and has a bucket-missing branch that
 * StaffPhotosTab lacked entirely.
 *
 * Wording is picked per branch rather than wholesale:
 *  - permission: BookingPhotoUpload's. "Not enabled yet" implied a feature flag
 *    that does not exist; an RLS rejection is a permission problem and should
 *    say so.
 *  - booking/uuid: StaffPhotosTab's. "The selected booking" is clearer than
 *    "this job" on a screen that has a booking picker on it.
 */
export function getUploadErrorMessage(error: unknown, isVideo: boolean): string {
  const raw = error instanceof Error ? error.message : String(error);
  const msg = raw.toLowerCase();

  if (
    msg.includes('security') || msg.includes('policy') || msg.includes('row-level') ||
    msg.includes('rls') || msg.includes('not allowed') || msg.includes('violates')
  ) {
    return 'Upload permission denied. Please contact your admin to check your account access.';
  }

  if (msg.includes('bucket') || msg.includes('not found')) {
    return 'Media storage is not set up yet. Please contact your admin.';
  }

  if (msg.includes('mime') || msg.includes('not supported')) {
    return isVideo
      ? 'Video uploads are not enabled for job media yet — please upload photos instead.'
      : 'That image format is not supported. Retake the photo with the camera button and try again.';
  }

  if (msg.includes('payload') || msg.includes('too large') || msg.includes('size')) {
    return isVideo
      ? 'Video must be under 100MB. Try trimming it or recording a shorter clip.'
      : 'Photo must be under 100MB. Please try again.';
  }


  if (msg.includes('network') || msg.includes('fetch') || msg.includes('timeout')) {
    return isVideo
      ? 'Video upload timed out. Try on WiFi for large videos.'
      : 'Upload failed. Check your connection and try again.';
  }

  if (msg.includes('booking') || msg.includes('uuid')) {
    return 'Could not identify the selected booking. Refresh and try again.';
  }

  return raw.length > 120 ? 'Upload failed. Please try again.' : `Failed to upload: ${raw}`;
}
