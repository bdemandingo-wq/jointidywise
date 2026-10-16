-- stripe_webhook_events used to claim by event_id alone. The invoice
-- webhook and the subscription webhook both insert Stripe's event id, so
-- whichever source inserted second looked like a duplicate and skipped
-- its own work. The claim is (event_id, source).
--
-- Run this file in the Supabase SQL editor. A committed migration does not
-- apply itself.

DO $$
DECLARE
  def text;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO def
  FROM pg_constraint
  WHERE conrelid = 'public.stripe_webhook_events'::regclass
    AND contype = 'p';

  IF def IS NULL
     OR (def NOT ILIKE '%event_id, source%' AND def NOT ILIKE '%source, event_id%') THEN
    ALTER TABLE public.stripe_webhook_events DROP CONSTRAINT IF EXISTS stripe_webhook_events_pkey;
    ALTER TABLE public.stripe_webhook_events
      ADD CONSTRAINT stripe_webhook_events_pkey PRIMARY KEY (event_id, source);
  END IF;
END $$;
