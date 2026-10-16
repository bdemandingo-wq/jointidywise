-- stripe_webhook_events used to claim by event_id alone. The invoice
-- webhook and the subscription webhook both insert Stripe's event id, so
-- whichever source inserted second looked like a duplicate and skipped
-- its own work. The claim is (event_id, source).
--
-- Run this file in the Supabase SQL editor. A committed migration does not
-- apply itself.

DO $$
DECLARE
  pk_name text;
  def text;
BEGIN
  SELECT c.conname, pg_get_constraintdef(c.oid)
    INTO pk_name, def
  FROM pg_constraint c
  WHERE c.conrelid = 'public.stripe_webhook_events'::regclass
    AND c.contype = 'p';

  IF pk_name IS NULL
     OR (def NOT ILIKE '%event_id, source%' AND def NOT ILIKE '%source, event_id%') THEN
    IF pk_name IS NOT NULL THEN
      EXECUTE format(
        'ALTER TABLE public.stripe_webhook_events DROP CONSTRAINT %I',
        pk_name
      );
    END IF;
    ALTER TABLE public.stripe_webhook_events
      ADD CONSTRAINT stripe_webhook_events_pkey PRIMARY KEY (event_id, source);
  END IF;
END $$;
