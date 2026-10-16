import { supabase } from '@/lib/supabase';
import { writeStartupSection } from '@/lib/startupCache';
import { ORG_BUNDLE_SELECT, ORG_MEMBERSHIP_SELECT } from '@/lib/orgBundleFields';

export interface Organization {
  id: string;
  name: string;
  slug: string | null;
  logo_url: string | null;
  owner_id: string;
  /** Set by provision-trial-org, cleared by onboarding submit. */
  needs_onboarding?: boolean;
  created_at?: string | null;
  plan_type?: string | null;
  /** Original launch accounts. Not the same as a purchased lifetime plan. */
  grandfathered_lifetime?: boolean | null;
}

export type OrgRole = 'owner' | 'admin' | 'manager' | 'member';

export interface OrganizationMembership {
  organization_id: string;
  role: OrgRole;
}

export interface OrgWithRole {
  organization: Organization;
  role: OrgRole;
}

export interface OrgBundle {
  organization: Organization | null;
  membership: OrganizationMembership | null;
  allOrganizations: OrgWithRole[];
  resolution: 'ready' | 'empty' | 'error';
}

const ACTIVE_ORG_KEY = 'tidywise_active_org';
const ORG_CHOSEN_KEY = 'tidywise_org_chosen';

interface MembershipEmbed {
  organization_id: string;
  role: string;
  organizations: Organization | Organization[] | null;
}

function oneOrg(value: Organization | Organization[] | null): Organization | null {
  if (!value) return null;
  return Array.isArray(value) ? value[0] ?? null : value;
}

function rolePriority(role: OrgRole) {
  return role === 'owner' ? 0 : role === 'admin' ? 1 : role === 'manager' ? 2 : 3;
}

function selectActive(allOrgs: OrgWithRole[]): OrgWithRole | undefined {
  const sortedByRole = [...allOrgs].sort((a, b) => rolePriority(a.role) - rolePriority(b.role));
  const savedOrgId = localStorage.getItem(ACTIVE_ORG_KEY);
  const savedOrg = allOrgs.find((o) => o.organization.id === savedOrgId);
  const wasChosen = localStorage.getItem(ORG_CHOSEN_KEY) === 'true';
  const isAdminOrg = (entry: OrgWithRole) =>
    entry.role === 'owner' || entry.role === 'admin' || entry.role === 'manager';
  const bestAdminOrg =
    sortedByRole.find((o) => isAdminOrg(o) && !o.organization.needs_onboarding) ??
    sortedByRole.find(isAdminOrg);

  if (wasChosen && savedOrg) return savedOrg;
  if (wasChosen && !savedOrg) {
    localStorage.removeItem(ORG_CHOSEN_KEY);
    return bestAdminOrg ?? sortedByRole[0];
  }
  if (
    savedOrg &&
    !savedOrg.organization.needs_onboarding &&
    (savedOrg.role !== 'member' || !bestAdminOrg)
  ) {
    return savedOrg;
  }
  return bestAdminOrg ?? sortedByRole[0];
}

function bundleFrom(allOrgs: OrgWithRole[]): OrgBundle {
  if (allOrgs.length === 0) {
    return { organization: null, membership: null, allOrganizations: [], resolution: 'empty' };
  }
  const active = selectActive(allOrgs);
  if (!active) {
    return { organization: null, membership: null, allOrganizations: allOrgs, resolution: 'error' };
  }
  localStorage.setItem(ACTIVE_ORG_KEY, active.organization.id);
  return {
    organization: active.organization,
    membership: { organization_id: active.organization.id, role: active.role },
    allOrganizations: allOrgs,
    resolution: 'ready',
  };
}

async function loadViaEmbed(userId: string): Promise<OrgWithRole[] | null> {
  const { data, error } = await supabase
    .from('org_memberships')
    .select(ORG_MEMBERSHIP_SELECT)
    .eq('user_id', userId);
  if (error || !data) return null;
  const rows = data as unknown as MembershipEmbed[];
  const all: OrgWithRole[] = [];
  for (const row of rows) {
    const org = oneOrg(row.organizations);
    if (!org) return null;
    all.push({ organization: org, role: row.role as OrgRole });
  }
  return all;
}

async function loadViaTwoSteps(userId: string): Promise<OrgWithRole[]> {
  const savedOrgId = localStorage.getItem(ACTIVE_ORG_KEY);
  const [membershipsResult, savedOrgResult] = await Promise.all([
    supabase.from('org_memberships').select('organization_id, role').eq('user_id', userId),
    savedOrgId
      ? supabase.from('organizations').select(ORG_BUNDLE_SELECT).eq('id', savedOrgId).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);
  if (membershipsResult.error) throw membershipsResult.error;
  const memberships = membershipsResult.data ?? [];
  if (memberships.length === 0) return [];

  const saved = savedOrgResult.data as Organization | null;
  const savedMatches = !!saved && memberships.some((m) => m.organization_id === saved.id);
  if (memberships.length === 1 && savedMatches && saved) {
    const role = memberships[0].role as OrgRole;
    return [{ organization: saved, role }];
  }

  const orgIds = memberships.map((m) => m.organization_id);
  const { data: orgs, error: orgError } = await supabase.from('organizations').select(ORG_BUNDLE_SELECT).in('id', orgIds);
  if (orgError || !orgs) throw orgError ?? new Error('Could not load organizations');
  const all: OrgWithRole[] = [];
  for (const m of memberships) {
    const org = (orgs as Organization[]).find((o) => o.id === m.organization_id);
    if (!org) continue;
    all.push({ organization: org, role: m.role as OrgRole });
  }
  return all;
}

/** Membership and organization in one round trip. Falls back to the two-step read. */
export async function fetchOrgBundle(userId: string): Promise<OrgBundle> {
  const embedded = await loadViaEmbed(userId);
  const allOrgs = embedded ?? await loadViaTwoSteps(userId);
  const bundle = bundleFrom(allOrgs);
  if (bundle.resolution !== 'error') writeStartupSection(userId, 'org', bundle);
  return bundle;
}
