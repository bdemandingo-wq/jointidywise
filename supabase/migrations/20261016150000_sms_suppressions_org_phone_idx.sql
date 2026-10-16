-- Lookup for the shared SMS sender is equality on (organization_id, phone)
-- after the number is normalized to E.164.
--
-- sms_suppressions was created with UNIQUE (organization_id, phone), which is
-- an index when that statement actually ran. CREATE TABLE IF NOT EXISTS does
-- not add the constraint if the table already existed, so this index covers
-- the lookup either way. Not applied by this change — run it in Lovable.
CREATE INDEX IF NOT EXISTS sms_suppressions_org_phone_idx
  ON public.sms_suppressions (organization_id, phone);
