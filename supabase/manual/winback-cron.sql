-- Hourly winback sender. Do not run until the campaign is approved.
-- This file is manual on purpose: the migration does not schedule anything.
--
-- pg_cron evaluates the schedule in UTC. 10:07–15:07 America/New_York is
-- 14:07–19:07 UTC during eastern daylight time and 15:07–20:07 UTC during
-- eastern standard time. The job is registered for the union (14:07–20:07 UTC,
-- Monday–Friday). The command posts only when the clock in America/New_York
-- is 10:00–15:59 on a weekday, so the extra UTC hour never sends.
--
-- Once, before the first schedule, store the same value as the edge
-- function secret INTERNAL_DISPATCH_SECRET:
--
--   SELECT vault.create_secret(
--     '<INTERNAL_DISPATCH_SECRET>',
--     'internal_dispatch_secret',
--     'send-winback-campaign x-internal-secret'
--   );
--
-- vault secret "supabase_url" is the one the other crons already use
-- (https://<project>.supabase.co, no trailing slash).
--
-- Each run sends at most 20. Step 2 is included by the function only for
-- step-1 recipients sent 3 or more days earlier. To stop the job:
--
--   SELECT cron.unschedule('send-winback-campaign');
--
-- A Resend bounce-rate / complaint / reputation error latches
-- public.winback_campaign_halt. Later hours no-op until that row is deleted.

DO $$ BEGIN
  PERFORM cron.unschedule('send-winback-campaign');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'send-winback-campaign',
  '7 14-20 * * 1-5',
  $job$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_url')
            || '/functions/v1/send-winback-campaign',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-internal-secret',
      (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'internal_dispatch_secret')
    ),
    body := '{"action":"batch"}'::jsonb
  )
  WHERE EXTRACT(HOUR FROM (now() AT TIME ZONE 'America/New_York')) BETWEEN 10 AND 15
    AND EXTRACT(DOW FROM (now() AT TIME ZONE 'America/New_York')) BETWEEN 1 AND 5;
  $job$
);
