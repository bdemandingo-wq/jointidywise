-- Not applied by this change. Ask Lovable to run it and confirm it ran.
-- 20260728194630 creates sms_suppressions with UNIQUE (organization_id, phone),
-- but CREATE TABLE IF NOT EXISTS skips that constraint when the table already
-- existed. recordSmsSuppression upserts on (organization_id, phone).
CREATE UNIQUE INDEX IF NOT EXISTS sms_suppressions_org_phone_uidx
  ON public.sms_suppressions (organization_id, phone);
