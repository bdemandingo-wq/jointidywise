-- Fix: get_public_activity_feed() raised "column reference \"i\" is ambiguous" (42702),
-- which made the public-growth edge function answer 500 and blanked the marketing page.
--
-- Cause: the function declares a plpgsql loop variable "i integer", and its paid-events
-- subquery aliases public.invoices as "i". plpgsql substitutes declared variables into the
-- SQL, so "i" resolved two ways at once (variable vs table alias), notably in to_jsonb(i).
--
-- Fix: rename only the loop variable to "idx". The SQL text, the invoices alias, the
-- ordering scores and the cache write are otherwise byte-identical to the version in
-- 20261016190000_public_activity_state_events.sql.

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
  idx integer;
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
          public.growth_public_place(bs.company_state, bs.company_zip, b.state) AS region,
          CASE
            WHEN b.total_amount IS NULL OR b.total_amount < 20 OR b.total_amount > 5000 THEN NULL
            ELSE (round(b.total_amount / 10.0) * 10)::int
          END AS amount,
          public.growth_public_service(s.name) AS service,
          b.created_at AS at
        FROM public.bookings b
        LEFT JOIN public.services s ON s.id = b.service_id
        LEFT JOIN public.business_settings bs ON bs.organization_id = b.organization_id
        WHERE b.created_at > now() - interval '24 hours'
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
          public.growth_public_place(bs.company_state, bs.company_zip, b.state) AS region,
          NULL::int AS amount,
          NULL::text AS service,
          b.completed_at AS at
        FROM public.bookings b
        LEFT JOIN public.business_settings bs ON bs.organization_id = b.organization_id
        WHERE b.completed_at > now() - interval '24 hours'
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
          public.growth_public_place(bs.company_state, bs.company_zip, NULL::text) AS region,
          NULL::int AS amount,
          NULL::text AS service,
          o.created_at AS at
        FROM public.organizations o
        LEFT JOIN public.business_settings bs ON bs.organization_id = o.id
        WHERE o.created_at > now() - interval '24 hours'
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
          public.growth_public_place(bs.company_state, bs.company_zip, NULL::text) AS region,
          (round(i.total_amount / 10.0) * 10)::int AS amount,
          NULL::text AS service,
          i.paid_at AS at
        FROM public.invoices i
        LEFT JOIN public.business_settings bs ON bs.organization_id = i.organization_id
        WHERE i.paid_at > now() - interval '24 hours'
          AND i.organization_id IS NOT NULL
          AND i.stripe_payment_intent_id IS NOT NULL
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
          public.growth_public_place(bs.company_state, bs.company_zip, b.state) AS region,
          NULL::int AS amount,
          NULL::text AS service,
          rr.responded_at AS at
        FROM public.review_requests rr
        INNER JOIN public.bookings b ON b.id = rr.booking_id
        LEFT JOIN public.business_settings bs
          ON bs.organization_id = coalesce(rr.organization_id, b.organization_id)
        WHERE rr.responded_at > now() - interval '24 hours'
          AND rr.booking_id IS NOT NULL
          AND rr.rating = 5
          AND rr.status = 'completed'
          AND NULLIF(btrim(rr.review_link_token), '') IS NOT NULL
          AND rr.sent_at IS NOT NULL
          AND rr.submitted_by_token = true
          AND public.booking_is_real_job(to_jsonb(b))
          AND coalesce(rr.organization_id, b.organization_id) IS NOT NULL
          AND public.growth_org_is_public(coalesce(rr.organization_id, b.organization_id), true)
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
          public.growth_public_place(bs.company_state, bs.company_zip, NULL::text) AS region,
          NULL::int AS amount,
          NULL::text AS service,
          st.created_at AS at
        FROM public.staff st
        LEFT JOIN public.business_settings bs ON bs.organization_id = st.organization_id
        WHERE st.created_at > now() - interval '24 hours'
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
    FOR idx IN 0 .. n - 1 LOOP
      item := candidates -> idx;
      IF item->>'kind' IS NOT DISTINCT FROM last_kind THEN
        CONTINUE;
      END IF;
      org := coalesce(item->>'org', '');
      score := idx;
      IF org <> '' AND org IS NOT DISTINCT FROM last_org THEN
        score := score + 1000;
      END IF;
      seen := coalesce((org_counts ->> org)::int, 0);
      score := score + seen * 100;
      IF best_score IS NULL OR score < best_score THEN
        best_score := score;
        best_i := idx;
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

  -- The ticker advances from the last line back to the first. Drop the
  -- oldest tail until those two kinds differ. A single remaining event
  -- stays, even when every other row was the same kind.
  WHILE jsonb_array_length(ordered) > 1
    AND (ordered -> 0 ->> 'kind') IS NOT DISTINCT FROM (ordered -> -1 ->> 'kind')
  LOOP
    ordered := ordered - (-1);
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
