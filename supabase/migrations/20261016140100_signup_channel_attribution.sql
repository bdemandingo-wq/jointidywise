-- Detected signup channel, beside the self-reported howHeard answer.
--
-- Adds channel, channel_source, detected_via, gclid, fbclid, and ttclid to
-- account_signup_attribution. save_signup_attribution stores labels only.
-- The raw user agent is not a column and is not accepted as a parameter.
--
-- Run after:
--   20261014230000_activation_tracking_and_signup_utm.sql
--   20261016050000_platform_account_metrics.sql
--   20261016140000_save_how_heard.sql
-- This file does not send email, SMS, or push, and it does not touch Stripe.
--
-- Verification:
--   1. select column_name from information_schema.columns
--      where table_schema = 'public' and table_name = 'account_signup_attribution'
--        and column_name in ('channel','channel_source','detected_via','gclid','fbclid','ttclid')
--      order by column_name;
--      -- six rows
--   2. select utm_source, referrer, channel from public.account_signup_attribution
--      where utm_source = 'direct' and utm_source_raw is null and referrer is not null
--        and referrer !~ '(^|\.)jointidywise\.com$';
--      -- zero rows: a real referrer is no longer labeled direct
--   3. select channel, detected_via, count(*) from public.account_signup_attribution
--      group by 1, 2 order by 3 desc;
--   4. select how_heard, how_heard_other, channel, detected_via
--      from public.platform_account_metrics(5, 0);
--      -- platform admin only; how_heard_other is the free-text answer

ALTER TABLE public.account_signup_attribution
  ADD COLUMN IF NOT EXISTS channel text,
  ADD COLUMN IF NOT EXISTS channel_source text,
  ADD COLUMN IF NOT EXISTS detected_via text,
  ADD COLUMN IF NOT EXISTS gclid text,
  ADD COLUMN IF NOT EXISTS fbclid text,
  ADD COLUMN IF NOT EXISTS ttclid text;

COMMENT ON COLUMN public.account_signup_attribution.channel IS
  'Classified label: tiktok, instagram, facebook, reddit, google, google_ads, organic_search, x, direct, referral, ios_app, or a utm slug. Never a user agent.';
COMMENT ON COLUMN public.account_signup_attribution.channel_source IS
  'Short label for what matched (utm source, ttclid/fbclid/gclid, TikTok/Instagram/Facebook/Reddit, or referrer host). Never a user agent.';
COMMENT ON COLUMN public.account_signup_attribution.detected_via IS
  'utm, click_id, user_agent, referrer, native, or direct.';
COMMENT ON COLUMN public.account_signup_attribution.gclid IS
  'Google click id, capped. Null when the landing had none.';
COMMENT ON COLUMN public.account_signup_attribution.fbclid IS
  'Facebook click id, capped. Null when the landing had none.';
COMMENT ON COLUMN public.account_signup_attribution.ttclid IS
  'TikTok click id, capped. Null when the landing had none.';

-- Keep in sync with classifyChannel() in src/lib/utmAttribution.ts.
-- No user-agent argument: the browser turns that into a label before calling save.
CREATE OR REPLACE FUNCTION public.signup_classify_channel(
  p_utm_source text,
  p_utm_medium text,
  p_utm_campaign text,
  p_utm_term text,
  p_utm_content text,
  p_referrer text,
  p_gclid text,
  p_fbclid text,
  p_ttclid text
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
  v_bare text;
  v_paid boolean;
  v_channel text;
  v_source_label text;
BEGIN
  v_paid := v_medium IN ('cpc', 'ppc', 'paid', 'paidsocial', 'paid_social', 'cpm', 'cpa', 'display', 'ads');

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
    channel := 'facebook'; channel_source := 'fbclid'; detected_via := 'click_id';
    RETURN NEXT; RETURN;
  END IF;
  IF NULLIF(btrim(COALESCE(p_gclid, '')), '') IS NOT NULL THEN
    channel := 'google_ads'; channel_source := 'gclid'; detected_via := 'click_id';
    RETURN NEXT; RETURN;
  END IF;

  v_bare := regexp_replace(COALESCE(v_host, ''), '^www\.', '');

  IF v_host IS NOT NULL THEN
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
    ELSIF v_bare <> 'jointidywise.com' AND right(v_bare, 17) <> '.jointidywise.com' THEN
      channel := 'referral'; channel_source := v_host; detected_via := 'referrer';
      RETURN NEXT; RETURN;
    END IF;
  END IF;

  channel := 'direct';
  channel_source := NULL;
  detected_via := 'direct';
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.signup_classify_channel(text, text, text, text, text, text, text, text, text)
  FROM PUBLIC, anon, authenticated;

DROP FUNCTION IF EXISTS public.save_signup_attribution(text, text, text, text, text, text, text, timestamptz);

CREATE OR REPLACE FUNCTION public.save_signup_attribution(
  p_utm_source text DEFAULT NULL,
  p_utm_medium text DEFAULT NULL,
  p_utm_campaign text DEFAULT NULL,
  p_utm_term text DEFAULT NULL,
  p_utm_content text DEFAULT NULL,
  p_referrer text DEFAULT NULL,
  p_landing_page text DEFAULT NULL,
  p_captured_at timestamptz DEFAULT NULL,
  p_channel text DEFAULT NULL,
  p_channel_source text DEFAULT NULL,
  p_detected_via text DEFAULT NULL,
  p_gclid text DEFAULT NULL,
  p_fbclid text DEFAULT NULL,
  p_ttclid text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_created timestamptz;
  v_landing timestamptz;
  v_source_raw text;
  v_medium_raw text;
  v_campaign_raw text;
  v_term_raw text;
  v_content_raw text;
  v_org uuid;
  v_channel text;
  v_channel_source text;
  v_detected_via text;
  v_utm_source text;
  v_client_via text := lower(btrim(COALESCE(p_detected_via, '')));
  v_client_channel text := lower(btrim(COALESCE(p_channel, '')));
BEGIN
  IF v_uid IS NULL THEN
    RETURN;
  END IF;

  v_landing := COALESCE(p_captured_at, now());
  SELECT p.created_at INTO v_created FROM public.profiles p WHERE p.id = v_uid;
  IF v_created IS NOT NULL AND v_landing > v_created + interval '1 hour' THEN
    RETURN;
  END IF;
  IF v_created IS NOT NULL AND v_created < now() - interval '120 days' THEN
    RETURN;
  END IF;
  IF v_landing > now() + interval '5 minutes' OR v_landing < now() - interval '120 days' THEN
    v_landing := now();
  END IF;

  v_source_raw := public.utm_raw_or_null(p_utm_source);
  v_medium_raw := public.utm_raw_or_null(p_utm_medium);
  v_campaign_raw := public.utm_raw_or_null(p_utm_campaign);
  v_term_raw := public.utm_raw_or_null(p_utm_term);
  v_content_raw := public.utm_raw_or_null(p_utm_content);

  SELECT c.channel, c.channel_source, c.detected_via
    INTO v_channel, v_channel_source, v_detected_via
  FROM public.signup_classify_channel(
    v_source_raw,
    v_medium_raw,
    v_campaign_raw,
    v_term_raw,
    v_content_raw,
    p_referrer,
    p_gclid,
    p_fbclid,
    p_ttclid
  ) AS c;

  -- The database never sees the user agent. Trust only an allowlisted label
  -- for the two signals it cannot recompute, and only when UTM and click ids
  -- did not already classify the visit.
  IF v_detected_via NOT IN ('utm', 'click_id') THEN
    IF v_client_via = 'user_agent' AND v_client_channel IN ('tiktok', 'instagram', 'facebook', 'reddit') THEN
      v_channel := v_client_channel;
      v_channel_source := CASE v_client_channel
        WHEN 'tiktok' THEN 'TikTok'
        WHEN 'instagram' THEN 'Instagram'
        WHEN 'facebook' THEN 'Facebook'
        ELSE 'Reddit'
      END;
      v_detected_via := 'user_agent';
    ELSIF v_client_via = 'native' AND v_client_channel = 'ios_app' THEN
      v_channel := 'ios_app';
      v_channel_source := 'ios';
      v_detected_via := 'native';
    END IF;
  END IF;

  -- 'direct' is only the normalized source when nothing else identified the visit.
  v_utm_source := public.normalize_utm_value(v_source_raw);
  IF v_utm_source IS NULL THEN
    IF v_channel IS NOT NULL AND v_channel <> 'direct' THEN
      v_utm_source := left(v_channel, 64);
    ELSE
      v_utm_source := 'direct';
    END IF;
  END IF;

  BEGIN
    INSERT INTO public.account_signup_attribution (
      user_id,
      utm_source_raw,
      utm_source,
      utm_medium_raw,
      utm_medium,
      utm_campaign_raw,
      utm_campaign,
      utm_term_raw,
      utm_term,
      utm_content_raw,
      utm_content,
      referrer,
      landing_page,
      captured_at,
      channel,
      channel_source,
      detected_via,
      gclid,
      fbclid,
      ttclid
    ) VALUES (
      v_uid,
      v_source_raw,
      v_utm_source,
      v_medium_raw,
      public.normalize_utm_value(v_medium_raw),
      v_campaign_raw,
      public.normalize_utm_value(v_campaign_raw),
      v_term_raw,
      public.normalize_utm_value(v_term_raw),
      v_content_raw,
      public.normalize_utm_value(v_content_raw),
      public.signup_referrer_domain(p_referrer),
      public.signup_landing_path(p_landing_page),
      v_landing,
      left(v_channel, 64),
      left(v_channel_source, 120),
      left(v_detected_via, 32),
      NULLIF(left(btrim(COALESCE(p_gclid, '')), 200), ''),
      NULLIF(left(btrim(COALESCE(p_fbclid, '')), 200), ''),
      NULLIF(left(btrim(COALESCE(p_ttclid, '')), 200), '')
    )
    ON CONFLICT (user_id) DO NOTHING;
  EXCEPTION WHEN OTHERS THEN
    PERFORM public.activation_log_warning(NULL, NULL, 'save_signup_attribution', SQLERRM);
    RETURN;
  END;

  BEGIN
    SELECT linked.organization_id INTO v_org
    FROM (
      SELECT o.id AS organization_id, o.created_at
      FROM public.organizations o
      WHERE o.owner_id = v_uid
      UNION ALL
      SELECT m.organization_id, m.created_at
      FROM public.org_memberships m
      WHERE m.user_id = v_uid
    ) linked
    ORDER BY linked.created_at ASC
    LIMIT 1;

    IF v_org IS NOT NULL THEN
      UPDATE public.account_signup_attribution
      SET organization_id = v_org,
          updated_at = now()
      WHERE user_id = v_uid
        AND organization_id IS NULL;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    PERFORM public.activation_log_warning(v_org, NULL, 'save_signup_attribution.org', SQLERRM);
  END;
END;
$$;

REVOKE ALL ON FUNCTION public.save_signup_attribution(
  text, text, text, text, text, text, text, timestamptz, text, text, text, text, text, text
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_signup_attribution(
  text, text, text, text, text, text, text, timestamptz, text, text, text, text, text, text
) TO authenticated;

COMMENT ON FUNCTION public.save_signup_attribution(
  text, text, text, text, text, text, text, timestamptz, text, text, text, text, text, text
) IS
  'First-touch signup attribution. Stores UTM, referrer host, landing path, click ids, and classified channel labels. Does not store a user agent. utm_source is direct only when no source and no external referrer were identified.';

-- Backfill channel from the signals already stored. A row whose normalized
-- source was forced to direct, with no raw utm_source, takes the classified
-- channel instead whenever a referrer (or other signal) identified one.
UPDATE public.account_signup_attribution AS a
SET
  channel = c.channel,
  channel_source = c.channel_source,
  detected_via = c.detected_via,
  utm_source = CASE
    WHEN a.utm_source = 'direct'
      AND a.utm_source_raw IS NULL
      AND c.channel IS DISTINCT FROM 'direct'
    THEN c.channel
    ELSE a.utm_source
  END,
  updated_at = now()
FROM (
  SELECT
    s.user_id,
    x.channel,
    x.channel_source,
    x.detected_via
  FROM public.account_signup_attribution AS s
  CROSS JOIN LATERAL public.signup_classify_channel(
    s.utm_source_raw,
    s.utm_medium_raw,
    s.utm_campaign_raw,
    s.utm_term_raw,
    s.utm_content_raw,
    s.referrer,
    s.gclid,
    s.fbclid,
    s.ttclid
  ) AS x
) AS c
WHERE a.user_id = c.user_id
  AND a.channel IS NULL;

-- ---------------------------------------------------------------------------
-- The view. security_invoker so a stray GRANT still runs as the caller.
-- Grants below remove anon, authenticated, and service_role.
-- CREATE OR REPLACE cannot change a view's column list. Drop any copy
-- created from an earlier run of this migration first. CASCADE also drops
-- platform_account_metrics(), which is recreated below.
-- ---------------------------------------------------------------------------

DROP VIEW IF EXISTS public.platform_account_metrics_v CASCADE;

CREATE OR REPLACE VIEW public.platform_account_metrics_v
WITH (security_invoker = true) AS
WITH chosen_sub AS (
  SELECT DISTINCT ON (s.organization_id)
    s.organization_id,
    s.stripe_subscription_id,
    s.status,
    s.plan,
    s.billing_interval,
    s.interval_count,
    s.unit_amount_cents,
    s.quantity,
    s.discount_amount_cents,
    s.discount_percent,
    s.discount_known,
    s.trial_end,
    s.canceled_at,
    s.cancel_at_period_end,
    s.current_period_end,
    s.updated_at
  FROM public.stripe_subscriptions s
  ORDER BY s.organization_id,
    CASE s.status
      WHEN 'active' THEN 0
      WHEN 'trialing' THEN 1
      WHEN 'past_due' THEN 2
      WHEN 'unpaid' THEN 3
      WHEN 'paused' THEN 4
      WHEN 'canceled' THEN 5
      WHEN 'cancelled' THEN 5
      WHEN 'incomplete' THEN 6
      WHEN 'incomplete_expired' THEN 7
      ELSE 8
    END,
    CASE
      WHEN lower(coalesce(s.plan, '')) = 'lifetime'
        OR starts_with(coalesce(s.stripe_subscription_id, ''), 'lifetime_')
      THEN 1 ELSE 0
    END,
    s.updated_at DESC NULLS LAST,
    s.id
),
activation AS (
  SELECT
    e.organization_id,
    COALESCE(
      jsonb_object_agg(e.milestone, e.occurred_at ORDER BY e.milestone),
      '{}'::jsonb
    ) AS activation_milestones
  FROM (
    SELECT organization_id, milestone, max(occurred_at) AS occurred_at
    FROM public.organization_activation_events
    GROUP BY organization_id, milestone
  ) e
  GROUP BY e.organization_id
),
latest_activation AS (
  SELECT DISTINCT ON (e.organization_id)
    e.organization_id,
    e.milestone AS latest_milestone,
    e.occurred_at AS latest_milestone_at
  FROM public.organization_activation_events e
  ORDER BY e.organization_id, e.occurred_at DESC, e.created_at DESC, e.milestone
),
period_price AS (
  SELECT DISTINCT ON (p.organization_id)
    p.organization_id,
    p.unit_amount_cents,
    p.quantity,
    p.billing_interval,
    p.interval_count,
    p.discount_percent,
    p.discount_amount_cents
  FROM public.billing_subscription_periods p
  WHERE p.revenue_stream = 'plan'
    AND p.organization_id IS NOT NULL
  ORDER BY p.organization_id,
    (p.effective_to IS NULL) DESC,
    p.effective_from DESC,
    p.id
),
period_cancel AS (
  SELECT DISTINCT ON (p.organization_id)
    p.organization_id,
    p.effective_to
  FROM public.billing_subscription_periods p
  WHERE p.revenue_stream = 'plan'
    AND p.organization_id IS NOT NULL
    AND p.effective_to IS NOT NULL
    AND p.cancellation_reason IS NOT NULL
  ORDER BY p.organization_id, p.effective_to DESC, p.id
),
feedback_cancel AS (
  SELECT f.organization_id, max(f.canceled_at) AS canceled_at
  FROM public.cancellation_feedback f
  WHERE f.organization_id IS NOT NULL
  GROUP BY f.organization_id
),
refund_rows AS (
  SELECT organization_id, refunded_at, refund_kind
  FROM (
    SELECT
      COALESCE(r.organization_id, linked.organization_id) AS organization_id,
      r.refunded_at,
      CASE
        WHEN r.refund_kind IN ('subscription', 'lifetime') THEN r.refund_kind
        ELSE NULL
      END AS refund_kind
    FROM public.platform_subscription_refunds r
    LEFT JOIN LATERAL (
      SELECT s.organization_id
      FROM public.stripe_subscriptions s
      WHERE r.organization_id IS NULL
        AND r.stripe_customer_id IS NOT NULL
        AND s.stripe_customer_id = r.stripe_customer_id
      ORDER BY s.updated_at DESC NULLS LAST, s.id
      LIMIT 1
    ) linked ON true
    WHERE NOT (
      r.stripe_refund_id LIKE '%:unitemized'
      AND EXISTS (
        SELECT 1
        FROM public.platform_subscription_refunds newer
        WHERE newer.stripe_charge_id = r.stripe_charge_id
          AND newer.stripe_refund_id <> r.stripe_refund_id
          AND newer.stripe_refund_id NOT LIKE '%:unitemized'
      )
    )
    UNION ALL
    SELECT
      be.organization_id,
      be.occurred_at,
      CASE
        WHEN COALESCE(be.revenue_stream_corrected, be.revenue_stream) = 'lifetime' THEN 'lifetime'
        ELSE 'subscription'
      END
    FROM public.billing_events be
    WHERE be.event_type = 'charge.refunded'
      AND be.organization_id IS NOT NULL
      AND COALESCE(be.revenue_stream_corrected, be.revenue_stream) IN ('plan', 'lifetime')
  ) raw
  WHERE organization_id IS NOT NULL
    AND refunded_at IS NOT NULL
),
refunds AS (
  SELECT
    d.organization_id,
    array_agg(d.refunded_at ORDER BY d.refunded_at) AS refund_dates,
    COALESCE(array_agg(d.refunded_at ORDER BY d.refunded_at) FILTER (WHERE d.refund_kind = 'subscription'), ARRAY[]::timestamptz[]) AS subscription_refund_dates,
    COALESCE(array_agg(d.refunded_at ORDER BY d.refunded_at) FILTER (WHERE d.refund_kind = 'lifetime'), ARRAY[]::timestamptz[]) AS lifetime_refund_dates
  FROM (
    SELECT DISTINCT organization_id, refunded_at, refund_kind FROM refund_rows
  ) d
  GROUP BY d.organization_id
),
org_core AS (
  SELECT
    o.id AS organization_id,
    o.name AS organization_name,
    owner.email AS owner_email,
    o.created_at AS signup_at,
    o.plan_type AS org_plan_type,
    o.last_login_at,
    CASE
      WHEN jsonb_typeof(o.onboarding_answers -> 'howHeard') = 'array' THEN (
        SELECT NULLIF(string_agg(
          CASE WHEN jsonb_typeof(elem) = 'string' THEN elem #>> '{}' ELSE NULL END,
          ', ' ORDER BY ord
        ), '')
        FROM jsonb_array_elements(o.onboarding_answers -> 'howHeard') WITH ORDINALITY AS heard(elem, ord)
      )
      WHEN jsonb_typeof(o.onboarding_answers -> 'howHeard') = 'string'
        THEN NULLIF(o.onboarding_answers ->> 'howHeard', '')
      ELSE NULL
    END AS how_heard,
    NULLIF(left(btrim(COALESCE(o.onboarding_answers ->> 'howHeardOther', '')), 200), '') AS how_heard_other,
    attr.utm_source,
    attr.utm_medium,
    attr.utm_campaign,
    attr.referrer,
    attr.channel,
    attr.channel_source,
    attr.detected_via,
    s.status AS stripe_subscription_status,
    s.stripe_subscription_id,
    s.plan AS sub_plan,
    s.billing_interval AS sub_billing_interval,
    s.interval_count AS sub_interval_count,
    s.unit_amount_cents AS sub_unit_amount_cents,
    s.quantity AS sub_quantity,
    s.discount_amount_cents AS sub_discount_amount_cents,
    s.discount_percent AS sub_discount_percent,
    COALESCE(s.discount_known, false) AS sub_discount_known,
    s.trial_end AS sub_trial_end,
    s.canceled_at AS sub_canceled_at,
    COALESCE(s.cancel_at_period_end, false) AS cancel_at_period_end,
    s.current_period_end,
    owner.trial_ends_at AS profile_trial_ends_at,
    per.unit_amount_cents AS period_unit_amount_cents,
    per.quantity AS period_quantity,
    per.billing_interval AS period_billing_interval,
    per.interval_count AS period_interval_count,
    per.discount_percent AS period_discount_percent,
    per.discount_amount_cents AS period_discount_amount_cents,
    l.applied_discount_cents::bigint AS loyalty_discount_cents,
    pc.effective_to AS period_canceled_at,
    fb.canceled_at AS feedback_canceled_at,
    COALESCE(act.activation_milestones, '{}'::jsonb) AS activation_milestones,
    latest.latest_milestone,
    latest.latest_milestone_at,
    COALESCE(rf.refund_dates, ARRAY[]::timestamptz[]) AS refund_dates,
    COALESCE(rf.subscription_refund_dates, ARRAY[]::timestamptz[]) AS subscription_refund_dates,
    COALESCE(rf.lifetime_refund_dates, ARRAY[]::timestamptz[]) AS lifetime_refund_dates,
    (
      -- A real paying subscription is not a demo org. Lifetime is excluded
      -- because a demo account can carry a synthetic lifetime row.
      -- is_test on the org or its pricing settings still flags the row.
      -- activation_subject_is_demo itself is unchanged.
      (
        CASE
          WHEN s.status IN ('active', 'past_due')
            AND NOT (
              o.grandfathered_lifetime IS TRUE
              OR lower(coalesce(o.plan_type, '')) = 'lifetime'
              OR lower(coalesce(s.plan, '')) = 'lifetime'
              OR starts_with(coalesce(s.stripe_subscription_id, ''), 'lifetime_')
            )
          THEN false
          ELSE public.activation_subject_is_demo(o.id)
        END
      )
      OR public.jsonb_flag_true(to_jsonb(o), 'is_test')
      OR COALESCE((
        SELECT public.jsonb_flag_true(to_jsonb(ps), 'is_test')
        FROM public.organization_pricing_settings ps
        WHERE ps.organization_id = o.id
      ), false)
    ) AS is_demo_or_test,
    (
      o.grandfathered_lifetime IS TRUE
      OR lower(coalesce(o.plan_type, '')) = 'lifetime'
      OR lower(coalesce(s.plan, '')) = 'lifetime'
      OR starts_with(coalesce(s.stripe_subscription_id, ''), 'lifetime_')
    ) AS is_lifetime
  FROM public.organizations o
  LEFT JOIN public.profiles owner ON owner.id = o.owner_id
  LEFT JOIN chosen_sub s ON s.organization_id = o.id
  LEFT JOIN public.org_subscription_loyalty l ON l.organization_id = o.id
  LEFT JOIN period_price per ON per.organization_id = o.id
  LEFT JOIN period_cancel pc ON pc.organization_id = o.id
  LEFT JOIN feedback_cancel fb ON fb.organization_id = o.id
  LEFT JOIN activation act ON act.organization_id = o.id
  LEFT JOIN latest_activation latest ON latest.organization_id = o.id
  LEFT JOIN refunds rf ON rf.organization_id = o.id
  LEFT JOIN LATERAL (
    SELECT a.utm_source, a.utm_medium, a.utm_campaign, a.referrer, a.channel, a.channel_source, a.detected_via
    FROM public.account_signup_attribution a
    WHERE a.organization_id = o.id
       OR (a.user_id = o.owner_id AND a.organization_id IS NULL)
    ORDER BY (a.organization_id = o.id) DESC, a.captured_at ASC
    LIMIT 1
  ) attr ON true
),
priced AS (
  SELECT
    c.*,
    CASE
      WHEN c.is_lifetime THEN 'lifetime'
      -- Known Stripe coupon, including a known zero. Loyalty is not applied
      -- again: the expanded coupon is already the amount off the invoice.
      WHEN c.sub_unit_amount_cents IS NOT NULL AND c.sub_discount_known THEN 'stripe'
      -- Coupon id was not expanded. Monthly Basic/Pro loyalty is an amount-off
      -- coupon we stored ourselves. Subtract that once. Do not also use the
      -- unreadable Stripe discount fields (they are null).
      WHEN c.sub_unit_amount_cents IS NOT NULL
        AND NOT c.sub_discount_known
        AND c.loyalty_discount_cents IS NOT NULL
        AND c.loyalty_discount_cents > 0
        AND lower(coalesce(nullif(c.sub_plan, ''), nullif(c.org_plan_type, ''), '')) IN ('basic', 'pro')
        AND lower(coalesce(c.sub_billing_interval, '')) IN ('month', 'monthly')
        AND GREATEST(COALESCE(NULLIF(c.sub_interval_count, 0), 1), 1) = 1
        THEN 'loyalty'
      -- Some other unread coupon. Leave the price null rather than treating
      -- the list price, or a zero loyalty row, as money collected.
      WHEN c.sub_unit_amount_cents IS NOT NULL AND NOT c.sub_discount_known THEN 'unknown_discount'
      -- Period rows already store list price and the coupon separately.
      -- Do not subtract loyalty on top of that coupon.
      WHEN c.period_unit_amount_cents IS NOT NULL THEN 'period'
      ELSE 'none'
    END AS price_mode
  FROM org_core c
)
SELECT
  p.organization_id,
  p.organization_name,
  p.owner_email,
  p.signup_at,
  CASE
    WHEN p.is_lifetime THEN 'not_applicable'
    WHEN p.stripe_subscription_status = 'trialing' THEN 'stripe_trialing'
    WHEN p.stripe_subscription_status IN ('active', 'past_due') THEN 'not_on_trial'
    WHEN p.profile_trial_ends_at IS NOT NULL
      AND p.profile_trial_ends_at > now()
      AND lower(coalesce(p.org_plan_type, 'trial')) IN ('trial', 'free', '')
      THEN 'card_free_trial'
    WHEN p.profile_trial_ends_at IS NOT NULL
      AND p.profile_trial_ends_at <= now()
      AND (p.stripe_subscription_status IS NULL OR p.stripe_subscription_status IN ('canceled', 'cancelled', 'incomplete', 'incomplete_expired', 'unpaid', 'paused'))
      AND lower(coalesce(p.org_plan_type, '')) IN ('trial', 'free', '')
      THEN 'trial_ended'
    ELSE 'none'
  END AS trial_status,
  CASE
    WHEN p.stripe_subscription_status = 'trialing' AND p.sub_trial_end IS NOT NULL THEN p.sub_trial_end
    ELSE p.profile_trial_ends_at
  END AS trial_ends_at,
  CASE
    WHEN p.stripe_subscription_status = 'trialing' AND p.sub_trial_end IS NOT NULL THEN 'stripe_subscription'
    WHEN p.profile_trial_ends_at IS NOT NULL THEN 'profile'
    ELSE NULL
  END AS trial_end_source,
  p.latest_milestone,
  p.latest_milestone_at,
  p.activation_milestones,
  p.last_login_at,
  p.how_heard,
  p.utm_source,
  p.utm_medium,
  p.utm_campaign,
  p.referrer,
  p.stripe_subscription_status,
  p.stripe_subscription_status AS subscription_status,
  p.stripe_subscription_id,
  CASE
    WHEN p.is_lifetime THEN 'Lifetime'
    WHEN lower(coalesce(nullif(p.sub_plan, ''), nullif(p.org_plan_type, ''), '')) = 'basic' THEN 'Basic'
    WHEN lower(coalesce(nullif(p.sub_plan, ''), nullif(p.org_plan_type, ''), '')) = 'pro' THEN 'Pro'
    WHEN lower(coalesce(nullif(p.sub_plan, ''), nullif(p.org_plan_type, ''), '')) = 'custom' THEN 'Custom'
    ELSE NULL
  END AS plan,
  p.is_lifetime,
  COALESCE(p.sub_billing_interval, p.period_billing_interval) AS billing_interval,
  CASE
    WHEN p.is_lifetime THEN NULL
    ELSE price.monthly_amount_cents
  END AS monthly_amount_cents,
  CASE
    WHEN p.is_lifetime THEN 'lifetime_excluded'
    WHEN p.price_mode = 'unknown_discount' THEN 'discount_unknown'
    WHEN p.price_mode = 'none' THEN NULL
    ELSE price.amount_basis
  END AS monthly_amount_basis,
  CASE p.price_mode
    WHEN 'stripe' THEN 'stripe_subscription'
    WHEN 'loyalty' THEN 'stripe_subscription_loyalty_discount'
    WHEN 'period' THEN 'billing_subscription_period'
    ELSE NULL
  END AS monthly_amount_source,
  CASE
    WHEN p.is_lifetime THEN NULL
    WHEN p.stripe_subscription_status IN ('active', 'past_due') THEN price.monthly_amount_cents
    ELSE NULL
  END AS mrr_cents,
  (
    p.is_lifetime IS NOT TRUE
    AND p.stripe_subscription_status IN ('active', 'past_due')
    AND price.monthly_amount_cents IS NOT NULL
  ) AS counts_toward_mrr,
  p.loyalty_discount_cents,
  CASE
    WHEN p.sub_canceled_at IS NOT NULL THEN p.sub_canceled_at
    WHEN p.period_canceled_at IS NOT NULL THEN p.period_canceled_at
    ELSE p.feedback_canceled_at
  END AS canceled_at,
  CASE
    WHEN p.sub_canceled_at IS NOT NULL THEN 'stripe_subscription'
    WHEN p.period_canceled_at IS NOT NULL THEN 'billing_subscription_period'
    WHEN p.feedback_canceled_at IS NOT NULL THEN 'cancellation_feedback'
    ELSE NULL
  END AS cancellation_source,
  p.cancel_at_period_end,
  CASE
    WHEN p.cancel_at_period_end AND p.current_period_end IS NOT NULL THEN p.current_period_end
    ELSE NULL
  END AS cancel_scheduled_for,
  p.refund_dates,
  p.subscription_refund_dates,
  p.lifetime_refund_dates,
  p.is_demo_or_test,
  p.how_heard_other,
  p.channel,
  p.channel_source,
  p.detected_via
FROM priced p
JOIN LATERAL public.platform_monthly_billed_cents(
  CASE p.price_mode
    WHEN 'stripe' THEN p.sub_unit_amount_cents
    WHEN 'loyalty' THEN p.sub_unit_amount_cents
    WHEN 'period' THEN p.period_unit_amount_cents
    ELSE NULL
  END,
  CASE p.price_mode
    WHEN 'stripe' THEN p.sub_quantity
    WHEN 'loyalty' THEN p.sub_quantity
    WHEN 'period' THEN p.period_quantity
    ELSE NULL
  END,
  CASE p.price_mode
    WHEN 'stripe' THEN p.sub_billing_interval
    WHEN 'loyalty' THEN p.sub_billing_interval
    WHEN 'period' THEN p.period_billing_interval
    ELSE NULL
  END,
  CASE p.price_mode
    WHEN 'stripe' THEN p.sub_interval_count
    WHEN 'loyalty' THEN p.sub_interval_count
    WHEN 'period' THEN p.period_interval_count
    ELSE NULL
  END,
  CASE p.price_mode
    WHEN 'stripe' THEN p.sub_discount_percent
    WHEN 'period' THEN p.period_discount_percent
    ELSE NULL
  END,
  CASE p.price_mode
    WHEN 'stripe' THEN COALESCE(p.sub_discount_amount_cents, 0)
    WHEN 'loyalty' THEN p.loyalty_discount_cents
    WHEN 'period' THEN COALESCE(p.period_discount_amount_cents, 0)
    ELSE NULL
  END
) price ON true;

COMMENT ON VIEW public.platform_account_metrics_v IS
  'One row per organization for platform admins. Do not grant this view. Read it through public.platform_account_metrics(). monthly_amount_cents and mrr_cents are the collected amount after one loyalty or Stripe coupon, never both. An annual plan is that invoice divided by 12 in both columns. mrr_cents is null for lifetime, trials, canceled subscriptions, and rows whose price is not stored. subscription_status is the raw Stripe status. Activation milestone timestamps are not copied into mrr_cents. A non-lifetime active or past_due subscription is not demo. An is_test flag still sets is_demo_or_test. Other demo orgs stay in the result with is_demo_or_test true. how_heard_other is the free-text answer. channel, channel_source, and detected_via are the classified visit, never a raw user agent.';

REVOKE ALL ON public.platform_account_metrics_v FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Admin-gated reader. Authenticated may execute it; the body checks the caller.
-- RETURNS SETOF public.platform_account_metrics_v: each row is one view row.
-- The view itself stays revoked. This function is the only reader.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.platform_account_metrics(
  p_limit integer DEFAULT 1000,
  p_offset integer DEFAULT 0
) RETURNS SETOF public.platform_account_metrics_v
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  IF COALESCE(public.is_platform_admin(), false) IS NOT TRUE THEN
    RAISE EXCEPTION 'platform admin only'
      USING ERRCODE = '42501';
  END IF;

  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 1000 THEN
    RAISE EXCEPTION 'p_limit must be between 1 and 1000'
      USING ERRCODE = '22023';
  END IF;

  IF p_offset IS NULL OR p_offset < 0 THEN
    RAISE EXCEPTION 'p_offset must be >= 0'
      USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  SELECT *
  FROM public.platform_account_metrics_v v
  ORDER BY v.signup_at DESC, v.organization_id
  LIMIT p_limit
  OFFSET p_offset;
END;
$fn$;

REVOKE ALL ON FUNCTION public.platform_account_metrics(integer, integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.platform_account_metrics(integer, integer) TO authenticated;

COMMENT ON FUNCTION public.platform_account_metrics(integer, integer) IS
  'RETURNS SETOF public.platform_account_metrics_v. Platform-admin account metrics. Raises 42501 for every other caller. Pages are at most 1000 rows, ordered by signup_at desc, organization_id. Does not call Stripe.';

-- Re-revoke in case a default privilege re-granted the view.
REVOKE ALL ON public.platform_account_metrics_v FROM PUBLIC, anon, authenticated, service_role;
