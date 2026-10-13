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

  IF v_b.needed = 1 THEN
    UPDATE public.bookings SET staff_id = v_staff_id WHERE id = p_booking_id;
  ELSE
    v_share := CASE WHEN v_b.pay_type = 'flat' THEN v_b.pay_per_cleaner ELSE NULL END;
    IF v_b.staff_id IS NULL THEN
      UPDATE public.bookings SET staff_id = v_staff_id WHERE id = p_booking_id;
    END IF;
    INSERT INTO public.booking_team_assignments (booking_id, staff_id, pay_share, is_primary)
    VALUES (p_booking_id, v_staff_id, v_share, v_b.staff_id IS NULL)
    ON CONFLICT (booking_id, staff_id) DO NOTHING;
    -- Primary claimed earlier without a team row: give them one too.
    IF v_b.staff_id IS NOT NULL THEN
      INSERT INTO public.booking_team_assignments (booking_id, staff_id, pay_share, is_primary)
      VALUES (p_booking_id, v_b.staff_id, v_share, true)
      ON CONFLICT (booking_id, staff_id) DO NOTHING;
    END IF;
  END IF;

  RETURN jsonb_build_object('result', 'claimed', 'needed', v_b.needed, 'claimed', v_claimed + 1);
END;
$$;

REVOKE ALL ON FUNCTION public.claim_booking(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_booking(uuid) TO authenticated;

-- Open team spots for the caller's org, so the available list can show team jobs
-- that already have a primary cleaner. Caller-authorized; returns counts only.
CREATE OR REPLACE FUNCTION public.get_team_claim_counts(p_booking_ids uuid[])
RETURNS TABLE(booking_id uuid, claimed int, mine boolean)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  WITH me AS (
    SELECT s.id, s.organization_id FROM public.staff s WHERE s.user_id = auth.uid()
  ), b AS (
    SELECT bk.id, bk.staff_id FROM public.bookings bk
     WHERE bk.id = ANY(p_booking_ids)
       AND bk.organization_id IN (SELECT organization_id FROM me)
  ), c AS (
    SELECT b.id AS bid, b.staff_id AS sid FROM b WHERE b.staff_id IS NOT NULL
    UNION
    SELECT t.booking_id, t.staff_id FROM public.booking_team_assignments t JOIN b ON b.id = t.booking_id
  )
  SELECT b.id, (SELECT count(*)::int FROM c WHERE c.bid = b.id),
         EXISTS (SELECT 1 FROM c WHERE c.bid = b.id AND c.sid IN (SELECT id FROM me))
    FROM b;
$$;

REVOKE ALL ON FUNCTION public.get_team_claim_counts(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_team_claim_counts(uuid[]) TO authenticated;

CREATE OR REPLACE FUNCTION public.guard_bookings_financial_updates()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_is_admin boolean := false;
  v_completing boolean := current_setting('app.complete_booking', true) = '1';
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

  IF (NOT v_completing AND NEW.cleaner_pay_expected IS DISTINCT FROM OLD.cleaner_pay_expected)
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