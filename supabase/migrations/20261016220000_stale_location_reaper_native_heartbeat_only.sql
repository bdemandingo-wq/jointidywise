-- The 15 minute recorded_at rule is for trips that heartbeat while the
-- phone is locked (iOS Always). While Using, Android, and web cannot
-- write in the background, so a quiet recorded_at is a paused trip, not
-- a dead process. Those rows stay active until the 3 hour cap.
--
-- native_background defaults to false. A row that never opts in is not
-- closed for silence. The iOS Always watcher sets it when this column
-- exists. Until then, every row is exempt from the 15 minute close.
--
-- Run this file in the Supabase SQL editor. A git push does not apply it.
-- The cron job from 20261016180000 keeps calling this function.

ALTER TABLE public.cleaner_location_tracking
  ADD COLUMN IF NOT EXISTS native_background boolean NOT NULL DEFAULT false;

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
      OR (
        native_background = true
        AND recorded_at < now() - interval '15 minutes'
      )
    );
$$;

REVOKE ALL ON FUNCTION public.deactivate_stale_cleaner_locations() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.deactivate_stale_cleaner_locations() FROM anon;
REVOKE ALL ON FUNCTION public.deactivate_stale_cleaner_locations() FROM authenticated;
