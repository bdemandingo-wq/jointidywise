-- Owner/admin texts are opt-in. Existing orgs keep push and the bell;
-- "Also text me" starts off for every business, including ones that already
-- had these events in the matrix.
--
-- Dedupe for one alert per event and booking is the existing
-- admin_system_notifications.dedupe_key column. The unique index is created
-- here as well so a database that never applied the original table migration
-- still rejects a second insert of the same key.

CREATE UNIQUE INDEX IF NOT EXISTS uq_admin_system_notif_dedupe
  ON public.admin_system_notifications (organization_id, dedupe_key)
  WHERE dedupe_key IS NOT NULL;

UPDATE public.organization_notification_preferences
SET
  notification_matrix =
    CASE
      WHEN jsonb_typeof(notification_matrix) = 'object' THEN notification_matrix
      ELSE '{}'::jsonb
    END
    || jsonb_build_object(
      'booking.new',
        CASE
          WHEN jsonb_typeof(notification_matrix -> 'booking.new') = 'object'
            THEN (notification_matrix -> 'booking.new') || '{"sms": false}'::jsonb
          ELSE '{"sms": false}'::jsonb
        END,
      'booking.cancelled',
        CASE
          WHEN jsonb_typeof(notification_matrix -> 'booking.cancelled') = 'object'
            THEN (notification_matrix -> 'booking.cancelled') || '{"sms": false}'::jsonb
          ELSE '{"sms": false}'::jsonb
        END,
      'client.portal_request',
        CASE
          WHEN jsonb_typeof(notification_matrix -> 'client.portal_request') = 'object'
            THEN (notification_matrix -> 'client.portal_request') || '{"sms": false}'::jsonb
          ELSE '{"sms": false}'::jsonb
        END,
      'job.on_the_way',
        CASE
          WHEN jsonb_typeof(notification_matrix -> 'job.on_the_way') = 'object'
            THEN (notification_matrix -> 'job.on_the_way') || '{"sms": false}'::jsonb
          ELSE '{"sms": false}'::jsonb
        END,
      'job.arrived',
        CASE
          WHEN jsonb_typeof(notification_matrix -> 'job.arrived') = 'object'
            THEN (notification_matrix -> 'job.arrived') || '{"sms": false}'::jsonb
          ELSE '{"sms": false}'::jsonb
        END,
      'job.completed',
        CASE
          WHEN jsonb_typeof(notification_matrix -> 'job.completed') = 'object'
            THEN (notification_matrix -> 'job.completed') || '{"sms": false}'::jsonb
          ELSE '{"sms": false}'::jsonb
        END
    ),
  updated_at = now();

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
