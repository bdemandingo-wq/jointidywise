ALTER TABLE public.booking_photos
  ADD COLUMN IF NOT EXISTS captured_at timestamptz,
  ADD COLUMN IF NOT EXISTS timestamp_source text,
  ADD COLUMN IF NOT EXISTS capture_latitude double precision,
  ADD COLUMN IF NOT EXISTS capture_longitude double precision,
  ADD COLUMN IF NOT EXISTS proof_stamped boolean NOT NULL DEFAULT false;

ALTER TABLE public.booking_photos DROP CONSTRAINT IF EXISTS booking_photos_timestamp_source_check;

ALTER TABLE public.booking_photos ADD CONSTRAINT booking_photos_timestamp_source_check CHECK (timestamp_source IS NULL OR timestamp_source IN ('exif', 'upload'));