-- organization_count is the "N cleaning businesses have signed up" line.
-- It already ignored test, QA, and demo orgs through growth_org_is_public.
-- This replaces get_public_growth_counters so that count also leaves out
-- the owner's own organizations. The weekly signup count is unchanged.
--
-- Owner orgs, matched the way this repo already finds them:
--   TIDYWISE          organizations.id = e95b92d0-7099-408e-a773-e4407b34f8b4
--   Clean Collective  organizations.name = 'Clean Collective'
--                     (20260806024408_be073872-fb0e-4ab3-83bd-9147899e8745.sql)
--
-- Test orgs are not re-detected here. growth_org_is_public(id, false) is
-- the rule, from 20261013340000_thirty_day_trial_and_public_growth.sql.
-- With p_feed false the activity opt-out is not used. An org is public
-- only when every one of these is true:
--   organization_pricing_settings.demo_mode_enabled is not true
--   organizations.name does not match
--     (~* ) '(^|[^a-z])(test|qa|demo|sandbox)([^a-z]|$)'
--   organizations.slug does not match
--     (~* ) '^(test|qa|demo|sandbox)'
--   profiles.email for organizations.owner_id does not match
--     (~* ) '(@tidywise1\.com$|^applereview@|@example\.com$|\+(qa|test))'
--   that email is not exactly support@tidywisecleaning.com
-- No other name, slug, or email pattern is applied to this count.

DELETE FROM public.growth_public_cache WHERE cache_key = 'counters_v2';

CREATE OR REPLACE FUNCTION public.get_public_growth_counters()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  cached jsonb;
  refreshed timestamptz;
  total_spots integer;
  sold_spots integer;
  weekly integer;
  orgs integer;
  weekly_min integer;
  payload jsonb;
BEGIN
  PERFORM set_config('statement_timeout', '3000', true);

  SELECT c.payload, c.refreshed_at
    INTO cached, refreshed
  FROM public.growth_public_cache c
  WHERE c.cache_key = 'counters_v2';

  IF NOT public.growth_public_rate_ok() THEN
    -- No cache yet: return a flag the client hides. Do not invent a count.
    RETURN coalesce(cached, jsonb_build_object('limited', true));
  END IF;

  IF refreshed IS NOT NULL AND refreshed > now() - interval '60 seconds' THEN
    RETURN cached;
  END IF;

  IF NOT pg_try_advisory_xact_lock(hashtext('growth_public_counters')) THEN
    RETURN cached;
  END IF;

  SELECT COALESCE((SELECT s.total_spots FROM public.lifetime_offer_state s WHERE s.id = 1), 100)
    INTO total_spots;
  SELECT COUNT(*)::int INTO sold_spots FROM public.lifetime_access_purchases;

  SELECT COALESCE((SELECT s.weekly_signup_min FROM public.growth_public_settings s WHERE s.id = 1), 15)
    INTO weekly_min;

  -- Weekly signups stay on growth_org_is_public alone.
  -- organization_count uses that same test/demo rule, then drops the
  -- owner's TIDYWISE org by id and Clean Collective by exact name.
  SELECT
    COUNT(*) FILTER (WHERE o.created_at > now() - interval '7 days')::int,
    COUNT(*) FILTER (
      WHERE o.id IS DISTINCT FROM 'e95b92d0-7099-408e-a773-e4407b34f8b4'::uuid
        AND o.name IS DISTINCT FROM 'Clean Collective'
    )::int
  INTO weekly, orgs
  FROM public.organizations o
  WHERE public.growth_org_is_public(o.id, false);

  payload := jsonb_build_object(
    'limited', false,
    'lifetime_total', total_spots,
    'lifetime_sold', sold_spots,
    'lifetime_remaining', GREATEST(0, total_spots - sold_spots),
    'lifetime_sold_out', sold_spots >= total_spots,
    'weekly_signups', weekly,
    'weekly_signup_min', weekly_min,
    'organization_count', orgs
  );

  INSERT INTO public.growth_public_cache (cache_key, payload, refreshed_at)
  VALUES ('counters_v2', payload, now())
  ON CONFLICT (cache_key) DO UPDATE
    SET payload = EXCLUDED.payload, refreshed_at = EXCLUDED.refreshed_at;

  DELETE FROM public.growth_public_rate
  WHERE window_start < now() - interval '10 minutes';

  RETURN payload;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_public_growth_counters() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_growth_counters() TO anon, authenticated, service_role;
