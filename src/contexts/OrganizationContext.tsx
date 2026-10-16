import { createContext, useContext, useState, useCallback, useRef, ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/lib/supabase';
import { clearSidebarHiddenItemsCache } from '@/hooks/useSidebarHiddenItems';
import {
  fetchOrgBundle,
  type Organization,
  type OrganizationMembership,
  type OrgBundle,
  type OrgRole,
  type OrgWithRole,
} from '@/lib/fetchOrgBundle';
import {
  readStartupSection,
  STARTUP_ORG_STALE_MS,
  startupOrgKey,
  startupOrgSnapshotIsUsable,
  writeStartupSection,
} from '@/lib/startupCache';

export type { Organization, OrganizationMembership, OrgRole, OrgWithRole };

export type OrganizationResolution = 'loading' | 'ready' | 'empty' | 'error';

interface OrganizationContextType {
  organization: Organization | null;
  membership: OrganizationMembership | null;
  loading: boolean;
  /** Distinguishes a confirmed new account from a failed/in-flight lookup. */
  resolution: OrganizationResolution;
  /** True for ~500ms after switchOrganization while queries refetch */
  switching: boolean;
  isOwner: boolean;
  isAdmin: boolean;
  /** All organizations the current user belongs to */
  allOrganizations: OrgWithRole[];
  /** Switch the active organization */
  switchOrganization: (orgId: string) => void;
  /** Set the active organization directly from a confirmed DB write.
   *  Used by onboarding submit to avoid the context-race — the org
   *  returned from the UPDATE is set synchronously so AdminRoute sees
   *  the correct value on the first render after navigation. */
  setOrganizationDirect: (org: Organization, role: OrgRole) => void;
  refetch: () => Promise<void>;
}

const ACTIVE_ORG_KEY = 'tidywise_active_org';
/** Set by switchOrganization to distinguish a deliberate choice from a default. */
const ORG_CHOSEN_KEY = 'tidywise_org_chosen';

const OrganizationContext = createContext<OrganizationContextType | undefined>(undefined);

export function OrganizationProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const { user, loading: authLoading } = useAuth();
  const userId = user?.id ?? null;
  const cached = userId ? readStartupSection<OrgBundle>(userId, 'org') : null;
  // An empty snapshot is how a sign-in race survived a refresh and opened
  // onboarding. Only a confirmed workspace may paint before the refetch.
  const usableCache = cached && startupOrgSnapshotIsUsable(cached.value) ? cached : null;

  const query = useQuery({
    queryKey: userId ? startupOrgKey(userId) : ['startup-org', 'signed-out'],
    queryFn: () => fetchOrgBundle(userId as string),
    enabled: !!userId && !authLoading,
    staleTime: STARTUP_ORG_STALE_MS,
    gcTime: 1000 * 60 * 60 * 24,
    ...(usableCache ? { initialData: usableCache.value, initialDataUpdatedAt: usableCache.at } : {}),
  });

  const bundle = userId ? (query.data ?? usableCache?.value ?? null) : null;
  const loading = authLoading || (!!userId && !bundle && !query.isError);
  const resolution: OrganizationResolution = !userId
    ? (authLoading ? 'loading' : 'empty')
    : bundle
      ? bundle.resolution
      : query.isError
        ? 'error'
        : 'loading';

  const [switching, setSwitching] = useState(false);
  const switchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const switchOrganization = useCallback((orgId: string) => {
    if (!userId || !bundle) return;
    const target = bundle.allOrganizations.find((o) => o.organization.id === orgId);
    if (!target) return;
    setSwitching(true);
    localStorage.setItem(ACTIVE_ORG_KEY, orgId);
    localStorage.setItem(ORG_CHOSEN_KEY, 'true');
    const next: OrgBundle = {
      ...bundle,
      organization: target.organization,
      membership: { organization_id: orgId, role: target.role },
      resolution: 'ready',
    };
    queryClient.setQueryData(startupOrgKey(userId), next);
    writeStartupSection(userId, 'org', next);
    clearSidebarHiddenItemsCache();
    // Keep the startup snapshot. resetQueries would drop it and flash the
    // skeleton; list queries are the ones that must not leak across orgs.
    queryClient.resetQueries({
      predicate: (q) => q.queryKey[0] !== 'startup-org'
        && q.queryKey[0] !== 'startup-subscription'
        && q.queryKey[0] !== 'startup-profile',
    });
    try { localStorage.removeItem('tw-offline-cache'); } catch { /* ignore */ }
    if (switchTimerRef.current) clearTimeout(switchTimerRef.current);
    switchTimerRef.current = setTimeout(() => setSwitching(false), 600);
  }, [bundle, queryClient, userId]);

  const setOrganizationDirect = useCallback((org: Organization, role: OrgRole) => {
    const uid = userId ?? org.owner_id;
    const prev = queryClient.getQueryData<OrgBundle>(startupOrgKey(uid));
    const others = (prev?.allOrganizations ?? bundle?.allOrganizations ?? []).filter(
      (entry) => entry.organization.id !== org.id,
    );
    const next: OrgBundle = {
      organization: org,
      membership: { organization_id: org.id, role },
      allOrganizations: [{ organization: org, role }, ...others],
      resolution: 'ready',
    };
    queryClient.setQueryData(startupOrgKey(uid), next);
    writeStartupSection(uid, 'org', next);
    localStorage.setItem(ACTIVE_ORG_KEY, org.id);
  }, [bundle, queryClient, userId]);

  const refetch = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    const sessionUser = session?.user;
    if (!sessionUser) return;
    await queryClient.fetchQuery({
      queryKey: startupOrgKey(sessionUser.id),
      queryFn: () => fetchOrgBundle(sessionUser.id),
      staleTime: 0,
    });
  }, [queryClient]);

  const organization = bundle?.organization ?? null;
  const membership = bundle?.membership ?? null;
  const allOrganizations = bundle?.allOrganizations ?? [];
  const isOwner = membership?.role === 'owner';
  const isAdmin =
    membership?.role === 'owner' ||
    membership?.role === 'admin' ||
    membership?.role === 'manager';

  return (
    <OrganizationContext.Provider
      value={{
        organization,
        membership,
        loading,
        resolution,
        switching,
        isOwner,
        isAdmin,
        allOrganizations,
        switchOrganization,
        setOrganizationDirect,
        refetch,
      }}
    >
      {children}
    </OrganizationContext.Provider>
  );
}

export function useOrganization() {
  const context = useContext(OrganizationContext);
  if (context === undefined) {
    throw new Error('useOrganization must be used within an OrganizationProvider');
  }
  return context;
}
