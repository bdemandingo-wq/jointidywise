-- Self-serve client portal password reset. Tokens are stored hashed.
-- No policies: only the service role (edge functions) reads or writes this table.
CREATE TABLE IF NOT EXISTS public.client_portal_password_resets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  portal_user_id uuid NOT NULL REFERENCES public.client_portal_users(id) ON DELETE CASCADE,
  token_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.client_portal_password_resets ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS client_portal_password_resets_token_hash_idx
  ON public.client_portal_password_resets (token_hash);
