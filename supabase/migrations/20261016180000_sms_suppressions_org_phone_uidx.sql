-- Not applied by this change. Ask Lovable to run this BEFORE deploying
-- the SMS functions, and confirm it ran.
-- 20260728194630 creates sms_suppressions with UNIQUE (organization_id, phone),
-- but CREATE TABLE IF NOT EXISTS skips that constraint when the table already
-- existed. recordSmsSuppression upserts on (organization_id, phone).
-- Drop older duplicates first so the unique index can be created.
DELETE FROM public.sms_suppressions AS older
WHERE older.id IN (
  SELECT id
  FROM (
    SELECT
      id,
      row_number() OVER (
        PARTITION BY organization_id, phone
        ORDER BY created_at DESC, id DESC
      ) AS rn
    FROM public.sms_suppressions
  ) ranked
  WHERE rn > 1
);

CREATE UNIQUE INDEX IF NOT EXISTS sms_suppressions_org_phone_uidx
  ON public.sms_suppressions (organization_id, phone);
