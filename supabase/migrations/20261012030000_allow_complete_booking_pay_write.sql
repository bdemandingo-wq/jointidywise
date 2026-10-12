-- complete_assigned_booking writes cleaner_pay_expected while computing pay
-- from the clock or from bookings.duration. guard_booking_financial_fields
-- allows that write when the function sets app.complete_booking.
--
-- An older trigger, trg_guard_bookings_financial_updates, does not. It still
-- rejects any non-admin change to cleaner_pay_expected, so the UPDATE raises
-- and the status change rolls back with it. A cleaner tapping Complete Job
-- gets an immediate failure. Existing in-progress jobs are the ones that
-- hit it: their stored expected pay was often the 5h profile default, and
-- the RPC replaces that with duration (for example 120 minutes = 2h).
--
-- Honor the same transaction flag. pay_base_amount and pay_locked stay
-- locked for a normal staff update; the completion RPC does not touch them.

CREATE OR REPLACE FUNCTION public.guard_bookings_financial_updates()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_is_admin boolean := false;
BEGIN
  -- Service role / no auth context (edge functions, cron) -> allow.
  IF v_uid IS NULL THEN
    RETURN NEW;
  END IF;

  -- Org admins/owners for this booking's org may change financial fields.
  SELECT EXISTS (
    SELECT 1 FROM public.org_memberships m
    WHERE m.user_id = v_uid
      AND m.organization_id = NEW.organization_id
      AND m.role IN ('owner','admin')
  ) INTO v_is_admin;

  IF v_is_admin THEN
    RETURN NEW;
  END IF;

  -- complete_assigned_booking sets this for its own transaction.
  IF current_setting('app.complete_booking', true) = '1' THEN
    RETURN NEW;
  END IF;

  -- Non-admins (including assigned staff) must not modify protected columns.
  IF NEW.cleaner_pay_expected IS DISTINCT FROM OLD.cleaner_pay_expected
     OR NEW.pay_base_amount   IS DISTINCT FROM OLD.pay_base_amount
     OR NEW.pay_locked        IS DISTINCT FROM OLD.pay_locked
     OR NEW.total_amount      IS DISTINCT FROM OLD.total_amount
     OR NEW.payment_status    IS DISTINCT FROM OLD.payment_status
  THEN
    RAISE EXCEPTION 'Not authorized to modify financial fields on bookings'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.guard_bookings_financial_updates() FROM PUBLIC, anon, authenticated;
