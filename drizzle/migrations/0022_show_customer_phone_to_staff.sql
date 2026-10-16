ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS show_customer_phone_to_staff boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.organizations.show_customer_phone_to_staff IS
  'When false, cleaners (staff without an owner/admin/manager membership) cannot read customer phone numbers. Enforced by the customers staff RLS policy plus get_staff_customers().';

-- Staff-safe customer read. Authorizes the caller per row: owners/admins/managers
-- of the org, or active staff who can see the customer through a booking.
-- Phone is returned only to operators, or to staff when the org allows it.
CREATE OR REPLACE FUNCTION public.get_staff_customers(p_customer_ids uuid[])
RETURNS TABLE (
  id uuid,
  organization_id uuid,
  first_name text,
  last_name text,
  email text,
  phone text,
  has_phone boolean
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
    CASE
      WHEN public.is_org_operator(c.organization_id) OR o.show_customer_phone_to_staff
      THEN c.phone::text
      ELSE NULL
    END,
    (NULLIF(btrim(COALESCE(c.phone::text, '')), '') IS NOT NULL)
  FROM public.customers c
  JOIN public.organizations o ON o.id = c.organization_id
  WHERE c.id = ANY (p_customer_ids)
    AND (
      public.is_org_operator(c.organization_id)
      OR public.staff_can_view_customer(c.id, c.organization_id)
    );
$$;

REVOKE ALL ON FUNCTION public.get_staff_customers(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_staff_customers(uuid[]) TO authenticated;

-- Direct customer-row access for cleaners now requires the org setting, so the
-- phone column cannot be read via the API when it is off. Cleaner screens read
-- names/addresses through get_staff_customers() instead.
DROP POLICY IF EXISTS "Staff can view assigned customers" ON public.customers;
CREATE POLICY "Staff can view assigned customers"
ON public.customers
FOR SELECT
TO authenticated
USING (
  public.staff_can_view_customer(id, organization_id)
  AND EXISTS (
    SELECT 1 FROM public.organizations o
    WHERE o.id = customers.organization_id
      AND o.show_customer_phone_to_staff
  )
);