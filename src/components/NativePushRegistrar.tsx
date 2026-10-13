import { useEffect, useRef, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useOrganization } from '@/contexts/OrganizationContext';
import { usePushNotifications } from '@/hooks/usePushNotifications';
import { isIosAppShell } from '@/lib/pushRuntime';
import { supabase } from '@/lib/supabase';

const PUSH_ROLES = new Set(['owner', 'admin', 'manager', 'member']);

// Survives re-renders, not cold starts. A new launch re-registers the token
// (APNs can rotate it) and retries a plugin call that failed last time.
const registrationStartedFor = new Set<string>();

// Long enough that the staff location prompt and the first dashboard paint
// are not stacked under the system notification dialog.
const PROMPT_DELAY_MS = 3000;

/**
 * Asks iOS for notification permission after login and saves the device token.
 *
 * Settings → TidyWise shows a Notifications row only after
 * UNUserNotificationCenter.requestAuthorization. The only automatic call used
 * to live in the staff portal, and it returned unless a staff row had loaded.
 * An owner, admin, or manager who stays on the dashboard never called it, so
 * the row was missing and no push could be delivered.
 *
 * Client-portal accounts are skipped: no org role and no active staff row.
 */
export function NativePushRegistrar() {
  const { user, loading: authLoading } = useAuth();
  const { organization, loading: orgLoading, resolution, allOrganizations } = useOrganization();
  const { registerDevice } = usePushNotifications();
  const [hasStaffRow, setHasStaffRow] = useState(false);
  // The post-login effect saves on the first eligible render. Later company
  // changes re-save without asking iOS again.
  const sawInitialSync = useRef(false);

  const userId = user?.id ?? null;
  const organizationId = organization?.id ?? null;
  const roleEligible = allOrganizations.some((entry) => PUSH_ROLES.has(entry.role));

  useEffect(() => {
    if (!isIosAppShell() || !userId || resolution !== 'empty') {
      setHasStaffRow(false);
      return;
    }

    let cancelled = false;
    setHasStaffRow(false);
    void (async () => {
      const { data, error } = await supabase
        .from('staff')
        .select('id')
        .eq('user_id', userId)
        .eq('is_active', true)
        .limit(1);
      if (cancelled) return;
      if (error) {
        console.error('[PUSH] Could not check whether this account is staff', error);
        return;
      }
      setHasStaffRow((data?.length ?? 0) > 0);
    })();

    return () => {
      cancelled = true;
    };
  }, [userId, resolution]);

  useEffect(() => {
    // User agent "TidyWise-iOS" is set on the web view even when the Capacitor
    // bridge was not injected. Skipping that case used to do nothing at all;
    // registerDevice then records a visible error instead of calling the
    // website Notification API.
    if (!isIosAppShell()) return;
    if (authLoading || orgLoading || !userId) return;
    if (resolution === 'loading') return;
    if (resolution === 'error') {
      console.error('[PUSH] Organization lookup failed; notification permission was not requested');
      return;
    }

    const eligible = roleEligible || hasStaffRow;
    if (!eligible || registrationStartedFor.has(userId)) return;

    const timeoutId = window.setTimeout(() => {
      registrationStartedFor.add(userId);
      console.log('[PUSH] Requesting notification permission after login');
      void registerDevice({ quiet: true, organizationId });
    }, PROMPT_DELAY_MS);

    return () => window.clearTimeout(timeoutId);
  }, [
    authLoading,
    orgLoading,
    userId,
    resolution,
    roleEligible,
    hasStaffRow,
    organizationId,
    registerDevice,
  ]);

  // Re-save the token when the company changes. Operator pushes look the
  // token up by user, so either company can reach this phone; the row's
  // organization_id still tracks the company the app is showing.
  useEffect(() => {
    if (!isIosAppShell()) return;
    if (authLoading || orgLoading || !userId) return;
    if (resolution === 'loading' || resolution === 'error') return;
    if (!(roleEligible || hasStaffRow)) return;
    if (!sawInitialSync.current) {
      sawInitialSync.current = true;
      return;
    }
    void registerDevice({ quiet: true, background: true, organizationId });
  }, [
    authLoading,
    orgLoading,
    userId,
    resolution,
    roleEligible,
    hasStaffRow,
    organizationId,
    registerDevice,
  ]);

  // APNs can rotate the token while the app is suspended. Resume re-registers
  // without asking again and without a toast when permission is already granted.
  useEffect(() => {
    if (!isIosAppShell() || !userId) return;
    let removed = false;
    let handle: { remove: () => Promise<void> } | undefined;

    void import('@capacitor/app')
      .then(({ App }) => App.addListener('appStateChange', ({ isActive }) => {
        if (!isActive || removed) return;
        if (authLoading || orgLoading || resolution === 'loading' || resolution === 'error') return;
        if (!(roleEligible || hasStaffRow)) return;
        void registerDevice({ quiet: true, background: true, organizationId });
      }))
      .then((listener) => {
        if (removed) void listener.remove();
        else handle = listener;
      })
      .catch((err) => {
        console.error('[PUSH] Could not watch app resume for push registration', err);
      });

    return () => {
      removed = true;
      void handle?.remove();
    };
  }, [
    authLoading,
    orgLoading,
    userId,
    resolution,
    roleEligible,
    hasStaffRow,
    organizationId,
    registerDevice,
  ]);

  return null;
}
