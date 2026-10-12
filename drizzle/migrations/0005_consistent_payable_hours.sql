CREATE OR REPLACE FUNCTION public.complete_assigned_booking(p_booking_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  b public.bookings%ROWTYPE;
  v_staff_id uuid;
  v_hourly numeric;
  v_base numeric;
  v_service_duration numeric;
  v_now timestamptz := now();
  v_actual numeric;
  v_basis text;
  v_scheduled numeric;
  v_trust boolean;
  v_wage_type text;
  v_rate numeric;
  v_cap numeric := 1.25;
  v_ceiling numeric := 12;
  v_payable numeric;
  v_pay numeric;
  v_capped numeric;
  v_assignment_count integer;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  IF p_booking_id IS NULL THEN
    RAISE EXCEPTION 'Booking id is required' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO b FROM public.bookings WHERE id = p_booking_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Booking not found' USING ERRCODE = 'P0002';
  END IF;

  IF b.organization_id IS NULL THEN
    RAISE EXCEPTION 'Booking has no organization' USING ERRCODE = '42501';
  END IF;

  SELECT s.id, s.hourly_rate, s.base_wage
    INTO v_staff_id, v_hourly, v_base
  FROM public.staff s
  WHERE s.user_id = v_uid
    AND s.organization_id = b.organization_id
    AND (
      s.id = b.staff_id
      OR EXISTS (
        SELECT 1 FROM public.booking_team_assignments a
        WHERE a.booking_id = b.id AND a.staff_id = s.id
      )
    )
  LIMIT 1;

  IF v_staff_id IS NULL THEN
    RAISE EXCEPTION 'You can only complete a job assigned to you'
      USING ERRCODE = '42501';
  END IF;

  IF b.status::text = 'completed' THEN
    RETURN jsonb_build_object(
      'success', true,
      'already_completed', true,
      'cleaner_pay_expected', b.cleaner_pay_expected,
      'actual_hours_worked', b.actual_hours_worked,
      'hours_basis', b.hours_basis
    );
  END IF;

  IF b.status::text IS DISTINCT FROM 'in_progress' THEN
    RAISE EXCEPTION 'Only an in-progress job can be completed'
      USING ERRCODE = '42501';
  END IF;

  IF b.staff_id IS NOT NULL AND v_staff_id IS DISTINCT FROM b.staff_id THEN
    SELECT s.hourly_rate, s.base_wage
      INTO v_hourly, v_base
    FROM public.staff s
    WHERE s.id = b.staff_id;
  END IF;

  SELECT duration INTO v_service_duration
  FROM public.services
  WHERE id = b.service_id;

  v_scheduled := COALESCE(b.duration, 0)::numeric / 60.0;
  v_trust := b.service_id IS NOT NULL AND COALESCE(v_service_duration, 0) > 0;

  IF b.cleaner_checkin_at IS NOT NULL AND v_now > b.cleaner_checkin_at THEN
    v_actual := EXTRACT(EPOCH FROM (v_now - b.cleaner_checkin_at)) / 3600.0;
    v_basis := CASE WHEN v_trust THEN 'clock' ELSE 'unknown' END;
  ELSE
    v_actual := NULL;
    v_basis := 'absent';
  END IF;

  v_wage_type := lower(COALESCE(NULLIF(btrim(b.cleaner_wage_type), ''), 'hourly'));
  v_rate := COALESCE(b.cleaner_wage, v_hourly, v_base, 0);
  v_pay := b.cleaner_pay_expected;
  v_capped := NULL;

  IF NOT COALESCE(b.pay_locked, false) AND v_wage_type = 'hourly' AND v_rate > 0 THEN
    SELECT COALESCE(ps.hours_overage_cap_ratio, 1.25),
           COALESCE(ps.hours_absolute_ceiling, 12)
      INTO v_cap, v_ceiling
    FROM public.payroll_settings ps
    WHERE ps.organization_id = b.organization_id
    LIMIT 1;

    IF NOT FOUND THEN
      v_cap := 1.25;
      v_ceiling := 12;
    END IF;

    IF v_actual IS NOT NULL AND v_scheduled > 0 THEN
      v_payable := LEAST(GREATEST(v_actual, v_scheduled), v_scheduled * v_cap, v_ceiling);
    ELSIF v_actual IS NOT NULL THEN
      v_payable := LEAST(GREATEST(v_actual, 0), v_ceiling);
    ELSIF b.cleaner_override_hours IS NOT NULL THEN
      v_payable := b.cleaner_override_hours;
    ELSIF v_scheduled > 0 THEN
      v_payable := v_scheduled;
    ELSE
      v_payable := NULL;
    END IF;

    IF v_payable IS NOT NULL THEN
      v_pay := ROUND(v_rate * v_payable, 2);
      IF v_actual IS NOT NULL AND v_payable < v_actual THEN
        v_capped := ROUND(v_payable, 3);
      ELSE
        v_capped := NULL;
      END IF;
    END IF;
  END IF;

  PERFORM set_config('app.complete_booking', '1', true);

  UPDATE public.bookings
  SET
    status = 'completed'::public.booking_status,
    cleaner_checkout_at = v_now,
    actual_hours_worked = v_actual,
    hours_basis = v_basis,
    hours_capped_at = v_capped,
    cleaner_pay_expected = v_pay
  WHERE id = b.id
    AND status::text = 'in_progress';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Job status could not be saved. Pull to refresh and try again.'
      USING ERRCODE = '40001';
  END IF;

  IF NOT COALESCE(b.pay_locked, false) AND v_wage_type = 'hourly' AND v_pay IS NOT NULL THEN
    SELECT count(*) INTO v_assignment_count
    FROM public.booking_team_assignments
    WHERE booking_id = b.id;

    IF v_assignment_count = 1 THEN
      UPDATE public.booking_team_assignments
      SET pay_share = v_pay
      WHERE booking_id = b.id;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'already_completed', false,
    'cleaner_pay_expected', v_pay,
    'actual_hours_worked', v_actual,
    'hours_basis', v_basis,
    'hours_capped_at', v_capped
  );
END;
$$;

REVOKE ALL ON FUNCTION public.complete_assigned_booking(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.complete_assigned_booking(uuid) TO authenticated;

COMMENT ON FUNCTION public.complete_assigned_booking(uuid) IS
  'Assigned cleaner marks their in-progress booking complete. Hourly pay is the staff or booking rate times payable hours: the clock, floored at the booking duration and capped by payroll_settings. Does not accept a pay amount from the client. Does not rewrite pay on bookings that are already completed.';