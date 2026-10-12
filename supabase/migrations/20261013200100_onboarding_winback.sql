-- Abandoned-onboarding winback. Does not change trial_ends_at for anyone
-- by itself; the onboarding-winback function extends a trial only after
-- the person accepts the in-wizard offer and finishes setup.

CREATE TABLE IF NOT EXISTS public.onboarding_winback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
  resume_token text NOT NULL UNIQUE,
  step smallint NOT NULL DEFAULT 1 CHECK (step BETWEEN 1 AND 3),
  draft jsonb NOT NULL DEFAULT '{}'::jsonb,
  started_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  modal_shown_at timestamptz,
  trial_30_accepted_at timestamptz,
  email_1h_sent_at timestamptz,
  email_24h_sent_at timestamptz,
  offer_used text CHECK (offer_used IS NULL OR offer_used IN (
    'trial_30', 'half_off_first_month', 'first_month_free'
  )),
  offer_used_at timestamptz,
  checkout_coupon_id text,
  checkout_attached_at timestamptz,
  completed_at timestamptz
);

CREATE INDEX IF NOT EXISTS onboarding_winback_incomplete_idx
  ON public.onboarding_winback (started_at)
  WHERE completed_at IS NULL;

ALTER TABLE public.onboarding_winback ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.onboarding_winback FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.onboarding_winback TO service_role;

-- Every 15 minutes so the 1-hour and 24-hour emails land close to those marks.
DO $$ BEGIN
  PERFORM cron.unschedule('send-onboarding-winback');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'send-onboarding-winback',
  '*/15 * * * *',
  $$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_url') || '/functions/v1/send-onboarding-winback',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret')
    ),
    body := '{}'::jsonb
  );
  $$
);
