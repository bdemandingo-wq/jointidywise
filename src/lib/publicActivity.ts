/**
 * Display gate for the public activity feed and growth counters.
 * The database function already returns only sanitized fields. This runs
 * again in the browser so a bad or extra field cannot render a name,
 * address, or made-up event.
 */

export type PublicActivityKind = 'booked' | 'joined' | 'completed';

export interface PublicActivityEvent {
  kind: PublicActivityKind;
  city: string;
  region: string | null;
  amount: number | null;
  service: string | null;
  at: string;
}

export interface PublicGrowthCounters {
  lifetimeTotal: number;
  lifetimeSold: number;
  lifetimeRemaining: number;
  lifetimeSoldOut: boolean;
  weeklySignups: number | null;
  /** Real organizations, test/demo excluded. Null when the payload has no count. */
  organizationCount: number | null;
  /** Hide the weekly line below this. From the database, otherwise the default. */
  weeklySignupMin: number;
}

/** Weekly signup line stays off until the count reaches this. Change it in growth_public_settings. */
export const DEFAULT_WEEKLY_SIGNUP_MIN = 15;

const SERVICES = new Set([
  'clean',
  'deep clean',
  'move-out clean',
  'turnover clean',
  'commercial clean',
  'carpet clean',
  'window clean',
]);

const BLOCKED_CITIES = new Set(['n/a', 'na', 'null', 'none', 'test', 'city', 'tba', 'unknown', 'xxx', 'qa', 'demo']);

const CITY_RE = /^[A-Za-z][A-Za-z .'-]{1,39}$/;
const STREET_RE = /\b(street|avenue|road|drive|lane|boulevard|highway|parkway)\b/i;

export function roundPublicAmount(amount: number | null | undefined): number | null {
  if (amount == null || !Number.isFinite(amount) || amount < 20 || amount > 5000) return null;
  const rounded = Math.round(amount / 10) * 10;
  if (rounded < 20) return null;
  return rounded;
}

export function publicCity(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const city = raw.trim();
  if (!CITY_RE.test(city) || STREET_RE.test(city) || /\d|@/.test(city)) return null;
  if (BLOCKED_CITIES.has(city.toLowerCase())) return null;
  return city;
}

export function publicRegion(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const region = raw.trim().toUpperCase();
  return /^[A-Z]{2}$/.test(region) ? region : null;
}

export function publicService(raw: string | null | undefined): string {
  const service = (raw ?? '').trim().toLowerCase();
  return SERVICES.has(service) ? service : 'clean';
}

export function formatPublicPlace(city: string, region: string | null): string {
  return region ? `${city}, ${region}` : city;
}

/** Null means the event is not safe to show. Never invent a replacement. */
export function activitySentence(event: PublicActivityEvent): string | null {
  const city = publicCity(event.city);
  if (!city) return null;
  const place = formatPublicPlace(city, publicRegion(event.region));
  if (event.kind === 'joined') {
    return `A new cleaning business joined from ${place}`;
  }
  if (event.kind === 'completed') {
    return `A cleaner completed a job in ${place}`;
  }
  if (event.kind === 'booked') {
    const amount = roundPublicAmount(event.amount);
    const service = publicService(event.service);
    const price = amount != null ? `$${amount} ` : '';
    return `A cleaning company in ${place} just booked a ${price}${service}`;
  }
  return null;
}

export function shouldShowWeeklySignups(
  count: number | null | undefined,
  minimum: number = DEFAULT_WEEKLY_SIGNUP_MIN,
): boolean {
  const floor = Number.isFinite(minimum) && minimum >= 1 ? minimum : DEFAULT_WEEKLY_SIGNUP_MIN;
  return typeof count === 'number' && Number.isFinite(count) && count >= floor;
}

export function weeklySignupLabel(count: number): string {
  const noun = count === 1 ? 'cleaning business' : 'cleaning businesses';
  return `${count} ${noun} joined this week`;
}

export function lifetimeSpotsLabel(remaining: number, total: number): string {
  return `${remaining} of ${total} Lifetime spots left`;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

export function parseActivityFeed(payload: unknown): PublicActivityEvent[] {
  const root = asRecord(payload);
  const rows = Array.isArray(payload)
    ? payload
    : Array.isArray(root?.events)
      ? root.events
      : [];
  const events: PublicActivityEvent[] = [];
  for (const row of rows) {
    const record = asRecord(row);
    if (!record) continue;
    const kind = record.kind;
    if (kind !== 'booked' && kind !== 'joined' && kind !== 'completed') continue;
    const city = publicCity(typeof record.city === 'string' ? record.city : null);
    if (!city) continue;
    const at = typeof record.at === 'string' ? record.at : '';
    if (!at || !Number.isFinite(Date.parse(at))) continue;
    events.push({
      kind,
      city,
      region: publicRegion(typeof record.region === 'string' ? record.region : null),
      amount: roundPublicAmount(typeof record.amount === 'number' ? record.amount : null),
      service: kind === 'booked' ? publicService(typeof record.service === 'string' ? record.service : null) : null,
      at,
    });
  }
  return events;
}

export function parseGrowthCounters(payload: unknown): PublicGrowthCounters | null {
  const root = asRecord(payload);
  if (!root || root.limited === true) return null;
  const total = root.lifetime_total;
  const sold = root.lifetime_sold;
  if (typeof total !== 'number' || typeof sold !== 'number' || total < 1 || sold < 0) return null;
  const remaining = Math.max(0, total - sold);
  const weekly = root.weekly_signups;
  const organizations = root.organization_count;
  const weeklyMin = root.weekly_signup_min;
  return {
    lifetimeTotal: total,
    lifetimeSold: sold,
    lifetimeRemaining: remaining,
    lifetimeSoldOut: sold >= total,
    weeklySignups: typeof weekly === 'number' && weekly >= 0 ? weekly : null,
    organizationCount: typeof organizations === 'number' && Number.isInteger(organizations) && organizations >= 0
      ? organizations
      : null,
    weeklySignupMin: typeof weeklyMin === 'number' && Number.isInteger(weeklyMin) && weeklyMin >= 1
      ? weeklyMin
      : DEFAULT_WEEKLY_SIGNUP_MIN,
  };
}
