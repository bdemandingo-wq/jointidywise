DROP POLICY IF EXISTS "Anyone can view booking photos" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can view booking photos" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can upload booking photos" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can update booking photos" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can delete booking photos" ON storage.objects;
DROP POLICY IF EXISTS "Staff can upload booking photos" ON storage.objects;
DROP POLICY IF EXISTS "Staff can update booking photos" ON storage.objects;
DROP POLICY IF EXISTS "Admins can delete booking photos" ON storage.objects;

DROP POLICY IF EXISTS "Org members can view booking photos" ON storage.objects;
CREATE POLICY "Org members can view booking photos" ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'booking-photos' AND (public.is_org_admin((storage.foldername(name))[1]::uuid) OR public.is_org_staff((storage.foldername(name))[1]::uuid)));

DROP POLICY IF EXISTS "Org members can upload booking photos" ON storage.objects;
CREATE POLICY "Org members can upload booking photos" ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'booking-photos' AND (public.is_org_admin((storage.foldername(name))[1]::uuid) OR public.is_org_staff((storage.foldername(name))[1]::uuid)));

DROP POLICY IF EXISTS "Org members can update booking photos" ON storage.objects;
CREATE POLICY "Org members can update booking photos" ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'booking-photos' AND (public.is_org_admin((storage.foldername(name))[1]::uuid) OR public.is_org_staff((storage.foldername(name))[1]::uuid)));

DROP POLICY IF EXISTS "Org members can delete booking photos" ON storage.objects;
CREATE POLICY "Org members can delete booking photos" ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'booking-photos' AND (public.is_org_admin((storage.foldername(name))[1]::uuid) OR public.is_org_staff((storage.foldername(name))[1]::uuid)));