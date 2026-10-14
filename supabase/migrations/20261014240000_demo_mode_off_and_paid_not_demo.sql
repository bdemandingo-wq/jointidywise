-- The old in-app demo toggle stored demo_mode_enabled = true on real
-- organizations. The server send guard now treats that flag as "do not
-- text, email, or push." Turn it off for every existing org so a stale
-- toggle cannot silently block real booking confirmations. An owner can
-- turn demo mode back on from the dashboard.
--
-- is_demo_or_test is the classifier for demo and test organizations.
-- An active or past_due Stripe subscription whose plan is not Lifetime
-- is a paying customer and must never count as demo or test, even if
-- the name looks like a sandbox or demo mode was left on.
-- Lifetime (plan = 'lifetime') can still be demo. trialing is not enough.

UPDATE public.organization_pricing_settings
SET demo_mode_enabled = false
WHERE demo_mode_enabled IS DISTINCT FROM false;

CREATE OR REPLACE FUNCTION public.is_demo_or_test(p_org_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_demo boolean;
  v_name text;
  v_slug text;
  v_email text;
BEGIN
  IF p_org_id IS NULL THEN
    RETURN false;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.stripe_subscriptions s
    WHERE s.organization_id = p_org_id
      AND lower(s.status) IN ('active', 'past_due')
      AND lower(coalesce(s.plan, '')) <> 'lifetime'
  ) THEN
    RETURN false;
  END IF;

  SELECT coalesce(ops.demo_mode_enabled, false)
    INTO v_demo
  FROM public.organization_pricing_settings ops
  WHERE ops.organization_id = p_org_id;

  IF coalesce(v_demo, false) THEN
    RETURN true;
  END IF;

  SELECT o.name, o.slug, lower(coalesce(owner.email, ''))
    INTO v_name, v_slug, v_email
  FROM public.organizations o
  LEFT JOIN public.profiles owner ON owner.id = o.owner_id
  WHERE o.id = p_org_id;

  IF v_name IS NULL AND v_slug IS NULL AND v_email IS NULL THEN
    RETURN false;
  END IF;

  IF coalesce(v_name, '') ~* '(^|[^a-z])(test|qa|demo|sandbox)([^a-z]|$)' THEN
    RETURN true;
  END IF;

  IF coalesce(v_slug, '') ~* '^(test|qa|demo|sandbox)' THEN
    RETURN true;
  END IF;

  IF coalesce(v_email, '') ~* '(@tidywise1\.com$|^applereview@|@example\.com$|\+(qa|test))' THEN
    RETURN true;
  END IF;

  RETURN false;
END;
$$;

REVOKE ALL ON FUNCTION public.is_demo_or_test(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_demo_or_test(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.growth_org_is_public(p_org_id uuid, p_feed boolean)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.organizations o
    LEFT JOIN public.business_settings bs ON bs.organization_id = o.id
    LEFT JOIN public.profiles owner ON owner.id = o.owner_id
    WHERE o.id = p_org_id
      AND (NOT p_feed OR coalesce(bs.show_public_activity, true))
      AND NOT public.is_demo_or_test(o.id)
      AND coalesce(owner.email, '') <> 'support@tidywisecleaning.com'
  );
$function$;

REVOKE ALL ON FUNCTION public.growth_org_is_public(uuid, boolean) FROM PUBLIC, anon, authenticated;
