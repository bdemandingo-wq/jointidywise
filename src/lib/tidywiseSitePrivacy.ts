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

/** Production tag hosts. An env-provided test host is ignored when production is true. */
export const PRODUCTION_TAG_HOSTS = ['jointidywise.com', 'www.jointidywise.com'] as const;

export type PrivacyChoice = 'acknowledged' | 'opted_out';

export type TidyWiseConversion =
  | 'signup_completed'
  | 'trial_started'
  | 'calc_completed'
  | 'trial_click';

export interface PrivacyStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** Meta Pixel IDs are numeric. Same shape TrackingPixels accepts. */
const META_PIXEL_RE = /^\d{10,20}$/;
/** GA4 measurement ids. Universal Analytics (UA-) is not accepted. */
const GA4_ID_RE = /^G-[A-Z0-9]{4,}$/;
/** Google Ads conversion ids. */
const ADS_ID_RE = /^AW-\d{6,}$/;

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
  '/tools',
];

/** These pages keep the footer link and show neither tags nor the bar. */
const NO_TAG_OR_BANNER = new Set(['/terms', '/privacy-policy', '/feedback']);

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

export function isTidyWiseTagSurface(pathname: string): boolean {
  const path = normalizePathname(pathname);
  if (NO_TAG_OR_BANNER.has(path)) return false;
  return isTidyWiseMarketingOrSignupPath(pathname);
}

export function isTrialConversionPath(pathname: string): boolean {
  const path = normalizePathname(pathname);
  return path === '/onboarding' || path === '/dashboard' || path.startsWith('/dashboard/');
}

export function sanitizeMetaPixelId(value: string | null | undefined): string | null {
  const id = (value ?? '').trim();
  return META_PIXEL_RE.test(id) ? id : null;
}

export function sanitizeGa4Id(value: string | null | undefined): string | null {
  const id = (value ?? '').trim();
  return GA4_ID_RE.test(id) ? id : null;
}

export function sanitizeAdsId(value: string | null | undefined): string | null {
  const id = (value ?? '').trim();
  return ADS_ID_RE.test(id) ? id : null;
}

export function parseExtraTagHosts(raw: string | null | undefined): string[] {
  if (!raw) return [];
  const seen = new Set<string>();
  for (const part of raw.split(',')) {
    const host = part.trim().toLowerCase().replace(/\.$/, '');
    if (host) seen.add(host);
  }
  return [...seen];
}

/**
 * Production allows only jointidywise.com and www.jointidywise.com.
 * Non-production may add hosts from an env var. Production must ignore that list
 * even when it is present in the build environment.
 */
export function tagHostOptionsFromEnv(env: {
  PROD?: boolean;
  VITE_TIDYWISE_TAG_TEST_HOSTS?: string;
}): { production: boolean; extraHosts: string[] } {
  const production = env.PROD === true;
  if (production) return { production: true, extraHosts: [] };
  return {
    production: false,
    extraHosts: parseExtraTagHosts(env.VITE_TIDYWISE_TAG_TEST_HOSTS),
  };
}

export function isTagHostnameAllowed(
  hostname: string,
  options: { production: boolean; extraHosts: readonly string[] },
): boolean {
  const host = hostname.trim().toLowerCase().replace(/\.$/, '');
  if ((PRODUCTION_TAG_HOSTS as readonly string[]).includes(host)) return true;
  if (options.production) return false;
  return options.extraHosts.some((extra) => extra.toLowerCase() === host);
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
  hostnameAllowed?: boolean;
  tourActive?: boolean;
}): boolean {
  if (input.native) return false;
  if (input.tourActive) return false;
  if (input.hostnameAllowed === false) return false;
  if (input.choice === 'acknowledged' || input.choice === 'opted_out') return false;
  const path = normalizePathname(input.pathname);
  if (NO_TAG_OR_BANNER.has(path) || path === DO_NOT_SELL_PATH) return false;
  return isTidyWiseMarketingOrSignupPath(input.pathname);
}

export interface GoogleAdsConsent {
  ad_storage: 'denied' | 'granted';
  ad_user_data: 'denied' | 'granted';
  ad_personalization: 'denied' | 'granted';
  analytics_storage: 'denied' | 'granted';
}

export function googleAdsConsent(granted: boolean): GoogleAdsConsent {
  const value = granted ? 'granted' : 'denied';
  return {
    ad_storage: value,
    ad_user_data: value,
    ad_personalization: value,
    analytics_storage: value,
  };
}

/**
 * What an opt-out does to tags that are already running.
 * The page reloads when the choice was stored, so the revoked scripts
 * are gone. A blocked storage write keeps the choice in memory and skips
 * the reload, because a reload would forget it.
 */
export function optOutTagPlan(): {
  metaConsent: ['consent', 'revoke'];
  googleConsentUpdate: GoogleAdsConsent;
  clearCookieNames: string[];
  reloadWhenStored: true;
} {
  return {
    metaConsent: ['consent', 'revoke'],
    googleConsentUpdate: googleAdsConsent(false),
    clearCookieNames: ['_fbp', '_fbc', '_ga', '_gcl_'],
    reloadWhenStored: true,
  };
}

/** Cookie names cleared on opt-out: Meta's _fbp/_fbc, GA's _ga/_ga_*, and _gcl_*. */
export function cookieMatchesOptOutClear(name: string): boolean {
  return name === '_fbp' || name === '_fbc' || name === '_ga' || name.startsWith('_ga_') || name.startsWith('_gcl_');
}

/**
 * Tags load on the marketing/signup surface unless the visitor opted out,
 * the browser sends Global Privacy Control, or the hostname is not allowed.
 * Acknowledging the notice does not block tags. Unset IDs load nothing.
 *
 * GPC blocks both GA4 and Google Ads. GA4 may run under GPC only once
 * Google signals, ads personalization, and the Google Ads link are
 * confirmed off. Until that confirmation, a GPC signal denies both.
 */
export function tidyWiseTagDecision(input: {
  pathname: string;
  native: boolean;
  choice: PrivacyChoice | null;
  gpc: boolean;
  hostnameAllowed: boolean;
  metaId: string | null;
  ga4Id: string | null;
  adsId: string | null;
}): { loadMeta: boolean; loadGa4: boolean; loadAds: boolean } {
  const allowed =
    !input.native &&
    input.choice !== 'opted_out' &&
    !input.gpc &&
    input.hostnameAllowed &&
    isTidyWiseTagSurface(input.pathname);
  return {
    loadMeta: allowed && !!input.metaId,
    loadGa4: allowed && !!input.ga4Id,
    loadAds: allowed && !!input.adsId,
  };
}

/**
 * Conversion events follow the same opt-out, GPC, native, and hostname rules.
 * signup_completed, calc_completed, and trial_click stay on marketing and
 * signup pages. trial_started also fires on /onboarding and /dashboard,
 * where the trial actually exists. Pageview tags still do not load on those
 * app routes.
 */
export function tidyWiseConversionAllowed(input: {
  event: TidyWiseConversion;
  pathname: string;
  native: boolean;
  choice: PrivacyChoice | null;
  gpc: boolean;
  hostnameAllowed: boolean;
  hasDestination: boolean;
}): boolean {
  if (input.native || input.choice === 'opted_out' || input.gpc || !input.hostnameAllowed) return false;
  if (!input.hasDestination) return false;
  if (input.event === 'trial_started') {
    return isTrialConversionPath(input.pathname) || isTidyWiseTagSurface(input.pathname);
  }
  return isTidyWiseTagSurface(input.pathname);
}

export type MetaCommandPlan =
  | { action: 'passthrough' }
  | { action: 'drop' }
  | { action: 'fanout'; pixelIds: string[] };

/**
 * Keeps a TidyWise pixel that shares window.fbq from receiving org booking
 * events, and drops TidyWise events after opt-out. After revoke, broadcast
 * track() calls are dropped too so a pixel that is already running cannot
 * keep sending. An explicit trackSingle to a different pixel id still passes.
 */
export function planMetaCommand(input: {
  command: string;
  pixelId: string | null;
  ourId: string | null;
  ourAllowed: boolean;
  otherIds: readonly string[];
  revoked?: boolean;
}): MetaCommandPlan {
  const { command, pixelId, ourId, ourAllowed, otherIds, revoked } = input;
  if (revoked && (command === 'track' || command === 'trackCustom' || command === 'trackSingle' || command === 'trackSingleCustom')) {
    const single = command === 'trackSingle' || command === 'trackSingleCustom';
    if (single && pixelId && ourId && pixelId !== ourId) return { action: 'passthrough' };
    return { action: 'drop' };
  }
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

/**
 * Event names only. metaCustom selects Meta's custom-event method.
 * Nothing in this object is a user field.
 */
export function conversionPayload(event: TidyWiseConversion): { meta: string; ga: string; metaCustom: boolean } {
  switch (event) {
    case 'signup_completed':
      return { meta: 'CompleteRegistration', ga: 'sign_up', metaCustom: false };
    case 'trial_started':
      return { meta: 'StartTrial', ga: 'trial_started', metaCustom: false };
    case 'calc_completed':
      return { meta: 'calc_completed', ga: 'calc_completed', metaCustom: true };
    case 'trial_click':
      return { meta: 'trial_click', ga: 'trial_click', metaCustom: true };
  }
}

/** One trial_started pixel per org, and only while the org is still new. */
export const TRIAL_STARTED_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export function orgCreatedWithinTrialPixelWindow(
  createdAt: string | null | undefined,
  now = Date.now(),
): boolean {
  if (!createdAt) return false;
  const created = Date.parse(createdAt);
  if (!Number.isFinite(created)) return false;
  const age = now - created;
  return age >= 0 && age <= TRIAL_STARTED_MAX_AGE_MS;
}

/** True when at least one TidyWise tag id is configured. An empty config must not claim. */
export function trialStartedDestinationConfigured(ids: {
  metaId?: string | null;
  ga4Id?: string | null;
  adsId?: string | null;
}): boolean {
  return !!(ids.metaId || ids.ga4Id || ids.adsId);
}

/** Read again at send time. Opt-out, GPC, or a disallowed host blocks the pixel. */
export function trialStartedConsentAllows(input: {
  choice: PrivacyChoice | null;
  gpc: boolean;
  hostnameAllowed: boolean;
  native?: boolean;
}): boolean {
  if (input.native) return false;
  if (input.choice === 'opted_out') return false;
  if (input.gpc) return false;
  if (!input.hostnameAllowed) return false;
  return true;
}

/**
 * The pixel goes out only when the org is still in trial, was created in
 * the last 24 hours, consent still allows it, and the server claim returned
 * true. A second claim is false and sends nothing.
 */
export function shouldSendTrialStartedPixel(input: {
  createdAt: string | null | undefined;
  inTrial: boolean;
  claimGranted: boolean;
  choice: PrivacyChoice | null;
  gpc: boolean;
  hostnameAllowed: boolean;
  native?: boolean;
  now?: number;
}): boolean {
  if (!input.inTrial) return false;
  if (!input.claimGranted) return false;
  if (!orgCreatedWithinTrialPixelWindow(input.createdAt, input.now)) return false;
  return trialStartedConsentAllows(input);
}

/** Event name only. send_to routes the hit to our tag and is not a user field. */
export function trialStartedGoogleArgs(googleId: string): readonly ['event', 'trial_started', { send_to: string }] {
  return ['event', 'trial_started', { send_to: googleId }];
}

export function trialStartedMetaArgs(pixelId: string): readonly ['trackSingle', string, 'StartTrial'] {
  return ['trackSingle', pixelId, 'StartTrial'];
}
