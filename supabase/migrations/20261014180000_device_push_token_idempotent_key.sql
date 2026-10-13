-- One row per user + device token.
--
-- register-push-token updates an existing row in place. PostgREST upsert
-- also needs this unique constraint for ON CONFLICT (user_id, token). A
-- second row for the same phone (one per company the owner belongs to)
-- makes send-push-notification deliver the same operator alert twice,
-- because operator audience selects by user_id and would see both rows.
--
-- Operator delivery does not read organization_id. The single row still
-- receives a push for every company this user operates.

DELETE FROM public.device_push_tokens AS older
USING public.device_push_tokens AS newer
WHERE older.user_id = newer.user_id
  AND older.token = newer.token
  AND older.id <> newer.id
  AND (
    older.updated_at < newer.updated_at
    OR (older.updated_at = newer.updated_at AND older.id < newer.id)
  );

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND t.relname = 'device_push_tokens'
      AND c.contype = 'u'
      AND (
        SELECT array_agg(att.attname::text ORDER BY u.ord)
        FROM unnest(c.conkey) WITH ORDINALITY AS u(attnum, ord)
        JOIN pg_attribute att
          ON att.attrelid = c.conrelid
         AND att.attnum = u.attnum
      ) = ARRAY['user_id', 'token']::text[]
  ) THEN
    ALTER TABLE public.device_push_tokens
      ADD CONSTRAINT device_push_tokens_user_id_token_key UNIQUE (user_id, token);
  END IF;
END $$;
