-- Staff location rows must use that staff member's organization, and the
-- booking must belong to the same organization.
--
-- The previous staff policies checked staff_id ownership only, so a cleaner
-- could write another org's organization_id or booking_id.
--
-- The check is a SECURITY DEFINER function so it reads the booking's real
-- organization even when booking RLS would hide that row. It still requires
-- auth.uid() to own the staff row, and it returns false for anon. Anon has
-- EXECUTE only so policy evaluation does not error; it cannot read a row.
--
-- Run this in the Supabase SQL editor. A git push does not apply it.

CREATE OR REPLACE FUNCTION public.cleaner_location_matches_staff_org(
  _staff_id uuid,
  _organization_id uuid,
  _booking_id uuid
) RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.staff s
    JOIN public.bookings b ON b.id = _booking_id
    WHERE s.id = _staff_id
      AND s.user_id = auth.uid()
      AND s.is_active = true
      AND s.organization_id IS NOT NULL
      AND s.organization_id = _organization_id
      AND b.organization_id = s.organization_id
  );
$$;

REVOKE ALL ON FUNCTION public.cleaner_location_matches_staff_org(uuid, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cleaner_location_matches_staff_org(uuid, uuid, uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cleaner_location_matches_staff_org(uuid, uuid, uuid) TO anon, authenticated;

DROP POLICY IF EXISTS "Staff can view own tracking" ON public.cleaner_location_tracking;
DROP POLICY IF EXISTS "Staff can insert their own tracking" ON public.cleaner_location_tracking;
DROP POLICY IF EXISTS "Staff can update their own tracking" ON public.cleaner_location_tracking;

CREATE POLICY "Staff can view own tracking"
  ON public.cleaner_location_tracking
  FOR SELECT
  TO public
  USING (
    public.cleaner_location_matches_staff_org(
      staff_id,
      organization_id,
      booking_id
    )
  );

CREATE POLICY "Staff can insert their own tracking"
  ON public.cleaner_location_tracking
  FOR INSERT
  TO public
  WITH CHECK (
    public.cleaner_location_matches_staff_org(
      staff_id,
      organization_id,
      booking_id
    )
  );

CREATE POLICY "Staff can update their own tracking"
  ON public.cleaner_location_tracking
  FOR UPDATE
  TO public
  USING (
    public.cleaner_location_matches_staff_org(
      staff_id,
      organization_id,
      booking_id
    )
  )
  WITH CHECK (
    public.cleaner_location_matches_staff_org(
      staff_id,
      organization_id,
      booking_id
    )
  );
