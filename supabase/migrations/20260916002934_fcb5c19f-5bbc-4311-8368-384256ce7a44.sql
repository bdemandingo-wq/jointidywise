DROP POLICY IF EXISTS "Admins can view org payout accounts" ON public.staff_payout_accounts;
CREATE POLICY "Financial admins can view org payout accounts"
ON public.staff_payout_accounts
FOR SELECT
TO authenticated
USING (public.has_org_financial_access(organization_id));