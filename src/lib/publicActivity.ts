/**
 * Display gate for the public activity feed and growth counters.
 * The database function already returns only sanitized fields. This runs
 * again in the browser so a bad or extra field cannot render a name,
 * a city, an address, or a made-up event.
 */

export type PublicActivityKind =
  | 'booked'
  | 'joined'
  | 'completed'
  | 'paid'
  | 'reviewed'
  | 'cleaner';

export interface PublicActivityEvent {
  kind: PublicActivityKind;
  /** Two-letter state or province code. Never a city. */
  region: string;
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

/** Landing ticker dwell time. */
export const ACTIVITY_TICKER_INTERVAL_MS = 8_000;

/** Hide the ticker when every event is older than this. */
export const ACTIVITY_TICKER_WINDOW_MS = 24 * 60 * 60 * 1000;

/** A timestamp a couple of minutes ahead is clock skew, not a future event. */
const TICKER_FUTURE_SKEW_MS = 2 * 60 * 1000;

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

/**
 * Codes the feed is allowed to name. Full names are the sentence form.
 * DC stays "DC" (state-level, same shape as "FL"). Keep this list in sync
 * with growth_public_region in the public-activity migration.
 */
const STATE_NAMES: Record<string, string> = {
  AL: 'Alabama',
  AK: 'Alaska',
  AZ: 'Arizona',
  AR: 'Arkansas',
  CA: 'California',
  CO: 'Colorado',
  CT: 'Connecticut',
  DE: 'Delaware',
  FL: 'Florida',
  GA: 'Georgia',
  HI: 'Hawaii',
  ID: 'Idaho',
  IL: 'Illinois',
  IN: 'Indiana',
  IA: 'Iowa',
  KS: 'Kansas',
  KY: 'Kentucky',
  LA: 'Louisiana',
  ME: 'Maine',
  MD: 'Maryland',
  MA: 'Massachusetts',
  MI: 'Michigan',
  MN: 'Minnesota',
  MS: 'Mississippi',
  MO: 'Missouri',
  MT: 'Montana',
  NE: 'Nebraska',
  NV: 'Nevada',
  NH: 'New Hampshire',
  NJ: 'New Jersey',
  NM: 'New Mexico',
  NY: 'New York',
  NC: 'North Carolina',
  ND: 'North Dakota',
  OH: 'Ohio',
  OK: 'Oklahoma',
  OR: 'Oregon',
  PA: 'Pennsylvania',
  RI: 'Rhode Island',
  SC: 'South Carolina',
  SD: 'South Dakota',
  TN: 'Tennessee',
  TX: 'Texas',
  UT: 'Utah',
  VT: 'Vermont',
  VA: 'Virginia',
  WA: 'Washington',
  WV: 'West Virginia',
  WI: 'Wisconsin',
  WY: 'Wyoming',
  DC: 'DC',
  PR: 'Puerto Rico',
  VI: 'U.S. Virgin Islands',
  GU: 'Guam',
  AS: 'American Samoa',
  MP: 'Northern Mariana Islands',
  AB: 'Alberta',
  BC: 'British Columbia',
  MB: 'Manitoba',
  NB: 'New Brunswick',
  NL: 'Newfoundland and Labrador',
  NS: 'Nova Scotia',
  NT: 'Northwest Territories',
  NU: 'Nunavut',
  ON: 'Ontario',
  PE: 'Prince Edward Island',
  QC: 'Quebec',
  SK: 'Saskatchewan',
  YT: 'Yukon',
};

const REGION_ALIASES: Record<string, string> = {
  'district of columbia': 'DC',
};

const KIND_LIST: readonly PublicActivityKind[] = [
  'booked',
  'joined',
  'completed',
  'paid',
  'reviewed',
  'cleaner',
];

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

/** Known state or province only. A city, street, or unknown code is null. */
export function publicRegion(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim().replace(/\s+/g, ' ');
  if (!trimmed || trimmed.length > 40) return null;
  if (/^[A-Za-z]{2}$/.test(trimmed)) {
    const code = trimmed.toUpperCase();
    return Object.prototype.hasOwnProperty.call(STATE_NAMES, code) ? code : null;
  }
  const key = trimmed.toLowerCase();
  const alias = REGION_ALIASES[key];
  if (alias) return alias;
  for (const [code, name] of Object.entries(STATE_NAMES)) {
    if (name.toLowerCase() === key) return code;
  }
  return null;
}

/** "Florida", or "DC" when the place has no fuller state name. */
export function publicStateName(raw: string | null | undefined): string | null {
  const code = publicRegion(raw);
  if (!code) return null;
  return STATE_NAMES[code] ?? null;
}

export function publicService(raw: string | null | undefined): string {
  const service = (raw ?? '').trim().toLowerCase();
  return SERVICES.has(service) ? service : 'clean';
}

function isKind(value: unknown): value is PublicActivityKind {
  return typeof value === 'string' && (KIND_LIST as readonly string[]).includes(value);
}

function templateIndex(event: PublicActivityEvent, count: number): number {
  const key = `${event.kind}|${event.at}|${event.region}|${event.amount ?? ''}|${event.service ?? ''}`;
  let hash = 2166136261;
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % count;
}

/** Null means the event is not safe to show. Never invent a replacement. */
export function activitySentence(event: PublicActivityEvent): string | null {
  const place = publicStateName(event.region);
  if (!place) return null;

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
  if (event.kind === 'paid') {
    const amount = roundPublicAmount(event.amount);
    if (amount == null) return null;
    const lines = [
      `A cleaning business in ${place} just got paid $${amount}`,
      `A cleaning company in ${place} received a $${amount} payment`,
      `A team in ${place} just collected $${amount}`,
    ];
    return lines[templateIndex(event, lines.length)] ?? null;
  }
  if (event.kind === 'reviewed') {
    const lines = [
      `A cleaning business in ${place} just received a 5-star review`,
      `A cleaner in ${place} earned a 5-star review`,
      `A 5-star review just came in for a business in ${place}`,
    ];
    return lines[templateIndex(event, lines.length)] ?? null;
  }
  if (event.kind === 'cleaner') {
    const lines = [
      `A cleaning business in ${place} just added a cleaner`,
      `A new cleaner joined a team in ${place}`,
      `A team in ${place} added a new cleaner`,
    ];
    return lines[templateIndex(event, lines.length)] ?? null;
  }
  return null;
}

export interface ActivitySpreadEvent {
  kind: string;
  at: string;
  /** Present only while ordering. Never copied onto the public event. */
  org?: string | null;
}

/**
 * Newest first. Never place the same kind twice in a row. When several
 * orgs are present, prefer one that was not just shown and has been shown
 * less often. Stop instead of repeating a kind. The result is a subset of
 * the input; nothing is synthesized.
 *
 * The SQL feed uses the same scores (1000 for the org just shown, 100 for
 * each earlier pick of that org). Keep them together.
 */
export function orderActivityEvents<T extends ActivitySpreadEvent>(events: readonly T[], limit = 12): T[] {
  const remaining = events.map((event, index) => ({ event, index }));
  remaining.sort((a, b) => {
    const aAt = Date.parse(a.event.at);
    const bAt = Date.parse(b.event.at);
    const delta = (Number.isFinite(bAt) ? bAt : 0) - (Number.isFinite(aAt) ? aAt : 0);
    if (delta !== 0) return delta;
    return a.index - b.index;
  });

  const result: T[] = [];
  const orgCounts = new Map<string, number>();
  let lastKind: string | null = null;
  let lastOrg: string | null = null;

  while (remaining.length > 0 && result.length < limit) {
    let best = -1;
    let bestScore = Number.POSITIVE_INFINITY;
    for (let i = 0; i < remaining.length; i++) {
      const event = remaining[i].event;
      if (event.kind === lastKind) continue;
      const org = event.org ?? '';
      let score = i;
      if (org !== '' && org === lastOrg) score += 1000;
      score += (orgCounts.get(org) ?? 0) * 100;
      if (score < bestScore) {
        bestScore = score;
        best = i;
      }
    }
    if (best === -1) break;
    const picked = remaining.splice(best, 1)[0].event;
    result.push(picked);
    lastKind = picked.kind;
    const org = picked.org ?? '';
    lastOrg = org === '' ? null : org;
    if (org !== '') orgCounts.set(org, (orgCounts.get(org) ?? 0) + 1);
  }
  return result;
}

/**
 * A feed that already alternates kinds is left in place so org spreading
 * done in SQL survives. A run of the same kind is reordered.
 */
export function enforceActivityOrder<T extends ActivitySpreadEvent>(events: readonly T[], limit = 12): T[] {
  for (let i = 1; i < events.length; i++) {
    if (events[i].kind === events[i - 1].kind) {
      return orderActivityEvents(events, limit);
    }
  }
  return events.slice(0, limit);
}

export function eventsForTicker(
  events: readonly PublicActivityEvent[],
  now = Date.now(),
): PublicActivityEvent[] {
  const fresh: PublicActivityEvent[] = [];
  for (const event of events) {
    const at = Date.parse(event.at);
    if (!Number.isFinite(at)) continue;
    const age = now - at;
    if (age >= -TICKER_FUTURE_SKEW_MS && age <= ACTIVITY_TICKER_WINDOW_MS) fresh.push(event);
  }
  return fresh;
}

/** Sentences for the landing ticker. Empty means the ticker stays hidden. */
export function tickerLines(events: readonly PublicActivityEvent[], now = Date.now()): string[] {
  const lines: string[] = [];
  for (const event of eventsForTicker(events, now)) {
    const line = activitySentence(event);
    if (line) lines.push(line);
  }
  return lines;
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

export function trustedByLabel(count: number): string {
  const noun = count === 1 ? 'cleaning business' : 'cleaning businesses';
  return `Trusted by ${count} ${noun}`;
}

export function shouldShowTrustedBy(count: number | null | undefined): boolean {
  return typeof count === 'number' && Number.isInteger(count) && count >= 1;
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
    if (!isKind(record.kind)) continue;
    const region = publicRegion(typeof record.region === 'string' ? record.region : null);
    if (!region) continue;
    const at = typeof record.at === 'string' ? record.at : '';
    if (!at || !Number.isFinite(Date.parse(at))) continue;
    const amount = record.kind === 'booked' || record.kind === 'paid'
      ? roundPublicAmount(typeof record.amount === 'number' ? record.amount : null)
      : null;
    if (record.kind === 'paid' && amount == null) continue;
    // The feed only emits this kind for a submitted 5-star review. A row that
    // carries any other rating is not that event.
    if (record.kind === 'reviewed' && 'rating' in record && record.rating !== 5) continue;
    events.push({
      kind: record.kind,
      region,
      amount,
      service: record.kind === 'booked'
        ? publicService(typeof record.service === 'string' ? record.service : null)
        : null,
      at,
    });
  }
  return enforceActivityOrder(events);
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
