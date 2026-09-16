-- Managers (is_org_admin covers owner/admin/manager) could read staff SSN last 4,
-- EIN, tax document paths and base wage because `authenticated` held a
-- table-wide SELECT grant on public.staff. Per business policy only owners
-- (has_org_financial_access) may see restricted financial/secret data.
--
-- Column-level grants are the only mechanism that can distinguish columns here:
-- RLS is row-level, and both managers and owners are the same `authenticated`
-- database role. So: drop the table-wide SELECT and re-grant every
-- non-sensitive column. The four sensitive columns are reachable only through
-- SECURITY DEFINER RPCs that authorize the caller as an owner.

REVOKE SELECT ON public.staff FROM authenticated;

GRANT SELECT (
  id, user_id, organization_id, name, email, phone, avatar_url, bio,
  is_active, hourly_rate, percentage_rate, default_hours, tax_classification,
  calendar_color, home_address, home_latitude, home_longitude,
  location_permission_status, location_permission_updated_at,
  created_at, updated_at
) ON public.staff TO authenticated;

-- SSN / EIN: was is_org_admin(), which includes managers.
CREATE OR REPLACE FUNCTION public.get_staff_sensitive_fields(_staff_id uuid)
RETURNS TABLE(ssn_last4 text, ein text)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _org uuid;
BEGIN
  SELECT organization_id INTO _org FROM public.staff WHERE id = _staff_id;
  IF _org IS NULL THEN
    RETURN;
  END IF;
  IF NOT public.has_org_financial_access(_org) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  RETURN QUERY
    SELECT s.ssn_last4, s.ein FROM public.staff s WHERE s.id = _staff_id;
END;
$function$;

-- Owner-only wage + tax-document lookup for payroll / finance screens.
CREATE OR REPLACE FUNCTION public.get_org_staff_wages(_org_id uuid)
RETURNS TABLE(id uuid, base_wage numeric, hourly_rate numeric, percentage_rate numeric, default_hours numeric, tax_document_url text)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.has_org_financial_access(_org_id) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  RETURN QUERY
    SELECT s.id, s.base_wage, s.hourly_rate, s.percentage_rate, s.default_hours, s.tax_document_url
    FROM public.staff s
    WHERE s.organization_id = _org_id;
END;
$function$;

-- A cleaner's own wage row (staff portal earnings), by staff id.
CREATE OR REPLACE FUNCTION public.get_my_staff_wages(_staff_id uuid)
RETURNS TABLE(id uuid, organization_id uuid, base_wage numeric, hourly_rate numeric, percentage_rate numeric, default_hours numeric)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT s.id, s.organization_id, s.base_wage, s.hourly_rate, s.percentage_rate, s.default_hours
  FROM public.staff s
  WHERE s.id = _staff_id AND s.user_id = auth.uid()
  LIMIT 1;
$function$;

REVOKE ALL ON FUNCTION public.get_org_staff_wages(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_my_staff_wages(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_org_staff_wages(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_staff_wages(uuid) TO authenticated;