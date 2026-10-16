-- Local proof for save_how_heard and signup_classify_channel.
--
-- save_how_heard is applied from its migration. signup_classify_channel is
-- created here from the same rules as
-- supabase/migrations/20261016140100_signup_channel_attribution.sql, because
-- that migration also rebuilds platform_account_metrics_v.
--
-- Run with:
--   sudo -u postgres psql -d signup_source_attribution_test -v ON_ERROR_STOP=1 \
--     -f supabase/tests/signup_source_attribution.sql

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
END $$;

CREATE SCHEMA IF NOT EXISTS auth;

CREATE OR REPLACE FUNCTION auth.uid()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

CREATE TABLE IF NOT EXISTS public.organizations (
  id uuid PRIMARY KEY,
  owner_id uuid,
  onboarding_answers jsonb
);

\ir ../migrations/20261016140000_save_how_heard.sql

INSERT INTO public.organizations (id, owner_id, onboarding_answers) VALUES
  ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '{}'::jsonb),
  ('22222222-2222-2222-2222-222222222222', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '{"teamSize":["solo"]}'::jsonb),
  ('33333333-3333-3333-3333-333333333333', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '{}'::jsonb)
ON CONFLICT (id) DO UPDATE
  SET owner_id = EXCLUDED.owner_id,
      onboarding_answers = EXCLUDED.onboarding_answers;

DO $$
DECLARE
  v_heard jsonb;
  v_other text;
  v_asked text;
  v_config text;
BEGIN
  SELECT proconfig::text INTO v_config
  FROM pg_proc
  WHERE proname = 'how_heard_is_present';
  IF v_config IS NULL OR position('search_path=public' IN v_config) = 0 THEN
    RAISE EXCEPTION 'how_heard_is_present is missing SET search_path = public';
  END IF;

  PERFORM set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', true);

  PERFORM public.save_how_heard('11111111-1111-1111-1111-111111111111', 'tiktok', null);

  SELECT onboarding_answers -> 'howHeard',
         onboarding_answers ->> 'howHeardAskedAt'
    INTO v_heard, v_asked
  FROM public.organizations
  WHERE id = '11111111-1111-1111-1111-111111111111';
  IF v_heard <> '["tiktok"]'::jsonb OR v_asked IS NULL THEN
    RAISE EXCEPTION 'tiktok was not stored on the named org: % %', v_heard, v_asked;
  END IF;

  SELECT onboarding_answers -> 'howHeard' INTO v_heard
  FROM public.organizations
  WHERE id = '22222222-2222-2222-2222-222222222222';
  IF v_heard IS NOT NULL THEN
    RAISE EXCEPTION 'save_how_heard wrote a second org the caller owns: %', v_heard;
  END IF;

  PERFORM public.save_how_heard('11111111-1111-1111-1111-111111111111', 'reddit', null);
  SELECT onboarding_answers -> 'howHeard' INTO v_heard
  FROM public.organizations
  WHERE id = '11111111-1111-1111-1111-111111111111';
  IF v_heard <> '["tiktok"]'::jsonb THEN
    RAISE EXCEPTION 'a second answer overwrote howHeard: %', v_heard;
  END IF;

  BEGIN
    PERFORM public.save_how_heard('22222222-2222-2222-2222-222222222222', 'billboard', null);
    RAISE EXCEPTION 'billboard was accepted';
  EXCEPTION WHEN invalid_parameter_value THEN
    NULL;
  END;

  BEGIN
    PERFORM public.save_how_heard('22222222-2222-2222-2222-222222222222', 'other', '   ');
    RAISE EXCEPTION 'blank other text was accepted';
  EXCEPTION WHEN invalid_parameter_value THEN
    NULL;
  END;

  PERFORM public.save_how_heard('22222222-2222-2222-2222-222222222222', 'not_sure', null);
  SELECT onboarding_answers -> 'howHeard',
         onboarding_answers ->> 'howHeardOther',
         onboarding_answers ->> 'howHeardAskedAt'
    INTO v_heard, v_other, v_asked
  FROM public.organizations
  WHERE id = '22222222-2222-2222-2222-222222222222';
  IF v_heard <> '["not_sure"]'::jsonb OR v_asked IS NULL THEN
    RAISE EXCEPTION 'not_sure was not stored with howHeardAskedAt: % %', v_heard, v_asked;
  END IF;
  IF COALESCE(v_other, '') <> '' THEN
    RAISE EXCEPTION 'not_sure stored other text: %', v_other;
  END IF;

  PERFORM public.save_how_heard('22222222-2222-2222-2222-222222222222', 'tiktok', null);
  SELECT onboarding_answers -> 'howHeard' INTO v_heard
  FROM public.organizations
  WHERE id = '22222222-2222-2222-2222-222222222222';
  IF v_heard <> '["not_sure"]'::jsonb THEN
    RAISE EXCEPTION 'not_sure was overwritten: %', v_heard;
  END IF;

  PERFORM set_config('request.jwt.claim.sub', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', true);
  PERFORM public.save_how_heard('11111111-1111-1111-1111-111111111111', 'reddit', null);
  PERFORM set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', true);
  SELECT onboarding_answers -> 'howHeard' INTO v_heard
  FROM public.organizations
  WHERE id = '11111111-1111-1111-1111-111111111111';
  IF v_heard <> '["tiktok"]'::jsonb THEN
    RAISE EXCEPTION 'a non-owner changed the org: %', v_heard;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.normalize_utm_value(p_raw text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT NULLIF(lower(btrim(COALESCE(p_raw, ''))), '')
$$;

CREATE OR REPLACE FUNCTION public.signup_referrer_domain(p_value text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v text := btrim(COALESCE(p_value, ''));
BEGIN
  IF v = '' THEN
    RETURN NULL;
  END IF;
  v := regexp_replace(v, '^[a-zA-Z][a-zA-Z0-9+.-]*://', '');
  IF position('@' in v) > 0 THEN
    v := substring(v from position('@' in v) + 1);
  END IF;
  v := split_part(split_part(split_part(v, '/', 1), '?', 1), '#', 1);
  v := split_part(v, ':', 1);
  v := lower(btrim(v));
  IF v = '' OR position(' ' in v) > 0 THEN
    RETURN NULL;
  END IF;
  RETURN NULLIF(left(v, 253), '');
END;
$$;

-- The body below is the migration function. Keep it in sync: the node test
-- checks that this file's instagram-over-fbclid and ignored-host rules match
-- supabase/migrations/20261016140100_signup_channel_attribution.sql.
CREATE OR REPLACE FUNCTION public.signup_classify_channel(
  p_utm_source text,
  p_utm_medium text,
  p_utm_campaign text,
  p_utm_term text,
  p_utm_content text,
  p_referrer text,
  p_gclid text,
  p_fbclid text,
  p_ttclid text,
  p_native boolean DEFAULT false
) RETURNS TABLE (channel text, channel_source text, detected_via text)
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_source text := public.normalize_utm_value(p_utm_source);
  v_medium text := public.normalize_utm_value(p_utm_medium);
  v_campaign text := public.normalize_utm_value(p_utm_campaign);
  v_term text := public.normalize_utm_value(p_utm_term);
  v_content text := public.normalize_utm_value(p_utm_content);
  v_host text := public.signup_referrer_domain(p_referrer);
  v_bare text := regexp_replace(COALESCE(v_host, ''), '^www\.', '');
  v_ignored boolean;
  v_paid boolean;
  v_channel text;
  v_source_label text;
BEGIN
  v_paid := v_medium IN ('cpc', 'ppc', 'paid', 'paidsocial', 'paid_social', 'cpm', 'cpa', 'display', 'ads');
  v_ignored := v_host IS NOT NULL AND (
    v_bare = 'jointidywise.com' OR right(v_bare, 17) = '.jointidywise.com'
    OR v_bare = 'accounts.google.com'
    OR v_bare = 'appleid.apple.com'
    OR v_bare = 'checkout.stripe.com'
    OR v_bare = 'supabase.co' OR right(v_bare, 12) = '.supabase.co'
    OR v_bare = 'lovable.app' OR right(v_bare, 12) = '.lovable.app'
  );

  IF v_source IS NOT NULL OR v_medium IS NOT NULL OR v_campaign IS NOT NULL
     OR v_term IS NOT NULL OR v_content IS NOT NULL THEN
    IF v_source IN ('tiktok', 'tt') THEN v_channel := 'tiktok';
    ELSIF v_source IN ('instagram', 'ig') THEN v_channel := 'instagram';
    ELSIF v_source IN ('facebook', 'fb', 'meta') THEN v_channel := 'facebook';
    ELSIF v_source = 'reddit' THEN v_channel := 'reddit';
    ELSIF v_source = 'google' THEN v_channel := CASE WHEN v_paid THEN 'google_ads' ELSE 'google' END;
    ELSIF v_source IN ('adwords', 'google_ads') THEN v_channel := 'google_ads';
    ELSIF v_source IN ('bing', 'duckduckgo', 'yahoo') THEN
      v_channel := CASE WHEN v_paid THEN v_source ELSE 'organic_search' END;
    ELSIF v_source IN ('twitter', 'x', 't.co') THEN v_channel := 'x';
    ELSIF v_source ~ '^[a-z0-9][a-z0-9_-]{0,63}$' THEN v_channel := v_source;
    ELSE v_channel := 'utm';
    END IF;
    v_source_label := COALESCE(v_source, v_medium, v_campaign, v_term, v_content);
    channel := v_channel;
    channel_source := left(v_source_label, 120);
    detected_via := 'utm';
    RETURN NEXT;
    RETURN;
  END IF;

  IF NULLIF(btrim(COALESCE(p_ttclid, '')), '') IS NOT NULL THEN
    channel := 'tiktok'; channel_source := 'ttclid'; detected_via := 'click_id';
    RETURN NEXT; RETURN;
  END IF;
  IF NULLIF(btrim(COALESCE(p_fbclid, '')), '') IS NOT NULL THEN
    IF NOT v_ignored AND v_bare ~ '(^|\.)instagram\.com$' THEN
      channel := 'instagram'; channel_source := v_host; detected_via := 'referrer';
      RETURN NEXT; RETURN;
    END IF;
    channel := 'facebook'; channel_source := 'fbclid'; detected_via := 'click_id';
    RETURN NEXT; RETURN;
  END IF;
  IF NULLIF(btrim(COALESCE(p_gclid, '')), '') IS NOT NULL THEN
    channel := 'google_ads'; channel_source := 'gclid'; detected_via := 'click_id';
    RETURN NEXT; RETURN;
  END IF;

  IF v_host IS NOT NULL AND NOT v_ignored THEN
    IF v_bare ~ '^google\.[a-z.]+$'
       OR v_bare ~ '(^|\.)bing\.com$'
       OR v_bare ~ '(^|\.)duckduckgo\.com$'
       OR v_bare ~ '(^|\.)yahoo\.[a-z.]+$' THEN
      channel := 'organic_search'; channel_source := v_host; detected_via := 'referrer';
      RETURN NEXT; RETURN;
    ELSIF v_bare ~ '(^|\.)tiktok\.com$' THEN
      channel := 'tiktok'; channel_source := v_host; detected_via := 'referrer';
      RETURN NEXT; RETURN;
    ELSIF v_bare ~ '(^|\.)instagram\.com$' THEN
      channel := 'instagram'; channel_source := v_host; detected_via := 'referrer';
      RETURN NEXT; RETURN;
    ELSIF v_bare IN ('facebook.com', 'l.facebook.com', 'lm.facebook.com', 'm.facebook.com')
       OR v_bare ~ '(^|\.)facebook\.com$' THEN
      channel := 'facebook'; channel_source := v_host; detected_via := 'referrer';
      RETURN NEXT; RETURN;
    ELSIF v_bare IN ('reddit.com', 'old.reddit.com', 'out.reddit.com')
       OR v_bare ~ '(^|\.)reddit\.com$' THEN
      channel := 'reddit'; channel_source := v_host; detected_via := 'referrer';
      RETURN NEXT; RETURN;
    ELSIF v_host = 't.co' OR v_bare IN ('x.com', 'twitter.com')
       OR v_bare ~ '(^|\.)twitter\.com$' OR v_bare ~ '(^|\.)x\.com$' THEN
      channel := 'x'; channel_source := v_host; detected_via := 'referrer';
      RETURN NEXT; RETURN;
    ELSE
      channel := 'referral'; channel_source := v_host; detected_via := 'referrer';
      RETURN NEXT; RETURN;
    END IF;
  END IF;

  IF COALESCE(p_native, false) THEN
    channel := 'ios_app';
    channel_source := 'ios';
    detected_via := 'native';
    RETURN NEXT;
    RETURN;
  END IF;

  channel := 'direct';
  channel_source := NULL;
  detected_via := 'direct';
  RETURN NEXT;
END;
$$;

DO $$
DECLARE
  r record;
BEGIN
  SELECT * INTO r FROM public.signup_classify_channel(
    NULL, NULL, NULL, NULL, NULL, 'https://l.instagram.com/reel/1', NULL, 'IwAR', NULL, false
  );
  IF r.channel <> 'instagram' OR r.detected_via <> 'referrer' THEN
    RAISE EXCEPTION 'instagram referrer did not beat fbclid: % %', r.channel, r.detected_via;
  END IF;

  SELECT * INTO r FROM public.signup_classify_channel(
    NULL, NULL, NULL, NULL, NULL, 'https://example.com/post', NULL, 'IwAR', NULL, false
  );
  IF r.channel <> 'facebook' OR r.detected_via <> 'click_id' THEN
    RAISE EXCEPTION 'fbclid without instagram was not facebook: %', r.channel;
  END IF;

  SELECT * INTO r FROM public.signup_classify_channel(
    NULL, NULL, NULL, NULL, NULL, 'https://accounts.google.com/o/oauth2/auth', NULL, NULL, NULL, false
  );
  IF r.channel <> 'direct' THEN
    RAISE EXCEPTION 'accounts.google.com was %', r.channel;
  END IF;

  SELECT * INTO r FROM public.signup_classify_channel(
    NULL, NULL, NULL, NULL, NULL, 'https://appleid.apple.com/auth', NULL, NULL, NULL, true
  );
  IF r.channel <> 'ios_app' OR r.detected_via <> 'native' THEN
    RAISE EXCEPTION 'appleid host hid the native label: % %', r.channel, r.detected_via;
  END IF;

  SELECT * INTO r FROM public.signup_classify_channel(
    NULL, NULL, NULL, NULL, NULL, 'https://abcdefgh.supabase.co/auth/v1/callback', NULL, NULL, NULL, false
  );
  IF r.channel <> 'direct' THEN
    RAISE EXCEPTION 'supabase host was %', r.channel;
  END IF;

  SELECT * INTO r FROM public.signup_classify_channel(
    NULL, NULL, NULL, NULL, NULL, 'https://checkout.stripe.com/c/pay/cs_test', NULL, NULL, NULL, false
  );
  IF r.channel <> 'direct' THEN
    RAISE EXCEPTION 'stripe checkout was %', r.channel;
  END IF;

  SELECT * INTO r FROM public.signup_classify_channel(
    NULL, NULL, NULL, NULL, NULL, 'https://preview.lovable.app/', NULL, NULL, NULL, false
  );
  IF r.channel <> 'direct' THEN
    RAISE EXCEPTION 'lovable host was %', r.channel;
  END IF;

  SELECT * INTO r FROM public.signup_classify_channel(
    NULL, NULL, NULL, NULL, NULL, 'https://example.com/post', NULL, NULL, NULL, true
  );
  IF r.channel <> 'referral' THEN
    RAISE EXCEPTION 'native overrode a real referrer: %', r.channel;
  END IF;

  SELECT * INTO r FROM public.signup_classify_channel(
    NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, true
  );
  IF r.channel <> 'ios_app' THEN
    RAISE EXCEPTION 'native direct visit was %', r.channel;
  END IF;

  SELECT * INTO r FROM public.signup_classify_channel(
    'TikTok', NULL, NULL, NULL, NULL, 'https://l.instagram.com/', NULL, 'IwAR', NULL, true
  );
  IF r.channel <> 'tiktok' OR r.detected_via <> 'utm' THEN
    RAISE EXCEPTION 'utm did not win: % %', r.channel, r.detected_via;
  END IF;
END $$;
