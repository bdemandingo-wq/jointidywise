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
-- Place comes from business_settings company_state, then company_zip, then
-- the booking state when that row has one. A ZIP maps through USPS ZIP3
-- prefixes or a Canada Post letter. A city name is never turned into a
-- state. A 2-letter value counts only when the whole field is that code
-- ("TX", not "Dallas, TX"). The payload has kind, region (two-letter code),
-- rounded amount, service, and at. It has no city, zip, name, address,
-- review text, or id. Every candidate is from the last 24 hours, which is
-- the same window the ticker displays.
--
-- A reviewed row has to be a real customer submission: booking_id set,
-- booking_is_real_job, review_link_token and sent_at set, and
-- submitted_by_token. Only submit_review_by_token may write rating,
-- responded_at, or that flag. A paid row needs stripe_payment_intent_id.
-- A completed row uses completed_at, never updated_at.
-- Ordering
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

DROP FUNCTION IF EXISTS public.growth_public_region_token(text);

-- A 2-letter value is accepted above only when the whole field is that code
-- and the code is in the list. "TX" is Texas. "Dallas, TX" and "NA" are not.
-- USPS ZIP3 or a Canadian postal code. Unassigned and ambiguous prefixes
-- (military, 969, Canada Post X) stay null. Keep the WHEN list in sync with
-- ZIP3_RANGES in src/lib/publicActivity.ts.
CREATE OR REPLACE FUNCTION public.growth_public_region_from_zip(raw text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $function$
DECLARE
  cleaned text;
  zip3 integer;
  letter text;
BEGIN
  IF raw IS NULL THEN
    RETURN NULL;
  END IF;
  cleaned := upper(regexp_replace(btrim(raw), '[^A-Za-z0-9]', '', 'g'));
  IF cleaned ~ '^[0-9]{5}([0-9]{4})?$' THEN
    zip3 := substring(cleaned from 1 for 3)::integer;
    RETURN CASE
      WHEN zip3 BETWEEN 5 AND 5 THEN 'NY'
      WHEN zip3 BETWEEN 6 AND 7 THEN 'PR'
      WHEN zip3 BETWEEN 8 AND 8 THEN 'VI'
      WHEN zip3 BETWEEN 9 AND 9 THEN 'PR'
      WHEN zip3 BETWEEN 10 AND 27 THEN 'MA'
      WHEN zip3 BETWEEN 28 AND 29 THEN 'RI'
      WHEN zip3 BETWEEN 30 AND 38 THEN 'NH'
      WHEN zip3 BETWEEN 39 AND 49 THEN 'ME'
      WHEN zip3 BETWEEN 50 AND 54 THEN 'VT'
      WHEN zip3 BETWEEN 55 AND 55 THEN 'MA'
      WHEN zip3 BETWEEN 56 AND 59 THEN 'VT'
      WHEN zip3 BETWEEN 60 AND 69 THEN 'CT'
      WHEN zip3 BETWEEN 70 AND 89 THEN 'NJ'
      WHEN zip3 BETWEEN 100 AND 149 THEN 'NY'
      WHEN zip3 BETWEEN 150 AND 196 THEN 'PA'
      WHEN zip3 BETWEEN 197 AND 199 THEN 'DE'
      WHEN zip3 BETWEEN 200 AND 200 THEN 'DC'
      WHEN zip3 BETWEEN 201 AND 201 THEN 'VA'
      WHEN zip3 BETWEEN 202 AND 205 THEN 'DC'
      WHEN zip3 BETWEEN 206 AND 212 THEN 'MD'
      WHEN zip3 BETWEEN 214 AND 219 THEN 'MD'
      WHEN zip3 BETWEEN 220 AND 246 THEN 'VA'
      WHEN zip3 BETWEEN 247 AND 268 THEN 'WV'
      WHEN zip3 BETWEEN 270 AND 289 THEN 'NC'
      WHEN zip3 BETWEEN 290 AND 299 THEN 'SC'
      WHEN zip3 BETWEEN 300 AND 319 THEN 'GA'
      WHEN zip3 BETWEEN 320 AND 339 THEN 'FL'
      WHEN zip3 BETWEEN 341 AND 342 THEN 'FL'
      WHEN zip3 BETWEEN 344 AND 344 THEN 'FL'
      WHEN zip3 BETWEEN 346 AND 347 THEN 'FL'
      WHEN zip3 BETWEEN 349 AND 349 THEN 'FL'
      WHEN zip3 BETWEEN 350 AND 352 THEN 'AL'
      WHEN zip3 BETWEEN 354 AND 369 THEN 'AL'
      WHEN zip3 BETWEEN 370 AND 385 THEN 'TN'
      WHEN zip3 BETWEEN 386 AND 397 THEN 'MS'
      WHEN zip3 BETWEEN 398 AND 399 THEN 'GA'
      WHEN zip3 BETWEEN 400 AND 418 THEN 'KY'
      WHEN zip3 BETWEEN 420 AND 427 THEN 'KY'
      WHEN zip3 BETWEEN 430 AND 459 THEN 'OH'
      WHEN zip3 BETWEEN 460 AND 479 THEN 'IN'
      WHEN zip3 BETWEEN 480 AND 499 THEN 'MI'
      WHEN zip3 BETWEEN 500 AND 516 THEN 'IA'
      WHEN zip3 BETWEEN 520 AND 528 THEN 'IA'
      WHEN zip3 BETWEEN 530 AND 532 THEN 'WI'
      WHEN zip3 BETWEEN 534 AND 535 THEN 'WI'
      WHEN zip3 BETWEEN 537 AND 549 THEN 'WI'
      WHEN zip3 BETWEEN 550 AND 551 THEN 'MN'
      WHEN zip3 BETWEEN 553 AND 567 THEN 'MN'
      WHEN zip3 BETWEEN 570 AND 577 THEN 'SD'
      WHEN zip3 BETWEEN 580 AND 588 THEN 'ND'
      WHEN zip3 BETWEEN 590 AND 599 THEN 'MT'
      WHEN zip3 BETWEEN 600 AND 603 THEN 'IL'
      WHEN zip3 BETWEEN 604 AND 605 THEN 'IL'
      WHEN zip3 BETWEEN 606 AND 608 THEN 'IL'
      WHEN zip3 BETWEEN 609 AND 609 THEN 'IL'
      WHEN zip3 BETWEEN 610 AND 611 THEN 'IL'
      WHEN zip3 BETWEEN 612 AND 620 THEN 'IL'
      WHEN zip3 BETWEEN 622 AND 629 THEN 'IL'
      WHEN zip3 BETWEEN 630 AND 631 THEN 'MO'
      WHEN zip3 BETWEEN 633 AND 641 THEN 'MO'
      WHEN zip3 BETWEEN 644 AND 658 THEN 'MO'
      WHEN zip3 BETWEEN 660 AND 679 THEN 'KS'
      WHEN zip3 BETWEEN 680 AND 681 THEN 'NE'
      WHEN zip3 BETWEEN 683 AND 693 THEN 'NE'
      WHEN zip3 BETWEEN 700 AND 701 THEN 'LA'
      WHEN zip3 BETWEEN 703 AND 708 THEN 'LA'
      WHEN zip3 BETWEEN 710 AND 714 THEN 'LA'
      WHEN zip3 BETWEEN 716 AND 729 THEN 'AR'
      WHEN zip3 BETWEEN 730 AND 731 THEN 'OK'
      WHEN zip3 BETWEEN 733 AND 733 THEN 'TX'
      WHEN zip3 BETWEEN 734 AND 741 THEN 'OK'
      WHEN zip3 BETWEEN 743 AND 749 THEN 'OK'
      WHEN zip3 BETWEEN 750 AND 770 THEN 'TX'
      WHEN zip3 BETWEEN 772 AND 799 THEN 'TX'
      WHEN zip3 BETWEEN 800 AND 816 THEN 'CO'
      WHEN zip3 BETWEEN 820 AND 831 THEN 'WY'
      WHEN zip3 BETWEEN 832 AND 838 THEN 'ID'
      WHEN zip3 BETWEEN 840 AND 847 THEN 'UT'
      WHEN zip3 BETWEEN 850 AND 853 THEN 'AZ'
      WHEN zip3 BETWEEN 855 AND 857 THEN 'AZ'
      WHEN zip3 BETWEEN 859 AND 860 THEN 'AZ'
      WHEN zip3 BETWEEN 863 AND 865 THEN 'AZ'
      WHEN zip3 BETWEEN 870 AND 871 THEN 'NM'
      WHEN zip3 BETWEEN 873 AND 884 THEN 'NM'
      WHEN zip3 BETWEEN 885 AND 885 THEN 'TX'
      WHEN zip3 BETWEEN 889 AND 891 THEN 'NV'
      WHEN zip3 BETWEEN 893 AND 895 THEN 'NV'
      WHEN zip3 BETWEEN 897 AND 898 THEN 'NV'
      WHEN zip3 BETWEEN 900 AND 908 THEN 'CA'
      WHEN zip3 BETWEEN 910 AND 928 THEN 'CA'
      WHEN zip3 BETWEEN 930 AND 961 THEN 'CA'
      WHEN zip3 BETWEEN 967 AND 968 THEN 'HI'
      WHEN zip3 BETWEEN 970 AND 979 THEN 'OR'
      WHEN zip3 BETWEEN 980 AND 986 THEN 'WA'
      WHEN zip3 BETWEEN 988 AND 994 THEN 'WA'
      WHEN zip3 BETWEEN 995 AND 999 THEN 'AK'
      ELSE NULL
    END;
  END IF;
  IF cleaned ~ '^[A-Z][0-9][A-Z][0-9][A-Z][0-9]$' THEN
    letter := substring(cleaned from 1 for 1);
    RETURN CASE letter
      WHEN 'A' THEN 'NL'
      WHEN 'B' THEN 'NS'
      WHEN 'C' THEN 'PE'
      WHEN 'E' THEN 'NB'
      WHEN 'G' THEN 'QC'
      WHEN 'H' THEN 'QC'
      WHEN 'J' THEN 'QC'
      WHEN 'K' THEN 'ON'
      WHEN 'L' THEN 'ON'
      WHEN 'M' THEN 'ON'
      WHEN 'N' THEN 'ON'
      WHEN 'P' THEN 'ON'
      WHEN 'R' THEN 'MB'
      WHEN 'S' THEN 'SK'
      WHEN 'T' THEN 'AB'
      WHEN 'V' THEN 'BC'
      WHEN 'Y' THEN 'YT'
      ELSE NULL
    END;
  END IF;
  RETURN NULL;
END;
$function$;

-- Exact state (code or full name), then ZIP, then the booking state the same way.
-- No substring match, so a city plus a code ("Dallas, TX") is not a state.
CREATE OR REPLACE FUNCTION public.growth_public_place(p_state text, p_zip text, p_booking_state text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $function$
  SELECT coalesce(
    public.growth_public_region(p_state),
    public.growth_public_region_from_zip(p_zip),
    public.growth_public_region(p_booking_state)
  );
$function$;

REVOKE ALL ON FUNCTION public.growth_public_region_from_zip(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.growth_public_place(text, text, text) FROM PUBLIC, anon, authenticated;

COMMENT ON COLUMN public.business_settings.show_public_activity IS
  'When false, this org is left out of the public TidyWise activity feed. State and rounded amount only; default on.';

-- Only submit_review_by_token may record a rating. Org admins can still
-- update the rest of the row (status, sent_at, the link) through RLS.
ALTER TABLE public.review_requests
  ADD COLUMN IF NOT EXISTS submitted_by_token boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.review_requests.submitted_by_token IS
  'True only when submit_review_by_token stored the rating. Direct writes of rating, responded_at, and this flag are rejected.';

CREATE OR REPLACE FUNCTION public.guard_review_request_submission()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  IF coalesce(current_setting('app.review_submit', true), '') = 'on' THEN
    NEW.submitted_by_token := true;
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.rating IS NOT NULL
      OR NEW.responded_at IS NOT NULL
      OR NEW.submitted_by_token IS TRUE
    THEN
      RAISE EXCEPTION 'rating and responded_at are recorded only by submit_review_by_token'
        USING ERRCODE = '42501';
    END IF;
    NEW.submitted_by_token := false;
    RETURN NEW;
  END IF;

  IF NEW.rating IS DISTINCT FROM OLD.rating
    OR NEW.responded_at IS DISTINCT FROM OLD.responded_at
    OR NEW.submitted_by_token IS DISTINCT FROM OLD.submitted_by_token
  THEN
    RAISE EXCEPTION 'rating and responded_at are recorded only by submit_review_by_token'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.guard_review_request_submission() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS review_requests_guard_submission ON public.review_requests;
CREATE TRIGGER review_requests_guard_submission
  BEFORE INSERT OR UPDATE ON public.review_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_review_request_submission();

-- Same body as 20260819175815, plus the session flag and submitted_by_token.
-- Grants from 20260501010000 stay on this signature.
CREATE OR REPLACE FUNCTION public.submit_review_by_token(p_token text, p_rating integer, p_review_text text DEFAULT NULL::text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_id uuid;
  v_customer_id uuid;
  v_org_id uuid;
  v_customer_name text;
  v_issue text;
  v_tz text;
  v_feedback_date date;
BEGIN
  IF p_token IS NULL OR length(p_token) < 16 THEN
    RETURN false;
  END IF;
  IF p_rating IS NULL OR p_rating < 1 OR p_rating > 5 THEN
    RETURN false;
  END IF;

  SELECT id, customer_id, organization_id
    INTO v_id, v_customer_id, v_org_id
  FROM public.review_requests
  WHERE review_link_token = p_token
  LIMIT 1;

  IF v_id IS NULL THEN
    RETURN false;
  END IF;

  PERFORM set_config('app.review_submit', 'on', true);

  UPDATE public.review_requests
  SET rating = p_rating,
      review_text = COALESCE(p_review_text, review_text),
      status = 'completed',
      responded_at = COALESCE(responded_at, now()),
      submitted_by_token = true
  WHERE id = v_id;

  IF v_customer_id IS NOT NULL THEN
    SELECT trim(coalesce(c.first_name, '') || ' ' || coalesce(c.last_name, ''))
      INTO v_customer_name
    FROM public.customers c
    WHERE c.id = v_customer_id;

    SELECT bs.timezone INTO v_tz
    FROM public.business_settings bs
    WHERE bs.organization_id = v_org_id
    LIMIT 1;

    v_tz := COALESCE(NULLIF(v_tz, ''), 'America/New_York');
    v_feedback_date := (now() AT TIME ZONE v_tz)::date;

    v_issue := COALESCE(NULLIF(btrim(p_review_text), ''),
                        'Customer gave ' || p_rating || ' star rating');

    BEGIN
      INSERT INTO public.client_feedback (
        organization_id, customer_name, issue_description,
        feedback_date, is_resolved, followup_needed
      ) VALUES (
        v_org_id, v_customer_name, v_issue, v_feedback_date, false, true
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'submit_review_by_token: client_feedback insert failed (review_request=%, org=%, customer=%): % [%]',
        v_id, v_org_id, v_customer_id, SQLERRM, SQLSTATE;
    END;
  END IF;

  RETURN true;
END;
$function$;

REVOKE ALL ON FUNCTION public.submit_review_by_token(text, integer, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_review_by_token(text, integer, text) TO anon, authenticated, service_role;

-- Recent paid invoices, submitted reviews, and new staff are filtered by
-- time. These keep that scan inside the feed's statement timeout.
CREATE INDEX IF NOT EXISTS invoices_paid_at_public_feed_idx
  ON public.invoices (paid_at DESC)
  WHERE status = 'paid' AND paid_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS review_requests_five_star_responded_idx
  ON public.review_requests (responded_at DESC)
  WHERE rating = 5
    AND status = 'completed'
    AND responded_at IS NOT NULL
    AND booking_id IS NOT NULL
    AND review_link_token IS NOT NULL
    AND sent_at IS NOT NULL
    AND submitted_by_token = true;

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
