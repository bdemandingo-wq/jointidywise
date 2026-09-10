CREATE POLICY "Org members can delete their suppressions"
ON public.email_suppressions
FOR DELETE
TO authenticated
USING (organization_id = get_user_organization_id());