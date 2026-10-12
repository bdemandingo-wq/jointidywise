-- Tighten guard_bookings_financial_updates during job completion.
--
-- 20261012030000 let the trigger return immediately when
-- app.complete_booking = '1'. That allowed every protected column to change,
-- including total_amount, payment_status, pay_base_amount, and pay_locked.
-- The comment on that migration said those fields stayed locked. They did not.
--
-- complete_assigned_booking's UPDATE writes status, cleaner_checkout_at,
-- actual_hours_worked, hours_basis, hours_capped_at, and cleaner_pay_expected.
-- Of the columns this trigger protects, only cleaner_pay_expected is in that
-- list. hours_capped_at is written by the RPC and is not one of the protected
-- financial columns, so this trigger does not reject it.
--
-- With the flag set, cleaner_pay_expected may change. pay_base_amount,
-- pay_locked, total_amount, and payment_status are still rejected. Without
-- the flag, cleaner_pay_expected is rejected too, same as before.

CREATE OR REPLACE FUNCTION public.guard_bookings_financial_updates()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_is_admin boolean := false;
  v_completing boolean := current_setting('app.complete_booking', true) = '1';
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

  -- During completion, expected pay may change. Every other protected
  -- financial field is still rejected. hours_capped_at is not in this list.
  IF (NOT v_completing AND NEW.cleaner_pay_expected IS DISTINCT FROM OLD.cleaner_pay_expected)
     OR NEW.pay_base_amount IS DISTINCT FROM OLD.pay_base_amount
     OR NEW.pay_locked      IS DISTINCT FROM OLD.pay_locked
     OR NEW.total_amount    IS DISTINCT FROM OLD.total_amount
     OR NEW.payment_status  IS DISTINCT FROM OLD.payment_status
  THEN
    RAISE EXCEPTION 'Not authorized to modify financial fields on bookings'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.guard_bookings_financial_updates() FROM PUBLIC, anon, authenticated;
