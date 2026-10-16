-- Owner/admin texts are opt-in, except for a business that can already text
-- and has no operator iPhone. Those orgs keep each text only when the old
-- switch is not explicitly false (null still means on). job.completed has no
-- old switch, so it stays on. Everyone else starts with "Also text me" off.
--
-- Dedupe uses admin_system_notifications.dedupe_key. Job alerts include the
-- cleaner, and a cancellation includes that cancellation's timestamp, so a
-- second cleaner or a later cancellation is not dropped. The unique index is
-- created here as well so a database that never applied the original table
-- migration still rejects a second insert of the same key.

CREATE UNIQUE INDEX IF NOT EXISTS uq_admin_system_notif_dedupe
  ON public.admin_system_notifications (organization_id, dedupe_key)
  WHERE dedupe_key IS NOT NULL;

CREATE TEMP TABLE owner_alert_keep_sms AS
SELECT
  s.organization_id,
  -- NULL is distinct from false, so a missing switch keeps the text on.
  (b.notify_new_booking IS DISTINCT FROM false) AS notify_new_booking,
  (b.notify_cancellations IS DISTINCT FROM false) AS notify_cancellations,
  (s.notify_admin_on_the_way IS DISTINCT FROM false) AS notify_admin_on_the_way,
  (s.notify_admin_arrived IS DISTINCT FROM false) AS notify_admin_arrived
FROM public.organization_sms_settings s
LEFT JOIN public.business_settings b ON b.organization_id = s.organization_id
WHERE s.sms_enabled IS TRUE
  AND length(btrim(coalesce(s.openphone_api_key, ''))) > 0
  AND length(btrim(coalesce(s.openphone_phone_number_id, ''))) > 0
  AND NOT EXISTS (
    SELECT 1
    FROM public.org_memberships op
    JOIN public.device_push_tokens t
      ON t.user_id = op.user_id
     AND t.platform = 'ios'
    WHERE op.organization_id = s.organization_id
      AND op.role IN ('owner', 'admin', 'manager')
  );

INSERT INTO public.organization_notification_preferences (organization_id, notification_matrix)
SELECT
  k.organization_id,
  jsonb_build_object(
    'booking.new', jsonb_build_object('sms', k.notify_new_booking),
    'booking.cancelled', jsonb_build_object('sms', k.notify_cancellations),
    'client.portal_request', jsonb_build_object('sms', k.notify_new_booking),
    'job.on_the_way', jsonb_build_object('sms', k.notify_admin_on_the_way),
    'job.arrived', jsonb_build_object('sms', k.notify_admin_arrived),
    'job.completed', jsonb_build_object('sms', true)
  )
FROM owner_alert_keep_sms k
WHERE NOT EXISTS (
  SELECT 1
  FROM public.organization_notification_preferences p
  WHERE p.organization_id = k.organization_id
);

UPDATE public.organization_notification_preferences p
SET
  notification_matrix =
    CASE
      WHEN jsonb_typeof(p.notification_matrix) = 'object' THEN p.notification_matrix
      ELSE '{}'::jsonb
    END
    || jsonb_build_object(
      'booking.new',
        CASE
          WHEN jsonb_typeof(p.notification_matrix -> 'booking.new') = 'object'
            THEN (p.notification_matrix -> 'booking.new') || jsonb_build_object('sms', k.notify_new_booking)
          ELSE jsonb_build_object('sms', k.notify_new_booking)
        END,
      'booking.cancelled',
        CASE
          WHEN jsonb_typeof(p.notification_matrix -> 'booking.cancelled') = 'object'
            THEN (p.notification_matrix -> 'booking.cancelled') || jsonb_build_object('sms', k.notify_cancellations)
          ELSE jsonb_build_object('sms', k.notify_cancellations)
        END,
      'client.portal_request',
        CASE
          WHEN jsonb_typeof(p.notification_matrix -> 'client.portal_request') = 'object'
            THEN (p.notification_matrix -> 'client.portal_request') || jsonb_build_object('sms', k.notify_new_booking)
          ELSE jsonb_build_object('sms', k.notify_new_booking)
        END,
      'job.on_the_way',
        CASE
          WHEN jsonb_typeof(p.notification_matrix -> 'job.on_the_way') = 'object'
            THEN (p.notification_matrix -> 'job.on_the_way') || jsonb_build_object('sms', k.notify_admin_on_the_way)
          ELSE jsonb_build_object('sms', k.notify_admin_on_the_way)
        END,
      'job.arrived',
        CASE
          WHEN jsonb_typeof(p.notification_matrix -> 'job.arrived') = 'object'
            THEN (p.notification_matrix -> 'job.arrived') || jsonb_build_object('sms', k.notify_admin_arrived)
          ELSE jsonb_build_object('sms', k.notify_admin_arrived)
        END,
      'job.completed',
        CASE
          WHEN jsonb_typeof(p.notification_matrix -> 'job.completed') = 'object'
            THEN (p.notification_matrix -> 'job.completed') || jsonb_build_object('sms', true)
          ELSE jsonb_build_object('sms', true)
        END
    ),
  updated_at = now()
FROM owner_alert_keep_sms k
WHERE p.organization_id = k.organization_id;

UPDATE public.organization_notification_preferences p
SET
  notification_matrix =
    CASE
      WHEN jsonb_typeof(p.notification_matrix) = 'object' THEN p.notification_matrix
      ELSE '{}'::jsonb
    END
    || jsonb_build_object(
      'booking.new',
        CASE
          WHEN jsonb_typeof(p.notification_matrix -> 'booking.new') = 'object'
            THEN (p.notification_matrix -> 'booking.new') || '{"sms": false}'::jsonb
          ELSE '{"sms": false}'::jsonb
        END,
      'booking.cancelled',
        CASE
          WHEN jsonb_typeof(p.notification_matrix -> 'booking.cancelled') = 'object'
            THEN (p.notification_matrix -> 'booking.cancelled') || '{"sms": false}'::jsonb
          ELSE '{"sms": false}'::jsonb
        END,
      'client.portal_request',
        CASE
          WHEN jsonb_typeof(p.notification_matrix -> 'client.portal_request') = 'object'
            THEN (p.notification_matrix -> 'client.portal_request') || '{"sms": false}'::jsonb
          ELSE '{"sms": false}'::jsonb
        END,
      'job.on_the_way',
        CASE
          WHEN jsonb_typeof(p.notification_matrix -> 'job.on_the_way') = 'object'
            THEN (p.notification_matrix -> 'job.on_the_way') || '{"sms": false}'::jsonb
          ELSE '{"sms": false}'::jsonb
        END,
      'job.arrived',
        CASE
          WHEN jsonb_typeof(p.notification_matrix -> 'job.arrived') = 'object'
            THEN (p.notification_matrix -> 'job.arrived') || '{"sms": false}'::jsonb
          ELSE '{"sms": false}'::jsonb
        END,
      'job.completed',
        CASE
          WHEN jsonb_typeof(p.notification_matrix -> 'job.completed') = 'object'
            THEN (p.notification_matrix -> 'job.completed') || '{"sms": false}'::jsonb
          ELSE '{"sms": false}'::jsonb
        END
    ),
  updated_at = now()
WHERE NOT EXISTS (
  SELECT 1 FROM owner_alert_keep_sms k WHERE k.organization_id = p.organization_id
);

-- True when any owner, admin, or manager of this org has an iPhone push token.
-- Returns only a boolean. The caller must be one of those operators.
CREATE OR REPLACE FUNCTION public.org_has_operator_ios_device(p_organization_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    EXISTS (
      SELECT 1
      FROM public.org_memberships caller
      WHERE caller.organization_id = p_organization_id
        AND caller.user_id = auth.uid()
        AND caller.role IN ('owner', 'admin', 'manager')
    )
    AND EXISTS (
      SELECT 1
      FROM public.org_memberships op
      JOIN public.device_push_tokens t ON t.user_id = op.user_id
      WHERE op.organization_id = p_organization_id
        AND op.role IN ('owner', 'admin', 'manager')
        AND t.platform = 'ios'
    );
$$;

REVOKE ALL ON FUNCTION public.org_has_operator_ios_device(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.org_has_operator_ios_device(uuid) TO authenticated;

-- True when this org has an address notifyOwner can use: the owner's profile
-- email, then the company email, then the sending address. Boolean only.
CREATE OR REPLACE FUNCTION public.org_has_owner_alert_email(p_organization_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    EXISTS (
      SELECT 1
      FROM public.org_memberships caller
      WHERE caller.organization_id = p_organization_id
        AND caller.user_id = auth.uid()
        AND caller.role IN ('owner', 'admin', 'manager')
    )
    AND (
      EXISTS (
        SELECT 1
        FROM public.organizations o
        JOIN public.profiles p ON p.id = o.owner_id
        WHERE o.id = p_organization_id
          AND length(btrim(coalesce(p.email, ''))) > 0
      )
      OR EXISTS (
        SELECT 1
        FROM public.business_settings b
        WHERE b.organization_id = p_organization_id
          AND length(btrim(coalesce(b.company_email, ''))) > 0
      )
      OR EXISTS (
        SELECT 1
        FROM public.organization_email_settings e
        WHERE e.organization_id = p_organization_id
          AND length(btrim(coalesce(e.from_email, ''))) > 0
      )
    );
$$;

REVOKE ALL ON FUNCTION public.org_has_owner_alert_email(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.org_has_owner_alert_email(uuid) TO authenticated;

DROP TABLE IF EXISTS owner_alert_keep_sms;
