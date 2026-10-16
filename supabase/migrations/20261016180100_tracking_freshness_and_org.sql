-- Fresh customer points, and a tracking row that cannot name another org.
--
-- Run this file in the Supabase SQL editor. A git push does not apply it.
--
-- customer_on_my_way_location returns a point only while the last fix is
-- within 10 minutes and the trip started within 3 hours. The return columns
-- stay latitude, longitude, and recorded_at. created_at is added so the
-- client can apply the same window before trusting a point.
--
-- A tracking insert or update must use the booking's organization_id.
-- The check is SECURITY DEFINER so row security on bookings cannot hide
-- the comparison. It is not granted to signed-in users.

DROP FUNCTION IF EXISTS public.customer_on_my_way_location(text);

CREATE FUNCTION public.customer_on_my_way_location(p_token text)
RETURNS TABLE (
  latitude double precision,
  longitude double precision,
  recorded_at timestamptz,
  created_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT t.latitude, t.longitude, t.recorded_at, t.created_at
  FROM public.cleaner_location_tracking t
  JOIN public.bookings b ON b.id = t.booking_id
  WHERE p_token IS NOT NULL
    AND length(p_token) > 0
    AND t.tracking_token = p_token
    AND t.is_active = true
    AND t.arrived_at IS NULL
    AND t.latitude IS NOT NULL
    AND t.longitude IS NOT NULL
    AND t.recorded_at >= now() - interval '10 minutes'
    AND t.created_at >= now() - interval '3 hours'
    AND b.status NOT IN ('in_progress', 'completed', 'cancelled', 'no_show')
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.customer_on_my_way_location(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.customer_on_my_way_location(text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.enforce_cleaner_location_tracking_organization()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  booking_org uuid;
BEGIN
  SELECT b.organization_id
    INTO booking_org
  FROM public.bookings b
  WHERE b.id = NEW.booking_id;

  IF booking_org IS NULL OR NEW.organization_id IS DISTINCT FROM booking_org THEN
    RAISE EXCEPTION 'tracking organization must match the booking'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_cleaner_location_tracking_organization() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_cleaner_location_tracking_organization ON public.cleaner_location_tracking;

CREATE TRIGGER trg_cleaner_location_tracking_organization
  BEFORE INSERT OR UPDATE ON public.cleaner_location_tracking
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_cleaner_location_tracking_organization();
