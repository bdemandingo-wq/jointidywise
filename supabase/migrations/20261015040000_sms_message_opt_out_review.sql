-- Apply this in the Supabase SQL editor. Do not run it from the CLI, CI,
-- or an agent. A file in supabase/migrations is not proof it has been applied.
--
-- Inbound SMS that mentions an opt-out keyword without being an exact keyword
-- or a clear opt-out phrase stays in the business inbox. This column marks
-- those rows for a person to review. Exact STOP / CANCEL / END replies are
-- not flagged; they opt the customer out and still appear in the inbox.

ALTER TABLE public.sms_messages
  ADD COLUMN IF NOT EXISTS opt_out_review boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.sms_messages.opt_out_review IS
  'True when an inbound SMS contains an opt-out keyword but was not an exact keyword or a clear opt-out phrase.';

CREATE INDEX IF NOT EXISTS idx_sms_messages_opt_out_review
  ON public.sms_messages (organization_id, sent_at DESC)
  WHERE opt_out_review;
