-- Activation milestones and first-touch signup attribution.
--
-- The owner runs this by hand in the SQL editor. It does not call Stripe.
-- Re-running it is safe: objects are created IF NOT EXISTS, functions are
-- replaced, and policies/triggers are dropped before they are created.
--
-- Milestones (one row per organization, ever):
--   trial_signup, cleaner_added, clients_imported,
--   first_job_booked, first_payment_received
--
-- Last login is not a milestone. profiles.last_login_at and
-- organizations.last_login_at follow auth.users.last_sign_in_at.
--
-- UTM values are free text. Nothing here restricts source or medium to a
-- list. Each UTM field is stored twice:
--   *_raw        the characters as received (not trimmed, not lowercased)
--   utm_*        trimmed and lowercased, for reporting
-- When a signup has no utm_source, the normalized column is 'direct'.
-- The raw column stays null. 'direct' is never written into utm_source_raw.
--
-- Demo orgs never get a milestone row. Last login is still stamped.
-- A row is treated as demo when any of these is true:
--   organization_pricing_settings.demo_mode_enabled
--   organizations / profiles / pricing-settings jsonb flags named
--     is_demo, demo_mode, demo_account, is_demo_account, is_demo_org
--   the org owner's email is applereview@tidywise.com,
--     applereview@tidywise1.com, or any @tidywise1.com address
--   the source row's is_test flag is true (bookings today; any later
--     is_test column is seen via to_jsonb)
-- support@tidywisecleaning.com is the owner's real account, not a demo.

-- ---------------------------------------------------------------------------
-- Columns on existing tables
-- ---------------------------------------------------------------------------

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS last_login_at timestamptz;

COMMENT ON COLUMN public.profiles.last_login_at IS
  'Last auth sign-in for this account. Written by touch_account_last_login from auth.users.last_sign_in_at. Clients cannot change it.';

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS last_login_at timestamptz;

COMMENT ON COLUMN public.organizations.last_login_at IS
  'Latest sign-in by the owner, a member, or a cleaner of this org.';

ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS created_via text;

COMMENT ON COLUMN public.customers.created_via IS
  'csv_import or migration_import when the row came from a client import. Null for customers added by hand, a booking, or a lead. The clients_imported milestone fires only for those two values.';

-- ---------------------------------------------------------------------------
-- Milestone ledger
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.organization_activation_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  milestone text NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  source text,
  created_at timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'organization_activation_events_org_milestone_key'
      AND conrelid = 'public.organization_activation_events'::regclass
  ) THEN
    ALTER TABLE public.organization_activation_events
      ADD CONSTRAINT organization_activation_events_org_milestone_key
      UNIQUE (organization_id, milestone);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'organization_activation_events_milestone_check'
      AND conrelid = 'public.organization_activation_events'::regclass
  ) THEN
    ALTER TABLE public.organization_activation_events
      ADD CONSTRAINT organization_activation_events_milestone_check
      CHECK (milestone IN (
        'trial_signup',
        'cleaner_added',
        'clients_imported',
        'first_job_booked',
        'first_payment_received'
      ));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS organization_activation_events_org_occurred_idx
  ON public.organization_activation_events (organization_id, occurred_at DESC);

COMMENT ON TABLE public.organization_activation_events IS
  'One activation milestone per organization. Inserts are ON CONFLICT DO NOTHING so retries, refreshes, and double clicks do not create a second row.';

-- ---------------------------------------------------------------------------
-- Signup attribution (UTM + referrer + landing page)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.account_signup_attribution (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  organization_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL,
  utm_source_raw text,
  utm_source text NOT NULL DEFAULT 'direct',
  utm_medium_raw text,
  utm_medium text,
  utm_campaign_raw text,
  utm_campaign text,
  utm_term_raw text,
  utm_term text,
  utm_content_raw text,
  utm_content text,
  referrer text,
  landing_page text,
  captured_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.account_signup_attribution
  ADD COLUMN IF NOT EXISTS utm_source_raw text,
  ADD COLUMN IF NOT EXISTS utm_source text NOT NULL DEFAULT 'direct',
  ADD COLUMN IF NOT EXISTS utm_medium_raw text,
  ADD COLUMN IF NOT EXISTS utm_medium text,
  ADD COLUMN IF NOT EXISTS utm_campaign_raw text,
  ADD COLUMN IF NOT EXISTS utm_campaign text,
  ADD COLUMN IF NOT EXISTS utm_term_raw text,
  ADD COLUMN IF NOT EXISTS utm_term text,
  ADD COLUMN IF NOT EXISTS utm_content_raw text,
  ADD COLUMN IF NOT EXISTS utm_content text,
  ADD COLUMN IF NOT EXISTS referrer text,
  ADD COLUMN IF NOT EXISTS landing_page text,
  ADD COLUMN IF NOT EXISTS captured_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE UNIQUE INDEX IF NOT EXISTS account_signup_attribution_org_uidx
  ON public.account_signup_attribution (organization_id)
  WHERE organization_id IS NOT NULL;

COMMENT ON TABLE public.account_signup_attribution IS
  'First-touch marketing attribution for one account. utm_*_raw is the value as received. utm_* is trimmed and lowercased. utm_source is direct when no source was sent. Not an allowlist.';

COMMENT ON COLUMN public.account_signup_attribution.utm_source_raw IS
  'utm_source exactly as received. Null when the visit had no utm_source. Never the word direct.';
COMMENT ON COLUMN public.account_signup_attribution.utm_source IS
  'Trimmed, lowercased utm_source. direct when utm_source_raw is null or blank after trim.';
COMMENT ON COLUMN public.account_signup_attribution.utm_medium_raw IS
  'utm_medium exactly as received.';
COMMENT ON COLUMN public.account_signup_attribution.utm_medium IS
  'Trimmed, lowercased utm_medium. Null when absent.';
COMMENT ON COLUMN public.account_signup_attribution.utm_campaign_raw IS
  'utm_campaign exactly as received (often a post or page slug, or onboarding).';
COMMENT ON COLUMN public.account_signup_attribution.utm_campaign IS
  'Trimmed, lowercased utm_campaign. Null when absent.';
COMMENT ON COLUMN public.account_signup_attribution.utm_term_raw IS
  'utm_term exactly as received.';
COMMENT ON COLUMN public.account_signup_attribution.utm_term IS
  'Trimmed, lowercased utm_term. Null when absent.';
COMMENT ON COLUMN public.account_signup_attribution.utm_content_raw IS
  'utm_content exactly as received.';
COMMENT ON COLUMN public.account_signup_attribution.utm_content IS
  'Trimmed, lowercased utm_content. Null when absent.';
COMMENT ON COLUMN public.account_signup_attribution.referrer IS
  'document.referrer from the first captured landing. Not lowercased.';
COMMENT ON COLUMN public.account_signup_attribution.landing_page IS
  'First landing URL. Not lowercased.';

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- Keep in sync with normalizeUtmValue() in src/lib/utmAttribution.ts.
CREATE OR REPLACE FUNCTION public.normalize_utm_value(p_raw text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT NULLIF(lower(btrim(p_raw)), '');
$$;

REVOKE ALL ON FUNCTION public.normalize_utm_value(text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.jsonb_flag_true(p_json jsonb, p_key text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT lower(coalesce(p_json ->> p_key, '')) IN ('true', 't', '1', 'yes');
$$;

REVOKE ALL ON FUNCTION public.jsonb_flag_true(jsonb, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.activation_subject_is_demo(_org_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org jsonb;
  v_owner uuid;
  v_email text;
  v_profile jsonb;
  v_pricing jsonb;
BEGIN
  IF _org_id IS NULL THEN
    RETURN true;
  END IF;

  SELECT to_jsonb(o) INTO v_org
  FROM public.organizations o
  WHERE o.id = _org_id;

  IF v_org IS NULL THEN
    RETURN true;
  END IF;

  IF public.jsonb_flag_true(v_org, 'is_demo')
     OR public.jsonb_flag_true(v_org, 'demo_mode')
     OR public.jsonb_flag_true(v_org, 'demo_account')
     OR public.jsonb_flag_true(v_org, 'is_demo_account')
     OR public.jsonb_flag_true(v_org, 'is_demo_org') THEN
    RETURN true;
  END IF;

  BEGIN
    SELECT to_jsonb(s) INTO v_pricing
    FROM public.organization_pricing_settings s
    WHERE s.organization_id = _org_id;
  EXCEPTION WHEN undefined_table THEN
    v_pricing := NULL;
  END;

  IF v_pricing IS NOT NULL AND (
    public.jsonb_flag_true(v_pricing, 'demo_mode_enabled')
    OR public.jsonb_flag_true(v_pricing, 'is_demo')
    OR public.jsonb_flag_true(v_pricing, 'demo_mode')
    OR public.jsonb_flag_true(v_pricing, 'demo_account')
    OR public.jsonb_flag_true(v_pricing, 'is_demo_account')
  ) THEN
    RETURN true;
  END IF;

  BEGIN
    v_owner := NULLIF(v_org ->> 'owner_id', '')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    v_owner := NULL;
  END;

  IF v_owner IS NOT NULL THEN
    SELECT lower(p.email), to_jsonb(p)
      INTO v_email, v_profile
    FROM public.profiles p
    WHERE p.id = v_owner;

    IF public.jsonb_flag_true(v_profile, 'is_demo')
       OR public.jsonb_flag_true(v_profile, 'demo_mode')
       OR public.jsonb_flag_true(v_profile, 'demo_account')
       OR public.jsonb_flag_true(v_profile, 'is_demo_account') THEN
      RETURN true;
    END IF;

    IF v_email IS NOT NULL AND (
      v_email = 'applereview@tidywise.com'
      OR v_email = 'applereview@tidywise1.com'
      OR v_email LIKE '%@tidywise1.com'
    ) THEN
      RETURN true;
    END IF;
  END IF;

  RETURN false;
END;
$$;

REVOKE ALL ON FUNCTION public.activation_subject_is_demo(uuid) FROM PUBLIC, anon, authenticated;

-- Not granted to clients. Triggers call it as the owner. A grant to
-- authenticated would let any login write another org's milestone.
CREATE OR REPLACE FUNCTION public.record_activation_milestone(
  _org_id uuid,
  _milestone text,
  _source text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF _org_id IS NULL OR _milestone IS NULL OR btrim(_milestone) = '' THEN
    RETURN;
  END IF;
  IF public.activation_subject_is_demo(_org_id) THEN
    RETURN;
  END IF;

  INSERT INTO public.organization_activation_events (organization_id, milestone, source)
  VALUES (_org_id, _milestone, NULLIF(left(COALESCE(_source, ''), 80), ''))
  ON CONFLICT (organization_id, milestone) DO NOTHING;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'record_activation_milestone failed: %', SQLERRM;
END;
$$;

REVOKE ALL ON FUNCTION public.record_activation_milestone(uuid, text, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.row_is_test(p_row jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT public.jsonb_flag_true(p_row, 'is_test');
$$;

REVOKE ALL ON FUNCTION public.row_is_test(jsonb) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Triggers: milestones
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.activation_on_organization_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  BEGIN
    IF COALESCE(NULLIF(lower(btrim(COALESCE(NEW.plan_type, ''))), ''), 'trial') IN ('trial', 'free') THEN
      PERFORM public.record_activation_milestone(NEW.id, 'trial_signup', 'organizations.insert');
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'activation org milestone failed: %', SQLERRM;
  END;

  BEGIN
    UPDATE public.account_signup_attribution
    SET organization_id = NEW.id,
        updated_at = now()
    WHERE user_id = NEW.owner_id
      AND organization_id IS NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'activation org attribution link failed: %', SQLERRM;
  END;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.activation_on_organization_insert() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS activation_organizations_insert ON public.organizations;
CREATE TRIGGER activation_organizations_insert
  AFTER INSERT ON public.organizations
  FOR EACH ROW
  EXECUTE FUNCTION public.activation_on_organization_insert();

CREATE OR REPLACE FUNCTION public.activation_on_staff_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.organization_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF COALESCE(NEW.is_active, true) IS NOT TRUE THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND COALESCE(OLD.is_active, true) IS TRUE THEN
    RETURN NEW;
  END IF;
  IF public.row_is_test(to_jsonb(NEW)) THEN
    RETURN NEW;
  END IF;

  PERFORM public.record_activation_milestone(NEW.organization_id, 'cleaner_added', 'staff.' || lower(TG_OP));
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'activation staff hook failed: %', SQLERRM;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.activation_on_staff_change() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS activation_staff_change ON public.staff;
CREATE TRIGGER activation_staff_change
  AFTER INSERT OR UPDATE OF is_active ON public.staff
  FOR EACH ROW
  EXECUTE FUNCTION public.activation_on_staff_change();

CREATE OR REPLACE FUNCTION public.activation_on_customer_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.organization_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF public.row_is_test(to_jsonb(NEW)) THEN
    RETURN NEW;
  END IF;
  IF COALESCE(NEW.created_via, '') NOT IN ('csv_import', 'migration_import') THEN
    RETURN NEW;
  END IF;

  PERFORM public.record_activation_milestone(
    NEW.organization_id,
    'clients_imported',
    'customers.' || NEW.created_via
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'activation customer hook failed: %', SQLERRM;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.activation_on_customer_insert() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS activation_customers_import ON public.customers;
CREATE TRIGGER activation_customers_import
  AFTER INSERT ON public.customers
  FOR EACH ROW
  EXECUTE FUNCTION public.activation_on_customer_insert();

CREATE OR REPLACE FUNCTION public.booking_is_real_job(p_row jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT NOT public.jsonb_flag_true(p_row, 'is_test')
     AND NOT public.jsonb_flag_true(p_row, 'is_draft');
$$;

REVOKE ALL ON FUNCTION public.booking_is_real_job(jsonb) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.booking_is_payment(p_row jsonb)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_status text;
  v_deposit numeric;
BEGIN
  IF NOT public.booking_is_real_job(p_row) THEN
    RETURN false;
  END IF;
  v_status := lower(coalesce(p_row ->> 'payment_status', ''));
  IF v_status IN ('paid', 'partial') THEN
    RETURN true;
  END IF;
  BEGIN
    v_deposit := COALESCE(NULLIF(p_row ->> 'deposit_paid', '')::numeric, 0);
  EXCEPTION WHEN invalid_text_representation THEN
    v_deposit := 0;
  END;
  RETURN v_deposit > 0;
END;
$$;

REVOKE ALL ON FUNCTION public.booking_is_payment(jsonb) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.activation_on_booking_job()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_new jsonb := to_jsonb(NEW);
  v_old jsonb := CASE WHEN TG_OP = 'UPDATE' THEN to_jsonb(OLD) ELSE NULL END;
BEGIN
  IF NEW.organization_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF NOT public.booking_is_real_job(v_new) THEN
    RETURN NEW;
  END IF;
  IF v_old IS NOT NULL AND public.booking_is_real_job(v_old) THEN
    RETURN NEW;
  END IF;

  PERFORM public.record_activation_milestone(NEW.organization_id, 'first_job_booked', 'bookings.' || lower(TG_OP));
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'activation booking job hook failed: %', SQLERRM;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.activation_on_booking_job() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS activation_bookings_job ON public.bookings;
CREATE TRIGGER activation_bookings_job
  AFTER INSERT OR UPDATE OF is_draft, is_test ON public.bookings
  FOR EACH ROW
  EXECUTE FUNCTION public.activation_on_booking_job();

CREATE OR REPLACE FUNCTION public.activation_on_booking_payment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_new jsonb := to_jsonb(NEW);
  v_old jsonb := CASE WHEN TG_OP = 'UPDATE' THEN to_jsonb(OLD) ELSE NULL END;
BEGIN
  IF NEW.organization_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF NOT public.booking_is_payment(v_new) THEN
    RETURN NEW;
  END IF;
  IF v_old IS NOT NULL AND public.booking_is_payment(v_old) THEN
    RETURN NEW;
  END IF;

  PERFORM public.record_activation_milestone(
    NEW.organization_id,
    'first_payment_received',
    'bookings.payment'
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'activation booking payment hook failed: %', SQLERRM;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.activation_on_booking_payment() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS activation_bookings_payment ON public.bookings;
CREATE TRIGGER activation_bookings_payment
  AFTER INSERT OR UPDATE OF payment_status, deposit_paid, is_test, is_draft ON public.bookings
  FOR EACH ROW
  EXECUTE FUNCTION public.activation_on_booking_payment();

CREATE OR REPLACE FUNCTION public.activation_on_invoice_paid()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.organization_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF public.row_is_test(to_jsonb(NEW)) THEN
    RETURN NEW;
  END IF;
  IF lower(coalesce(NEW.status, '')) <> 'paid' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND lower(coalesce(OLD.status, '')) = 'paid' THEN
    RETURN NEW;
  END IF;

  PERFORM public.record_activation_milestone(NEW.organization_id, 'first_payment_received', 'invoices.paid');
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'activation invoice hook failed: %', SQLERRM;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.activation_on_invoice_paid() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS activation_invoices_paid ON public.invoices;
CREATE TRIGGER activation_invoices_paid
  AFTER INSERT OR UPDATE OF status ON public.invoices
  FOR EACH ROW
  EXECUTE FUNCTION public.activation_on_invoice_paid();

CREATE OR REPLACE FUNCTION public.activation_on_manual_payment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.organization_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF COALESCE(NEW.amount, 0) <= 0 THEN
    RETURN NEW;
  END IF;
  IF public.row_is_test(to_jsonb(NEW)) THEN
    RETURN NEW;
  END IF;

  PERFORM public.record_activation_milestone(NEW.organization_id, 'first_payment_received', 'manual_payments.insert');
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'activation manual payment hook failed: %', SQLERRM;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.activation_on_manual_payment() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS activation_manual_payments_insert ON public.manual_payments;
CREATE TRIGGER activation_manual_payments_insert
  AFTER INSERT ON public.manual_payments
  FOR EACH ROW
  EXECUTE FUNCTION public.activation_on_manual_payment();

-- ---------------------------------------------------------------------------
-- Last login
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.protect_last_login_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.last_login_at IS DISTINCT FROM OLD.last_login_at
     AND coalesce(current_setting('tw.allow_last_login', true), '') <> 'on' THEN
    NEW.last_login_at := OLD.last_login_at;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.protect_last_login_at() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS protect_profiles_last_login ON public.profiles;
CREATE TRIGGER protect_profiles_last_login
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_last_login_at();

DROP TRIGGER IF EXISTS protect_organizations_last_login ON public.organizations;
CREATE TRIGGER protect_organizations_last_login
  BEFORE UPDATE ON public.organizations
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_last_login_at();

CREATE OR REPLACE FUNCTION public.touch_account_last_login()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.last_sign_in_at IS NULL THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.last_sign_in_at IS NOT DISTINCT FROM OLD.last_sign_in_at THEN
    RETURN NEW;
  END IF;

  PERFORM set_config('tw.allow_last_login', 'on', true);

  UPDATE public.profiles
  SET last_login_at = NEW.last_sign_in_at
  WHERE id = NEW.id;

  UPDATE public.organizations o
  SET last_login_at = NEW.last_sign_in_at
  WHERE o.id IN (
    SELECT owned.id FROM public.organizations owned WHERE owned.owner_id = NEW.id
    UNION
    SELECT m.organization_id FROM public.org_memberships m WHERE m.user_id = NEW.id
    UNION
    SELECT s.organization_id FROM public.staff s
    WHERE s.user_id = NEW.id AND s.organization_id IS NOT NULL
  );

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'touch_account_last_login failed: %', SQLERRM;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.touch_account_last_login() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS on_auth_user_last_login ON auth.users;
CREATE TRIGGER on_auth_user_last_login
  AFTER INSERT OR UPDATE OF last_sign_in_at ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_account_last_login();

-- ---------------------------------------------------------------------------
-- Save attribution at signup. First write wins. The client sends raw values;
-- this function computes the normalized copies, including direct.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.save_signup_attribution(
  p_utm_source text DEFAULT NULL,
  p_utm_medium text DEFAULT NULL,
  p_utm_campaign text DEFAULT NULL,
  p_utm_term text DEFAULT NULL,
  p_utm_content text DEFAULT NULL,
  p_referrer text DEFAULT NULL,
  p_landing_page text DEFAULT NULL,
  p_captured_at timestamptz DEFAULT NULL
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
BEGIN
  IF v_uid IS NULL THEN
    RETURN;
  END IF;

  -- A capture taken after the account already existed (opening the dashboard
  -- on a later visit) must not be written as if it were the signup. A landing
  -- that happened before signup, or within an hour of it, is the first touch.
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

  v_source_raw := CASE WHEN p_utm_source IS NULL OR p_utm_source = '' THEN NULL ELSE left(p_utm_source, 500) END;
  v_medium_raw := CASE WHEN p_utm_medium IS NULL OR p_utm_medium = '' THEN NULL ELSE left(p_utm_medium, 500) END;
  v_campaign_raw := CASE WHEN p_utm_campaign IS NULL OR p_utm_campaign = '' THEN NULL ELSE left(p_utm_campaign, 500) END;
  v_term_raw := CASE WHEN p_utm_term IS NULL OR p_utm_term = '' THEN NULL ELSE left(p_utm_term, 500) END;
  v_content_raw := CASE WHEN p_utm_content IS NULL OR p_utm_content = '' THEN NULL ELSE left(p_utm_content, 500) END;

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
      captured_at
    ) VALUES (
      v_uid,
      v_source_raw,
      COALESCE(public.normalize_utm_value(v_source_raw), 'direct'),
      v_medium_raw,
      public.normalize_utm_value(v_medium_raw),
      v_campaign_raw,
      public.normalize_utm_value(v_campaign_raw),
      v_term_raw,
      public.normalize_utm_value(v_term_raw),
      v_content_raw,
      public.normalize_utm_value(v_content_raw),
      NULLIF(left(btrim(COALESCE(p_referrer, '')), 2000), ''),
      NULLIF(left(btrim(COALESCE(p_landing_page, '')), 2000), ''),
      v_landing
    )
    ON CONFLICT (user_id) DO NOTHING;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'save_signup_attribution insert failed: %', SQLERRM;
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
    RAISE WARNING 'save_signup_attribution org link failed: %', SQLERRM;
  END;
END;
$$;

REVOKE ALL ON FUNCTION public.save_signup_attribution(text, text, text, text, text, text, text, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_signup_attribution(text, text, text, text, text, text, text, timestamptz) TO authenticated;

-- ---------------------------------------------------------------------------
-- RLS: an org sees its own rows. Platform admins see every row.
-- Clients cannot insert or update. The functions above are the writers.
-- ---------------------------------------------------------------------------

ALTER TABLE public.organization_activation_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.account_signup_attribution ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.organization_activation_events FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.organization_activation_events TO authenticated;

REVOKE ALL ON TABLE public.account_signup_attribution FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.account_signup_attribution TO authenticated;

DROP POLICY IF EXISTS "Org members read own activation events" ON public.organization_activation_events;
CREATE POLICY "Org members read own activation events"
  ON public.organization_activation_events
  FOR SELECT
  TO authenticated
  USING (public.is_org_member(organization_id));

DROP POLICY IF EXISTS "Platform admins read all activation events" ON public.organization_activation_events;
CREATE POLICY "Platform admins read all activation events"
  ON public.organization_activation_events
  FOR SELECT
  TO authenticated
  USING (public.is_platform_admin());

DROP POLICY IF EXISTS "Users read own signup attribution" ON public.account_signup_attribution;
CREATE POLICY "Users read own signup attribution"
  ON public.account_signup_attribution
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Org members read own signup attribution" ON public.account_signup_attribution;
CREATE POLICY "Org members read own signup attribution"
  ON public.account_signup_attribution
  FOR SELECT
  TO authenticated
  USING (organization_id IS NOT NULL AND public.is_org_member(organization_id));

DROP POLICY IF EXISTS "Platform admins read all signup attribution" ON public.account_signup_attribution;
CREATE POLICY "Platform admins read all signup attribution"
  ON public.account_signup_attribution
  FOR SELECT
  TO authenticated
  USING (public.is_platform_admin());
