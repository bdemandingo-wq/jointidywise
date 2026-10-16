-- Team-claim follow-up. Safe to re-run.
--
-- 0016/0017 added cleaners_needed and claim_booking, but the claim insert
-- left booking_team_assignments.organization_id null. Org-scoped policies
-- and pay sync key off that column, so claimed cleaners disappeared from
-- the admin team list and from org-filtered payroll reads.
--
-- Any org member can still UPDATE bookings (existing RLS). Without a guard,
-- a cleaner can change cleaners_needed or overwrite staff_id and skip the
-- locked claim. claim_booking sets app.claim_booking for its own update.

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS cleaners_needed integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS pay_per_cleaner numeric NULL,
  ADD COLUMN IF NOT EXISTS pay_type text NULL;

ALTER TABLE public.bookings
  DROP CONSTRAINT IF EXISTS bookings_pay_type_check;

ALTER TABLE public.bookings
  ADD CONSTRAINT bookings_pay_type_check
  CHECK (pay_type IS NULL OR pay_type IN ('flat', 'hourly'));

UPDATE public.booking_team_assignments bta
SET organization_id = b.organization_id
FROM public.bookings b
WHERE bta.booking_id = b.id
  AND bta.organization_id IS NULL
  AND b.organization_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.claim_booking(p_booking_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_b record;
  v_staff_id uuid;
  v_claimed int;
  v_share numeric;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT id, organization_id, staff_id, status, is_draft, scheduled_at,
         GREATEST(COALESCE(cleaners_needed, 1), 1) AS needed, pay_per_cleaner, pay_type
    INTO v_b
    FROM public.bookings WHERE id = p_booking_id
    FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('result', 'not_found');
  END IF;

  SELECT s.id INTO v_staff_id FROM public.staff s
   WHERE s.user_id = v_uid AND s.organization_id = v_b.organization_id
     AND COALESCE(s.is_active, true) = true
   LIMIT 1;
  IF v_staff_id IS NULL THEN
    RAISE EXCEPTION 'Not a staff member of this business' USING ERRCODE = '42501';
  END IF;

  IF v_b.status NOT IN ('pending', 'confirmed') OR COALESCE(v_b.is_draft, false)
     OR v_b.scheduled_at < now() THEN
    RETURN jsonb_build_object('result', 'unavailable');
  END IF;

  IF v_b.staff_id = v_staff_id OR EXISTS (
    SELECT 1 FROM public.booking_team_assignments
     WHERE booking_id = p_booking_id AND staff_id = v_staff_id) THEN
    RETURN jsonb_build_object('result', 'already_claimed');
  END IF;

  SELECT count(*) INTO v_claimed FROM (
    SELECT v_b.staff_id AS sid WHERE v_b.staff_id IS NOT NULL
    UNION
    SELECT staff_id FROM public.booking_team_assignments WHERE booking_id = p_booking_id
  ) c;

  IF v_claimed >= v_b.needed THEN
    RETURN jsonb_build_object('result', 'full', 'needed', v_b.needed, 'claimed', v_claimed);
  END IF;

  -- The financial guard allows this staff_id write only while the flag is set.
  PERFORM set_config('app.claim_booking', '1', true);

  IF v_b.needed = 1 THEN
    UPDATE public.bookings SET staff_id = v_staff_id WHERE id = p_booking_id;
  ELSE
    v_share := CASE WHEN v_b.pay_type = 'flat' THEN v_b.pay_per_cleaner ELSE NULL END;
    IF v_b.staff_id IS NULL THEN
      UPDATE public.bookings SET staff_id = v_staff_id WHERE id = p_booking_id;
    END IF;
    INSERT INTO public.booking_team_assignments (booking_id, staff_id, pay_share, is_primary, organization_id)
    VALUES (p_booking_id, v_staff_id, v_share, v_b.staff_id IS NULL, v_b.organization_id)
    ON CONFLICT (booking_id, staff_id) DO UPDATE
      SET organization_id = COALESCE(public.booking_team_assignments.organization_id, EXCLUDED.organization_id);
    -- Primary claimed earlier without a team row: give them one too.
    IF v_b.staff_id IS NOT NULL THEN
      INSERT INTO public.booking_team_assignments (booking_id, staff_id, pay_share, is_primary, organization_id)
      VALUES (p_booking_id, v_b.staff_id, v_share, true, v_b.organization_id)
      ON CONFLICT (booking_id, staff_id) DO UPDATE
        SET organization_id = COALESCE(public.booking_team_assignments.organization_id, EXCLUDED.organization_id);
    END IF;
  END IF;

  RETURN jsonb_build_object('result', 'claimed', 'needed', v_b.needed, 'claimed', v_claimed + 1);
END;
$$;

REVOKE ALL ON FUNCTION public.claim_booking(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_booking(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.guard_bookings_financial_updates()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_is_admin boolean := false;
  v_can_assign boolean := false;
  v_completing boolean := current_setting('app.complete_booking', true) = '1';
  v_claiming boolean := current_setting('app.claim_booking', true) = '1';
BEGIN
  IF v_uid IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.org_memberships m
    WHERE m.user_id = v_uid
      AND m.organization_id = NEW.organization_id
      AND m.role IN ('owner','admin')
  ) INTO v_is_admin;

  IF v_is_admin THEN
    RETURN NEW;
  END IF;

  -- Managers run the schedule. They may assign a cleaner and set how many
  -- are needed. Pay columns stay owner/admin, same as before. Cleaners may
  -- change staff_id only inside claim_booking.
  SELECT EXISTS (
    SELECT 1 FROM public.org_memberships m
    WHERE m.user_id = v_uid
      AND m.organization_id = NEW.organization_id
      AND m.role IN ('owner','admin','manager')
  ) INTO v_can_assign;

  IF NOT v_can_assign AND NOT v_claiming AND NEW.staff_id IS DISTINCT FROM OLD.staff_id THEN
    RAISE EXCEPTION 'Not authorized to reassign this booking'
      USING ERRCODE = '42501';
  END IF;

  IF (NOT v_can_assign AND NEW.cleaners_needed IS DISTINCT FROM OLD.cleaners_needed)
     OR (NOT v_completing AND NEW.cleaner_pay_expected IS DISTINCT FROM OLD.cleaner_pay_expected)
     OR NEW.pay_base_amount IS DISTINCT FROM OLD.pay_base_amount
     OR NEW.pay_locked      IS DISTINCT FROM OLD.pay_locked
     OR NEW.total_amount    IS DISTINCT FROM OLD.total_amount
     OR NEW.payment_status  IS DISTINCT FROM OLD.payment_status
     OR NEW.pay_per_cleaner IS DISTINCT FROM OLD.pay_per_cleaner
     OR NEW.pay_type        IS DISTINCT FROM OLD.pay_type
  THEN
    RAISE EXCEPTION 'Not authorized to modify financial fields on bookings'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.guard_bookings_financial_updates() FROM PUBLIC, anon, authenticated;
