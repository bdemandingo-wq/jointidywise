-- Keep an unstamped original next to the painted proof file, and freeze
-- the evidence columns after insert.
--
-- photo_url is the unstamped file. stamped_photo_url is the same photo
-- with the timestamp bar painted into the pixels. Rows from before this
-- change have only photo_url; when proof_stamped is true that file is
-- already painted and there is no original to recover.
--
-- A signed-in cleaner (and a signed-in admin) cannot change the capture
-- time, GPS, stamp flag, or either stored path. Service role has no
-- auth.uid() and can still repair a row from SQL. Moving a photo between
-- before and after only updates photo_type, which this trigger allows.

ALTER TABLE public.booking_photos
  ADD COLUMN IF NOT EXISTS captured_at timestamptz,
  ADD COLUMN IF NOT EXISTS timestamp_source text,
  ADD COLUMN IF NOT EXISTS capture_latitude double precision,
  ADD COLUMN IF NOT EXISTS capture_longitude double precision,
  ADD COLUMN IF NOT EXISTS proof_stamped boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS stamped_photo_url text;

ALTER TABLE public.booking_photos DROP CONSTRAINT IF EXISTS booking_photos_timestamp_source_check;
ALTER TABLE public.booking_photos ADD CONSTRAINT booking_photos_timestamp_source_check
  CHECK (timestamp_source IS NULL OR timestamp_source IN ('exif', 'upload'));

CREATE OR REPLACE FUNCTION public.guard_booking_photo_proof()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP <> 'UPDATE' THEN
    RETURN NEW;
  END IF;

  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.captured_at IS DISTINCT FROM OLD.captured_at
     OR NEW.timestamp_source IS DISTINCT FROM OLD.timestamp_source
     OR NEW.capture_latitude IS DISTINCT FROM OLD.capture_latitude
     OR NEW.capture_longitude IS DISTINCT FROM OLD.capture_longitude
     OR NEW.proof_stamped IS DISTINCT FROM OLD.proof_stamped
     OR NEW.stamped_photo_url IS DISTINCT FROM OLD.stamped_photo_url
     OR NEW.photo_url IS DISTINCT FROM OLD.photo_url
  THEN
    RAISE EXCEPTION 'Photo time, location, and the stored files cannot be changed after upload.'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_booking_photo_proof ON public.booking_photos;
CREATE TRIGGER trg_guard_booking_photo_proof
  BEFORE UPDATE ON public.booking_photos
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_booking_photo_proof();

COMMENT ON FUNCTION public.guard_booking_photo_proof() IS
  'Blocks signed-in users from rewriting booking photo proof columns or file paths. Insert still records them. Service role (auth.uid() null) is allowed through.';

-- Replacing the object would change the evidence without touching the row.
-- Cleaners can still insert a new photo and remove an upload that never
-- got a database row. They cannot overwrite a file that is already there.
DROP POLICY IF EXISTS "Org members can update booking photos" ON storage.objects;
DROP POLICY IF EXISTS "Org admins can update booking photos" ON storage.objects;
CREATE POLICY "Org admins can update booking photos"
ON storage.objects FOR UPDATE
TO authenticated
USING (
  bucket_id = 'booking-photos'
  AND public.is_org_admin((storage.foldername(name))[1]::uuid)
);
