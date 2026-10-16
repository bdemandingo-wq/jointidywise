DROP FUNCTION IF EXISTS public.get_staff_customers(uuid[]);

CREATE FUNCTION public.get_staff_customers(p_customer_ids uuid[])
RETURNS TABLE (
  id uuid,
  organization_id uuid,
  first_name text,
  last_name text,
  email text,
  phone text,
  has_phone boolean,
  phone_visible boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    c.id,
    c.organization_id,
    c.first_name::text,
    c.last_name::text,
    c.email::text,
    CASE WHEN v.visible THEN c.phone::text ELSE NULL END,
    (NULLIF(btrim(COALESCE(c.phone::text, '')), '') IS NOT NULL),
    v.visible
  FROM public.customers c
  JOIN public.organizations o ON o.id = c.organization_id
  CROSS JOIN LATERAL (
    SELECT (public.is_org_operator(c.organization_id) OR o.show_customer_phone_to_staff) AS visible
  ) v
  WHERE c.id = ANY (p_customer_ids)
    AND (
      public.is_org_operator(c.organization_id)
      OR public.staff_can_view_customer(c.id, c.organization_id)
    );
$$;

REVOKE ALL ON FUNCTION public.get_staff_customers(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_staff_customers(uuid[]) TO authenticated;