-- New signups get exactly 30 days.
--
-- Writers of profiles.trial_ends_at / the trial length, and what this does:
--   * public.handle_new_user — INSERT now() + 30 days. Replaces the 14-day
--     body in 20260731124226 (and the 7-day body in 20260625042915) if the
--     30-day replace in 20261013340000 never landed on the live database.
--   * profiles.trial_ends_at column default — now() + 30 days. Replaces the
--     14-day default in 20260819165728.
--   * check-subscription and provision-trial-org — fill a null stamp with
--     created_at + 30 days, and lengthen a shorter stamp. They do not
--     shorten. This migration is the backfill for rows already stored.
--   * onboarding-winback — extends to created_at + 30 days only after the
--     trial_30 offer is accepted, and only when that is later. Unchanged.
--   * 20260625042915 — historical backfill of null stamps to created_at + 7
--     days. It does not run again.
--   * 20261013200000_card_free_trial_reminders — reminder log and cron only.
--     It does not write trial_ends_at, plan_type, or any Stripe subscription.
--   * create-subscription trial_period_days = 14 — Stripe Checkout for an
--     account that already has a non-trial plan. It does not write
--     profiles.trial_ends_at. Anonymous first checkout is already 30 days.
--     An org trial sends the profile timestamp as trial_end.
--
-- Backfill: orgs created in the last 30 days whose trial end is missing or
-- earlier than that org's created_at + 30 days. Extend only. A longer end
-- is not moved. Paying orgs are skipped: paid plan_type, lifetime /
-- grandfathered, a lifetime purchase, a live Stripe subscription row, an
-- active comp, or a positive plan cash event.

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

-- Used only by the backfill below, then dropped. Not granted to clients.
CREATE OR REPLACE FUNCTION public.org_has_paid_access(_org_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  paying boolean := false;
BEGIN
  -- to_jsonb so a missing grandfathered_lifetime column does not abort the backfill.
  SELECT
    COALESCE((to_jsonb(o) ->> 'grandfathered_lifetime')::boolean, false)
    OR COALESCE(o.plan_type, '') IN ('basic', 'pro', 'custom', 'standard', 'lifetime', 'enterprise')
  INTO paying
  FROM public.organizations o
  WHERE o.id = _org_id;

  IF COALESCE(paying, false) THEN
    RETURN true;
  END IF;

  IF to_regclass('public.lifetime_access_purchases') IS NOT NULL THEN
    EXECUTE $q$
      SELECT EXISTS (
        SELECT 1 FROM public.lifetime_access_purchases lap
        WHERE lap.organization_id = $1
      )
    $q$ INTO paying USING _org_id;
    IF paying THEN RETURN true; END IF;
  END IF;

  IF to_regclass('public.stripe_subscriptions') IS NOT NULL THEN
    EXECUTE $q$
      SELECT EXISTS (
        SELECT 1 FROM public.stripe_subscriptions s
        WHERE s.organization_id = $1
          AND s.status IN ('active', 'trialing', 'past_due', 'unpaid')
      )
    $q$ INTO paying USING _org_id;
    IF paying THEN RETURN true; END IF;
  END IF;

  IF to_regclass('public.comped_access') IS NOT NULL THEN
    EXECUTE $q$
      SELECT EXISTS (
        SELECT 1 FROM public.comped_access c
        WHERE c.organization_id = $1
          AND c.revoked_at IS NULL
          AND c.expires_at > now()
      )
    $q$ INTO paying USING _org_id;
    IF paying THEN RETURN true; END IF;
  END IF;

  IF to_regclass('public.billing_events') IS NOT NULL THEN
    EXECUTE $q$
      SELECT EXISTS (
        SELECT 1 FROM public.billing_events be
        WHERE be.organization_id = $1
          AND be.event_type IN ('invoice.paid', 'charge.succeeded')
          AND be.amount_cents > 0
          AND be.counts_as_cash
          AND be.revenue_stream = 'plan'
      )
    $q$ INTO paying USING _org_id;
    IF paying THEN RETURN true; END IF;
  END IF;

  RETURN false;
END;
$$;

REVOKE ALL ON FUNCTION public.org_has_paid_access(uuid) FROM PUBLIC, anon, authenticated;

DO $$
DECLARE
  n_profiles int := 0;
  n_orgs int := 0;
BEGIN
  WITH candidate_orgs AS (
    SELECT o.id, o.created_at, o.owner_id
    FROM public.organizations o
    WHERE o.created_at > now() - interval '30 days'
      AND NOT public.org_has_paid_access(o.id)
  ),
  profile_targets AS (
    SELECT src.profile_id, MAX(src.created_at + interval '30 days') AS target_end
    FROM (
      SELECT c.owner_id AS profile_id, c.created_at
      FROM candidate_orgs c
      WHERE c.owner_id IS NOT NULL
      UNION ALL
      SELECT m.user_id, c.created_at
      FROM candidate_orgs c
      JOIN public.org_memberships m
        ON m.organization_id = c.id
       AND m.role = 'owner'
    ) src
    WHERE src.profile_id IS NOT NULL
      AND src.created_at + interval '30 days' > now()
    GROUP BY src.profile_id
  )
  UPDATE public.profiles p
  SET trial_ends_at = t.target_end
  FROM profile_targets t
  WHERE p.id = t.profile_id
    AND (p.trial_ends_at IS NULL OR p.trial_ends_at < t.target_end);

  GET DIAGNOSTICS n_profiles = ROW_COUNT;

  UPDATE public.organizations o
  SET plan_type = 'trial'
  WHERE o.created_at > now() - interval '30 days'
    AND (o.plan_type IS NULL OR o.plan_type = 'free')
    AND NOT public.org_has_paid_access(o.id)
    AND EXISTS (
      SELECT 1
      FROM public.profiles p
      WHERE p.trial_ends_at > now()
        AND (
          p.id = o.owner_id
          OR EXISTS (
            SELECT 1
            FROM public.org_memberships m
            WHERE m.organization_id = o.id
              AND m.user_id = p.id
              AND m.role = 'owner'
          )
        )
    );

  GET DIAGNOSTICS n_orgs = ROW_COUNT;

  RAISE NOTICE 'extend_short_new_org_trials: % profiles extended, % orgs set to trial', n_profiles, n_orgs;
END $$;

DROP FUNCTION public.org_has_paid_access(uuid);

-- The plan heading reads raw_plan_type. The earlier return shape had no
-- such column, and the client then showed "Free".
DROP FUNCTION IF EXISTS public.my_effective_plan();

CREATE OR REPLACE FUNCTION public.my_effective_plan()
RETURNS TABLE (plan_type text, raw_plan_type text, organization_id uuid)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org uuid;
BEGIN
  SELECT m.organization_id INTO v_org
  FROM public.org_memberships m
  WHERE m.user_id = auth.uid()
  ORDER BY m.created_at ASC NULLS LAST
  LIMIT 1;

  IF v_org IS NULL THEN
    RETURN QUERY SELECT 'free'::text, 'free'::text, NULL::uuid;
    RETURN;
  END IF;

  RETURN QUERY
  SELECT public.effective_plan(v_org),
         COALESCE((SELECT o.plan_type
                   FROM public.organizations o
                   WHERE o.id = v_org), 'free'),
         v_org;
END;
$$;

REVOKE ALL ON FUNCTION public.my_effective_plan() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_effective_plan() TO authenticated;
