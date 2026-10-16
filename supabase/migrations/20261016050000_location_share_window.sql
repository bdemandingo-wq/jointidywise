-- On My Way location window, consent decisions, and 30-day deletion.
--
-- Run this file in the Supabase SQL editor. A git push does not apply it.
--
-- The consent log stays append-only: authenticated still has SELECT and
-- INSERT only. os_permission_granted is the OS permission yes. revoked is
-- written when that permission is removed. Older granted and toggled_on
-- rows still allow a coordinate write.
--
-- Coordinate writes are refused once the cleaner has arrived or the job
-- is marked started, completed, cancelled, or a no-show.
--
-- redact_old_cleaner_locations now deletes the tracking row 30 days after
-- its last fix. It used to null the coordinates and keep the row. The
-- daily job runs only when pg_cron is installed.

BEGIN;

ALTER TABLE public.cleaner_location_consents
  DROP CONSTRAINT IF EXISTS cleaner_location_consents_decision_chk;

ALTER TABLE public.cleaner_location_consents
  ADD CONSTRAINT cleaner_location_consents_decision_chk
  CHECK (decision IN (
    'granted',
    'declined',
    'toggled_on',
    'toggled_off',
    'os_denied',
    'os_permission_granted',
    'revoked'
  ));

CREATE OR REPLACE FUNCTION public.enforce_cleaner_location_tracking_consent()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  latest_decision text;
  tracking_enabled boolean;
  booking_status text;
  coordinate_write boolean;
BEGIN
  coordinate_write := TG_OP = 'INSERT'
    OR NEW.latitude IS DISTINCT FROM OLD.latitude
    OR NEW.longitude IS DISTINCT FROM OLD.longitude
    OR NEW.recorded_at IS DISTINCT FROM OLD.recorded_at;

  IF NOT coordinate_write THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE'
     AND NEW.is_active = false
     AND NEW.latitude IS NULL
     AND NEW.longitude IS NULL
  THEN
    RETURN NEW;
  END IF;

  SELECT b.status
    INTO booking_status
  FROM public.bookings b
  WHERE b.id = NEW.booking_id;

  IF booking_status IN ('in_progress', 'completed', 'cancelled', 'no_show') THEN
    RAISE EXCEPTION 'location sharing has ended'
      USING ERRCODE = '42501';
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.arrived_at IS NOT NULL THEN
    RAISE EXCEPTION 'location sharing has ended'
      USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE((value #>> '{}') = 'true', false)
    INTO tracking_enabled
  FROM public.platform_settings
  WHERE key = 'cleaner_location_tracking_enabled';

  IF NOT COALESCE(tracking_enabled, false) THEN
    RAISE EXCEPTION 'location tracking disabled'
      USING ERRCODE = '42501';
  END IF;

  SELECT c.decision
    INTO latest_decision
  FROM public.cleaner_location_consents c
  WHERE c.staff_id = NEW.staff_id
  ORDER BY c.created_at DESC, c.id DESC
  LIMIT 1;

  IF latest_decision IS DISTINCT FROM 'granted'
     AND latest_decision IS DISTINCT FROM 'toggled_on'
     AND latest_decision IS DISTINCT FROM 'os_permission_granted' THEN
    RAISE EXCEPTION 'location consent required'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_cleaner_location_tracking_consent() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.redact_old_cleaner_locations()
  RETURNS void
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path TO 'public'
AS $$
  DELETE FROM public.cleaner_location_tracking
  WHERE recorded_at < now() - interval '30 days';
$$;

REVOKE ALL ON FUNCTION public.redact_old_cleaner_locations() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.redact_old_cleaner_locations() FROM anon;
REVOKE ALL ON FUNCTION public.redact_old_cleaner_locations() FROM authenticated;

-- The customer sees a live point only while On My Way is still open.
-- The token is the authorization. A finished, arrived, or inactive row
-- returns nothing. No other columns are returned.
CREATE OR REPLACE FUNCTION public.customer_on_my_way_location(p_token text)
RETURNS TABLE (latitude double precision, longitude double precision, recorded_at timestamptz)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT t.latitude, t.longitude, t.recorded_at
  FROM public.cleaner_location_tracking t
  JOIN public.bookings b ON b.id = t.booking_id
  WHERE p_token IS NOT NULL
    AND length(p_token) > 0
    AND t.tracking_token = p_token
    AND t.is_active = true
    AND t.arrived_at IS NULL
    AND t.latitude IS NOT NULL
    AND t.longitude IS NOT NULL
    AND b.status NOT IN ('in_progress', 'completed', 'cancelled', 'no_show')
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.customer_on_my_way_location(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.customer_on_my_way_location(text) TO anon, authenticated;

COMMIT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE WARNING 'pg_cron is not installed; cleaner location rows older than 30 days will not be deleted automatically';
    RETURN;
  END IF;

  BEGIN
    PERFORM cron.unschedule('redact-old-cleaner-locations');
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  PERFORM cron.schedule(
    'redact-old-cleaner-locations',
    '15 7 * * *',
    $cron$ SELECT public.redact_old_cleaner_locations(); $cron$
  );
END $$;
