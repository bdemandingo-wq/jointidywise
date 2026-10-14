/**
 * TidyWise's own marketing-site privacy choice.
 *
 * Org booking pages keep using TrackingPixels with each company's pixel.
 * Nothing in this module loads those tags or changes that path.
 *
 * Stored values are distinct on purpose:
 *   acknowledged — the visitor dismissed the notice; tags may load
 *   opted_out    — Do Not Sell / Share; TidyWise tags must not load
 */

export const PRIVACY_CHOICE_KEY = 'tw-site-privacy-choice';

export const BANNER_BODY =
  'We use cookies and similar tools from Google and Meta to measure our site and show you relevant ads.';

export const DO_NOT_SELL_LABEL = 'Do Not Sell or Share My Personal Information';

export const DO_NOT_SELL_PATH = '/do-not-sell';

export type PrivacyChoice = 'acknowledged' | 'opted_out';

export type TidyWiseConversion = 'signup_completed' | 'trial_started';

export interface PrivacyStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** Meta Pixel IDs are numeric. Same shape TrackingPixels accepts. */
const META_PIXEL_RE = /^\d{10,20}$/;
/** GA4, Universal, Google Ads, or Campaign Manager. */
const GA_ID_RE = /^(G-[A-Z0-9]{6,12}|UA-\d{4,}-\d+|AW-\d{6,}|DC-\d{6,})$/;

const MARKETING_EXACT = new Set([
  '/',
  '/signup',
  '/pricing',
  '/demo',
  '/contact',
  '/get-the-app',
  '/privacy-policy',
  '/terms',
  '/referral',
  '/refer',
  '/affiliate',
  '/feedback',
  DO_NOT_SELL_PATH,
]);

const MARKETING_PREFIXES = [
  '/blog',
  '/compare',
  '/features',
  '/cleaning-business-software',
  '/score',
];

export function normalizePathname(pathname: string): string {
  const raw = (pathname || '/').split('?')[0].split('#')[0] || '/';
  if (raw.length > 1 && raw.endsWith('/')) return raw.slice(0, -1);
  return raw || '/';
}

function matchesPrefix(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(`${prefix}/`);
}

/**
 * TidyWise marketing and signup only.
 * Public booking, the admin app, the cleaner portal, the client portal,
 * and auth screens are not this surface.
 */
export function isTidyWiseMarketingOrSignupPath(pathname: string): boolean {
  const path = normalizePathname(pathname);
  if (MARKETING_EXACT.has(path)) return true;
  return MARKETING_PREFIXES.some((prefix) => matchesPrefix(path, prefix));
}

export function sanitizeMetaPixelId(value: string | null | undefined): string | null {
  const id = (value ?? '').trim();
  return META_PIXEL_RE.test(id) ? id : null;
}

export function sanitizeGaId(value: string | null | undefined): string | null {
  const id = (value ?? '').trim();
  return GA_ID_RE.test(id) ? id : null;
}

export function readPrivacyChoice(storage: PrivacyStorage | null): PrivacyChoice | null {
  if (!storage) return null;
  try {
    const value = storage.getItem(PRIVACY_CHOICE_KEY);
    if (value === 'acknowledged' || value === 'opted_out') return value;
    return null;
  } catch {
    return null;
  }
}

export function writePrivacyChoice(storage: PrivacyStorage, choice: PrivacyChoice): void {
  storage.setItem(PRIVACY_CHOICE_KEY, choice);
}

/** True only for the spec signal. Other truthy values do not count. */
export function readGlobalPrivacyControl(nav: { globalPrivacyControl?: boolean } | null | undefined): boolean {
  return nav?.globalPrivacyControl === true;
}

export function shouldShowCookieNotice(input: {
  pathname: string;
  native: boolean;
  choice: PrivacyChoice | null;
}): boolean {
  if (input.native) return false;
  if (input.choice === 'acknowledged' || input.choice === 'opted_out') return false;
  return isTidyWiseMarketingOrSignupPath(input.pathname);
}

/**
 * Tags load on the marketing/signup surface unless the visitor opted out
 * or the browser sends Global Privacy Control. Acknowledging the notice
 * does not block tags. Unset IDs load nothing.
 */
export function tidyWiseTagDecision(input: {
  pathname: string;
  native: boolean;
  choice: PrivacyChoice | null;
  gpc: boolean;
  metaId: string | null;
  gaId: string | null;
}): { loadMeta: boolean; loadGa: boolean } {
  const allowed =
    !input.native &&
    input.choice !== 'opted_out' &&
    !input.gpc &&
    isTidyWiseMarketingOrSignupPath(input.pathname);
  return {
    loadMeta: allowed && !!input.metaId,
    loadGa: allowed && !!input.gaId,
  };
}

export type MetaCommandPlan =
  | { action: 'passthrough' }
  | { action: 'drop' }
  | { action: 'fanout'; pixelIds: string[] };

/**
 * Keeps a TidyWise pixel that shares window.fbq from receiving org booking
 * events, and drops TidyWise events after opt-out. Org pixels stay on the
 * fan-out list. Broadcast `track` is never forwarded to the TidyWise id.
 */
export function planMetaCommand(input: {
  command: string;
  pixelId: string | null;
  ourId: string | null;
  ourAllowed: boolean;
  otherIds: readonly string[];
}): MetaCommandPlan {
  const { command, pixelId, ourId, ourAllowed, otherIds } = input;
  if (command === 'init' || command === 'set' || command === 'consent') {
    return { action: 'passthrough' };
  }
  if (command === 'trackSingle' || command === 'trackSingleCustom') {
    if (pixelId && ourId && pixelId === ourId && !ourAllowed) return { action: 'drop' };
    return { action: 'passthrough' };
  }
  if (command === 'track' || command === 'trackCustom') {
    if (!ourId) return { action: 'passthrough' };
    const others = otherIds.filter((id) => id !== ourId);
    // Unknown org pixel: leave the broadcast alone so a booking pixel we
    // did not see init still receives it. When we know the other ids,
    // send only to those and keep the TidyWise pixel out.
    if (others.length === 0) return { action: 'passthrough' };
    return { action: 'fanout', pixelIds: others };
  }
  return { action: 'passthrough' };
}

export function conversionPayload(event: TidyWiseConversion): { meta: string; ga: string } {
  if (event === 'signup_completed') return { meta: 'CompleteRegistration', ga: 'sign_up' };
  return { meta: 'StartTrial', ga: 'trial_started' };
}
