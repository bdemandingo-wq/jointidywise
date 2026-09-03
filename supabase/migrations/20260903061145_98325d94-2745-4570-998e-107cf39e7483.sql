CREATE TABLE public.email_suppressions (
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  email text NOT NULL,
  reason text NOT NULL,
  first_bounced_at timestamptz NOT NULL DEFAULT now(),
  bounce_count int NOT NULL DEFAULT 1,
  last_bounce_detail text,
  PRIMARY KEY (organization_id, email)
);

GRANT SELECT ON public.email_suppressions TO authenticated;
GRANT ALL ON public.email_suppressions TO service_role;

ALTER TABLE public.email_suppressions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members can view their suppressions"
ON public.email_suppressions
FOR SELECT
TO authenticated
USING (organization_id = public.get_user_organization_id());

CREATE POLICY "Service role manages suppressions"
ON public.email_suppressions
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);