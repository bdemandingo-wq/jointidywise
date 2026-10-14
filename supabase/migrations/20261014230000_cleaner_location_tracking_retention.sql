-- RETENTION — approve this file on its own.
--
-- Deletes cleaner_location_tracking rows 30 days after tracking stops.
-- Does not null latitude/longitude (those columns stay required). Does not
-- touch the admin map. PR #51 does not add a retention job.
--
-- stopped_at is stamped when is_active flips to false. Existing inactive
-- rows are backfilled from recorded_at (the last stored point), then the
-- same delete runs once immediately. The daily pg_cron job repeats it.
-- Safe to run more than once.

BEGIN;

ALTER TABLE public.cleaner_location_tracking
  ADD COLUMN IF NOT EXISTS stopped_at timestamptz;

COMMENT ON COLUMN public.cleaner_location_tracking.stopped_at IS
  'When this session stopped sharing. Retention deletes the row 30 days later.';

UPDATE public.cleaner_location_tracking
SET stopped_at = recorded_at
WHERE is_active = false
  AND stopped_at IS NULL;

CREATE OR REPLACE FUNCTION public.stamp_cleaner_location_stopped_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.stopped_at IS NULL THEN
    NEW.stopped_at := now();
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.stamp_cleaner_location_stopped_at() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_cleaner_location_stopped_at ON public.cleaner_location_tracking;
CREATE TRIGGER trg_cleaner_location_stopped_at
  BEFORE UPDATE OF is_active ON public.cleaner_location_tracking
  FOR EACH ROW
  WHEN (NEW.is_active = false AND OLD.is_active IS DISTINCT FROM false)
  EXECUTE FUNCTION public.stamp_cleaner_location_stopped_at();

CREATE OR REPLACE FUNCTION public.purge_stale_cleaner_locations()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  removed integer;
BEGIN
  DELETE FROM public.cleaner_location_tracking
  WHERE is_active = false
    AND COALESCE(stopped_at, recorded_at) < now() - interval '30 days';
  GET DIAGNOSTICS removed = ROW_COUNT;
  RETURN removed;
END;
$$;

REVOKE ALL ON FUNCTION public.purge_stale_cleaner_locations() FROM PUBLIC, anon, authenticated;

-- One-time cleanup of rows that are already past the window.
SELECT public.purge_stale_cleaner_locations();

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE EXCEPTION 'pg_cron is required to retain cleaner location rows';
  END IF;

  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'purge-cleaner-location-coordinates') THEN
    PERFORM cron.unschedule('purge-cleaner-location-coordinates');
  END IF;
END $$;

SELECT cron.schedule(
  'purge-cleaner-location-coordinates',
  '15 8 * * *',
  $cron$SELECT public.purge_stale_cleaner_locations();$cron$
);

COMMIT;
