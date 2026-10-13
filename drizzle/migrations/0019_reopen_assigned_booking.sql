-- Let a cleaner undo Complete Job the same business day, and let an
-- owner, admin, or manager reopen it later.
--
-- Does not charge, refund, or send a message. It only moves the booking
-- back to in_progress and clears the completion snapshot (checkout, hours,
-- and unlocked expected pay) so the next completion writes those once.
-- complete_assigned_booking already refuses to recompute a job that is
-- still completed, and send-job-complete-sms dedupes on booking_reminder_log.
-- Loyalty credits the booking once. Review SMS is ON CONFLICT (booking_id).
--
-- A sealed payout cannot be reopened. guard_booking_payroll_lock rejects
-- any change to completed_at while payroll_locked_week is set, and clearing
-- status would clear completed_at. The function says so before that trigger
-- fires. cleaner_actual_payment means the cleaner was already paid.

CREATE OR REPLACE FUNCTION public.reopen_assigned_booking(p_booking_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  b public.bookings%ROWTYPE;
  v_admin boolean := false;
  v_staff_id uuid;
  v_tz text := 'America/New_York';
  v_completed timestamptz;
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

  v_admin := public.is_org_admin(b.organization_id);

  IF NOT v_admin THEN
    SELECT s.id INTO v_staff_id
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
      RAISE EXCEPTION 'You can only reopen a job assigned to you'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  IF b.status::text = 'in_progress' THEN
    RETURN jsonb_build_object('success', true, 'already_open', true);
  END IF;

  IF b.status::text IS DISTINCT FROM 'completed' THEN
    RAISE EXCEPTION 'Only a completed job can be reopened.'
      USING ERRCODE = '42501';
  END IF;

  IF b.payroll_locked_week IS NOT NULL THEN
    RAISE EXCEPTION 'This job is already in a paid payroll week. Undo that payout before reopening it.'
      USING ERRCODE = '55006';
  END IF;

  IF b.cleaner_actual_payment IS NOT NULL AND b.cleaner_actual_payment > 0 THEN
    RAISE EXCEPTION 'This job was already paid out to the cleaner. Undo that payout before reopening it.'
      USING ERRCODE = '55006';
  END IF;

  IF NOT v_admin AND b.payment_status::text IN ('paid', 'refunded') THEN
    RAISE EXCEPTION 'This job was already paid or refunded. Ask an owner or admin to reopen it.'
      USING ERRCODE = '42501';
  END IF;

  IF NOT v_admin THEN
    SELECT COALESCE(NULLIF(btrim(timezone), ''), 'America/New_York')
      INTO v_tz
    FROM public.business_settings
    WHERE organization_id = b.organization_id
    LIMIT 1;
    v_tz := COALESCE(v_tz, 'America/New_York');

    v_completed := COALESCE(b.cleaner_checkout_at, b.completed_at, b.updated_at);
    BEGIN
      IF (v_completed AT TIME ZONE v_tz)::date
         IS DISTINCT FROM (now() AT TIME ZONE v_tz)::date THEN
        RAISE EXCEPTION 'You can undo a completion until the end of the business day. Ask an owner or admin to reopen it after that.'
          USING ERRCODE = '42501';
      END IF;
    EXCEPTION
      WHEN invalid_parameter_value OR datetime_field_overflow THEN
        IF (v_completed AT TIME ZONE 'America/New_York')::date
           IS DISTINCT FROM (now() AT TIME ZONE 'America/New_York')::date THEN
          RAISE EXCEPTION 'You can undo a completion until the end of the business day. Ask an owner or admin to reopen it after that.'
            USING ERRCODE = '42501';
        END IF;
    END;
  END IF;

  -- Lets this function clear cleaner_pay_expected. Payment status, the
  -- total, and pay_locked stay locked by guard_bookings_financial_updates.
  PERFORM set_config('app.complete_booking', '1', true);

  UPDATE public.bookings
  SET
    status = 'in_progress'::public.booking_status,
    cleaner_checkout_at = NULL,
    actual_hours_worked = NULL,
    hours_basis = NULL,
    hours_capped_at = NULL,
    cleaner_pay_expected = CASE
      WHEN COALESCE(pay_locked, false) THEN cleaner_pay_expected
      ELSE NULL
    END
  WHERE id = b.id
    AND status::text = 'completed';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Job status could not be saved. Pull to refresh and try again.'
      USING ERRCODE = '40001';
  END IF;

  -- A solo pay_share is a copy of the completion snapshot. Clear it so
  -- payroll does not keep paying the accidental finish. A real team split
  -- is left alone. Locked pay is an admin decision and stays.
  IF NOT COALESCE(b.pay_locked, false) THEN
    SELECT count(*) INTO v_assignment_count
    FROM public.booking_team_assignments
    WHERE booking_id = b.id;

    IF v_assignment_count = 1 THEN
      UPDATE public.booking_team_assignments
      SET pay_share = NULL
      WHERE booking_id = b.id;
    END IF;
  END IF;

  RETURN jsonb_build_object('success', true, 'already_open', false);
END;
$$;

REVOKE ALL ON FUNCTION public.reopen_assigned_booking(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reopen_assigned_booking(uuid) TO authenticated;

COMMENT ON FUNCTION public.reopen_assigned_booking(uuid) IS
  'Moves a completed booking back to in_progress. Assigned cleaner: same business day, and only before customer payment or a cleaner payout. Owner, admin, and manager: any day, still blocked once payroll is sealed or the cleaner was paid. Does not charge, refund, or send notifications.';

-- One review request per booking when the table has no duplicates yet.
-- A second completion must not email the customer again. If live data
-- already has two rows for one booking, skip the index rather than fail.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.review_requests
    GROUP BY booking_id
    HAVING count(*) > 1
  ) THEN
    RAISE NOTICE 'review_requests already has duplicate booking_id rows; unique index skipped';
  ELSIF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public' AND indexname = 'review_requests_one_per_booking'
  ) THEN
    CREATE UNIQUE INDEX review_requests_one_per_booking
      ON public.review_requests (booking_id);
  END IF;
END $$;
