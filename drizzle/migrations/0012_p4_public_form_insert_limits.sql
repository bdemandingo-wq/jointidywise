CREATE OR REPLACE FUNCTION public.enforce_public_form_rate_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  email_norm text;
  email_recent integer;
  table_recent integer;
BEGIN
  email_norm := lower(trim(coalesce(NEW.email, '')));
  IF email_norm !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' OR length(email_norm) > 320 THEN
    RAISE EXCEPTION 'invalid email' USING ERRCODE = '23514';
  END IF;

  IF TG_TABLE_NAME IN ('demo_requests', 'demo_bookings') THEN
    IF length(trim(coalesce(NEW.full_name, ''))) < 1 OR length(NEW.full_name) > 200 THEN
      RAISE EXCEPTION 'invalid name' USING ERRCODE = '23514';
    END IF;
    IF length(trim(coalesce(NEW.phone, ''))) < 7 OR length(NEW.phone) > 40 THEN
      RAISE EXCEPTION 'invalid phone' USING ERRCODE = '23514';
    END IF;
    IF length(trim(coalesce(NEW.business_name, ''))) < 1 OR length(NEW.business_name) > 200 THEN
      RAISE EXCEPTION 'invalid business' USING ERRCODE = '23514';
    END IF;
  END IF;

  SELECT count(*) INTO email_recent
    FROM public.abuse_throttle
   WHERE bucket = 'public_form:' || TG_TABLE_NAME || ':' || email_norm
     AND created_at > now() - interval '1 day';
  IF email_recent >= 8 THEN
    RAISE EXCEPTION 'rate_limited' USING ERRCODE = '54000';
  END IF;

  SELECT count(*) INTO table_recent
    FROM public.abuse_throttle
   WHERE action = 'public_form_' || TG_TABLE_NAME
     AND created_at > now() - interval '1 hour';
  IF table_recent >= 60 THEN
    RAISE EXCEPTION 'rate_limited' USING ERRCODE = '54000';
  END IF;

  INSERT INTO public.abuse_throttle (bucket, action)
  VALUES (
    'public_form:' || TG_TABLE_NAME || ':' || email_norm,
    'public_form_' || TG_TABLE_NAME
  );

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_public_form_rate_limit() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_p4_demo_requests_rate ON public.demo_requests;
CREATE TRIGGER trg_p4_demo_requests_rate
  BEFORE INSERT ON public.demo_requests
  FOR EACH ROW EXECUTE FUNCTION public.enforce_public_form_rate_limit();

DROP TRIGGER IF EXISTS trg_p4_demo_bookings_rate ON public.demo_bookings;
CREATE TRIGGER trg_p4_demo_bookings_rate
  BEFORE INSERT ON public.demo_bookings
  FOR EACH ROW EXECUTE FUNCTION public.enforce_public_form_rate_limit();

DROP TRIGGER IF EXISTS trg_p4_lifetime_waitlist_rate ON public.lifetime_waitlist;
CREATE TRIGGER trg_p4_lifetime_waitlist_rate
  BEFORE INSERT ON public.lifetime_waitlist
  FOR EACH ROW EXECUTE FUNCTION public.enforce_public_form_rate_limit();