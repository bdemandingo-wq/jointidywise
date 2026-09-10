ALTER TABLE public.email_unsubscribe_tokens
  ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE;

-- The old global UNIQUE(email) has to give way to a pair of partial indexes:
-- one legacy/platform row per address, plus one row per (address, org).
ALTER TABLE public.email_unsubscribe_tokens
  DROP CONSTRAINT IF EXISTS email_unsubscribe_tokens_email_key;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_unsub_token_email_global
  ON public.email_unsubscribe_tokens (email)
  WHERE organization_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_unsub_token_email_org
  ON public.email_unsubscribe_tokens (email, organization_id)
  WHERE organization_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_unsub_token_org
  ON public.email_unsubscribe_tokens (organization_id)
  WHERE organization_id IS NOT NULL;