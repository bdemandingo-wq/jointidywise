ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS payment_method text;

ALTER TABLE public.invoices
  DROP CONSTRAINT IF EXISTS invoices_payment_method_check;

ALTER TABLE public.invoices
  ADD CONSTRAINT invoices_payment_method_check
  CHECK (
    payment_method IS NULL
    OR payment_method IN ('cash', 'check', 'zelle', 'card', 'ach', 'paypal', 'other')
  );

COMMENT ON COLUMN public.invoices.payment_method IS
  'How a non-Stripe payment was recorded. Null when unpaid or when Stripe collected the card.';