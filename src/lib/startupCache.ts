/**
 * Synchronous snapshot of the signed-in startup reads.
 *
 * React Query's persister restores asynchronously, after the first paint.
 * AdminRoute decides whether to show the dashboard on that first paint, so
 * org, subscription, and profile are also written here and read with
 * localStorage — the same store the persister uses — before any request.
 */

const KEY = 'tw-startup-v1';

interface Snapshot {
  v: 1;
  userId: string;
  org?: unknown;
  orgAt?: number;
  subscription?: unknown;
  subscriptionAt?: number;
  profile?: unknown;
  profileAt?: number;
}

export type StartupSection = 'org' | 'subscription' | 'profile';

function readSnapshot(): Snapshot | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Snapshot;
    if (!parsed || parsed.v !== 1 || typeof parsed.userId !== 'string') return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeSnapshot(next: Snapshot) {
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Quota or private mode. The React Query persister is the other copy.
  }
}

export function clearStartupCache() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

export function readStartupSection<T>(userId: string, section: StartupSection): { value: T; at: number } | null {
  const snap = readSnapshot();
  if (!snap || snap.userId !== userId) return null;
  const at = snap[`${section}At`];
  if (typeof at !== 'number') return null;
  return { value: snap[section] as T, at };
}

export function writeStartupSection(userId: string, section: StartupSection, value: unknown) {
  const current = readSnapshot();
  const base: Snapshot = current?.userId === userId ? current : { v: 1, userId };
  writeSnapshot({
    ...base,
    v: 1,
    userId,
    [section]: value,
    [`${section}At`]: Date.now(),
  });
}

export const startupOrgKey = (userId: string) => ['startup-org', userId] as const;
export const startupSubscriptionKey = (userId: string) => ['startup-subscription', userId] as const;
export const startupProfileKey = (userId: string) => ['startup-profile', userId] as const;

export const STARTUP_ORG_STALE_MS = 5 * 60 * 1000;
export const STARTUP_PROFILE_STALE_MS = 5 * 60 * 1000;
export const STARTUP_SUBSCRIPTION_STALE_MS = 5 * 60 * 1000;
