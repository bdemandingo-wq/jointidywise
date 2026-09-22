
-- Replace the spoofable header-based UPDATE policy with SECURITY DEFINER RPCs
-- that take the session token as an explicit argument. Guests keep the same
-- ability to save/resume a half-finished booking, but nothing gates row access
-- on a caller-supplied request header any more.

DROP POLICY IF EXISTS "Anon can update own abandoned row by session token" ON public.abandoned_bookings;

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
BEGIN
  IF _session_token IS NULL OR length(trim(_session_token)) < 16 THEN
    RAISE EXCEPTION 'invalid session token';
  END IF;
  IF _organization_id IS NULL
     OR NOT EXISTS (SELECT 1 FROM public.organizations o WHERE o.id = _organization_id) THEN
    RAISE EXCEPTION 'unknown organization';
  END IF;
  IF coalesce(trim(_email), '') = '' AND coalesce(trim(_first_name), '') = '' THEN
    RAISE EXCEPTION 'contact details required';
  END IF;

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

CREATE OR REPLACE FUNCTION public.mark_abandoned_booking_progress(
  _session_token text,
  _step_reached integer DEFAULT NULL,
  _converted boolean DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF _session_token IS NULL OR length(trim(_session_token)) < 16 THEN
    RETURN;
  END IF;

  UPDATE public.abandoned_bookings
     SET step_reached  = COALESCE(_step_reached, step_reached),
         converted     = COALESCE(_converted, converted),
         converted_at  = CASE WHEN _converted IS TRUE THEN now() ELSE converted_at END,
         updated_at    = now()
   WHERE session_token = _session_token;
END;
$$;

REVOKE ALL ON FUNCTION public.save_abandoned_booking(text, uuid, text, text, text, text, uuid, integer, jsonb) FROM public;
REVOKE ALL ON FUNCTION public.mark_abandoned_booking_progress(text, integer, boolean) FROM public;
GRANT EXECUTE ON FUNCTION public.save_abandoned_booking(text, uuid, text, text, text, text, uuid, integer, jsonb) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mark_abandoned_booking_progress(text, integer, boolean) TO anon, authenticated, service_role;
