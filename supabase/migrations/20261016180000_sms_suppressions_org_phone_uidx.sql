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

-- Backfill suppressions from customers who are already opted out.
-- 20260514163227 stamped every then-existing opted-out row
-- opted_out_method = 'manual' and opted_out_at = updated_at. Those rows
-- include SMS STOPs from before that migration. Treat manual rows dated
-- before 2026-05-14 as STOP so transactional texts stay blocked. Later
-- manual opt-outs and email unsubscribes are not copied, so transactional
-- texts to those numbers still send. Marketing still blocks any opted_out
-- through isPhoneOptedOut. ON CONFLICT DO NOTHING leaves a non-STOP source
-- in place.
INSERT INTO public.sms_suppressions (organization_id, phone, source)
SELECT DISTINCT organization_id, e164, 'sms_stop'
FROM (
  SELECT
    organization_id,
    CASE
      WHEN right(digits, 10) ~ '^[2-9][0-9]{2}[2-9][0-9]{6}$'
        THEN '+1' || right(digits, 10)
      WHEN length(digits) BETWEEN 11 AND 15
        AND left(digits, 1) <> '0'
        AND NOT (length(digits) = 11 AND left(digits, 1) = '1')
        THEN '+' || digits
      ELSE NULL
    END AS e164
  FROM (
    SELECT
      organization_id,
      regexp_replace(phone, '\D', '', 'g') AS digits
    FROM public.customers
    WHERE marketing_status = 'opted_out'
      AND phone IS NOT NULL
      AND btrim(phone) <> ''
      AND (
        opted_out_method = 'sms_stop'
        OR (
          opted_out_method = 'manual'
          AND opted_out_at < TIMESTAMPTZ '2026-05-14 00:00:00+00'
        )
      )
  ) digits_only
  WHERE length(digits) >= 10
) ready
WHERE e164 IS NOT NULL
ON CONFLICT DO NOTHING;
