/**
 * Admin mobile bottom nav.
 *
 * The four side slots are the org's saved row in
 * organization_mobile_nav_settings (role admin). The built-in default is
 * Dashboard, Calendar, Bookings, Reports — but only after we know the org
 * has no saved row. Painting that default first, then swapping the 4th tab
 * to Payroll when the row arrives, is the launch flicker.
 *
 * The last saved row is read from localStorage before any request, the same
 * way the startup snapshot is. Web and iOS share this component.
 */

export interface MobileNavSlot {
  id: string;
  label: string;
  to: string;
  iconKey: string;
}

const CACHE_PREFIX = 'tw-admin-mobile-nav:';
export const ACTIVE_ORG_STORAGE_KEY = 'tidywise_active_org';

export function sanitizeMobileNavSlots(items: unknown): MobileNavSlot[] | null {
  if (!Array.isArray(items) || items.length !== 4) return null;
  const slots: MobileNavSlot[] = [];
  for (const raw of items) {
    if (!raw || typeof raw !== 'object') return null;
    const record = raw as Record<string, unknown>;
    const label = typeof record.label === 'string' ? record.label.trim() : '';
    const to = typeof record.to === 'string' ? record.to.trim() : '';
    const iconKey = typeof record.iconKey === 'string' && record.iconKey ? record.iconKey : 'Home';
    const id = typeof record.id === 'string' && record.id ? record.id : `${label}_${to}`;
    if (!label || !to.startsWith('/dashboard')) return null;
    slots.push({ id, label, to, iconKey });
  }
  return slots;
}

export function sameMobileNav(a: MobileNavSlot[] | null, b: MobileNavSlot[] | null): boolean {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  return a.every((slot, index) => {
    const other = b[index];
    return slot.id === other.id && slot.label === other.label && slot.to === other.to && slot.iconKey === other.iconKey;
  });
}

function cacheKey(orgId: string) {
  return `${CACHE_PREFIX}${orgId}`;
}

export function readCachedMobileNav(orgId: string | null | undefined): MobileNavSlot[] | null {
  if (!orgId || typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(cacheKey(orgId));
    if (!raw) return null;
    return sanitizeMobileNavSlots(JSON.parse(raw));
  } catch {
    return null;
  }
}

/** Slots for the org this device last used, available before the org query resolves. */
export function readLaunchMobileNav(): MobileNavSlot[] | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    return readCachedMobileNav(localStorage.getItem(ACTIVE_ORG_STORAGE_KEY));
  } catch {
    return null;
  }
}

export function writeCachedMobileNav(orgId: string, items: unknown) {
  const slots = sanitizeMobileNavSlots(items);
  if (!slots || typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(cacheKey(orgId), JSON.stringify(slots));
  } catch {
    /* quota or private mode */
  }
}
