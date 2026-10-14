-- Cleaner location consent log for On My Way.
-- Append-only. A cleaner inserts and reads their own rows. Org owners and
-- admins read their org. Platform admins read all. No client update or delete.
-- Tracking coordinates are rejected unless the latest decision is granted
-- or toggled_on. Safe to run more than once.

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

-- Coordinate writes require a current yes. Stopping a session (is_active,
-- arrived_at) does not write a new point and stays allowed.
CREATE OR REPLACE FUNCTION public.enforce_cleaner_location_tracking_consent()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  latest_decision text;
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.latitude IS NOT DISTINCT FROM OLD.latitude
     AND NEW.longitude IS NOT DISTINCT FROM OLD.longitude
     AND NEW.recorded_at IS NOT DISTINCT FROM OLD.recorded_at
  THEN
    RETURN NEW;
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

-- The consent text says sharing ends when the job starts or is cancelled.
-- in_progress and completed were already covered. cancelled was not.
CREATE OR REPLACE FUNCTION public.deactivate_tracking_on_status_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status IN ('in_progress', 'completed', 'cancelled') AND OLD.status IS DISTINCT FROM NEW.status THEN
    UPDATE public.cleaner_location_tracking
    SET is_active = false
    WHERE booking_id = NEW.id
      AND is_active = true;
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON TABLE public.cleaner_location_consents IS
  'Append-only On My Way location decisions. Latest row for a staff_id gates cleaner_location_tracking coordinate writes.';

COMMIT;
