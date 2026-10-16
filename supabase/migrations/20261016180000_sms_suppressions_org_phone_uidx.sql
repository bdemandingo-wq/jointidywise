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

-- Same decisions as historyConsentKeyword in sms-opt-out.ts:
-- letters-only whole message (so "Stop." and "Opt out" match), then the
-- webhook phrase list, then a message of at most 3 words whose first or last
-- word is a short opt-out ("please stop"). A keyword inside a longer sentence
-- is not a STOP. START/UNSTOP use the same letters-only normalization.
CREATE OR REPLACE FUNCTION public.sms_history_consent(content text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  folded text;
  letters text;
  normalized text;
  parts text[];
  keys text[];
  n int;
  i int;
  phrase text;
  lead text;
  follow text;
BEGIN
  IF content IS NULL OR btrim(content) = '' THEN
    RETURN NULL;
  END IF;

  -- Same apostrophes as APOSTROPHE_LIKE in sms-opt-out.ts.
  folded := replace(replace(replace(replace(replace(replace(replace(replace(content,
    chr(8217), ''''), chr(8216), ''''), chr(8218), ''''), chr(8219), ''''),
    chr(8242), ''''), chr(8245), ''''), chr(700), ''''), chr(65287), '''');
  letters := upper(regexp_replace(folded, '[^A-Za-z]', '', 'g'));
  IF letters IN ('START', 'UNSTOP') THEN
    RETURN 'start';
  END IF;
  IF letters IN (
    'STOP',
    'STOPALL',
    'UNSUBSCRIBE',
    'CANCEL',
    'END',
    'QUIT',
    'REVOKE',
    'OPTOUT'
  ) THEN
    RETURN 'stop';
  END IF;

  normalized := btrim(regexp_replace(lower(folded), '[^a-z'']+', ' ', 'g'));
  FOREACH phrase IN ARRAY ARRAY[
    'stop texting',
    'stop messaging',
    'unsubscribe me',
    'don''t text',
    'dont text',
    'do not text',
    'remove me',
    'take me off'
  ] LOOP
    IF (' ' || normalized || ' ') LIKE ('% ' || phrase || ' %') THEN
      RETURN 'stop';
    END IF;
  END LOOP;

  parts := regexp_split_to_array(normalized, ' ');
  IF parts IS NOT NULL THEN
    FOR i IN 1 .. coalesce(array_length(parts, 1), 0) - 1 LOOP
      lead := parts[i];
      follow := parts[i + 1];
      IF lead IN ('stop', 'quit', 'unsubscribe')
         AND (
           follow IN ('sending', 'contacting', 'receiving')
           OR follow LIKE 'messag%'
           OR follow LIKE 'text%'
         ) THEN
        RETURN 'stop';
      END IF;
    END LOOP;
  END IF;

  SELECT coalesce(array_agg(upper(regexp_replace(tok, '[^A-Za-z]', '', 'g')) ORDER BY ord), ARRAY[]::text[])
  INTO keys
  FROM (
    SELECT m[1] AS tok, ord
    FROM regexp_matches(
      lower(folded),
      '[a-z]+(?:''[a-z]+)+|[0-9]{1,2}:[0-9]{2}[[:space:]]*(?:am|pm)?|[0-9]+[[:space:]]*(?:am|pm)?|[a-z]+',
      'g'
    ) WITH ORDINALITY AS r(m, ord)
  ) tokens;

  n := coalesce(array_length(keys, 1), 0);
  IF n > 0 AND n <= 6 THEN
    FOR i IN 1 .. n LOOP
      IF i + 2 <= n AND keys[i] = 'OPT' AND keys[i + 1] = 'ME' AND keys[i + 2] = 'OUT' THEN
        RETURN 'stop';
      END IF;
      IF i + 2 <= n AND keys[i] = 'NO' AND keys[i + 1] = 'MORE' AND keys[i + 2] = 'TEXTS' THEN
        RETURN 'stop';
      END IF;
    END LOOP;
  END IF;

  IF n > 0 AND n <= 3 THEN
    IF NOT (keys[1] = 'STOP' AND n >= 2 AND keys[2] = 'BY')
       AND keys[1] IN ('STOP', 'STOPALL', 'UNSUBSCRIBE', 'QUIT', 'OPTOUT', 'REVOKE') THEN
      RETURN 'stop';
    END IF;
    IF keys[n] IN ('STOP', 'STOPALL', 'UNSUBSCRIBE', 'QUIT', 'OPTOUT', 'REVOKE')
       AND NOT (
         n >= 2 AND keys[n - 1] IN (
           'DONT', 'CANT', 'WONT', 'ISNT', 'ARENT', 'DIDNT', 'WASNT', 'WERENT',
           'HAVENT', 'HASNT', 'HADNT', 'COULDNT', 'SHOULDNT', 'WOULDNT'
         )
       ) THEN
      RETURN 'stop';
    END IF;
  END IF;

  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.sms_history_consent(text) FROM PUBLIC;

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

-- Inbound history. Suppress a number when its latest webhook STOP is newer
-- than its latest START/UNSTOP. sent_at NULLS LAST so a missing timestamp
-- cannot outrank a real message. max(e164) keeps the group when the newest
-- conversation's phone does not normalize but an older one does.
WITH classified AS (
  SELECT
    m.organization_id,
    right(regexp_replace(c.customer_phone, '\D', '', 'g'), 10) AS match_key,
    public.to_e164(c.customer_phone) AS e164,
    public.sms_history_consent(m.content) AS consent,
    m.sent_at,
    m.id
  FROM public.sms_messages m
  JOIN public.sms_conversations c
    ON c.id = m.conversation_id
   AND c.organization_id = m.organization_id
  WHERE m.direction = 'inbound'
    AND length(regexp_replace(c.customer_phone, '\D', '', 'g')) >= 10
    AND public.sms_history_consent(m.content) IS NOT NULL
),
latest AS (
  SELECT DISTINCT ON (organization_id, match_key)
    organization_id,
    match_key,
    consent
  FROM classified
  ORDER BY organization_id, match_key, sent_at DESC NULLS LAST, id DESC
),
phones AS (
  SELECT organization_id, match_key, max(e164) AS e164
  FROM classified
  GROUP BY organization_id, match_key
)
INSERT INTO public.sms_suppressions (organization_id, phone, source)
SELECT latest.organization_id, phones.e164, 'sms_stop'
FROM latest
JOIN phones
  ON phones.organization_id = latest.organization_id
 AND phones.match_key = latest.match_key
WHERE latest.consent = 'stop'
  AND phones.e164 IS NOT NULL
ON CONFLICT DO NOTHING;
