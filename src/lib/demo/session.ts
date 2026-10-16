/**
 * Sample-demo session.
 *
 * Two switches, on purpose:
 * - Sample demo (this file) swaps business reads for an in-memory cleaning
 *   company and blocks writes. It lives in localStorage for a signed-in
 *   admin, or in sessionStorage for the public /try-demo preview.
 * - The org flag organization_pricing_settings.demo_mode_enabled is what
 *   edge functions read. Turning sample demo on saves that flag first.
 * - Masking (TestModeContext) only hides names and amounts on this device.
 *
 * The public preview must not stick. Leaving /dashboard clears it so signup
 * and login keep writing to the real account.
 */

import type { Organization, OrgRole } from '@/lib/fetchOrgBundle';

export const DEMO_ORG_ID = 'd00000de-0000-4000-8000-000000000001';
export const DEMO_OWNER_ID = 'd00000de-0000-4000-8000-000000000002';

const SAMPLE_KEY_PREFIX = 'tw-sample-demo:';
const LEGACY_SAMPLE_KEY = 'tw-sample-demo';
const PUBLIC_KEY = 'tw-public-demo';

/** Signed-in user and the org they are acting in. The flag is not per device. */
let storageScope: { userId: string; orgId: string } | null = null;

export function setDemoStorageScope(next: { userId: string | null; orgId: string | null }) {
  storageScope = next.userId && next.orgId ? { userId: next.userId, orgId: next.orgId } : null;
  emit();
}

function sampleStorageKey(): string | null {
  if (!storageScope) return null;
  return `${SAMPLE_KEY_PREFIX}${storageScope.userId}:${storageScope.orgId}`;
}

/** Drop this device's demo switches. Masking (tw-mask-names) is left alone. */
export function clearSampleDemoStorage() {
  storageScope = null;
  try {
    const keys = Object.keys(localStorage).filter((key) => key === LEGACY_SAMPLE_KEY || key.startsWith(SAMPLE_KEY_PREFIX));
    keys.forEach((key) => localStorage.removeItem(key));
    sessionStorage.removeItem(PUBLIC_KEY);
  } catch {
    /* private mode */
  }
  emit();
}

export const demoOrganization: Organization = {
  id: DEMO_ORG_ID,
  name: 'Harbor & Pine Cleaning',
  slug: 'harbor-pine-cleaning',
  logo_url: null,
  owner_id: DEMO_OWNER_ID,
  needs_onboarding: false,
};

const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((listener) => listener());
}

export function subscribeDemoMode(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function isSampleDemoEnabled(): boolean {
  const key = sampleStorageKey();
  if (!key) return false;
  try {
    return localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

export function setSampleDemoEnabled(on: boolean) {
  const key = sampleStorageKey();
  if (!key) return;
  try {
    if (on) localStorage.setItem(key, '1');
    else localStorage.removeItem(key);
    localStorage.removeItem(LEGACY_SAMPLE_KEY);
  } catch {
    /* private mode */
  }
  emit();
}

export function toggleSampleDemo(): boolean {
  const next = !isSampleDemoEnabled();
  setSampleDemoEnabled(next);
  return next;
}

export function isPublicDemoActive(): boolean {
  try {
    return sessionStorage.getItem(PUBLIC_KEY) === '1';
  } catch {
    return false;
  }
}

export function startPublicDemo() {
  try {
    sessionStorage.setItem(PUBLIC_KEY, '1');
  } catch {
    /* private mode */
  }
  emit();
}

export function endPublicDemo() {
  try {
    sessionStorage.removeItem(PUBLIC_KEY);
  } catch {
    /* private mode */
  }
  emit();
}

/** Web uses the pathname. The iOS app uses HashRouter, so the route is in the hash. */
export function demoRoutePath(): string {
  if (typeof window === 'undefined') return '';
  const hash = window.location.hash;
  if (hash.startsWith('#/')) return hash.slice(1).split('?')[0];
  return window.location.pathname;
}

function samplePathActive(): boolean {
  const path = demoRoutePath();
  return path.startsWith('/dashboard') || path.startsWith('/admin') || path.startsWith('/staff');
}

/** True when business reads must come from the fixture set and writes must stop. */
export function isSampleDemoOn(): boolean {
  if (isPublicDemoActive()) return true;
  return isSampleDemoEnabled() && samplePathActive();
}

export const publicDemoMembership = {
  organization_id: DEMO_ORG_ID,
  role: 'owner' as OrgRole,
};
