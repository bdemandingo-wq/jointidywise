-- Cleaner location consent log for On My Way.
-- Append-only. A cleaner inserts and reads their own rows. Org owners and
-- admins read their org. Platform admins read all. No client update or delete.
-- Tracking coordinates are rejected unless the remote switch
-- cleaner_location_tracking_enabled is true and the latest decision is
-- granted or toggled_on. The switch defaults to false. Safe to run more
-- than once. Closing a session and the 30-day coordinate redaction live
-- in the tracking map migration, not here.

BEGIN;

CREATE TABLE IF NOT EXISTS public.cleaner_location_consents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id uuid NOT NULL REFERENCES public.staff(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  decision text NOT NULL,
  copy_version text NOT NULL,
  source text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'cleaner_location_consents_decision_chk'
      AND conrelid = 'public.cleaner_location_consents'::regclass
  ) THEN
    ALTER TABLE public.cleaner_location_consents
      ADD CONSTRAINT cleaner_location_consents_decision_chk
      CHECK (decision IN ('granted', 'declined', 'toggled_on', 'toggled_off', 'os_denied'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'cleaner_location_consents_source_chk'
      AND conrelid = 'public.cleaner_location_consents'::regclass
  ) THEN
    ALTER TABLE public.cleaner_location_consents
      ADD CONSTRAINT cleaner_location_consents_source_chk
      CHECK (source IN ('first_run_sheet', 'settings'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS cleaner_location_consents_staff_created_idx
  ON public.cleaner_location_consents (staff_id, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS cleaner_location_consents_org_created_idx
  ON public.cleaner_location_consents (organization_id, created_at DESC);

ALTER TABLE public.cleaner_location_consents ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.cleaner_location_consents FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON TABLE public.cleaner_location_consents TO authenticated;
GRANT ALL ON TABLE public.cleaner_location_consents TO service_role;

DROP POLICY IF EXISTS "Cleaners insert own location consent" ON public.cleaner_location_consents;
CREATE POLICY "Cleaners insert own location consent"
  ON public.cleaner_location_consents
  FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM public.staff s
      WHERE s.id = cleaner_location_consents.staff_id
        AND s.user_id = auth.uid()
        AND s.organization_id = cleaner_location_consents.organization_id
        AND s.is_active = true
    )
  );

DROP POLICY IF EXISTS "Cleaners read own location consent" ON public.cleaner_location_consents;
CREATE POLICY "Cleaners read own location consent"
  ON public.cleaner_location_consents
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.staff s
      WHERE s.id = cleaner_location_consents.staff_id
        AND s.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Org owners and admins read location consent" ON public.cleaner_location_consents;
CREATE POLICY "Org owners and admins read location consent"
  ON public.cleaner_location_consents
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.org_memberships m
      WHERE m.organization_id = cleaner_location_consents.organization_id
        AND m.user_id = auth.uid()
        AND m.role IN ('owner', 'admin')
    )
  );

DROP POLICY IF EXISTS "Platform admins read location consent" ON public.cleaner_location_consents;
CREATE POLICY "Platform admins read location consent"
  ON public.cleaner_location_consents
  FOR SELECT
  TO authenticated
  USING (public.is_platform_admin());

-- The client cannot choose created_at, so a row cannot be backdated ahead of
-- a later decision.
CREATE OR REPLACE FUNCTION public.stamp_cleaner_location_consent_created_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.created_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_cleaner_location_consent_created_at ON public.cleaner_location_consents;
CREATE TRIGGER trg_cleaner_location_consent_created_at
  BEFORE INSERT ON public.cleaner_location_consents
  FOR EACH ROW
  EXECUTE FUNCTION public.stamp_cleaner_location_consent_created_at();

REVOKE ALL ON FUNCTION public.stamp_cleaner_location_consent_created_at() FROM PUBLIC, anon, authenticated;

-- No UPDATE or DELETE policy, and authenticated has no UPDATE or DELETE
-- grant. A reject trigger is not used: deleting a cleaner cascades into
-- this table, and a reject trigger would block that delete. Clients still
-- cannot update or delete rows through the API.

-- Remote switch. Defaults off. Tracking also requires a current yes.
-- Re-running this file does not turn a later manual flip back off.
INSERT INTO public.platform_settings (key, value)
VALUES ('cleaner_location_tracking_enabled', 'false'::jsonb)
ON CONFLICT (key) DO NOTHING;

DROP POLICY IF EXISTS "Signed-in users can read location tracking switch" ON public.platform_settings;
CREATE POLICY "Signed-in users can read location tracking switch"
  ON public.platform_settings
  FOR SELECT
  TO authenticated
  USING (key = 'cleaner_location_tracking_enabled');

-- New On My Way points require the switch and a current yes.
-- Stopping a session, and clearing coordinates on an inactive row
-- (the 30-day redaction in PR #51), are not new shares.
-- Job-photo GPS is stored on booking_photos, not this table.
CREATE OR REPLACE FUNCTION public.enforce_cleaner_location_tracking_consent()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  latest_decision text;
  tracking_enabled boolean;
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.latitude IS NOT DISTINCT FROM OLD.latitude
     AND NEW.longitude IS NOT DISTINCT FROM OLD.longitude
     AND NEW.recorded_at IS NOT DISTINCT FROM OLD.recorded_at
  THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE'
     AND NEW.is_active = false
     AND NEW.latitude IS NULL
     AND NEW.longitude IS NULL
  THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE((value #>> '{}') = 'true', false)
    INTO tracking_enabled
  FROM public.platform_settings
  WHERE key = 'cleaner_location_tracking_enabled';

  IF NOT COALESCE(tracking_enabled, false) THEN
    RAISE EXCEPTION 'location tracking disabled'
      USING ERRCODE = '42501';
  END IF;

  SELECT c.decision
    INTO latest_decision
  FROM public.cleaner_location_consents c
  WHERE c.staff_id = NEW.staff_id
  ORDER BY c.created_at DESC, c.id DESC
  LIMIT 1;

  IF latest_decision IS DISTINCT FROM 'granted' AND latest_decision IS DISTINCT FROM 'toggled_on' THEN
    RAISE EXCEPTION 'location consent required'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_cleaner_location_tracking_consent() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_cleaner_location_require_consent ON public.cleaner_location_tracking;
CREATE TRIGGER trg_cleaner_location_require_consent
  BEFORE INSERT OR UPDATE ON public.cleaner_location_tracking
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_cleaner_location_tracking_consent();

COMMENT ON TABLE public.cleaner_location_consents IS
  'Append-only On My Way location decisions. Latest row for a staff_id gates cleaner_location_tracking coordinate writes.';

COMMIT;
