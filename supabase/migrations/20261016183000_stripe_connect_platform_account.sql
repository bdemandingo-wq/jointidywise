-- Which Stripe platform account (acct_...) an org Connect connection or a
-- cleaner Express account was created under. The app compares this to
-- STRIPE_PLATFORM_ACCOUNT_ID. NULL means the row predates stamping.
-- After STRIPE_CONNECT_PLATFORM_SWITCHED is set, NULL and any other id
-- are treated as needing a reconnect. This file does not backfill ids,
-- does not call Stripe, and does not move money.
--
-- Manual API-key connections stay NULL on purpose: they are the business's
-- own Stripe account, not a Connect account issued by the platform.

ALTER TABLE public.org_stripe_settings
  ADD COLUMN IF NOT EXISTS platform_account_id text;

ALTER TABLE public.staff_payout_accounts
  ADD COLUMN IF NOT EXISTS platform_account_id text;

COMMENT ON COLUMN public.org_stripe_settings.platform_account_id IS
  'Stripe platform account id (acct_...) this Connect OAuth connection was authorized under. NULL before platform stamping, and for manual API-key connections.';

COMMENT ON COLUMN public.staff_payout_accounts.platform_account_id IS
  'Stripe platform account id (acct_...) this Express account was created under. NULL before platform stamping.';
