ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS cleaners_needed integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS pay_per_cleaner numeric NULL,
  ADD COLUMN IF NOT EXISTS pay_type text NULL;

ALTER TABLE public.bookings
  DROP CONSTRAINT IF EXISTS bookings_pay_type_check;

ALTER TABLE public.bookings
  ADD CONSTRAINT bookings_pay_type_check
  CHECK (pay_type IS NULL OR pay_type IN ('flat','hourly'));