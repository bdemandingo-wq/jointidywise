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

-- Same rules as toE164 in supabase/functions/_shared/phone.ts.
-- A 12-digit international number such as 447955512345 stays +447955512345.
-- It is not rewritten to +1 plus its last 10 digits.
CREATE OR REPLACE FUNCTION public.to_e164(raw text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = public
AS $$
  WITH d AS (
    SELECT regexp_replace(coalesce(raw, ''), '\D', '', 'g') AS digits
  )
  SELECT CASE
    WHEN length(digits) = 10 AND digits ~ '^[2-9][0-9]{2}[2-9][0-9]{6}$'
      THEN '+1' || digits
    WHEN length(digits) = 11
      AND left(digits, 1) = '1'
      AND substring(digits FROM 2) ~ '^[2-9][0-9]{2}[2-9][0-9]{6}$'
      THEN '+' || digits
    WHEN length(digits) BETWEEN 11 AND 15
      AND left(digits, 1) <> '0'
      AND NOT (length(digits) = 11 AND left(digits, 1) = '1')
      THEN '+' || digits
    ELSE NULL
  END
  FROM d;
$$;

REVOKE ALL ON FUNCTION public.to_e164(text) FROM PUBLIC;

-- Customers already recorded as an SMS STOP. Manual and email opt-outs are
-- not copied: 20260514163227 stamped those as manual, and they are not STOPs.
-- Columns checked against 20260106010534 (sms_messages.direction, content,
-- sent_at, conversation_id, organization_id; sms_conversations.customer_phone).
INSERT INTO public.sms_suppressions (organization_id, phone, source)
SELECT DISTINCT c.organization_id, public.to_e164(c.phone), 'sms_stop'
FROM public.customers c
WHERE c.marketing_status = 'opted_out'
  AND c.opted_out_method = 'sms_stop'
  AND public.to_e164(c.phone) IS NOT NULL
ON CONFLICT DO NOTHING;

-- Inbound history. Suppress a number when its latest STOP-family keyword is
-- newer than its latest START/UNSTOP. Keyword match is case-insensitive trim.
-- sent_at is the provider time the webhook stores.
INSERT INTO public.sms_suppressions (organization_id, phone, source)
SELECT organization_id, e164, 'sms_stop'
FROM (
  SELECT DISTINCT ON (
    m.organization_id,
    right(regexp_replace(c.customer_phone, '\D', '', 'g'), 10)
  )
    m.organization_id,
    public.to_e164(c.customer_phone) AS e164,
    upper(btrim(m.content)) AS token
  FROM public.sms_messages m
  JOIN public.sms_conversations c
    ON c.id = m.conversation_id
   AND c.organization_id = m.organization_id
  WHERE m.direction = 'inbound'
    AND length(regexp_replace(c.customer_phone, '\D', '', 'g')) >= 10
    AND upper(btrim(m.content)) IN (
      'STOP', 'STOPALL', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT', 'START', 'UNSTOP'
    )
  ORDER BY
    m.organization_id,
    right(regexp_replace(c.customer_phone, '\D', '', 'g'), 10),
    m.sent_at DESC,
    m.id DESC
) latest
WHERE token NOT IN ('START', 'UNSTOP')
  AND e164 IS NOT NULL
ON CONFLICT DO NOTHING;
