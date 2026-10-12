-- Force the booking-photos bucket private.
--
-- The bucket was created public (20251224065946) and set public = false
-- in 20260120224325. No later migration sets it public again. A production
-- check still found public = true, so this UPDATE is the live fix and is
-- safe to re-run.
--
-- Direct URLs stop working once the bucket is private. Admin, staff, and
-- portal photo UIs already call createSignedUrl / SignedImage. Service-role
-- signing in get-portal-photo-journal does not need a SELECT policy.
-- Authenticated createSignedUrl does, so the org-scoped SELECT policy is
-- recreated here. Paths are {organization_id}/{booking_id}/...
--
-- staff-avatars and business-assets stay public. Avatars are rendered with
-- getPublicUrl, and business logos are embedded in email and on the public
-- booking page. Making either private would break those displays. Listing
-- on those buckets was already dropped in 20260501030000.

UPDATE storage.buckets
SET public = false
WHERE id = 'booking-photos';

-- Legacy policies that allow anyone, or any logged-in user, to read or
-- write every org's photos. Storage policies are OR'd, so one leftover
-- broad policy undoes the org-scoped ones.
DROP POLICY IF EXISTS "Anyone can view booking photos" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can view booking photos" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can upload booking photos" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can update booking photos" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can delete booking photos" ON storage.objects;
DROP POLICY IF EXISTS "Staff can upload booking photos" ON storage.objects;
DROP POLICY IF EXISTS "Staff can update booking photos" ON storage.objects;
-- Same name was reused for an org-scoped delete and, earlier, for
-- "any authenticated user". The org-scoped replacement below is
-- "Org members can delete booking photos".
DROP POLICY IF EXISTS "Admins can delete booking photos" ON storage.objects;

DROP POLICY IF EXISTS "Org members can view booking photos" ON storage.objects;
CREATE POLICY "Org members can view booking photos"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'booking-photos'
  AND (
    public.is_org_admin((storage.foldername(name))[1]::uuid)
    OR public.is_org_staff((storage.foldername(name))[1]::uuid)
  )
);

DROP POLICY IF EXISTS "Org members can upload booking photos" ON storage.objects;
CREATE POLICY "Org members can upload booking photos"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'booking-photos'
  AND (
    public.is_org_admin((storage.foldername(name))[1]::uuid)
    OR public.is_org_staff((storage.foldername(name))[1]::uuid)
  )
);

DROP POLICY IF EXISTS "Org members can update booking photos" ON storage.objects;
CREATE POLICY "Org members can update booking photos"
ON storage.objects FOR UPDATE
TO authenticated
USING (
  bucket_id = 'booking-photos'
  AND (
    public.is_org_admin((storage.foldername(name))[1]::uuid)
    OR public.is_org_staff((storage.foldername(name))[1]::uuid)
  )
);

DROP POLICY IF EXISTS "Org members can delete booking photos" ON storage.objects;
CREATE POLICY "Org members can delete booking photos"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'booking-photos'
  AND (
    public.is_org_admin((storage.foldername(name))[1]::uuid)
    OR public.is_org_staff((storage.foldername(name))[1]::uuid)
  )
);
