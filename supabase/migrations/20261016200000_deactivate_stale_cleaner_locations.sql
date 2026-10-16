-- Stop live On My Way rows that the phone never closed.
--
-- Run this file in the Supabase SQL editor. A git push does not apply it.
--
-- The iOS watcher stops itself after 3 hours, and it stops when fixes stop
-- arriving. If that process is killed, the row can stay is_active. This job
-- closes those rows: created_at older than 3 hours, or recorded_at older
-- than 15 minutes. It does not delete coordinates. The daily 30-day delete
-- is a different job.
--
-- pg_cron is installed on the live project. The extension check keeps this
-- file from failing in a database that does not have it.

CREATE OR REPLACE FUNCTION public.deactivate_stale_cleaner_locations()
  RETURNS void
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path TO 'public'
AS $$
  UPDATE public.cleaner_location_tracking
  SET is_active = false
  WHERE is_active = true
    AND (
      created_at < now() - interval '3 hours'
      OR recorded_at < now() - interval '15 minutes'
    );
$$;

REVOKE ALL ON FUNCTION public.deactivate_stale_cleaner_locations() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.deactivate_stale_cleaner_locations() FROM anon;
REVOKE ALL ON FUNCTION public.deactivate_stale_cleaner_locations() FROM authenticated;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE WARNING 'pg_cron is not installed; stale On My Way rows will not be closed automatically';
    RETURN;
  END IF;

  BEGIN
    PERFORM cron.unschedule('deactivate-stale-cleaner-locations');
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  PERFORM cron.schedule(
    'deactivate-stale-cleaner-locations',
    '*/5 * * * *',
    $cron$ SELECT public.deactivate_stale_cleaner_locations(); $cron$
  );
END $$;
