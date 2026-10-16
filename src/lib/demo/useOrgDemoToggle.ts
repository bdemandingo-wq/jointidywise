import { useEffect, useRef } from 'react';
import { useSyncExternalStore } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import { useOrganization } from '@/contexts/OrganizationContext';
import { useOrganizationSettings } from '@/hooks/useOrganizationSettings';
import { purgeDemoQueries } from '@/lib/demo/cache';
import {
  isPublicDemoActive,
  isSampleDemoEnabled,
  setDemoStorageScope,
  setSampleDemoEnabled,
  subscribeDemoMode,
} from '@/lib/demo/session';

/**
 * Demo mode is the org flag the edge functions read
 * (organization_pricing_settings.demo_mode_enabled) plus the in-browser
 * sample company. The flag is saved before sample reads start, and cleared
 * after they stop, so the write is not swallowed by the demo gate.
 */
export function useOrgDemoToggle() {
  const { user } = useAuth();
  const { organization } = useOrganization();
  const { settings, saveSettings } = useOrganizationSettings();
  const queryClient = useQueryClient();
  const publicDemo = useSyncExternalStore(subscribeDemoMode, isPublicDemoActive, () => false);
  const sampleOn = useSyncExternalStore(subscribeDemoMode, isSampleDemoEnabled, () => false);
  const skipServerSync = useRef(false);
  const userId = user?.id ?? null;
  const orgId = organization?.id ?? null;
  const serverOn = settings?.demo_mode_enabled === true;

  useEffect(() => {
    setDemoStorageScope({ userId, orgId });
    if (skipServerSync.current || publicDemo || !settings || !userId || !orgId) return;
    if (isSampleDemoEnabled() !== serverOn) setSampleDemoEnabled(serverOn);
  }, [publicDemo, settings, serverOn, userId, orgId]);

  const toggle = async () => {
    if (publicDemo) return;
    skipServerSync.current = true;
    try {
      const next = !isSampleDemoEnabled();
      if (next) {
        const ok = await saveSettings({ demo_mode_enabled: true });
        if (!ok) {
          toast.error('Could not turn on demo mode');
          return;
        }
        setSampleDemoEnabled(true);
      } else {
        setSampleDemoEnabled(false);
        const ok = await saveSettings({ demo_mode_enabled: false });
        if (!ok) {
          setSampleDemoEnabled(true);
          toast.error('Could not turn off demo mode');
          return;
        }
      }
      purgeDemoQueries(queryClient);
      toast(next ? 'Demo mode on — showing sample data' : 'Demo mode off — your data is back');
    } finally {
      skipServerSync.current = false;
    }
  };

  return { on: publicDemo || sampleOn, publicDemo, toggle };
}
