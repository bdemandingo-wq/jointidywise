import { supabase } from '@/lib/supabase';
import {
  buildConsentLogRow,
  consentAllowsTracking,
  consentLogForOsPermissionGrant,
  consentSnapshot,
} from '@/lib/locationConsent';
import { readLocationSharingAvailability } from '@/lib/readLocationSharingAvailability';

/**
 * Appends a granted consent row when iOS or the browser has already allowed
 * location and the latest decision would still block tracking.
 * No-op when sharing is closed (old iOS build, Android, or the remote switch)
 * or when the latest row is already a yes.
 */
export async function recordOsPermissionGrant(staffId: string): Promise<void> {
  const gate = await readLocationSharingAvailability();
  if (!gate.logConsent) return;

  const { data: staff, error: staffError } = await supabase
    .from('staff')
    .select('organization_id')
    .eq('id', staffId)
    .maybeSingle();
  if (staffError) throw staffError;
  if (!staff?.organization_id) throw new Error('Staff profile has no organization');

  const { data: rows, error: readError } = await supabase
    .from('cleaner_location_consents')
    .select('decision')
    .eq('staff_id', staffId)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(1);
  if (readError) throw readError;

  const snapshot = consentSnapshot(!!rows?.[0], rows?.[0]?.decision);
  if (consentAllowsTracking(snapshot.decision)) return;

  const event = consentLogForOsPermissionGrant(snapshot.decision);
  if (!event) return;

  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError) throw userError;
  const userId = userData.user?.id;
  if (!userId) throw new Error('Not signed in');

  const { error } = await supabase.from('cleaner_location_consents').insert(
    buildConsentLogRow({
      staffId,
      organizationId: staff.organization_id,
      userId,
      decision: event.decision,
      source: event.source,
    }),
  );
  if (error) throw error;
}
