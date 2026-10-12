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