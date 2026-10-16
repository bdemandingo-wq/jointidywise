/**
 * An empty membership read right after sign-in is not proof the account
 * has no business. RLS returns zero rows when the request runs before the
 * session token is attached. That used to be cached and treated as
 * "send this owner to onboarding".
 */

export const EMPTY_ORG_RETRY_MS = 500;

export class OrgSessionNotAttachedError extends Error {
  constructor() {
    super('Organization lookup ran before the sign-in session was attached');
    this.name = 'OrgSessionNotAttachedError';
  }
}

export function assertSessionMatchesUser(
  sessionUserId: string | null | undefined,
  userId: string,
): void {
  if (!sessionUserId || sessionUserId !== userId) {
    throw new OrgSessionNotAttachedError();
  }
}

export interface MembershipOrgRow {
  organization_id: string;
  role: string;
}

/**
 * Memberships with no visible org rows is a failed read, not an empty
 * account. Filtering those rows out used to return [] and open onboarding.
 */
export function joinMembershipsToOrgs<T extends { id: string }>(
  memberships: MembershipOrgRow[],
  orgs: T[],
): { organization: T; role: string }[] {
  if (memberships.length === 0) return [];
  const joined: { organization: T; role: string }[] = [];
  for (const membership of memberships) {
    const org = orgs.find((row) => row.id === membership.organization_id);
    if (!org) continue;
    joined.push({ organization: org, role: membership.role });
  }
  if (joined.length === 0) {
    throw new Error('Memberships exist but no organizations were returned');
  }
  return joined;
}

export function shouldCacheOrgBundle(resolution: 'ready' | 'empty' | 'error'): boolean {
  return resolution === 'ready';
}

export interface EmptyOrgRead<T> {
  userId: string;
  load: () => Promise<T[]>;
  readSessionUserId: () => Promise<string | null | undefined>;
  sleep?: (ms: number) => Promise<void>;
  retryMs?: number;
}

/**
 * One reload about 500ms later before an empty read is trusted. A session
 * that is not this user throws, so React Query retries and the route guards
 * show Retry instead of the setup wizard.
 */
export async function resolveEmptyOrgRead<T>(input: EmptyOrgRead<T>): Promise<T[]> {
  const sleep = input.sleep ?? ((ms: number) => new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  }));
  const retryMs = input.retryMs ?? EMPTY_ORG_RETRY_MS;

  let rows = await input.load();
  if (rows.length > 0) return rows;

  assertSessionMatchesUser(await input.readSessionUserId(), input.userId);
  await sleep(retryMs);
  rows = await input.load();
  if (rows.length === 0) {
    assertSessionMatchesUser(await input.readSessionUserId(), input.userId);
  }
  return rows;
}
