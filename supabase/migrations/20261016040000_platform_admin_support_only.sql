-- Platform admin is support@tidywisecleaning.com only.
--
-- is_platform_admin() was created in
-- 20260509165919_ad38301f-2fa1-43f8-85ac-37502836efed.sql with a second
-- address on the allowlist. That address is removed here.
--
-- Run this file in the Supabase SQL editor. A committed migration does not
-- apply itself.

CREATE OR REPLACE FUNCTION public.is_platform_admin()
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM auth.users
    WHERE id = auth.uid()
      AND lower(email) IN (
        'support@tidywisecleaning.com'
      )
  )
$$;

REVOKE EXECUTE ON FUNCTION public.is_platform_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_platform_admin() TO authenticated;
