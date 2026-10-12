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

  -- complete_assigned_booking sets this for its own transaction.
  IF current_setting('app.complete_booking', true) = '1' THEN
    RETURN NEW;
  END IF;

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