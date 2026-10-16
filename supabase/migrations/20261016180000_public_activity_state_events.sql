-- Public activity feed: real events only, state-level place, no invented rows.
--
-- Not applied by the change that added this file. New Bot runs it.
--
-- Kinds, each from an opted-in org (show_public_activity, test/demo excluded
-- by growth_org_is_public):
--   booked, completed, joined  (already live)
--   paid      invoices with status paid and paid_at set
--   reviewed  a submitted 5-star review
--   cleaner   an active staff row added to the team
--
-- There is no public.reviews table. Submitted ratings live on
-- review_requests (submit_review_by_token sets rating, status completed,
-- and responded_at). Only rating = 5 is a "5-star review received".
-- Do not synthesize a review when that row is absent.
--
-- The payload has kind, region (two-letter code), rounded amount, service,
-- and at. It has no city, name, address, review text, or id. Ordering
-- matches orderActivityEvents in src/lib/publicActivity.ts: never the same
-- kind twice in a row, and spread across orgs (1000 if this org was the
-- previous pick, 100 for each earlier pick). Stop rather than repeat a kind.

CREATE OR REPLACE FUNCTION public.growth_public_region(raw text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $function$
  WITH input AS (
    SELECT NULLIF(btrim(raw), '') AS value
  ),
  states(name, abbr) AS (
    VALUES
      ('alabama', 'AL'),
      ('alaska', 'AK'),
      ('arizona', 'AZ'),
      ('arkansas', 'AR'),
      ('california', 'CA'),
      ('colorado', 'CO'),
      ('connecticut', 'CT'),
      ('delaware', 'DE'),
      ('florida', 'FL'),
      ('georgia', 'GA'),
      ('hawaii', 'HI'),
      ('idaho', 'ID'),
      ('illinois', 'IL'),
      ('indiana', 'IN'),
      ('iowa', 'IA'),
      ('kansas', 'KS'),
      ('kentucky', 'KY'),
      ('louisiana', 'LA'),
      ('maine', 'ME'),
      ('maryland', 'MD'),
      ('massachusetts', 'MA'),
      ('michigan', 'MI'),
      ('minnesota', 'MN'),
      ('mississippi', 'MS'),
      ('missouri', 'MO'),
      ('montana', 'MT'),
      ('nebraska', 'NE'),
      ('nevada', 'NV'),
      ('new hampshire', 'NH'),
      ('new jersey', 'NJ'),
      ('new mexico', 'NM'),
      ('new york', 'NY'),
      ('north carolina', 'NC'),
      ('north dakota', 'ND'),
      ('ohio', 'OH'),
      ('oklahoma', 'OK'),
      ('oregon', 'OR'),
      ('pennsylvania', 'PA'),
      ('rhode island', 'RI'),
      ('south carolina', 'SC'),
      ('south dakota', 'SD'),
      ('tennessee', 'TN'),
      ('texas', 'TX'),
      ('utah', 'UT'),
      ('vermont', 'VT'),
      ('virginia', 'VA'),
      ('washington', 'WA'),
      ('west virginia', 'WV'),
      ('wisconsin', 'WI'),
      ('wyoming', 'WY'),
      ('district of columbia', 'DC'),
      ('puerto rico', 'PR'),
      ('u.s. virgin islands', 'VI'),
      ('guam', 'GU'),
      ('american samoa', 'AS'),
      ('northern mariana islands', 'MP'),
      ('alberta', 'AB'),
      ('british columbia', 'BC'),
      ('manitoba', 'MB'),
      ('new brunswick', 'NB'),
      ('newfoundland and labrador', 'NL'),
      ('nova scotia', 'NS'),
      ('northwest territories', 'NT'),
      ('nunavut', 'NU'),
      ('ontario', 'ON'),
      ('prince edward island', 'PE'),
      ('quebec', 'QC'),
      ('saskatchewan', 'SK'),
      ('yukon', 'YT')
  )
  SELECT CASE
    WHEN input.value IS NULL THEN NULL
    WHEN upper(input.value) ~ '^[A-Z]{2}$' THEN (
      SELECT s.abbr FROM states s WHERE s.abbr = upper(input.value) LIMIT 1
    )
    ELSE (
      SELECT s.abbr FROM states s WHERE s.name = lower(input.value) LIMIT 1
    )
  END
  FROM input;
$function$;

REVOKE ALL ON FUNCTION public.growth_public_region(text) FROM PUBLIC, anon, authenticated;

COMMENT ON COLUMN public.business_settings.show_public_activity IS
  'When false, this org is left out of the public TidyWise activity feed. State and rounded amount only; default on.';

-- Recent paid invoices, submitted reviews, and new staff are filtered by
-- time. These keep that scan inside the feed's statement timeout.
CREATE INDEX IF NOT EXISTS invoices_paid_at_public_feed_idx
  ON public.invoices (paid_at DESC)
  WHERE status = 'paid' AND paid_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS review_requests_five_star_responded_idx
  ON public.review_requests (responded_at DESC)
  WHERE rating = 5 AND status = 'completed' AND responded_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS staff_created_active_public_feed_idx
  ON public.staff (created_at DESC)
  WHERE is_active = true;

CREATE OR REPLACE FUNCTION public.get_public_activity_feed()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  cached jsonb;
  refreshed timestamptz;
  candidates jsonb := '[]'::jsonb;
  ordered jsonb := '[]'::jsonb;
  org_counts jsonb := '{}'::jsonb;
  last_kind text := NULL;
  last_org text := NULL;
  best_i integer;
  best_score integer;
  i integer;
  n integer;
  steps integer := 0;
  item jsonb;
  org text;
  score integer;
  seen integer;
  payload jsonb;
BEGIN
  PERFORM set_config('statement_timeout', '3000', true);

  SELECT c.payload, c.refreshed_at
    INTO cached, refreshed
  FROM public.growth_public_cache c
  WHERE c.cache_key = 'feed-state';

  IF NOT public.growth_public_rate_ok() THEN
    RETURN coalesce(cached, jsonb_build_object('limited', true, 'events', '[]'::jsonb));
  END IF;

  IF refreshed IS NOT NULL AND refreshed > now() - interval '45 seconds' THEN
    RETURN cached;
  END IF;

  IF NOT pg_try_advisory_xact_lock(hashtext('growth_public_feed')) THEN
    RETURN coalesce(cached, jsonb_build_object('limited', false, 'events', '[]'::jsonb));
  END IF;

  WITH src AS (
    (
      SELECT * FROM (
        SELECT
          'booked'::text AS kind,
          b.organization_id::text AS org,
          coalesce(
            public.growth_public_region(bs.company_state),
            public.growth_public_region(b.state)
          ) AS region,
          CASE
            WHEN b.total_amount IS NULL OR b.total_amount < 20 OR b.total_amount > 5000 THEN NULL
            ELSE (round(b.total_amount / 10.0) * 10)::int
          END AS amount,
          public.growth_public_service(s.name) AS service,
          b.created_at AS at
        FROM public.bookings b
        LEFT JOIN public.services s ON s.id = b.service_id
        LEFT JOIN public.business_settings bs ON bs.organization_id = b.organization_id
        WHERE b.created_at > now() - interval '7 days'
          AND b.organization_id IS NOT NULL
          AND coalesce(b.is_test, false) = false
          AND coalesce(b.is_draft, false) = false
          AND NOT public.row_is_imported(to_jsonb(b))
          AND b.status IN ('pending', 'confirmed', 'in_progress', 'rescheduled')
          AND public.growth_org_is_public(b.organization_id, true)
      ) booked
      WHERE region IS NOT NULL
      ORDER BY at DESC
      LIMIT 40
    )

    UNION ALL

    (
      SELECT * FROM (
        SELECT
          'completed'::text AS kind,
          b.organization_id::text AS org,
          coalesce(
            public.growth_public_region(bs.company_state),
            public.growth_public_region(b.state)
          ) AS region,
          NULL::int AS amount,
          NULL::text AS service,
          coalesce(b.completed_at, b.updated_at) AS at
        FROM public.bookings b
        LEFT JOIN public.business_settings bs ON bs.organization_id = b.organization_id
        WHERE coalesce(b.completed_at, b.updated_at) > now() - interval '7 days'
          AND b.organization_id IS NOT NULL
          AND coalesce(b.is_test, false) = false
          AND coalesce(b.is_draft, false) = false
          AND NOT public.row_is_imported(to_jsonb(b))
          AND b.status = 'completed'
          AND public.growth_org_is_public(b.organization_id, true)
      ) completed
      WHERE region IS NOT NULL
      ORDER BY at DESC
      LIMIT 40
    )

    UNION ALL

    (
      SELECT * FROM (
        SELECT
          'joined'::text AS kind,
          o.id::text AS org,
          public.growth_public_region(bs.company_state) AS region,
          NULL::int AS amount,
          NULL::text AS service,
          o.created_at AS at
        FROM public.organizations o
        LEFT JOIN public.business_settings bs ON bs.organization_id = o.id
        WHERE o.created_at > now() - interval '7 days'
          AND public.growth_org_is_public(o.id, true)
      ) joined
      WHERE region IS NOT NULL
      ORDER BY at DESC
      LIMIT 20
    )

    UNION ALL

    (
      SELECT * FROM (
        SELECT
          'paid'::text AS kind,
          i.organization_id::text AS org,
          public.growth_public_region(bs.company_state) AS region,
          (round(i.total_amount / 10.0) * 10)::int AS amount,
          NULL::text AS service,
          i.paid_at AS at
        FROM public.invoices i
        LEFT JOIN public.business_settings bs ON bs.organization_id = i.organization_id
        WHERE i.paid_at > now() - interval '7 days'
          AND i.organization_id IS NOT NULL
          AND i.status = 'paid'
          AND i.total_amount >= 20
          AND i.total_amount <= 5000
          AND NOT public.row_is_imported(to_jsonb(i))
          AND public.growth_org_is_public(i.organization_id, true)
      ) paid
      WHERE region IS NOT NULL
      ORDER BY at DESC
      LIMIT 40
    )

    UNION ALL

    (
      SELECT * FROM (
        SELECT
          'reviewed'::text AS kind,
          coalesce(rr.organization_id, b.organization_id)::text AS org,
          coalesce(
            public.growth_public_region(bs.company_state),
            public.growth_public_region(b.state)
          ) AS region,
          NULL::int AS amount,
          NULL::text AS service,
          rr.responded_at AS at
        FROM public.review_requests rr
        LEFT JOIN public.bookings b ON b.id = rr.booking_id
        LEFT JOIN public.business_settings bs
          ON bs.organization_id = coalesce(rr.organization_id, b.organization_id)
        WHERE rr.responded_at > now() - interval '7 days'
          AND rr.rating = 5
          AND rr.status = 'completed'
          AND coalesce(rr.organization_id, b.organization_id) IS NOT NULL
          AND public.growth_org_is_public(coalesce(rr.organization_id, b.organization_id), true)
          AND (
            b.id IS NULL
            OR (
              coalesce(b.is_test, false) = false
              AND coalesce(b.is_draft, false) = false
              AND NOT public.row_is_imported(to_jsonb(b))
            )
          )
      ) reviewed
      WHERE region IS NOT NULL
      ORDER BY at DESC
      LIMIT 40
    )

    UNION ALL

    (
      SELECT * FROM (
        SELECT
          'cleaner'::text AS kind,
          st.organization_id::text AS org,
          public.growth_public_region(bs.company_state) AS region,
          NULL::int AS amount,
          NULL::text AS service,
          st.created_at AS at
        FROM public.staff st
        LEFT JOIN public.business_settings bs ON bs.organization_id = st.organization_id
        WHERE st.created_at > now() - interval '7 days'
          AND st.organization_id IS NOT NULL
          AND st.is_active = true
          AND NOT public.row_is_imported(to_jsonb(st))
          AND coalesce(st.created_via, '') !~* '(^|[^a-z])(test|demo|sandbox)([^a-z]|$)'
          AND coalesce(st.email, '') !~* '(@example\.com$|^applereview@|\+(qa|test))'
          AND coalesce(st.name, '') !~* '(^|[^a-z])(test|qa|demo|sandbox)([^a-z]|$)'
          AND public.growth_org_is_public(st.organization_id, true)
      ) cleaner
      WHERE region IS NOT NULL
      ORDER BY at DESC
      LIMIT 40
    )
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'kind', src.kind,
    'org', src.org,
    'region', src.region,
    'amount', src.amount,
    'service', src.service,
    'at', src.at
  ) ORDER BY src.at DESC, src.org, src.kind), '[]'::jsonb)
  INTO candidates
  FROM src
  WHERE src.org IS NOT NULL
    AND src.region IS NOT NULL
    AND src.at IS NOT NULL;

  -- Same scores as orderActivityEvents. The candidate list is newest first
  -- (org, then kind, when timestamps tie). Org is stripped before the row is kept.
  WHILE jsonb_array_length(candidates) > 0
    AND jsonb_array_length(ordered) < 12
    AND steps < 200
  LOOP
    steps := steps + 1;
    best_i := NULL;
    best_score := NULL;
    n := jsonb_array_length(candidates);
    FOR i IN 0 .. n - 1 LOOP
      item := candidates -> i;
      IF item->>'kind' IS NOT DISTINCT FROM last_kind THEN
        CONTINUE;
      END IF;
      org := coalesce(item->>'org', '');
      score := i;
      IF org <> '' AND org IS NOT DISTINCT FROM last_org THEN
        score := score + 1000;
      END IF;
      seen := coalesce((org_counts ->> org)::int, 0);
      score := score + seen * 100;
      IF best_score IS NULL OR score < best_score THEN
        best_score := score;
        best_i := i;
      END IF;
    END LOOP;

    EXIT WHEN best_i IS NULL;

    item := candidates -> best_i;
    ordered := ordered || jsonb_build_array(item - 'org');
    last_kind := item->>'kind';
    org := coalesce(item->>'org', '');
    IF org = '' THEN
      last_org := NULL;
    ELSE
      last_org := org;
      org_counts := jsonb_set(
        org_counts,
        ARRAY[org],
        to_jsonb(coalesce((org_counts ->> org)::int, 0) + 1),
        true
      );
    END IF;
    candidates := candidates - best_i;
  END LOOP;

  payload := jsonb_build_object('limited', false, 'events', coalesce(ordered, '[]'::jsonb));

  INSERT INTO public.growth_public_cache (cache_key, payload, refreshed_at)
  VALUES ('feed-state', payload, now())
  ON CONFLICT (cache_key) DO UPDATE
    SET payload = EXCLUDED.payload, refreshed_at = EXCLUDED.refreshed_at;

  RETURN payload;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_public_activity_feed() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_activity_feed() TO anon, authenticated, service_role;
