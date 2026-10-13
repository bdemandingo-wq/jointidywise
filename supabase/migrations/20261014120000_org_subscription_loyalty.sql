-- Loyalty price clock. One row per organization.
-- continuous_since is the start of the current paid streak. It is cleared
-- when the subscription is canceled or ends unpaid. past_due does not clear it.
-- Authenticated users can read their own org. Only the service role writes.

CREATE TABLE public.org_subscription_loyalty (
  organization_id uuid PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  continuous_since timestamptz,
  stripe_subscription_id text,
  plan text,
  billing_interval text,
  applied_discount_cents integer NOT NULL DEFAULT 0 CHECK (applied_discount_cents >= 0),
  applied_coupon_id text,
  last_status text,
  reset_at timestamptz,
  reset_reason text CHECK (reset_reason IS NULL OR reset_reason IN ('cancelled', 'unpaid_ended')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.org_subscription_loyalty ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.org_subscription_loyalty FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.org_subscription_loyalty TO authenticated;
GRANT ALL ON public.org_subscription_loyalty TO service_role;

CREATE POLICY "Org owners and admins can view their loyalty price"
ON public.org_subscription_loyalty
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.org_memberships m
    WHERE m.organization_id = org_subscription_loyalty.organization_id
      AND m.user_id = auth.uid()
      AND m.role IN ('owner', 'admin')
  )
);

DROP TRIGGER IF EXISTS trg_org_subscription_loyalty_updated ON public.org_subscription_loyalty;
CREATE TRIGGER trg_org_subscription_loyalty_updated
BEFORE UPDATE ON public.org_subscription_loyalty
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Daily backstop for the renewal coupon. invoice.upcoming can call the
-- same function sooner. The function checks x-cron-secret itself.
DO $$ BEGIN
  PERFORM cron.unschedule('apply-loyalty-pricing');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'apply-loyalty-pricing',
  '45 15 * * *',
  $$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_url') || '/functions/v1/apply-loyalty-pricing',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret')
    ),
    body := '{}'::jsonb
  );
  $$
);
