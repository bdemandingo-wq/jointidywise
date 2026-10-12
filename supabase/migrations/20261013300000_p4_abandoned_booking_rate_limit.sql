-- save_abandoned_booking is SECURITY DEFINER and granted to anon so the
-- public booking form can checkpoint a half-finished booking. Nothing
-- limited how often that could be called, so a script could fill
-- abandoned_bookings (and the form_snapshot jsonb) without an account.
--
-- There is no trustworthy client IP inside an RPC, so the budget is per
-- organization plus a global ceiling. The booking page already treats a
-- failed checkpoint as non-fatal (it logs and continues).

CREATE OR REPLACE FUNCTION public.save_abandoned_booking(
  _session_token text,
  _organization_id uuid,
  _first_name text DEFAULT NULL,
  _last_name text DEFAULT NULL,
  _email text DEFAULT NULL,
  _phone text DEFAULT NULL,
  _service_id uuid DEFAULT NULL,
  _step_reached integer DEFAULT NULL,
  _form_snapshot jsonb DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  org_recent integer;
  global_recent integer;
BEGIN
  IF _session_token IS NULL OR length(trim(_session_token)) < 16 OR length(_session_token) > 200 THEN
    RAISE EXCEPTION 'invalid session token';
  END IF;
  IF _organization_id IS NULL
     OR NOT EXISTS (SELECT 1 FROM public.organizations o WHERE o.id = _organization_id) THEN
    RAISE EXCEPTION 'unknown organization';
  END IF;
  IF coalesce(trim(_email), '') = '' AND coalesce(trim(_first_name), '') = '' THEN
    RAISE EXCEPTION 'contact details required';
  END IF;
  IF _form_snapshot IS NOT NULL AND octet_length(_form_snapshot::text) > 32768 THEN
    RAISE EXCEPTION 'payload too large';
  END IF;

  SELECT count(*) INTO org_recent
    FROM public.abuse_throttle
   WHERE bucket = 'abandoned_booking:' || _organization_id::text
     AND created_at > now() - interval '10 minutes';
  IF org_recent >= 90 THEN
    RAISE EXCEPTION 'rate_limited' USING ERRCODE = '54000';
  END IF;

  SELECT count(*) INTO global_recent
    FROM public.abuse_throttle
   WHERE action = 'save_abandoned_booking'
     AND created_at > now() - interval '10 minutes';
  IF global_recent >= 1500 THEN
    RAISE EXCEPTION 'rate_limited' USING ERRCODE = '54000';
  END IF;

  INSERT INTO public.abuse_throttle (bucket, action)
  VALUES ('abandoned_booking:' || _organization_id::text, 'save_abandoned_booking');

  INSERT INTO public.abandoned_bookings AS ab (
    organization_id, first_name, last_name, email, phone,
    service_id, step_reached, session_token, form_snapshot, sms_consent
  ) VALUES (
    _organization_id, _first_name, _last_name, _email, _phone,
    _service_id, _step_reached, _session_token, _form_snapshot, false
  )
  ON CONFLICT (session_token) DO UPDATE SET
    first_name    = EXCLUDED.first_name,
    last_name     = EXCLUDED.last_name,
    email         = EXCLUDED.email,
    phone         = EXCLUDED.phone,
    service_id    = EXCLUDED.service_id,
    step_reached  = EXCLUDED.step_reached,
    form_snapshot = EXCLUDED.form_snapshot,
    updated_at    = now()
  -- Never let a guessed token move a row between organizations, and never
  -- touch sms_consent: consent is granted server-side only.
  WHERE ab.organization_id = EXCLUDED.organization_id;
END;
$$;

REVOKE ALL ON FUNCTION public.save_abandoned_booking(text, uuid, text, text, text, text, uuid, integer, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.save_abandoned_booking(text, uuid, text, text, text, text, uuid, integer, jsonb) TO anon, authenticated, service_role;
