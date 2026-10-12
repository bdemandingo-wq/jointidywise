-- Cleaner completion, GPS check-in error, and per-device APNs environment.
--
-- complete_assigned_booking lets an assigned cleaner finish their own job.
-- Pay is computed here. The client no longer writes cleaner_pay_expected, which
-- guard_booking_financial_fields rejects for anyone who is not an operator
-- (that rejection aborted the whole update, including status = completed).
--
-- The guard still blocks arbitrary pay edits. It allows cleaner_pay_expected
-- to change only while this function has set app.complete_booking for the
-- transaction. PostgREST does not let a client set that GUC.

-- ---------------------------------------------------------------------------
-- 1. Check-in rows can record why coordinates are missing.
-- ---------------------------------------------------------------------------
ALTER TABLE public.booking_checkins
  ADD COLUMN IF NOT EXISTS gps_error text;

COMMENT ON COLUMN public.booking_checkins.gps_error IS
  'Set when a check-in was saved without coordinates: denied, timeout, unavailable, or unknown.';

-- ---------------------------------------------------------------------------
-- 2. Remember which APNs host accepted each device token.
-- ---------------------------------------------------------------------------
ALTER TABLE public.device_push_tokens
  ADD COLUMN IF NOT EXISTS apns_env text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'device_push_tokens_apns_env_check'
  ) THEN
    ALTER TABLE public.device_push_tokens
      ADD CONSTRAINT device_push_tokens_apns_env_check
      CHECK (apns_env IS NULL OR apns_env IN ('sandbox', 'production'));
  END IF;
END $$;

COMMENT ON COLUMN public.device_push_tokens.apns_env IS
  'APNs host that accepted this token. production for TestFlight/App Store, sandbox for Xcode debug. NULL until the first successful send.';

-- ---------------------------------------------------------------------------
-- 3. Financial guard: allow the completion RPC to write expected pay.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.guard_booking_financial_fields()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Service role / internal jobs (no JWT) and org operators keep full access.
  IF auth.uid() IS NULL OR public.is_org_operator(NEW.organization_id) THEN
    RETURN NEW;
  END IF;

  -- complete_assigned_booking sets this for its own transaction. Only expected
  -- pay may change on that path; payment status and charged amounts stay locked.
  IF current_setting('app.complete_booking', true) = '1' THEN
    IF NEW.total_amount IS DISTINCT FROM OLD.total_amount
       OR NEW.discount_amount IS DISTINCT FROM OLD.discount_amount
       OR NEW.payment_status IS DISTINCT FROM OLD.payment_status
       OR NEW.cleaner_actual_payment IS DISTINCT FROM OLD.cleaner_actual_payment THEN
      RAISE EXCEPTION 'Only owners, managers or admins can change payment or pay fields on a booking'
        USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.total_amount IS DISTINCT FROM OLD.total_amount
     OR NEW.discount_amount IS DISTINCT FROM OLD.discount_amount
     OR NEW.payment_status IS DISTINCT FROM OLD.payment_status
     OR NEW.cleaner_pay_expected IS DISTINCT FROM OLD.cleaner_pay_expected
     OR NEW.cleaner_actual_payment IS DISTINCT FROM OLD.cleaner_actual_payment THEN
    RAISE EXCEPTION 'Only owners, managers or admins can change payment or pay fields on a booking'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.guard_booking_financial_fields() FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Assigned cleaner completes their own in-progress job.
-- ---------------------------------------------------------------------------
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

  -- The caller must be an active-or-not staff row in THIS org who is the
  -- primary cleaner or on the team. A cleaner in another company cannot
  -- complete this job, and neither can a coworker who is not assigned.
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

  -- Rate follows the booking snapshot, then the primary cleaner's staff row.
  -- A teammate completing the job must not substitute their own rate.
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
  v_rate := COALESCE(b.cleaner_wage, v_base, v_hourly, 0);
  v_pay := b.cleaner_pay_expected;
  v_capped := NULL;

  -- Locked pay is an admin decision. Completion still records the clock.
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

    -- Hours for pay:
    --   clock, when the check-in is real, capped so a forgotten checkout
    --   cannot pay a multi-day shift;
    --   otherwise the booking's own duration (minutes / 60).
    -- staff.default_hours (the profile default of 5) is intentionally not read.
    IF v_actual IS NOT NULL AND v_basis = 'clock' AND v_scheduled > 0 THEN
      v_payable := LEAST(v_actual, v_scheduled * v_cap, v_ceiling);
    ELSIF v_actual IS NOT NULL THEN
      v_payable := LEAST(v_actual, v_ceiling);
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
  'Assigned cleaner marks their in-progress booking complete. Computes hourly pay from clock time, or from bookings.duration when there is no clock. Does not accept a pay amount from the client.';
