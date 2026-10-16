-- Local proof for platform_account_metrics().
-- Builds the tables the view reads, applies the metrics migration, and
-- checks three things:
--   * the activation milestone check is still there
--   * an org owner and a cleaner both get SQLSTATE 42501
--   * collected monthly amount and MRR follow the loyalty and annual rules
--
-- Run with:
--   sudo -u postgres psql -d platform_account_metrics_test -v ON_ERROR_STOP=1 \
--     -f supabase/tests/platform_account_metrics_access.sql

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN;
  END IF;
END $$;

CREATE SCHEMA IF NOT EXISTS auth;

CREATE TABLE IF NOT EXISTS auth.users (
  id uuid PRIMARY KEY,
  email text
);

CREATE OR REPLACE FUNCTION auth.uid()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

-- The assertions below execute the function from the migration, not a stub.
\ir ../migrations/20261016040000_platform_admin_support_only.sql

DO $$
DECLARE
  src text;
BEGIN
  SELECT pg_get_functiondef('public.is_platform_admin()'::regprocedure) INTO src;
  IF src IS NULL OR position('support@tidywisecleaning.com' IN src) = 0 THEN
    RAISE EXCEPTION 'SQL test is not running the real is_platform_admin()';
  END IF;
  IF position('gmail.com' IN src) > 0 THEN
    RAISE EXCEPTION 'is_platform_admin still names a gmail address';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.jsonb_flag_true(p_json jsonb, p_key text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT lower(coalesce(p_json ->> p_key, '')) IN ('true', 't', '1', 'yes');
$$;

-- The real helper also hides demo bits from outsiders. Price checks only
-- need a boolean, and every fixture org is a real account.
CREATE OR REPLACE FUNCTION public.activation_subject_is_demo(_org_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT false
$$;

CREATE TABLE public.profiles (
  id uuid PRIMARY KEY,
  email text,
  trial_ends_at timestamptz
);

CREATE TABLE public.organizations (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  owner_id uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  plan_type text,
  last_login_at timestamptz,
  onboarding_answers jsonb,
  grandfathered_lifetime boolean NOT NULL DEFAULT false
);

CREATE TABLE public.org_memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  user_id uuid NOT NULL REFERENCES auth.users(id),
  role text NOT NULL
);

CREATE TABLE public.staff (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id),
  organization_id uuid REFERENCES public.organizations(id),
  name text NOT NULL,
  email text
);

CREATE TABLE public.organization_activation_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  milestone text NOT NULL,
  occurred_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT organization_activation_events_milestone_check CHECK (milestone IN (
    'trial_signup',
    'service_added',
    'staff_added',
    'openphone_connected',
    'stripe_connected',
    'first_job_booked',
    'clients_imported',
    'first_payment_received'
  ))
);

CREATE TABLE public.stripe_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES public.organizations(id),
  stripe_subscription_id text UNIQUE,
  stripe_customer_id text,
  stripe_price_id text,
  status text NOT NULL DEFAULT 'inactive',
  plan text,
  billing_interval text,
  current_period_end timestamptz,
  cancel_at_period_end boolean NOT NULL DEFAULT false,
  trial_end timestamptz,
  metadata jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.billing_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid,
  occurred_at timestamptz,
  event_type text,
  revenue_stream text,
  revenue_stream_corrected text
);

CREATE TABLE public.billing_subscription_periods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid,
  unit_amount_cents bigint,
  quantity integer,
  billing_interval text,
  interval_count integer,
  discount_percent numeric,
  discount_amount_cents bigint,
  revenue_stream text,
  effective_from timestamptz,
  effective_to timestamptz,
  cancellation_reason text
);

CREATE TABLE public.cancellation_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid,
  canceled_at timestamptz
);

CREATE TABLE public.org_subscription_loyalty (
  organization_id uuid PRIMARY KEY REFERENCES public.organizations(id),
  applied_discount_cents integer NOT NULL DEFAULT 0
);

CREATE TABLE public.organization_pricing_settings (
  organization_id uuid PRIMARY KEY
);

CREATE TABLE public.account_signup_attribution (
  user_id uuid,
  organization_id uuid,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  referrer text,
  captured_at timestamptz NOT NULL DEFAULT now()
);

\ir ../migrations/20261016050200_platform_account_metrics.sql

INSERT INTO auth.users (id, email) VALUES
  ('11111111-1111-4111-8111-111111111111', 'owner@example.com'),
  ('22222222-2222-4222-8222-222222222222', 'cleaner@example.com'),
  ('33333333-3333-4333-8333-333333333333', 'support@tidywisecleaning.com'),
  ('44444444-4444-4444-8444-444444444444', 'agencyfootprintllc@gmail.com');

INSERT INTO public.profiles (id, email) VALUES
  ('11111111-1111-4111-8111-111111111111', 'owner@example.com'),
  ('22222222-2222-4222-8222-222222222222', 'cleaner@example.com'),
  ('33333333-3333-4333-8333-333333333333', 'support@tidywisecleaning.com');

INSERT INTO public.organizations (id, name, owner_id, plan_type) VALUES
  ('a0000000-0000-4000-8000-000000000001', 'Home', '11111111-1111-4111-8111-111111111111', 'pro'),
  ('a0000000-0000-4000-8000-000000000002', 'Loyalty unread', '11111111-1111-4111-8111-111111111111', 'pro'),
  ('a0000000-0000-4000-8000-000000000003', 'Known coupon', '11111111-1111-4111-8111-111111111111', 'pro'),
  ('a0000000-0000-4000-8000-000000000004', 'Stale loyalty', '11111111-1111-4111-8111-111111111111', 'pro'),
  ('a0000000-0000-4000-8000-000000000005', 'Annual', '11111111-1111-4111-8111-111111111111', 'pro'),
  ('a0000000-0000-4000-8000-000000000006', 'Past due', '11111111-1111-4111-8111-111111111111', 'basic'),
  ('a0000000-0000-4000-8000-000000000007', 'Unread other', '11111111-1111-4111-8111-111111111111', 'pro'),
  ('a0000000-0000-4000-8000-000000000008', 'Lifetime Co', '11111111-1111-4111-8111-111111111111', 'lifetime'),
  ('a0000000-0000-4000-8000-000000000009', 'Period coupon', '11111111-1111-4111-8111-111111111111', 'pro');

INSERT INTO public.org_memberships (organization_id, user_id, role) VALUES
  ('a0000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'owner'),
  ('a0000000-0000-4000-8000-000000000001', '22222222-2222-4222-8222-222222222222', 'member');

INSERT INTO public.staff (user_id, organization_id, name, email) VALUES
  ('22222222-2222-4222-8222-222222222222', 'a0000000-0000-4000-8000-000000000001', 'Casey Cleaner', 'cleaner@example.com');

-- $97/mo, coupon not expanded, loyalty $8 off. Collected $89.
INSERT INTO public.stripe_subscriptions (
  organization_id, stripe_subscription_id, status, plan, billing_interval, interval_count,
  unit_amount_cents, quantity, discount_known
) VALUES (
  'a0000000-0000-4000-8000-000000000002', 'sub_loyalty', 'active', 'pro', 'month', 1,
  9700, 1, false
);
INSERT INTO public.org_subscription_loyalty (organization_id, applied_discount_cents) VALUES
  ('a0000000-0000-4000-8000-000000000002', 800);

-- Same list price, Stripe coupon already $8, loyalty row also $8. Count the $8 once.
INSERT INTO public.stripe_subscriptions (
  organization_id, stripe_subscription_id, status, plan, billing_interval, interval_count,
  unit_amount_cents, quantity, discount_known, discount_amount_cents
) VALUES (
  'a0000000-0000-4000-8000-000000000003', 'sub_known', 'active', 'pro', 'month', 1,
  9700, 1, true, 800
);
INSERT INTO public.org_subscription_loyalty (organization_id, applied_discount_cents) VALUES
  ('a0000000-0000-4000-8000-000000000003', 800);

-- Stripe says there is no coupon. A stale loyalty number must not come off again.
INSERT INTO public.stripe_subscriptions (
  organization_id, stripe_subscription_id, status, plan, billing_interval, interval_count,
  unit_amount_cents, quantity, discount_known, discount_amount_cents
) VALUES (
  'a0000000-0000-4000-8000-000000000004', 'sub_stale', 'active', 'pro', 'month', 1,
  9700, 1, true, 0
);
INSERT INTO public.org_subscription_loyalty (organization_id, applied_discount_cents) VALUES
  ('a0000000-0000-4000-8000-000000000004', 800);

-- $970/year with a $120 coupon. Both money columns are 85000/12. Loyalty is not annual.
INSERT INTO public.stripe_subscriptions (
  organization_id, stripe_subscription_id, status, plan, billing_interval, interval_count,
  unit_amount_cents, quantity, discount_known, discount_amount_cents
) VALUES (
  'a0000000-0000-4000-8000-000000000005', 'sub_annual', 'active', 'pro', 'year', 1,
  97000, 1, true, 12000
);
INSERT INTO public.org_subscription_loyalty (organization_id, applied_discount_cents) VALUES
  ('a0000000-0000-4000-8000-000000000005', 800);

INSERT INTO public.stripe_subscriptions (
  organization_id, stripe_subscription_id, status, plan, billing_interval, interval_count,
  unit_amount_cents, quantity, discount_known, discount_amount_cents
) VALUES (
  'a0000000-0000-4000-8000-000000000006', 'sub_past_due', 'past_due', 'basic', 'month', 1,
  4900, 1, true, 0
);

-- Unreadable coupon and no loyalty amount. Do not pretend the list price was collected.
INSERT INTO public.stripe_subscriptions (
  organization_id, stripe_subscription_id, status, plan, billing_interval, interval_count,
  unit_amount_cents, quantity, discount_known
) VALUES (
  'a0000000-0000-4000-8000-000000000007', 'sub_unknown', 'active', 'pro', 'month', 1,
  9700, 1, false
);

INSERT INTO public.stripe_subscriptions (
  organization_id, stripe_subscription_id, status, plan, billing_interval,
  unit_amount_cents, discount_known
) VALUES (
  'a0000000-0000-4000-8000-000000000008', 'lifetime_sub', 'active', 'lifetime', 'month',
  30000, true
);
UPDATE public.organizations SET grandfathered_lifetime = true
WHERE id = 'a0000000-0000-4000-8000-000000000008';

-- Period ledger already netted its own coupon. Loyalty must not be subtracted again.
INSERT INTO public.stripe_subscriptions (
  organization_id, stripe_subscription_id, status, plan, billing_interval, discount_known
) VALUES (
  'a0000000-0000-4000-8000-000000000009', 'sub_period', 'active', 'pro', 'month', false
);
INSERT INTO public.billing_subscription_periods (
  organization_id, unit_amount_cents, quantity, billing_interval, interval_count,
  discount_amount_cents, revenue_stream, effective_from
) VALUES (
  'a0000000-0000-4000-8000-000000000009', 9700, 1, 'month', 1,
  400, 'plan', now()
);
INSERT INTO public.org_subscription_loyalty (organization_id, applied_discount_cents) VALUES
  ('a0000000-0000-4000-8000-000000000009', 800);

DO $$
DECLARE
  def text;
  r record;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO def
  FROM pg_constraint
  WHERE conname = 'organization_activation_events_milestone_check'
    AND conrelid = 'public.organization_activation_events'::regclass;
  IF def IS NULL THEN
    RAISE EXCEPTION 'milestone check is missing after the metrics migration';
  END IF;
  IF def NOT LIKE '%trial_signup%'
     OR def NOT LIKE '%service_added%'
     OR def NOT LIKE '%staff_added%'
     OR def NOT LIKE '%openphone_connected%'
     OR def NOT LIKE '%stripe_connected%'
     OR def NOT LIKE '%first_job_booked%'
     OR def NOT LIKE '%clients_imported%'
     OR def NOT LIKE '%first_payment_received%' THEN
    RAISE EXCEPTION 'milestone check no longer has the eight keys: %', def;
  END IF;

  BEGIN
    INSERT INTO public.organization_activation_events (organization_id, milestone, occurred_at)
    VALUES ('a0000000-0000-4000-8000-000000000001', 'not_a_milestone', now());
    RAISE EXCEPTION 'milestone check accepted a name outside the allowlist';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

  SELECT * INTO r FROM public.platform_account_metrics_v
  WHERE organization_id = 'a0000000-0000-4000-8000-000000000002';
  IF r.monthly_amount_cents IS DISTINCT FROM 8900
     OR r.mrr_cents IS DISTINCT FROM 8900
     OR r.monthly_amount_source IS DISTINCT FROM 'stripe_subscription_loyalty_discount'
     OR r.monthly_amount_basis IS DISTINCT FROM 'monthly' THEN
    RAISE EXCEPTION 'loyalty unread expected 8900/8900 monthly loyalty source, got %/% % %',
      r.monthly_amount_cents, r.mrr_cents, r.monthly_amount_basis, r.monthly_amount_source;
  END IF;

  SELECT * INTO r FROM public.platform_account_metrics_v
  WHERE organization_id = 'a0000000-0000-4000-8000-000000000003';
  IF r.monthly_amount_cents IS DISTINCT FROM 8900
     OR r.mrr_cents IS DISTINCT FROM 8900
     OR r.monthly_amount_source IS DISTINCT FROM 'stripe_subscription' THEN
    RAISE EXCEPTION 'known coupon was combined with loyalty: %/% %',
      r.monthly_amount_cents, r.mrr_cents, r.monthly_amount_source;
  END IF;

  SELECT * INTO r FROM public.platform_account_metrics_v
  WHERE organization_id = 'a0000000-0000-4000-8000-000000000004';
  IF r.monthly_amount_cents IS DISTINCT FROM 9700
     OR r.mrr_cents IS DISTINCT FROM 9700
     OR r.monthly_amount_source IS DISTINCT FROM 'stripe_subscription' THEN
    RAISE EXCEPTION 'stale loyalty was subtracted from a known zero coupon: %/% %',
      r.monthly_amount_cents, r.mrr_cents, r.monthly_amount_source;
  END IF;

  SELECT * INTO r FROM public.platform_account_metrics_v
  WHERE organization_id = 'a0000000-0000-4000-8000-000000000005';
  IF r.monthly_amount_cents IS DISTINCT FROM 7083
     OR r.mrr_cents IS DISTINCT FROM 7083
     OR r.monthly_amount_basis IS DISTINCT FROM 'normalized_from_annual'
     OR r.monthly_amount_source IS DISTINCT FROM 'stripe_subscription' THEN
    RAISE EXCEPTION 'annual expected 7083/7083 normalized_from_annual, got %/% % %',
      r.monthly_amount_cents, r.mrr_cents, r.monthly_amount_basis, r.monthly_amount_source;
  END IF;

  SELECT * INTO r FROM public.platform_account_metrics_v
  WHERE organization_id = 'a0000000-0000-4000-8000-000000000006';
  IF r.subscription_status IS DISTINCT FROM 'past_due'
     OR r.stripe_subscription_status IS DISTINCT FROM 'past_due'
     OR r.mrr_cents IS DISTINCT FROM 4900
     OR r.monthly_amount_cents IS DISTINCT FROM 4900 THEN
    RAISE EXCEPTION 'past_due row expected status past_due and 4900/4900, got % %/%',
      r.subscription_status, r.monthly_amount_cents, r.mrr_cents;
  END IF;

  SELECT * INTO r FROM public.platform_account_metrics_v
  WHERE organization_id = 'a0000000-0000-4000-8000-000000000007';
  IF r.monthly_amount_cents IS NOT NULL
     OR r.mrr_cents IS NOT NULL
     OR r.monthly_amount_basis IS DISTINCT FROM 'discount_unknown' THEN
    RAISE EXCEPTION 'unread non-loyalty coupon should stay null, got %/% %',
      r.monthly_amount_cents, r.mrr_cents, r.monthly_amount_basis;
  END IF;

  SELECT * INTO r FROM public.platform_account_metrics_v
  WHERE organization_id = 'a0000000-0000-4000-8000-000000000008';
  IF r.is_lifetime IS NOT TRUE
     OR r.monthly_amount_cents IS NOT NULL
     OR r.mrr_cents IS NOT NULL
     OR r.monthly_amount_basis IS DISTINCT FROM 'lifetime_excluded' THEN
    RAISE EXCEPTION 'lifetime leaked into MRR: % %/% %',
      r.is_lifetime, r.monthly_amount_cents, r.mrr_cents, r.monthly_amount_basis;
  END IF;

  SELECT * INTO r FROM public.platform_account_metrics_v
  WHERE organization_id = 'a0000000-0000-4000-8000-000000000009';
  IF r.monthly_amount_cents IS DISTINCT FROM 9300
     OR r.mrr_cents IS DISTINCT FROM 9300
     OR r.monthly_amount_source IS DISTINCT FROM 'billing_subscription_period' THEN
    RAISE EXCEPTION 'period coupon was combined with loyalty: %/% %',
      r.monthly_amount_cents, r.mrr_cents, r.monthly_amount_source;
  END IF;
END $$;

DO $$
DECLARE
  v_state text;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
  SET LOCAL ROLE authenticated;
  IF public.is_platform_admin() THEN
    RAISE EXCEPTION 'org owner was treated as a platform admin';
  END IF;
  BEGIN
    PERFORM 1 FROM public.platform_account_metrics(10, 0) LIMIT 1;
    RAISE EXCEPTION 'org owner was not rejected';
  EXCEPTION WHEN insufficient_privilege THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE;
    IF v_state IS DISTINCT FROM '42501' THEN
      RAISE EXCEPTION 'org owner sqlstate %, expected 42501', v_state;
    END IF;
  END;
END $$;

DO $$
DECLARE
  v_state text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.staff
    WHERE user_id = '22222222-2222-4222-8222-222222222222'
      AND email = 'cleaner@example.com'
  ) THEN
    RAISE EXCEPTION 'cleaner fixture is missing';
  END IF;
  PERFORM set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);
  SET LOCAL ROLE authenticated;
  IF public.is_platform_admin() THEN
    RAISE EXCEPTION 'cleaner was treated as a platform admin';
  END IF;
  BEGIN
    PERFORM 1 FROM public.platform_account_metrics(10, 0) LIMIT 1;
    RAISE EXCEPTION 'cleaner was not rejected';
  EXCEPTION WHEN insufficient_privilege THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE;
    IF v_state IS DISTINCT FROM '42501' THEN
      RAISE EXCEPTION 'cleaner sqlstate %, expected 42501', v_state;
    END IF;
  END;
END $$;

DO $$
DECLARE
  n integer;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '33333333-3333-4333-8333-333333333333', true);
  SET LOCAL ROLE authenticated;
  IF public.is_platform_admin() IS NOT TRUE THEN
    RAISE EXCEPTION 'platform admin email was rejected by is_platform_admin()';
  END IF;
  SELECT count(*) INTO n
  FROM public.platform_account_metrics(1000, 0)
  WHERE subscription_status = 'past_due';
  IF n <> 1 THEN
    RAISE EXCEPTION 'platform admin past_due count %, expected 1', n;
  END IF;
END $$;

DO $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '44444444-4444-4444-8444-444444444444', true);
  SET LOCAL ROLE authenticated;
  IF public.is_platform_admin() THEN
    RAISE EXCEPTION 'agencyfootprintllc was treated as a platform admin';
  END IF;
END $$;

DO $$
DECLARE
  v_state text;
BEGIN
  SET LOCAL ROLE anon;
  BEGIN
    PERFORM 1 FROM public.platform_account_metrics(10, 0) LIMIT 1;
    RAISE EXCEPTION 'anon was not rejected';
  EXCEPTION WHEN insufficient_privilege THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE;
    IF v_state IS DISTINCT FROM '42501' THEN
      RAISE EXCEPTION 'anon sqlstate %, expected 42501', v_state;
    END IF;
  END;
END $$;

-- The old primary key was event_id alone. Each webhook source claims the
-- same Stripe id, and the other source must still be able to insert it.
CREATE TABLE public.stripe_webhook_events (
  event_id text PRIMARY KEY,
  event_type text NOT NULL,
  source text NOT NULL,
  processed_at timestamptz NOT NULL DEFAULT now()
);

-- Prod may not have named the old primary key stripe_webhook_events_pkey.
ALTER TABLE public.stripe_webhook_events
  RENAME CONSTRAINT stripe_webhook_events_pkey TO stripe_webhook_events_event_id_pk;

\ir ../migrations/20261016050100_stripe_webhook_events_source_key.sql

INSERT INTO public.stripe_webhook_events (event_id, event_type, source) VALUES
  ('evt_both', 'customer.subscription.deleted', 'stripe-invoice-webhook');
INSERT INTO public.stripe_webhook_events (event_id, event_type, source) VALUES
  ('evt_both', 'customer.subscription.deleted', 'stripe-subscription-webhook');

INSERT INTO public.stripe_webhook_events (event_id, event_type, source) VALUES
  ('evt_both_rev', 'invoice.paid', 'stripe-subscription-webhook');
INSERT INTO public.stripe_webhook_events (event_id, event_type, source) VALUES
  ('evt_both_rev', 'invoice.paid', 'stripe-invoice-webhook');

DO $$
BEGIN
  BEGIN
    INSERT INTO public.stripe_webhook_events (event_id, event_type, source) VALUES
      ('evt_both', 'customer.subscription.deleted', 'stripe-invoice-webhook');
    RAISE EXCEPTION 'invoice source claimed evt_both twice';
  EXCEPTION WHEN unique_violation THEN
    NULL;
  END;
  BEGIN
    INSERT INTO public.stripe_webhook_events (event_id, event_type, source) VALUES
      ('evt_both_rev', 'invoice.paid', 'stripe-subscription-webhook');
    RAISE EXCEPTION 'subscription source claimed evt_both_rev twice';
  EXCEPTION WHEN unique_violation THEN
    NULL;
  END;
END $$;
