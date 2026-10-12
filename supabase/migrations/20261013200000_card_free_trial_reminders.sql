-- Reminder log for the card-free 14-day org trial.
-- Does not change trial_ends_at, plan_type, or any Stripe subscription.
-- Existing trials keep the end date they already have.

CREATE TABLE IF NOT EXISTS public.trial_reminder_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  reminder_day smallint NOT NULL CHECK (reminder_day IN (10, 13)),
  sent_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (profile_id, reminder_day)
);

ALTER TABLE public.trial_reminder_log ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.trial_reminder_log FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.trial_reminder_log TO service_role;

-- Daily, shortly after the renewal-reminder job. The function is cron-only
-- (x-cron-secret) and verify_jwt = false in config.toml.
DO $$ BEGIN
  PERFORM cron.unschedule('send-trial-reminders');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'send-trial-reminders',
  '15 14 * * *',
  $$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_url') || '/functions/v1/send-trial-reminders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret')
    ),
    body := '{}'::jsonb
  );
  $$
);
