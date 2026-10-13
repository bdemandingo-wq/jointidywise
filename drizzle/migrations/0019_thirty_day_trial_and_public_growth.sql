-- New signups get 30 days of Pro. Existing trial_ends_at values are not
-- updated. Reminders move to day 25 and day 29; a trial that ends before
-- those days (the current 14-day accounts) is never emailed.
--
-- Public growth numbers and the activity feed are aggregate / city-level
-- only. N for the lifetime counter is lifetime_offer_state.total_spots
-- (default 100). Change N with:
--   UPDATE public.lifetime_offer_state SET total_spots = <n>, updated_at = now() WHERE id = 1;

-- ── 1. Trial length for new profiles only ────────────────────────────────
ALTER TABLE public.profiles
  ALTER COLUMN trial_ends_at SET DEFAULT (now() + interval '30 days');

CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, phone, created_at, updated_at, subscription_status, trial_ends_at)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(
      NULLIF(NEW.raw_user_meta_data->>'full_name', ''),
      NULLIF(NEW.raw_user_meta_data->>'name', ''),
      NULLIF(TRIM(CONCAT_WS(' ', NEW.raw_user_meta_data->>'first_name', NEW.raw_user_meta_data->>'last_name')), '')
    ),
    COALESCE(
      NULLIF(NEW.raw_user_meta_data->>'phone', ''),
      NULLIF(NEW.raw_user_meta_data->>'phone_number', '')
    ),
    NOW(),
    NOW(),
    'trial',
    NOW() + interval '30 days'
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$function$;

-- Keep historical reminder rows valid. New sends are 25 and 29 only.
DO $$
BEGIN
  IF to_regclass('public.trial_reminder_log') IS NOT NULL THEN
    ALTER TABLE public.trial_reminder_log
      DROP CONSTRAINT IF EXISTS trial_reminder_log_reminder_day_check;
    ALTER TABLE public.trial_reminder_log
      ADD CONSTRAINT trial_reminder_log_reminder_day_check
      CHECK (reminder_day IN (10, 13, 25, 29));
  END IF;
END $$;

-- ── 2. Feed opt-out. Default on. Owners already update business_settings. ─
ALTER TABLE public.business_settings
  ADD COLUMN IF NOT EXISTS show_public_activity boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.business_settings.show_public_activity IS
  'When false, this org is left out of the public TidyWise activity feed. City and rounded amount only; default on.';

-- ── 3. Lifetime N comes from the offer row, sold from real purchases. ────
CREATE OR REPLACE FUNCTION public.get_lifetime_spots_remaining()
 RETURNS TABLE(total integer, sold integer, remaining integer, sold_out boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH offer AS (
    SELECT COALESCE(
      (SELECT total_spots FROM public.lifetime_offer_state WHERE id = 1),
      100
    )::int AS total
  ),
  sales AS (
    SELECT COUNT(*)::int AS sold
    FROM public.lifetime_access_purchases
  )
  SELECT
    offer.total,
    sales.sold,
    GREATEST(0, offer.total - sales.sold)::int AS remaining,
    (sales.sold >= offer.total) AS sold_out
  FROM offer, sales;
$function$;

-- ── 4. Cache + rate limit. Not readable by anon. ─────────────────────────
CREATE TABLE IF NOT EXISTS public.growth_public_cache (
  cache_key text PRIMARY KEY,
  payload jsonb NOT NULL,
  refreshed_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS public.growth_public_rate (
  caller_key text PRIMARY KEY,
  window_start timestamptz NOT NULL,
  hits integer NOT NULL
);

ALTER TABLE public.growth_public_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.growth_public_rate ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.growth_public_cache FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.growth_public_rate FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.growth_public_caller_role()
 RETURNS text
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  claims text;
BEGIN
  claims := current_setting('request.jwt.claim.role', true);
  IF claims IS NOT NULL AND claims <> '' THEN
    RETURN claims;
  END IF;
  claims := current_setting('request.jwt.claims', true);
  IF claims IS NULL OR claims = '' THEN
    RETURN '';
  END IF;
  RETURN coalesce(claims::json->>'role', '');
EXCEPTION WHEN OTHERS THEN
  RETURN '';
END;
$function$;

CREATE OR REPLACE FUNCTION public.growth_public_rate_ok()
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  role text;
  headers text;
  ip text;
  window_at timestamptz := date_trunc('minute', now());
  hit_count integer;
BEGIN
  role := public.growth_public_caller_role();
  -- The public-growth edge function calls this as service_role and applies
  -- its own per-visitor limit. A missing role is a privileged SQL session.
  IF role IN ('service_role', '') THEN
    RETURN true;
  END IF;

  headers := current_setting('request.headers', true);
  ip := '';
  IF headers IS NOT NULL AND headers <> '' THEN
    BEGIN
      ip := split_part(coalesce(
        headers::json->>'x-forwarded-for',
        headers::json->>'cf-connecting-ip',
        ''
      ), ',', 1);
    EXCEPTION WHEN OTHERS THEN
      ip := '';
    END;
  END IF;
  ip := left(btrim(ip), 64);
  IF ip = '' THEN
    ip := 'unknown';
  END IF;

  INSERT INTO public.growth_public_rate AS r (caller_key, window_start, hits)
  VALUES (ip, window_at, 1)
  ON CONFLICT (caller_key) DO UPDATE
    SET hits = CASE WHEN r.window_start = EXCLUDED.window_start THEN r.hits + 1 ELSE 1 END,
        window_start = EXCLUDED.window_start
  RETURNING hits INTO hit_count;

  -- Shared NAT with no IP gets a wider budget so one missing header cannot
  -- blank the marketing site. A real IP is capped tightly.
  IF ip = 'unknown' THEN
    RETURN hit_count <= 600;
  END IF;
  RETURN hit_count <= 60;
END;
$function$;

CREATE OR REPLACE FUNCTION public.growth_public_city(raw text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$
  SELECT CASE
    WHEN raw IS NULL THEN NULL
    WHEN btrim(raw) ~ '^[A-Za-z][A-Za-z .''-]{1,39}$'
     AND btrim(raw) !~* '\m(street|avenue|road|drive|lane|boulevard|highway|parkway)\M'
     AND btrim(raw) !~ '[0-9@]'
     AND lower(btrim(raw)) NOT IN ('n/a', 'na', 'null', 'none', 'test', 'city', 'tba', 'unknown', 'xxx', 'qa', 'demo')
    THEN btrim(raw)
    ELSE NULL
  END;
$function$;

CREATE OR REPLACE FUNCTION public.growth_public_service(raw text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$
  SELECT CASE
    WHEN lower(coalesce(raw, '')) ~ 'deep' THEN 'deep clean'
    WHEN lower(coalesce(raw, '')) ~ 'move' THEN 'move-out clean'
    WHEN lower(coalesce(raw, '')) ~ 'airbnb|turnover' THEN 'turnover clean'
    WHEN lower(coalesce(raw, '')) ~ 'office|commercial' THEN 'commercial clean'
    WHEN lower(coalesce(raw, '')) ~ 'carpet' THEN 'carpet clean'
    WHEN lower(coalesce(raw, '')) ~ 'window' THEN 'window clean'
    ELSE 'clean'
  END;
$function$;

-- Test, QA, and demo orgs are excluded from both the weekly count and the
-- feed. p_feed also honors the opt-out. A missing settings row stays opted in.
CREATE OR REPLACE FUNCTION public.growth_org_is_public(p_org_id uuid, p_feed boolean)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.organizations o
    LEFT JOIN public.business_settings bs ON bs.organization_id = o.id
    LEFT JOIN public.organization_pricing_settings ops ON ops.organization_id = o.id
    LEFT JOIN public.profiles owner ON owner.id = o.owner_id
    WHERE o.id = p_org_id
      AND (NOT p_feed OR coalesce(bs.show_public_activity, true))
      AND coalesce(ops.demo_mode_enabled, false) = false
      AND o.name !~* '(^|[^a-z])(test|qa|demo|sandbox)([^a-z]|$)'
      AND coalesce(o.slug, '') !~* '^(test|qa|demo|sandbox)'
      AND coalesce(owner.email, '') !~* '(@tidywise1\.com$|^applereview@|@example\.com$|\+(qa|test))'
      AND coalesce(owner.email, '') <> 'support@tidywisecleaning.com'
  );
$function$;

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
  payload jsonb;
BEGIN
  PERFORM set_config('statement_timeout', '3000', true);

  SELECT c.payload, c.refreshed_at
    INTO cached, refreshed
  FROM public.growth_public_cache c
  WHERE c.cache_key = 'counters';

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

  SELECT COUNT(*)::int INTO weekly
  FROM public.organizations o
  WHERE o.created_at > now() - interval '7 days'
    AND public.growth_org_is_public(o.id, false);

  payload := jsonb_build_object(
    'limited', false,
    'lifetime_total', total_spots,
    'lifetime_sold', sold_spots,
    'lifetime_remaining', GREATEST(0, total_spots - sold_spots),
    'lifetime_sold_out', sold_spots >= total_spots,
    'weekly_signups', weekly
  );

  INSERT INTO public.growth_public_cache (cache_key, payload, refreshed_at)
  VALUES ('counters', payload, now())
  ON CONFLICT (cache_key) DO UPDATE
    SET payload = EXCLUDED.payload, refreshed_at = EXCLUDED.refreshed_at;

  DELETE FROM public.growth_public_rate
  WHERE window_start < now() - interval '10 minutes';

  RETURN payload;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_public_activity_feed()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  cached jsonb;
  refreshed timestamptz;
  payload jsonb;
BEGIN
  PERFORM set_config('statement_timeout', '3000', true);

  SELECT c.payload, c.refreshed_at
    INTO cached, refreshed
  FROM public.growth_public_cache c
  WHERE c.cache_key = 'feed';

  IF NOT public.growth_public_rate_ok() THEN
    RETURN coalesce(cached, jsonb_build_object('limited', true, 'events', '[]'::jsonb));
  END IF;

  IF refreshed IS NOT NULL AND refreshed > now() - interval '45 seconds' THEN
    RETURN cached;
  END IF;

  IF NOT pg_try_advisory_xact_lock(hashtext('growth_public_feed')) THEN
    RETURN coalesce(cached, jsonb_build_object('limited', false, 'events', '[]'::jsonb));
  END IF;

  WITH booked AS (
    SELECT
      'booked'::text AS kind,
      public.growth_public_city(b.city) AS city,
      CASE WHEN upper(btrim(b.state)) ~ '^[A-Z]{2}$' THEN upper(btrim(b.state)) ELSE NULL END AS region,
      CASE
        WHEN b.total_amount IS NULL OR b.total_amount < 20 OR b.total_amount > 5000 THEN NULL
        ELSE (round(b.total_amount / 10.0) * 10)::int
      END AS amount,
      public.growth_public_service(s.name) AS service,
      b.created_at AS happened_at
    FROM public.bookings b
    LEFT JOIN public.services s ON s.id = b.service_id
    WHERE b.created_at > now() - interval '7 days'
      AND b.organization_id IS NOT NULL
      AND coalesce(b.is_test, false) = false
      AND coalesce(b.is_draft, false) = false
      AND b.status IN ('pending', 'confirmed', 'in_progress', 'rescheduled')
      AND public.growth_org_is_public(b.organization_id, true)
    ORDER BY b.created_at DESC
    LIMIT 20
  ),
  completed AS (
    SELECT
      'completed'::text AS kind,
      public.growth_public_city(b.city) AS city,
      CASE WHEN upper(btrim(b.state)) ~ '^[A-Z]{2}$' THEN upper(btrim(b.state)) ELSE NULL END AS region,
      NULL::int AS amount,
      NULL::text AS service,
      coalesce(b.completed_at, b.updated_at) AS happened_at
    FROM public.bookings b
    WHERE coalesce(b.completed_at, b.updated_at) > now() - interval '7 days'
      AND b.organization_id IS NOT NULL
      AND coalesce(b.is_test, false) = false
      AND coalesce(b.is_draft, false) = false
      AND b.status = 'completed'
      AND public.growth_org_is_public(b.organization_id, true)
    ORDER BY 6 DESC
    LIMIT 20
  ),
  joined AS (
    SELECT
      'joined'::text AS kind,
      public.growth_public_city(bs.company_city) AS city,
      CASE WHEN upper(btrim(bs.company_state)) ~ '^[A-Z]{2}$' THEN upper(btrim(bs.company_state)) ELSE NULL END AS region,
      NULL::int AS amount,
      NULL::text AS service,
      o.created_at AS happened_at
    FROM public.organizations o
    LEFT JOIN public.business_settings bs ON bs.organization_id = o.id
    WHERE o.created_at > now() - interval '7 days'
      AND public.growth_org_is_public(o.id, true)
    ORDER BY o.created_at DESC
    LIMIT 10
  ),
  combined AS (
    SELECT * FROM booked
    UNION ALL
    SELECT * FROM completed
    UNION ALL
    SELECT * FROM joined
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'kind', e.kind,
    'city', e.city,
    'region', e.region,
    'amount', e.amount,
    'service', e.service,
    'at', e.happened_at
  ) ORDER BY e.happened_at DESC), '[]'::jsonb)
  INTO payload
  FROM (
    SELECT * FROM combined
    WHERE city IS NOT NULL
    ORDER BY happened_at DESC
    LIMIT 12
  ) e;

  payload := jsonb_build_object('limited', false, 'events', coalesce(payload, '[]'::jsonb));

  INSERT INTO public.growth_public_cache (cache_key, payload, refreshed_at)
  VALUES ('feed', payload, now())
  ON CONFLICT (cache_key) DO UPDATE
    SET payload = EXCLUDED.payload, refreshed_at = EXCLUDED.refreshed_at;

  RETURN payload;
END;
$function$;

REVOKE ALL ON FUNCTION public.growth_public_caller_role() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.growth_public_rate_ok() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.growth_public_city(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.growth_public_service(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.growth_org_is_public(uuid, boolean) FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.get_public_growth_counters() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_public_activity_feed() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_growth_counters() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_public_activity_feed() TO anon, authenticated, service_role;
