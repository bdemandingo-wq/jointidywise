-- Apply this in the Supabase SQL editor. Do not run it from the CLI, CI,
-- or an agent. A file in supabase/migrations is not proof it has been applied.
--
-- Inbound SMS that mentions an opt-out keyword without being an opt-out
-- stays in the business inbox. opt_out_review marks those rows, including a
-- START/UNSTOP while the customer is opted out some way other than sms_stop.
-- sms_resubscribed marks a START/UNSTOP that cleared an sms_stop opt-out.
-- marketing_status_before_sms_stop is the consent to restore. START must not
-- invent opted-in status when this value was never stored.

ALTER TABLE public.sms_messages
  ADD COLUMN IF NOT EXISTS opt_out_review boolean NOT NULL DEFAULT false;

ALTER TABLE public.sms_messages
  ADD COLUMN IF NOT EXISTS sms_resubscribed boolean NOT NULL DEFAULT false;

ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS marketing_status_before_sms_stop text;

COMMENT ON COLUMN public.sms_messages.opt_out_review IS
  'True when an inbound SMS needs a person: an opt-out keyword that was not treated as an opt-out, or START/UNSTOP while opted out another way.';

COMMENT ON COLUMN public.sms_messages.sms_resubscribed IS
  'True when this inbound START/UNSTOP cleared an sms_stop opt-out. No confirmation text is sent.';

COMMENT ON COLUMN public.customers.marketing_status_before_sms_stop IS
  'marketing_status at the moment an sms_stop opt-out was recorded. START/UNSTOP restores this value and does not invent opted-in consent.';

CREATE INDEX IF NOT EXISTS idx_sms_messages_opt_out_review
  ON public.sms_messages (organization_id, sent_at DESC)
  WHERE opt_out_review;
