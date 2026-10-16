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

/**
 * Inclusive USPS ZIP3 prefixes that belong to one state. Gaps are prefixes
 * USPS does not assign; those stay null. 969 is Guam, the Marianas, and
 * Palau together, so it is not a state. Keep this list in sync with
 * growth_public_region_from_zip in the public-activity migration.
 */
export const ZIP3_RANGES: readonly (readonly [number, number, string])[] = [
  [5, 5, 'NY'],
  [6, 7, 'PR'],
  [8, 8, 'VI'],
  [9, 9, 'PR'],
  [10, 27, 'MA'],
  [28, 29, 'RI'],
  [30, 38, 'NH'],
  [39, 49, 'ME'],
  [50, 54, 'VT'],
  [55, 55, 'MA'],
  [56, 59, 'VT'],
  [60, 69, 'CT'],
  [70, 89, 'NJ'],
  [100, 149, 'NY'],
  [150, 196, 'PA'],
  [197, 199, 'DE'],
  [200, 200, 'DC'],
  [201, 201, 'VA'],
  [202, 205, 'DC'],
  [206, 212, 'MD'],
  [214, 219, 'MD'],
  [220, 246, 'VA'],
  [247, 268, 'WV'],
  [270, 289, 'NC'],
  [290, 299, 'SC'],
  [300, 319, 'GA'],
  [320, 339, 'FL'],
  [341, 342, 'FL'],
  [344, 344, 'FL'],
  [346, 347, 'FL'],
  [349, 349, 'FL'],
  [350, 352, 'AL'],
  [354, 369, 'AL'],
  [370, 385, 'TN'],
  [386, 397, 'MS'],
  [398, 399, 'GA'],
  [400, 418, 'KY'],
  [420, 427, 'KY'],
  [430, 459, 'OH'],
  [460, 479, 'IN'],
  [480, 499, 'MI'],
  [500, 516, 'IA'],
  [520, 528, 'IA'],
  [530, 532, 'WI'],
  [534, 535, 'WI'],
  [537, 549, 'WI'],
  [550, 551, 'MN'],
  [553, 567, 'MN'],
  [570, 577, 'SD'],
  [580, 588, 'ND'],
  [590, 599, 'MT'],
  [600, 603, 'IL'],
  [604, 605, 'IL'],
  [606, 608, 'IL'],
  [609, 609, 'IL'],
  [610, 611, 'IL'],
  [612, 620, 'IL'],
  [622, 629, 'IL'],
  [630, 631, 'MO'],
  [633, 641, 'MO'],
  [644, 658, 'MO'],
  [660, 679, 'KS'],
  [680, 681, 'NE'],
  [683, 693, 'NE'],
  [700, 701, 'LA'],
  [703, 708, 'LA'],
  [710, 714, 'LA'],
  [716, 729, 'AR'],
  [730, 731, 'OK'],
  [733, 733, 'TX'],
  [734, 741, 'OK'],
  [743, 749, 'OK'],
  [750, 770, 'TX'],
  [772, 799, 'TX'],
  [800, 816, 'CO'],
  [820, 831, 'WY'],
  [832, 838, 'ID'],
  [840, 847, 'UT'],
  [850, 853, 'AZ'],
  [855, 857, 'AZ'],
  [859, 860, 'AZ'],
  [863, 865, 'AZ'],
  [870, 871, 'NM'],
  [873, 884, 'NM'],
  [885, 885, 'TX'],
  [889, 891, 'NV'],
  [893, 895, 'NV'],
  [897, 898, 'NV'],
  [900, 908, 'CA'],
  [910, 928, 'CA'],
  [930, 961, 'CA'],
  [967, 968, 'HI'],
  [970, 979, 'OR'],
  [980, 986, 'WA'],
  [988, 994, 'WA'],
  [995, 999, 'AK'],
];

/** Canada Post first letter. X is both NT and NU, so it is not a province. */
const CANADA_POSTAL: Record<string, string> = {
  A: 'NL',
  B: 'NS',
  C: 'PE',
  E: 'NB',
  G: 'QC',
  H: 'QC',
  J: 'QC',
  K: 'ON',
  L: 'ON',
  M: 'ON',
  N: 'ON',
  P: 'ON',
  R: 'MB',
  S: 'SK',
  T: 'AB',
  V: 'BC',
  Y: 'YT',
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

function isStateCode(code: string): boolean {
  return Object.prototype.hasOwnProperty.call(STATE_NAMES, code);
}

/**
 * Exact 2-letter known code only, same as growth_public_region. A full name,
 * a city, or a code buried in a longer string ("Dallas, TX", "Florida") is
 * not a state.
 */
export function publicRegion(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!/^[A-Za-z]{2}$/.test(trimmed)) return null;
  const code = trimmed.toUpperCase();
  return isStateCode(code) ? code : null;
}

/** State from a ZIP or Canadian postal code. Never from a city name. */
export function publicRegionFromZip(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const cleaned = raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (/^\d{5}(\d{4})?$/.test(cleaned)) {
    const zip3 = Number(cleaned.slice(0, 3));
    for (const [lo, hi, code] of ZIP3_RANGES) {
      if (zip3 >= lo && zip3 <= hi) return code;
    }
    return null;
  }
  if (/^[A-Z]\d[A-Z]\d[A-Z]\d$/.test(cleaned)) {
    return CANADA_POSTAL[cleaned[0]] ?? null;
  }
  return null;
}

/**
 * Exact state code, then ZIP, then an exact booking-state code. Full names
 * and substrings are not codes. The feed parser does not call this: the
 * server sends the code it already resolved.
 */
export function publicPlace(
  state: string | null | undefined,
  zip?: string | null,
  bookingState?: string | null,
): string | null {
  return publicRegion(state) ?? publicRegionFromZip(zip) ?? publicRegion(bookingState);
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
 * each earlier pick of that org). The last kind also has to differ from the
 * first, because the ticker wraps. Keep them together.
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
  return closeActivityKindLoop(result);
}

/** Drop the oldest tail until the wrap from last back to first changes kind. */
function closeActivityKindLoop<T extends { kind: string }>(events: readonly T[]): T[] {
  const result = events.slice();
  while (result.length > 1 && result[0].kind === result[result.length - 1].kind) {
    result.pop();
  }
  return result;
}

/**
 * A feed that already alternates kinds is left in place so org spreading
 * done in SQL survives. A run of the same kind is reordered. Either way the
 * last kind must differ from the first.
 */
export function enforceActivityOrder<T extends ActivitySpreadEvent>(events: readonly T[], limit = 12): T[] {
  for (let i = 1; i < events.length; i++) {
    if (events[i].kind === events[i - 1].kind) {
      return orderActivityEvents(events, limit);
    }
  }
  return closeActivityKindLoop(events.slice(0, limit));
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

export interface TickerLine {
  text: string;
  kind: PublicActivityKind;
}

/** Sentences for the landing ticker, each with its kind. Empty hides the ticker. */
export function tickerLines(events: readonly PublicActivityEvent[], now = Date.now()): TickerLine[] {
  const lines: TickerLine[] = [];
  for (const event of enforceActivityOrder(eventsForTicker(events, now))) {
    const text = activitySentence(event);
    if (text) lines.push({ text, kind: event.kind });
  }
  return lines;
}

/**
 * Line to show after the list changes.
 * The sentence on screen is found and the following line of a different kind
 * is chosen. If that sentence is gone, the search starts at the first line
 * and still skips the kind that was showing.
 */
export function tickerIndexAfterChange(
  lines: readonly TickerLine[],
  shown: { text: string; kind: string } | null,
): number {
  if (lines.length === 0 || shown == null) return 0;
  const found = lines.findIndex((line) => line.text === shown.text);
  const start = found === -1 ? 0 : (found + 1) % lines.length;
  for (let step = 0; step < lines.length; step++) {
    const index = (start + step) % lines.length;
    if (lines[index].kind !== shown.kind) return index;
  }
  return found === -1 ? 0 : found;
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
  if (count === 1) return '1 cleaning business has signed up';
  return `${count} cleaning businesses have signed up`;
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

export function parseActivityFeed(payload: unknown, now = Date.now()): PublicActivityEvent[] {
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
  return enforceActivityOrder(eventsForTicker(events, now));
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
