-- The organizations INSERT trigger used to POST notify-new-organization-signup
-- with no credential and a caller-supplied org name. The function now
-- rejects anything that is not the cron secret, then loads the org name
-- itself. This replaces the trigger function so the secret travels with
-- the request. CREATE OR REPLACE keeps the existing on_new_org_created
-- trigger.
--
-- Same vault names as notify_new_lead and the cron jobs: supabase_url and
-- cron_secret. If either is missing the insert still commits and a warning
-- is raised; an unauthenticated request is not sent. The edge function
-- fails closed when CRON_SECRET is unset or does not match.
--
-- Owner: confirm vault.decrypted_secrets contains cron_secret and
-- supabase_url, and that the edge function's CRON_SECRET matches
-- cron_secret, before relying on new-signup SMS again.

CREATE OR REPLACE FUNCTION public.notify_new_org_signup()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_url text;
  v_secret text;
BEGIN
  SELECT decrypted_secret INTO v_url
    FROM vault.decrypted_secrets WHERE name = 'supabase_url';
  SELECT decrypted_secret INTO v_secret
    FROM vault.decrypted_secrets WHERE name = 'cron_secret';

  IF v_url IS NULL OR v_url = '' THEN
    v_url := current_setting('app.settings.supabase_url', true);
  END IF;
  IF v_url IS NULL OR v_url = '' THEN
    v_url := 'https://slwfkaqczvwvvvavkgpr.supabase.co';
  END IF;

  IF v_secret IS NULL OR v_secret = '' THEN
    RAISE WARNING 'notify_new_org_signup: vault cron_secret missing, org % not dispatched', NEW.id;
    RETURN NEW;
  END IF;

  PERFORM net.http_post(
    url := v_url || '/functions/v1/notify-new-organization-signup',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', v_secret
    ),
    body := jsonb_build_object(
      'org_id', NEW.id,
      'created_at', NEW.created_at
    )
  );

  RETURN NEW;
EXCEPTION
  WHEN OTHERS THEN
    RAISE WARNING 'notify_new_org_signup error for org %: %', NEW.id, SQLERRM;
    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.notify_new_org_signup() FROM PUBLIC, anon, authenticated;
