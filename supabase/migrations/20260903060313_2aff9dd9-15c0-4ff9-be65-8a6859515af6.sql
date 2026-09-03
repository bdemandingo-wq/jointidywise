ALTER TABLE public.email_send_log
  ADD COLUMN IF NOT EXISTS bounced_at timestamptz,
  ADD COLUMN IF NOT EXISTS bounce_type text,
  ADD COLUMN IF NOT EXISTS bounce_detail text;

ALTER TABLE public.email_send_log
  DROP CONSTRAINT IF EXISTS email_send_log_bounce_type_check;
ALTER TABLE public.email_send_log
  ADD CONSTRAINT email_send_log_bounce_type_check
  CHECK (bounce_type IS NULL OR bounce_type IN ('hard','soft','unknown'));

CREATE INDEX IF NOT EXISTS idx_email_send_log_org_bounced
  ON public.email_send_log (organization_id, bounced_at)
  WHERE bounced_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.email_bounce_cursor (
  organization_id uuid PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  last_uid bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.email_bounce_cursor TO service_role;

ALTER TABLE public.email_bounce_cursor ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role manages bounce cursor"
  ON public.email_bounce_cursor FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);