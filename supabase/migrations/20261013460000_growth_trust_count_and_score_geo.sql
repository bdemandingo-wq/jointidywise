-- All-time organization count for the public "Trusted by" line, and a
-- configurable floor for the weekly signup line. The weekly line stays
-- hidden until weekly_signups >= weekly_signup_min (default 15).
--
-- Change the floor without a code deploy:
--   UPDATE public.growth_public_settings
--   SET weekly_signup_min = 15, updated_at = now()
--   WHERE id = 1;
--
-- score_companies gains the county and Google place type that the
-- leaderboard uses to widen a thin city honestly. Rows are not invented
-- here. score-seed-house-cleaners fills county and primary_type from
-- Google Places, and only for house-cleaning listings.

CREATE TABLE IF NOT EXISTS public.growth_public_settings (
  id integer PRIMARY KEY CHECK (id = 1),
  weekly_signup_min integer NOT NULL DEFAULT 15 CHECK (weekly_signup_min >= 1 AND weekly_signup_min <= 1000),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.growth_public_settings (id, weekly_signup_min)
VALUES (1, 15)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.growth_public_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.growth_public_settings FROM PUBLIC, anon, authenticated;

COMMENT ON TABLE public.growth_public_settings IS
  'Public marketing thresholds. weekly_signup_min hides the weekly signup line below that count. The all-time organization count is not capped here.';

ALTER TABLE public.score_companies
  ADD COLUMN IF NOT EXISTS county text,
  ADD COLUMN IF NOT EXISTS primary_type text;

COMMENT ON COLUMN public.score_companies.county IS
  'County from Google Places administrative_area_level_2. Null until a real place lookup stores it.';
COMMENT ON COLUMN public.score_companies.primary_type IS
  'Google Places primary type, such as house_cleaning_service. The landing leaderboard uses it to leave out other trades.';

CREATE INDEX IF NOT EXISTS idx_score_companies_state_lat
  ON public.score_companies (state, latitude);

CREATE INDEX IF NOT EXISTS idx_score_companies_state_county
  ON public.score_companies (state, county);

CREATE TABLE IF NOT EXISTS public.score_seed_runs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  city_slug text NOT NULL,
  seeded_at timestamptz NOT NULL DEFAULT now(),
  inserted_count integer NOT NULL DEFAULT 0,
  updated_count integer NOT NULL DEFAULT 0,
  status text NOT NULL
);

CREATE INDEX IF NOT EXISTS score_seed_runs_city_recent
  ON public.score_seed_runs (city_slug, seeded_at DESC);

CREATE INDEX IF NOT EXISTS score_seed_runs_seeded_at
  ON public.score_seed_runs (seeded_at DESC);

ALTER TABLE public.score_seed_runs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.score_seed_runs FROM PUBLIC, anon, authenticated;

COMMENT ON TABLE public.score_seed_runs IS
  'Rate limit for score-seed-house-cleaners. One successful Google seed per city per day. No business names are stored here.';

-- Drop the previous counter snapshot so the next read includes organization_count.
DELETE FROM public.growth_public_cache WHERE cache_key = 'counters';

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

  -- One pass. Test, QA, and demo organizations are excluded from both
  -- numbers, same rule the weekly line already used.
  SELECT
    COUNT(*) FILTER (WHERE o.created_at > now() - interval '7 days')::int,
    COUNT(*)::int
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
