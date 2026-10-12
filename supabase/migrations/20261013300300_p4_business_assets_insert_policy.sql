-- Two INSERT policies on storage.objects for bucket business-assets were
-- both permissive, and Postgres ORs permissive policies. The later
-- "any org member" policy undid the admin-only lockdown, so any member
-- could upload. Logo uploads happen from Settings, and is_org_admin
-- already includes owner, admin, and manager. Recreate the admin policy
-- so a drift where only the loose policy exists still leaves a working
-- upload path for those roles.

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
