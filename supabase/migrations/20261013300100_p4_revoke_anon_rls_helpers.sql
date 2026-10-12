-- RLS helper functions were executable by the anon role, so anyone with
-- the publishable key could call them through PostgREST. They are only
-- needed while evaluating policies for signed-in users. Policies that
-- reference them are narrowed to `authenticated` first, then EXECUTE is
-- revoked from anon. is_org_member / is_org_admin were already revoked
-- from anon in 20260501010000 and are not touched here.

DROP POLICY IF EXISTS "Staff can view their own team assignments" ON public.booking_team_assignments;
CREATE POLICY "Staff can view their own team assignments"
  ON public.booking_team_assignments
  FOR SELECT
  TO authenticated
  USING (public.staff_owns_assignment(staff_id));

REVOKE ALL ON FUNCTION public.staff_owns_assignment(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.staff_owns_assignment(uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.staff_can_view_customer(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.staff_can_view_customer(uuid, uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.staff_can_view_booking(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.staff_can_view_booking(uuid, uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.is_client_portal_user(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_client_portal_user(uuid, uuid) TO authenticated, service_role;
