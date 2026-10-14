-- One trial_started marketing pixel per organization.
--
-- The browser may fire the pixel only when this function returns true.
-- It does not send anything to Google or Meta. It stamps
-- organizations.trial_started_pixel_at the first time the org owner or an
-- admin claims it, and only while the org is still on the card-free trial
-- and was created in the last 24 hours. A second caller gets false.
--
-- Safe to re-run. The column add is IF NOT EXISTS and the function is
-- replaced.
--
-- The stamp column is not protected. Supabase grants UPDATE on the whole
-- organizations table, and a column-level REVOKE does not override that
-- table-wide grant. The worst case is an owner suppressing their own
-- event. This migration does not change RLS.

BEGIN;

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS trial_started_pixel_at timestamptz;

COMMENT ON COLUMN public.organizations.trial_started_pixel_at IS
  'Set once when the org owner or an admin claims the trial_started marketing pixel. Not a report to Google or Meta. The column is not protected from a table UPDATE; the worst case is an owner suppressing their own event.';

CREATE OR REPLACE FUNCTION public.claim_trial_started_pixel(p_org uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_owner uuid;
  v_created timestamptz;
  v_plan text;
  v_claimed timestamptz;
  v_allowed boolean := false;
  v_id uuid;
BEGIN
  IF v_uid IS NULL OR p_org IS NULL THEN
    RETURN false;
  END IF;

  SELECT o.owner_id, o.created_at, o.plan_type, o.trial_started_pixel_at
    INTO v_owner, v_created, v_plan, v_claimed
  FROM public.organizations o
  WHERE o.id = p_org
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  IF v_owner = v_uid THEN
    v_allowed := true;
  ELSIF EXISTS (
    SELECT 1
    FROM public.org_memberships m
    WHERE m.organization_id = p_org
      AND m.user_id = v_uid
      AND m.role IN ('owner', 'admin')
  ) THEN
    v_allowed := true;
  END IF;

  IF NOT v_allowed THEN
    RETURN false;
  END IF;

  -- Already claimed. The first caller is the only one that gets true.
  IF v_claimed IS NOT NULL THEN
    RETURN false;
  END IF;

  IF v_created IS NULL
     OR v_created < now() - interval '24 hours'
     OR v_created > now() THEN
    RETURN false;
  END IF;

  IF lower(btrim(COALESCE(v_plan, ''))) <> 'trial' THEN
    RETURN false;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = v_owner
      AND p.trial_ends_at IS NOT NULL
      AND p.trial_ends_at > now()
  ) THEN
    RETURN false;
  END IF;

  UPDATE public.organizations
  SET trial_started_pixel_at = now()
  WHERE id = p_org
    AND trial_started_pixel_at IS NULL
  RETURNING id INTO v_id;

  RETURN v_id IS NOT NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_trial_started_pixel(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_trial_started_pixel(uuid) TO authenticated;

COMMIT;
