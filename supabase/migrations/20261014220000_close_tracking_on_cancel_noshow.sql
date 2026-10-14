-- Close live tracking when a job is cancelled or a no-show, and forget
-- coordinates 30 days after tracking stops.
--
-- deactivate_tracking_on_status_change previously ran only for
-- in_progress and completed, so a cancelled or no-show booking left
-- is_active = true and the admin map kept the pin.
--
-- Location rows themselves are not deleted. Before this migration they
-- were kept indefinitely, coordinates included. The daily job below
-- nulls latitude and longitude 30 days after the row is inactive,
-- measured from recorded_at (the last fix). Booking linkage stays so
-- history can still name the job; the map can no longer plot that point.

CREATE OR REPLACE FUNCTION public.deactivate_tracking_on_status_change()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.status IN ('in_progress', 'completed', 'cancelled', 'no_show')
     AND OLD.status IS DISTINCT FROM NEW.status THEN
    UPDATE public.cleaner_location_tracking
    SET is_active = false
    WHERE booking_id = NEW.id
      AND is_active = true;
  END IF;
  RETURN NEW;
END;
$$;

-- Rows already stuck active because the old trigger ignored these statuses.
UPDATE public.cleaner_location_tracking AS tracking
SET is_active = false
FROM public.bookings AS booking
WHERE tracking.booking_id = booking.id
  AND tracking.is_active = true
  AND booking.status IN ('cancelled', 'no_show', 'in_progress', 'completed');

ALTER TABLE public.cleaner_location_tracking
  ALTER COLUMN latitude DROP NOT NULL,
  ALTER COLUMN longitude DROP NOT NULL;

CREATE OR REPLACE FUNCTION public.redact_old_cleaner_locations()
  RETURNS void
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path TO 'public'
AS $$
  UPDATE public.cleaner_location_tracking
  SET latitude = NULL,
      longitude = NULL
  WHERE is_active = false
    AND recorded_at < now() - interval '30 days'
    AND (latitude IS NOT NULL OR longitude IS NOT NULL);
$$;

-- Maintenance only. A signed-in user must not be able to call this.
REVOKE ALL ON FUNCTION public.redact_old_cleaner_locations() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.redact_old_cleaner_locations() FROM anon;
REVOKE ALL ON FUNCTION public.redact_old_cleaner_locations() FROM authenticated;

DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT jobname FROM cron.job WHERE jobname = 'redact-old-cleaner-locations'
  LOOP
    PERFORM cron.unschedule(r.jobname);
  END LOOP;
END $$;

SELECT cron.schedule(
  'redact-old-cleaner-locations',
  '15 7 * * *',
  $$SELECT public.redact_old_cleaner_locations();$$
);
