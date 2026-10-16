-- Arrival sends insert booking_reminder_log before the text goes out.
-- Two callers must not both win. The original table declared
-- UNIQUE (booking_id, reminder_type). Recreate that constraint if it
-- is gone. Keep the earliest row when duplicates already exist.
--
-- Run this file in the Supabase SQL editor. A git push does not apply it.

DO $$
BEGIN
  -- Live databases already have booking_reminder_log_booking_id_reminder_type_key
  -- UNIQUE (booking_id, reminder_type). Either match returns before any
  -- DELETE or ALTER, so this file is a no-op there.
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.booking_reminder_log'::regclass
      AND (
        conname = 'booking_reminder_log_booking_id_reminder_type_key'
        OR (
          contype = 'u'
          AND pg_get_constraintdef(oid) LIKE '%(booking_id, reminder_type)%'
        )
      )
  ) THEN
    RETURN;
  END IF;

  DELETE FROM public.booking_reminder_log AS extra
  WHERE extra.id IN (
    SELECT id FROM (
      SELECT id,
             row_number() OVER (
               PARTITION BY booking_id, reminder_type
               ORDER BY sent_at ASC, created_at ASC, id ASC
             ) AS n
      FROM public.booking_reminder_log
    ) ranked
    WHERE ranked.n > 1
  );

  ALTER TABLE public.booking_reminder_log
    ADD CONSTRAINT booking_reminder_log_booking_id_reminder_type_key
    UNIQUE (booking_id, reminder_type);
END $$;
