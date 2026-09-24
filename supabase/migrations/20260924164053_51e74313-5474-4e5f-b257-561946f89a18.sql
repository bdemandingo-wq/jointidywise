ALTER TABLE public.payroll_payments
  ADD COLUMN IF NOT EXISTS payout_status text,
  ADD COLUMN IF NOT EXISTS status_updated_at timestamptz DEFAULT now(),
  ADD COLUMN IF NOT EXISTS expected_arrival_date date,
  ADD COLUMN IF NOT EXISTS stripe_payout_id text,
  ADD COLUMN IF NOT EXISTS failure_reason text,
  ADD COLUMN IF NOT EXISTS status_history jsonb NOT NULL DEFAULT '[]'::jsonb;

UPDATE public.payroll_payments
SET payout_status = CASE WHEN payment_method = 'stripe_transfer' THEN
      CASE WHEN paid_at < now() - interval '7 days' THEN 'deposited' ELSE 'pending' END
    ELSE 'paid' END,
    status_history = jsonb_build_array(jsonb_build_object('status','pending','at',paid_at))
WHERE payout_status IS NULL;

ALTER TABLE public.payroll_payments ALTER COLUMN payout_status SET DEFAULT 'pending';
ALTER TABLE public.payroll_payments ADD CONSTRAINT payroll_payments_payout_status_chk
  CHECK (payout_status IN ('pending','paid','failed','reversed','deposited'));
CREATE INDEX IF NOT EXISTS idx_payroll_payments_open_status ON public.payroll_payments(created_at, id)
  WHERE payout_status IN ('pending','paid') AND stripe_transfer_id IS NOT NULL;

-- Cleaner reads only their own payouts (safe columns). Authorizes caller internally.
CREATE OR REPLACE FUNCTION public.get_my_payouts(_organization_id uuid)
RETURNS TABLE(id uuid, week_start date, amount numeric, payment_method text, paid_at timestamptz,
  payout_status text, expected_arrival_date date, failure_reason text, status_history jsonb)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p.id, p.week_start::date, p.amount, p.payment_method, p.paid_at, p.payout_status,
         p.expected_arrival_date, p.failure_reason, p.status_history
  FROM public.payroll_payments p
  JOIN public.staff s ON s.id = p.staff_id AND s.organization_id = p.organization_id
  WHERE p.organization_id = _organization_id AND s.user_id = auth.uid()
  ORDER BY p.paid_at DESC, p.id
  LIMIT 100
$$;
REVOKE ALL ON FUNCTION public.get_my_payouts(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_my_payouts(uuid) TO authenticated;