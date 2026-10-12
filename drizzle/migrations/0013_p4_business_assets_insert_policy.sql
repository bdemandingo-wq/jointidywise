DROP POLICY IF EXISTS "Org members can upload to their business assets" ON storage.objects;
DROP POLICY IF EXISTS "Org members can update their business assets" ON storage.objects;

DROP POLICY IF EXISTS "Org admins can upload business assets" ON storage.objects;
CREATE POLICY "Org admins can upload business assets"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'business-assets'
    AND public.is_org_admin(((storage.foldername(name))[1])::uuid)
  );

DROP POLICY IF EXISTS "Org admins can update business assets" ON storage.objects;
CREATE POLICY "Org admins can update business assets"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'business-assets'
    AND public.is_org_admin(((storage.foldername(name))[1])::uuid)
  )
  WITH CHECK (
    bucket_id = 'business-assets'
    AND public.is_org_admin(((storage.foldername(name))[1])::uuid)
  );