import { useEffect, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { useOrganization } from '@/contexts/OrganizationContext';
import {
  useNotificationPreferences,
  useUpdateNotificationPreferences,
} from '@/hooks/useNotificationPreferences';

// Map old business_settings columns to new notification catalog keys.
// Migration is non-destructive: legacy columns are not deleted and existing
// customized preferences in the new matrix are never overwritten.
const LEGACY_MAP: Array<{ col: string; typeKey: string }> = [
  { col: 'notify_new_booking', typeKey: 'booking.new' },
  { col: 'notify_cancellations', typeKey: 'booking.cancelled' },
  // notify_reminders is the customer's appointment-reminder email, not an
  // owner "booking confirmed" alert. It stays on the customer section.
];

// Module-level guard so multiple mounted consumers (e.g. Settings page +
// Notifications page) don't race the same migration for one org in a session.
const migrated = new Set<string>();

/**
 * Seeds the new organization_notification_preferences matrix from the three
 * legacy business_settings toggles the first time an org loads the new
 * notification center. Idempotent; safe to call from any surface.
 */
export function useLegacyNotificationMigration() {
  const { organization } = useOrganization();
  const orgId = organization?.id ?? null;
  const prefs = useNotificationPreferences();
  const { save } = useUpdateNotificationPreferences();
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;

  useEffect(() => {
    if (!orgId) return;
    if (migrated.has(orgId)) return;
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from('business_settings')
        .select('notify_new_booking, notify_cancellations')
        .eq('organization_id', orgId)
        .maybeSingle();
      if (cancelled || error) return;
      migrated.add(orgId);
      const matrixPatch: Record<string, Record<string, boolean>> = {};
      for (const { col, typeKey } of LEGACY_MAP) {
        const legacy = (data as any)?.[col];
        if (typeof legacy !== 'boolean') continue;
        const already = prefsRef.current.notification_matrix?.[typeKey]?.email;
        if (typeof already === 'boolean') continue;
        matrixPatch[typeKey] = { email: legacy };
      }
      if (Object.keys(matrixPatch).length > 0) {
        await save({ notification_matrix: matrixPatch });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [orgId, save]);
}
