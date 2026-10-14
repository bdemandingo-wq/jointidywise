-- Activation milestones and first-touch signup attribution.
--
-- The owner runs this by hand in the SQL editor. It does not call Stripe.
-- This file does not open or commit its own transaction. The SQL editor
-- wraps the script. An extra BEGIN/COMMIT would commit that wrapper early.
--
-- Milestone keys (one row per organization, the first time it happens).
-- Keep this list identical to ACTIVATION_MILESTONES in
-- src/lib/activationMilestones.ts:
--   trial_signup            Trial signup
--   service_added           Add your first service
--   staff_added             Add your first staff member
--   openphone_connected     Connect OpenPhone
--   stripe_connected        Connect Stripe
--   first_job_booked        Create your first booking
--   clients_imported        Clients imported
--   first_payment_received  First client payment received
--
-- first_payment_received is a client of the cleaning business paying that
-- business (a booking, an invoice, or a manual payment). It is not TidyWise
-- subscription revenue.
--
-- openphone_connected and stripe_connected mean "first connected at".
-- Disconnecting does not delete the row. The setup checklist reads the live
-- row in organization_sms_settings / org_stripe_settings, not this ledger.
-- org_stripe_settings has no charges_enabled column. That flag lives on
-- staff_payout_accounts and describes a cleaner's payout account, which is
-- a different Stripe account. The org is connected when is_connected is true
-- or stripe_account_id is set (OAuth). Manual API keys set is_connected
-- with a null account id and still count. If a charges_enabled key is ever
-- present on the settings row and is false, that row is not connected.
--
-- Imported rows do not count as staff_added, first_job_booked, or
-- first_payment_received. created_via (or source) of migration_import or
-- csv_import is an import. Bookings whose notes still start with the
-- migration importer's "[Imported" prefix are imports too. clients_imported
-- is the milestone that does fire for those customer rows. service_added
-- does fire for an imported service: the business now has a service.
--
-- Last login is not a milestone. The app calls touch_my_last_login() after
-- sign-in. Each update is skipped when that row was stamped in the last 15
-- minutes. This file does not create a trigger on auth.users. Creating one
-- can fail in the SQL editor because this role does not own the auth schema,
-- and that failure would roll this whole transaction back.
--
-- UTM values are free text. Each UTM field is stored twice:
--   *_raw   the characters as received, or null when missing or whitespace
--   utm_*   trimmed and lowercased
-- When a signup has no utm_source, the normalized column is 'direct'.
-- The raw column stays null. 'direct' is never written into utm_source_raw.
--
-- The only URL pieces stored are the utm_* values, the landing path (no
-- origin, query string, or hash), and the referrer's domain (no path or
-- query). save_signup_attribution applies that reduction even if the client
-- sends a full URL. Invite hashes (access_token, refresh_token) are not
-- columns and are not kept.
--
-- Demo orgs never keep a milestone row. A row is demo when any of these
-- is true:
--   organization_pricing_settings.demo_mode_enabled
--   organizations / profiles / pricing-settings jsonb flags named
--     is_demo, demo_mode, demo_account, is_demo_account, is_demo_org
--   the org owner's email is applereview@tidywise.com,
--     applereview@tidywise1.com, or any @tidywise1.com address
--   the source row's is_test flag is true
-- support@tidywisecleaning.com is the owner's real account, not a demo.
-- Turning demo mode on deletes that org's milestone rows. Reads also hide
-- demo orgs, so a trial_signup written before the demo flag existed does
-- not show up.

-- ---------------------------------------------------------------------------
-- Columns on existing tables
-- ---------------------------------------------------------------------------

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS last_login_at timestamptz;

COMMENT ON COLUMN public.profiles.last_login_at IS
  'Last time this account called touch_my_last_login. Written only by that function. Clients cannot change it.';

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS last_login_at timestamptz;

COMMENT ON COLUMN public.organizations.last_login_at IS
  'Latest touch_my_last_login by the owner, a member, or a cleaner of this org.';

ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS created_via text;

COMMENT ON COLUMN public.customers.created_via IS
  'csv_import or migration_import when the row came from a client import. Null for customers added by hand, a booking, or a lead. The clients_imported milestone fires only for those two values.';

ALTER TABLE public.staff
  ADD COLUMN IF NOT EXISTS created_via text;

COMMENT ON COLUMN public.staff.created_via IS
  'migration_import or csv_import when the cleaner was imported. Null for staff added in TidyWise. staff_added ignores imported rows.';

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS created_via text;

COMMENT ON COLUMN public.bookings.created_via IS
  'migration_import or csv_import when the job was imported. Null for a job created in TidyWise. first_job_booked and first_payment_received ignore imported rows.';

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS created_via text;

COMMENT ON COLUMN public.invoices.created_via IS
  'migration_import or csv_import when the invoice was imported. Null for an invoice created in TidyWise. first_payment_received ignores imported rows. The migration importer does not insert invoices today; the column is here so an imported invoice cannot count as a native client payment.';

ALTER TABLE public.manual_payments
  ADD COLUMN IF NOT EXISTS created_via text;

COMMENT ON COLUMN public.manual_payments.created_via IS
  'migration_import or csv_import when the payment row was imported. Null for a payment recorded in TidyWise. first_payment_received ignores imported rows. This is a client paying the cleaning business, not TidyWise revenue.';

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
END $$;

-- A previous run of this file may have installed the shorter check list
-- (cleaner_added, no service / OpenPhone / Stripe). Drop that check before
-- renaming, because the old check rejects staff_added.
ALTER TABLE public.organization_activation_events
  DROP CONSTRAINT IF EXISTS organization_activation_events_milestone_check;

UPDATE public.organization_activation_events
SET milestone = 'staff_added'
WHERE milestone = 'cleaner_added';

ALTER TABLE public.organization_activation_events
  ADD CONSTRAINT organization_activation_events_milestone_check
  CHECK (milestone IN (
    'trial_signup',
    'service_added',
    'staff_added',
    'openphone_connected',
    'stripe_connected',
    'first_job_booked',
    'clients_imported',
    'first_payment_received'
  ));

COMMENT ON CONSTRAINT organization_activation_events_milestone_check
  ON public.organization_activation_events IS
  'Canonical milestone keys. first_payment_received is a client paying this cleaning business, not TidyWise subscription revenue. openphone_connected and stripe_connected are the first time that integration was connected.';

CREATE INDEX IF NOT EXISTS organization_activation_events_org_occurred_idx
  ON public.organization_activation_events (organization_id, occurred_at DESC);

COMMENT ON TABLE public.organization_activation_events IS
  'First time each activation milestone happened for an organization. Inserts are ON CONFLICT DO NOTHING. Disconnecting OpenPhone or Stripe, or deleting the service or staff member, does not remove the row. Demo orgs are deleted from this table and hidden on read.';

-- Failures inside milestone triggers land here. The business write still
-- commits. The post-deploy query at the bottom of this file reads this table.
CREATE TABLE IF NOT EXISTS public.activation_trigger_log (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id uuid,
  milestone text,
  source text,
  message text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS activation_trigger_log_created_idx
  ON public.activation_trigger_log (created_at DESC);

COMMENT ON TABLE public.activation_trigger_log IS
  'Warnings from activation triggers. A row here means a milestone was not recorded. The customer-facing write was not rolled back.';

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
  'First-touch marketing attribution for one account. utm_*_raw is the value as received. utm_* is trimmed and lowercased. utm_source is direct when no source was sent. Not an allowlist. Readable by the account, by org owners and admins, and by platform admins.';

COMMENT ON COLUMN public.account_signup_attribution.utm_source_raw IS
  'utm_source exactly as received. Null when the visit had no utm_source, or only whitespace. Never the word direct.';
COMMENT ON COLUMN public.account_signup_attribution.utm_source IS
  'Trimmed, lowercased utm_source. direct when utm_source_raw is null or blank after trim.';
COMMENT ON COLUMN public.account_signup_attribution.utm_medium_raw IS
  'utm_medium exactly as received. Null when missing or whitespace.';
COMMENT ON COLUMN public.account_signup_attribution.utm_medium IS
  'Trimmed, lowercased utm_medium. Null when absent.';
COMMENT ON COLUMN public.account_signup_attribution.utm_campaign_raw IS
  'utm_campaign exactly as received (often a post or page slug, or onboarding). Null when missing or whitespace.';
COMMENT ON COLUMN public.account_signup_attribution.utm_campaign IS
  'Trimmed, lowercased utm_campaign. Null when absent.';
COMMENT ON COLUMN public.account_signup_attribution.utm_term_raw IS
  'utm_term exactly as received. Null when missing or whitespace.';
COMMENT ON COLUMN public.account_signup_attribution.utm_term IS
  'Trimmed, lowercased utm_term. Null when absent.';
COMMENT ON COLUMN public.account_signup_attribution.utm_content_raw IS
  'utm_content exactly as received. Null when missing or whitespace.';
COMMENT ON COLUMN public.account_signup_attribution.utm_content IS
  'Trimmed, lowercased utm_content. Null when absent.';
COMMENT ON COLUMN public.account_signup_attribution.referrer IS
  'Hostname of the first captured referrer. No scheme, path, query, or hash. Lowercased.';
COMMENT ON COLUMN public.account_signup_attribution.landing_page IS
  'Path of the first captured landing. No origin, query string, or hash.';

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

-- Whitespace-only is absent. A value that still has characters after trim
-- is kept as received (not trimmed) so the raw column matches the URL.
CREATE OR REPLACE FUNCTION public.utm_raw_or_null(p_raw text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT CASE
    WHEN p_raw IS NULL OR btrim(left(p_raw, 500)) = '' THEN NULL
    ELSE left(p_raw, 500)
  END;
$$;

REVOKE ALL ON FUNCTION public.utm_raw_or_null(text) FROM PUBLIC, anon, authenticated;

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

  -- Direct RPC calls must not reveal whether some other org is a demo.
  -- A null auth.uid() is a trigger, the SQL editor, or the service role,
  -- and those callers still get the real answer. The org owner counts even
  -- before their membership row exists (org insert).
  IF auth.uid() IS NOT NULL
     AND NOT public.is_org_member(_org_id)
     AND NOT EXISTS (
       SELECT 1
       FROM public.organizations owned
       WHERE owned.id = _org_id
         AND owned.owner_id = auth.uid()
     )
     AND NOT public.is_platform_admin()
  THEN
    RETURN false;
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

-- Granted to authenticated so row-level policies can call it. Callers who
-- are not a member, the owner, or a platform admin get false, not the real
-- demo bit. It does not return the owner email.
REVOKE ALL ON FUNCTION public.activation_subject_is_demo(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.activation_subject_is_demo(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.activation_log_warning(
  _org_id uuid,
  _milestone text,
  _source text,
  _message text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.activation_trigger_log (organization_id, milestone, source, message)
  VALUES (
    _org_id,
    NULLIF(left(coalesce(_milestone, ''), 80), ''),
    NULLIF(left(coalesce(_source, ''), 80), ''),
    left(coalesce(_message, 'unknown'), 500)
  );
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'activation_log_warning failed: %', SQLERRM;
END;
$$;

REVOKE ALL ON FUNCTION public.activation_log_warning(uuid, text, text, text) FROM PUBLIC, anon, authenticated;

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
  PERFORM public.activation_log_warning(_org_id, _milestone, _source, SQLERRM);
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

-- Keep the two created_via values in sync with IMPORTED_CREATED_VIA in
-- src/lib/activationMilestones.ts. The notes prefix is the label the
-- migration importer wrote before created_via existed.
CREATE OR REPLACE FUNCTION public.row_is_imported(p_row jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT lower(btrim(coalesce(p_row ->> 'created_via', ''))) IN ('migration_import', 'csv_import')
      OR lower(btrim(coalesce(p_row ->> 'source', ''))) IN ('migration_import', 'csv_import')
      OR btrim(coalesce(p_row ->> 'notes', '')) ILIKE '[Imported%';
$$;

REVOKE ALL ON FUNCTION public.row_is_imported(jsonb) FROM PUBLIC, anon, authenticated;

-- A native job: not a test, not a draft, not an import.
CREATE OR REPLACE FUNCTION public.booking_is_real_job(p_row jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT NOT public.jsonb_flag_true(p_row, 'is_test')
     AND NOT public.jsonb_flag_true(p_row, 'is_draft')
     AND NOT public.row_is_imported(p_row);
$$;

REVOKE ALL ON FUNCTION public.booking_is_real_job(jsonb) FROM PUBLIC, anon, authenticated;

-- A client of this org paying this org. Not a TidyWise subscription charge.
-- Imported bookings are not a native payment even when payment_status is paid.
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

-- API key and phone number both saved. The checklist uses the same rule
-- against live columns, not the milestone row.
CREATE OR REPLACE FUNCTION public.org_openphone_is_connected(p_row jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT NULLIF(btrim(coalesce(p_row ->> 'openphone_api_key', '')), '') IS NOT NULL
     AND NULLIF(btrim(coalesce(p_row ->> 'openphone_phone_number_id', '')), '') IS NOT NULL;
$$;

REVOKE ALL ON FUNCTION public.org_openphone_is_connected(jsonb) FROM PUBLIC, anon, authenticated;

-- See the header comment for why charges_enabled is not required unless the
-- key is actually present on this row.
CREATE OR REPLACE FUNCTION public.org_stripe_is_connected(p_row jsonb)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  IF p_row IS NULL THEN
    RETURN false;
  END IF;
  IF p_row ? 'charges_enabled' AND NOT public.jsonb_flag_true(p_row, 'charges_enabled') THEN
    RETURN false;
  END IF;
  IF public.jsonb_flag_true(p_row, 'is_connected') THEN
    RETURN true;
  END IF;
  RETURN NULLIF(btrim(coalesce(p_row ->> 'stripe_account_id', '')), '') IS NOT NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.org_stripe_is_connected(jsonb) FROM PUBLIC, anon, authenticated;

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
    -- Demo mode usually lands on organization_pricing_settings after this
    -- insert. record_activation_milestone skips orgs that are already demo
    -- (review emails, flags on the org row). A later demo_mode_enabled = true
    -- deletes the row. Reads hide demo orgs either way.
    IF NOT public.activation_subject_is_demo(NEW.id)
       AND COALESCE(NULLIF(lower(btrim(COALESCE(NEW.plan_type, ''))), ''), 'trial') IN ('trial', 'free') THEN
      PERFORM public.record_activation_milestone(NEW.id, 'trial_signup', 'organizations.insert');
    END IF;
  EXCEPTION WHEN OTHERS THEN
    PERFORM public.activation_log_warning(NEW.id, 'trial_signup', 'organizations.insert', SQLERRM);
  END;

  BEGIN
    UPDATE public.account_signup_attribution
    SET organization_id = NEW.id,
        updated_at = now()
    WHERE user_id = NEW.owner_id
      AND organization_id IS NULL;
  EXCEPTION WHEN OTHERS THEN
    PERFORM public.activation_log_warning(NEW.id, NULL, 'organizations.attribution', SQLERRM);
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

CREATE OR REPLACE FUNCTION public.activation_purge_if_demo()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row jsonb := to_jsonb(NEW);
  v_org uuid;
BEGIN
  -- organization_pricing_settings uses organization_id. organizations uses id.
  -- Prefer organization_id so a settings row's own id is not treated as an org.
  BEGIN
    v_org := NULLIF(v_row ->> 'organization_id', '')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    v_org := NULL;
  END;
  IF v_org IS NULL THEN
    BEGIN
      v_org := NULLIF(v_row ->> 'id', '')::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
      v_org := NULL;
    END;
  END IF;
  IF v_org IS NULL THEN
    RETURN NEW;
  END IF;
  IF public.activation_subject_is_demo(v_org) THEN
    DELETE FROM public.organization_activation_events
    WHERE organization_id = v_org;
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  PERFORM public.activation_log_warning(v_org, NULL, 'demo_purge', SQLERRM);
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.activation_purge_if_demo() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS activation_purge_demo_pricing ON public.organization_pricing_settings;
CREATE TRIGGER activation_purge_demo_pricing
  AFTER INSERT OR UPDATE OF demo_mode_enabled ON public.organization_pricing_settings
  FOR EACH ROW
  EXECUTE FUNCTION public.activation_purge_if_demo();

-- organizations has no dedicated demo column in this schema. The flag that
-- exists today is organization_pricing_settings.demo_mode_enabled, covered
-- above. This trigger follows owner_id (a new owner can be a demo email)
-- and any of the jsonb flag names activation_subject_is_demo already reads,
-- if that column is present. Re-running the file rebuilds the column list.
DO $$
DECLARE
  v_cols text;
BEGIN
  SELECT string_agg(quote_ident(c.column_name), ', ' ORDER BY c.column_name)
    INTO v_cols
  FROM information_schema.columns c
  WHERE c.table_schema = 'public'
    AND c.table_name = 'organizations'
    AND c.column_name IN (
      'owner_id',
      'is_demo',
      'demo_mode',
      'demo_account',
      'is_demo_account',
      'is_demo_org',
      'demo_mode_enabled'
    );

  IF v_cols IS NULL OR btrim(v_cols) = '' THEN
    RAISE EXCEPTION 'organizations has none of the demo-purge columns';
  END IF;

  EXECUTE 'DROP TRIGGER IF EXISTS activation_purge_demo_organization ON public.organizations';
  EXECUTE format(
    'CREATE TRIGGER activation_purge_demo_organization
       AFTER INSERT OR UPDATE OF %s ON public.organizations
       FOR EACH ROW
       EXECUTE FUNCTION public.activation_purge_if_demo()',
    v_cols
  );
END $$;

CREATE OR REPLACE FUNCTION public.activation_on_service_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.organization_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF COALESCE(NEW.is_active, false) IS NOT TRUE THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND COALESCE(OLD.is_active, false) IS TRUE THEN
    RETURN NEW;
  END IF;
  IF public.row_is_test(to_jsonb(NEW)) THEN
    RETURN NEW;
  END IF;

  PERFORM public.record_activation_milestone(NEW.organization_id, 'service_added', 'services.' || lower(TG_OP));
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  PERFORM public.activation_log_warning(NEW.organization_id, 'service_added', 'services', SQLERRM);
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.activation_on_service_change() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS activation_services_change ON public.services;
CREATE TRIGGER activation_services_change
  AFTER INSERT OR UPDATE OF is_active ON public.services
  FOR EACH ROW
  EXECUTE FUNCTION public.activation_on_service_change();

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
  IF public.row_is_test(to_jsonb(NEW)) OR public.row_is_imported(to_jsonb(NEW)) THEN
    RETURN NEW;
  END IF;

  PERFORM public.record_activation_milestone(NEW.organization_id, 'staff_added', 'staff.' || lower(TG_OP));
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  PERFORM public.activation_log_warning(NEW.organization_id, 'staff_added', 'staff', SQLERRM);
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
  PERFORM public.activation_log_warning(NEW.organization_id, 'clients_imported', 'customers', SQLERRM);
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.activation_on_customer_insert() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS activation_customers_import ON public.customers;
CREATE TRIGGER activation_customers_import
  AFTER INSERT ON public.customers
  FOR EACH ROW
  EXECUTE FUNCTION public.activation_on_customer_insert();

CREATE OR REPLACE FUNCTION public.activation_on_openphone_change()
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
  IF NOT public.org_openphone_is_connected(v_new) THEN
    RETURN NEW;
  END IF;
  IF v_old IS NOT NULL AND public.org_openphone_is_connected(v_old) THEN
    RETURN NEW;
  END IF;

  PERFORM public.record_activation_milestone(
    NEW.organization_id,
    'openphone_connected',
    'organization_sms_settings.' || lower(TG_OP)
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  PERFORM public.activation_log_warning(NEW.organization_id, 'openphone_connected', 'organization_sms_settings', SQLERRM);
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.activation_on_openphone_change() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS activation_openphone_connected ON public.organization_sms_settings;
CREATE TRIGGER activation_openphone_connected
  AFTER INSERT OR UPDATE OF openphone_api_key, openphone_phone_number_id
  ON public.organization_sms_settings
  FOR EACH ROW
  EXECUTE FUNCTION public.activation_on_openphone_change();

CREATE OR REPLACE FUNCTION public.activation_on_stripe_change()
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
  IF NOT public.org_stripe_is_connected(v_new) THEN
    RETURN NEW;
  END IF;
  IF v_old IS NOT NULL AND public.org_stripe_is_connected(v_old) THEN
    RETURN NEW;
  END IF;

  PERFORM public.record_activation_milestone(
    NEW.organization_id,
    'stripe_connected',
    'org_stripe_settings.' || lower(TG_OP)
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  PERFORM public.activation_log_warning(NEW.organization_id, 'stripe_connected', 'org_stripe_settings', SQLERRM);
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.activation_on_stripe_change() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS activation_stripe_connected ON public.org_stripe_settings;
CREATE TRIGGER activation_stripe_connected
  AFTER INSERT OR UPDATE OF is_connected, stripe_account_id, stripe_secret_key
  ON public.org_stripe_settings
  FOR EACH ROW
  EXECUTE FUNCTION public.activation_on_stripe_change();

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
  PERFORM public.activation_log_warning(NEW.organization_id, 'first_job_booked', 'bookings', SQLERRM);
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.activation_on_booking_job() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS activation_bookings_job ON public.bookings;
CREATE TRIGGER activation_bookings_job
  AFTER INSERT OR UPDATE OF is_draft, is_test, created_via ON public.bookings
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
  -- Client paid this cleaning business. Not a TidyWise subscription charge.
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
  PERFORM public.activation_log_warning(NEW.organization_id, 'first_payment_received', 'bookings.payment', SQLERRM);
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.activation_on_booking_payment() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS activation_bookings_payment ON public.bookings;
CREATE TRIGGER activation_bookings_payment
  AFTER INSERT OR UPDATE OF payment_status, deposit_paid, is_test, is_draft, created_via ON public.bookings
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
  IF public.row_is_test(to_jsonb(NEW)) OR public.row_is_imported(to_jsonb(NEW)) THEN
    RETURN NEW;
  END IF;
  IF lower(coalesce(NEW.status, '')) <> 'paid' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND lower(coalesce(OLD.status, '')) = 'paid' THEN
    RETURN NEW;
  END IF;

  -- Client paid this cleaning business. Not a TidyWise subscription charge.
  PERFORM public.record_activation_milestone(NEW.organization_id, 'first_payment_received', 'invoices.paid');
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  PERFORM public.activation_log_warning(NEW.organization_id, 'first_payment_received', 'invoices.paid', SQLERRM);
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.activation_on_invoice_paid() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS activation_invoices_paid ON public.invoices;
CREATE TRIGGER activation_invoices_paid
  AFTER INSERT OR UPDATE OF status, created_via ON public.invoices
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
  IF public.row_is_test(to_jsonb(NEW)) OR public.row_is_imported(to_jsonb(NEW)) THEN
    RETURN NEW;
  END IF;

  -- Client paid this cleaning business. Not a TidyWise subscription charge.
  PERFORM public.record_activation_milestone(NEW.organization_id, 'first_payment_received', 'manual_payments.insert');
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  PERFORM public.activation_log_warning(NEW.organization_id, 'first_payment_received', 'manual_payments.insert', SQLERRM);
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
-- Last login. No trigger on auth.users.
--
-- If an earlier draft of this file created on_auth_user_last_login, leave
-- that trigger in place until a role that owns auth.users runs:
--   DROP TRIGGER IF EXISTS on_auth_user_last_login ON auth.users;
-- The function it calls is kept below so sign-in does not break in the
-- meantime. New installs never create the trigger. The app calls
-- touch_my_last_login() after a session is established.
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

-- Retained for a draft trigger on auth.users. Not created by this file.
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
  PERFORM public.activation_log_warning(NULL, NULL, 'auth.last_sign_in', SQLERRM);
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.touch_account_last_login() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.touch_my_last_login()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_now timestamptz := now();
BEGIN
  IF v_uid IS NULL THEN
    RETURN;
  END IF;

  PERFORM set_config('tw.allow_last_login', 'on', true);

  -- Skip a row stamped in the last 15 minutes so a refresh does not write.
  UPDATE public.profiles
  SET last_login_at = v_now
  WHERE id = v_uid
    AND (last_login_at IS NULL OR last_login_at < now() - interval '15 minutes');

  UPDATE public.organizations o
  SET last_login_at = v_now
  WHERE (o.last_login_at IS NULL OR o.last_login_at < now() - interval '15 minutes')
    AND o.id IN (
      SELECT owned.id FROM public.organizations owned WHERE owned.owner_id = v_uid
      UNION
      SELECT m.organization_id FROM public.org_memberships m WHERE m.user_id = v_uid
      UNION
      SELECT s.organization_id FROM public.staff s
      WHERE s.user_id = v_uid AND s.organization_id IS NOT NULL
    );
END;
$$;

REVOKE ALL ON FUNCTION public.touch_my_last_login() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.touch_my_last_login() TO authenticated;

-- ---------------------------------------------------------------------------
-- Save attribution at signup. First write wins. The client sends raw utm
-- values; this function stores null for whitespace-only and computes the
-- normalized copies, including direct. Referrer is reduced to a domain and
-- landing page to a path, so a full URL cannot land in the table.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.signup_landing_path(p_value text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v text := btrim(COALESCE(p_value, ''));
  v_hash text;
BEGIN
  IF v = '' THEN
    RETURN NULL;
  END IF;
  IF position('://' in v) > 0 THEN
    v := regexp_replace(v, '^[^:]+://[^/?#]*', '');
    IF v = '' THEN
      v := '/';
    END IF;
  END IF;
  IF position('#' in v) > 0 THEN
    v_hash := substring(v from position('#' in v));
    IF v_hash ~ '^#/' THEN
      v := substring(v_hash from 2);
    ELSE
      v := substring(v from 1 for position('#' in v) - 1);
    END IF;
  END IF;
  IF position('?' in v) > 0 THEN
    v := substring(v from 1 for position('?' in v) - 1);
  END IF;
  IF position('&' in v) > 0 THEN
    v := substring(v from 1 for position('&' in v) - 1);
  END IF;
  v := btrim(v);
  IF v = '' THEN
    RETURN '/';
  END IF;
  IF left(v, 1) <> '/' THEN
    v := '/' || v;
  END IF;
  RETURN NULLIF(left(v, 2000), '');
END;
$$;

REVOKE ALL ON FUNCTION public.signup_landing_path(text) FROM PUBLIC, anon, authenticated;

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
  IF v ~ '^\[[0-9a-fA-F:]+\]' THEN
    v := substring(v from 2 for position(']' in v) - 2);
  ELSE
    v := split_part(v, ':', 1);
  END IF;
  v := lower(btrim(v));
  IF v = '' OR position(' ' in v) > 0 THEN
    RETURN NULL;
  END IF;
  RETURN NULLIF(left(v, 253), '');
END;
$$;

REVOKE ALL ON FUNCTION public.signup_referrer_domain(text) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Save attribution at signup.
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

  v_source_raw := public.utm_raw_or_null(p_utm_source);
  v_medium_raw := public.utm_raw_or_null(p_utm_medium);
  v_campaign_raw := public.utm_raw_or_null(p_utm_campaign);
  v_term_raw := public.utm_raw_or_null(p_utm_term);
  v_content_raw := public.utm_raw_or_null(p_utm_content);

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
      public.signup_referrer_domain(p_referrer),
      public.signup_landing_path(p_landing_page),
      v_landing
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

REVOKE ALL ON FUNCTION public.save_signup_attribution(text, text, text, text, text, text, text, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_signup_attribution(text, text, text, text, text, text, text, timestamptz) TO authenticated;

-- ---------------------------------------------------------------------------
-- RLS. An org sees its own milestone rows, except demo orgs, which are
-- hidden even if a row was written before the demo flag existed. Platform
-- admins see every non-demo row. Clients cannot insert or update.
-- Signup attribution is limited to the account itself, org owners and
-- admins, and platform admins. Cleaners and managers cannot read it.
-- ---------------------------------------------------------------------------

ALTER TABLE public.organization_activation_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.account_signup_attribution ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.activation_trigger_log ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.organization_activation_events FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.organization_activation_events TO authenticated;

REVOKE ALL ON TABLE public.account_signup_attribution FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.account_signup_attribution TO authenticated;

REVOKE ALL ON TABLE public.activation_trigger_log FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.activation_trigger_log TO authenticated;

DROP POLICY IF EXISTS "Org members read own activation events" ON public.organization_activation_events;
CREATE POLICY "Org members read own activation events"
  ON public.organization_activation_events
  FOR SELECT
  TO authenticated
  USING (
    public.is_org_member(organization_id)
    AND NOT public.activation_subject_is_demo(organization_id)
  );

DROP POLICY IF EXISTS "Platform admins read all activation events" ON public.organization_activation_events;
CREATE POLICY "Platform admins read all activation events"
  ON public.organization_activation_events
  FOR SELECT
  TO authenticated
  USING (
    public.is_platform_admin()
    AND NOT public.activation_subject_is_demo(organization_id)
  );

DROP POLICY IF EXISTS "Users read own signup attribution" ON public.account_signup_attribution;
CREATE POLICY "Users read own signup attribution"
  ON public.account_signup_attribution
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Org members read own signup attribution" ON public.account_signup_attribution;
DROP POLICY IF EXISTS "Org owners and admins read signup attribution" ON public.account_signup_attribution;
CREATE POLICY "Org owners and admins read signup attribution"
  ON public.account_signup_attribution
  FOR SELECT
  TO authenticated
  USING (
    organization_id IS NOT NULL
    AND (
      EXISTS (
        SELECT 1
        FROM public.org_memberships m
        WHERE m.organization_id = account_signup_attribution.organization_id
          AND m.user_id = auth.uid()
          AND m.role IN ('owner', 'admin')
      )
      OR EXISTS (
        SELECT 1
        FROM public.organizations o
        WHERE o.id = account_signup_attribution.organization_id
          AND o.owner_id = auth.uid()
      )
    )
  );

DROP POLICY IF EXISTS "Platform admins read all signup attribution" ON public.account_signup_attribution;
CREATE POLICY "Platform admins read all signup attribution"
  ON public.account_signup_attribution
  FOR SELECT
  TO authenticated
  USING (public.is_platform_admin());

DROP POLICY IF EXISTS "Platform admins read activation trigger log" ON public.activation_trigger_log;
CREATE POLICY "Platform admins read activation trigger log"
  ON public.activation_trigger_log
  FOR SELECT
  TO authenticated
  USING (public.is_platform_admin());

-- security_invoker so the caller's RLS still applies, plus the demo filter
-- for readers that query the view directly.
CREATE OR REPLACE VIEW public.organization_activation_events_live
WITH (security_invoker = true) AS
SELECT
  e.id,
  e.organization_id,
  e.milestone,
  e.occurred_at,
  e.source,
  e.created_at
FROM public.organization_activation_events e
WHERE NOT public.activation_subject_is_demo(e.organization_id);

COMMENT ON VIEW public.organization_activation_events_live IS
  'Activation milestones with demo orgs removed. Current OpenPhone, Stripe, service, and staff status is not in this view; read those tables for live connection state.';

GRANT SELECT ON public.organization_activation_events_live TO authenticated;

-- Checklist "Create your first booking" uses this so imported jobs do not
-- count. Same predicate as the first_job_booked trigger.
CREATE OR REPLACE FUNCTION public.org_has_native_booking(_org_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF _org_id IS NULL THEN
    RETURN false;
  END IF;
  IF auth.uid() IS NOT NULL
     AND NOT public.is_org_member(_org_id)
     AND NOT EXISTS (
       SELECT 1
       FROM public.organizations owned
       WHERE owned.id = _org_id
         AND owned.owner_id = auth.uid()
     )
     AND NOT public.is_platform_admin()
  THEN
    RETURN false;
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM public.bookings b
    WHERE b.organization_id = _org_id
      AND public.booking_is_real_job(to_jsonb(b))
  );
END;
$$;

REVOKE ALL ON FUNCTION public.org_has_native_booking(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.org_has_native_booking(uuid) TO authenticated;

-- Drop activation_trigger_log rows older than 90 days. pg_cron is already
-- used in this project. Unschedule first so a second run replaces the job
-- instead of failing on a duplicate name. Skip quietly when the extension
-- is absent so this file can still be applied.
CREATE OR REPLACE FUNCTION public.activation_trigger_log_purge()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.activation_trigger_log
  WHERE created_at < now() - interval '90 days';
END;
$$;

REVOKE ALL ON FUNCTION public.activation_trigger_log_purge() FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE WARNING 'pg_cron is not installed; activation_trigger_log rows older than 90 days will not be deleted automatically';
    RETURN;
  END IF;

  BEGIN
    PERFORM cron.unschedule('activation-trigger-log-purge');
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  PERFORM cron.schedule(
    'activation-trigger-log-purge',
    '15 3 * * *',
    $cron$ SELECT public.activation_trigger_log_purge(); $cron$
  );
END $$;

-- ---------------------------------------------------------------------------
-- Post-deploy verification. These statements are comments so applying the
-- file does not depend on them. Run them in the SQL editor after this file.
-- A growing activation_trigger_log means a trigger is failing quietly.
-- The business write still succeeded; the milestone did not.
--
-- Milestone counts, demo orgs excluded:
--
-- SELECT milestone, count(*) AS orgs
-- FROM public.organization_activation_events e
-- WHERE NOT public.activation_subject_is_demo(e.organization_id)
-- GROUP BY milestone
-- ORDER BY milestone;
--
-- Demo rows that should already have been deleted (expect 0):
--
-- SELECT count(*) AS demo_rows_still_present
-- FROM public.organization_activation_events e
-- WHERE public.activation_subject_is_demo(e.organization_id);
--
-- Recent trigger warnings:
--
-- SELECT created_at, organization_id, milestone, source, message
-- FROM public.activation_trigger_log
-- ORDER BY created_at DESC
-- LIMIT 50;
--
-- Triggers this file installs. on_auth_user_last_login must not appear
-- unless an earlier draft created it:
--
-- SELECT c.relname AS table_name, t.tgname
-- FROM pg_trigger t
-- JOIN pg_class c ON c.oid = t.tgrelid
-- WHERE NOT t.tgisinternal
--   AND t.tgname LIKE 'activation_%'
-- ORDER BY 1, 2;
--
-- Optional, only if a draft trigger exists and the role owns auth.users:
--
-- DROP TRIGGER IF EXISTS on_auth_user_last_login ON auth.users;
-- ---------------------------------------------------------------------------
