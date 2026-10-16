/**
 * First-touch UTM capture for the marketing site.
 *
 * The browser only remembers what the visitor landed with. The account row is
 * written later by save_signup_attribution, which keeps the raw string and a
 * trimmed, lowercased copy. This file does not load an advertising SDK and
 * does not read an advertising identifier, so the iOS app does not need ATT.
 *
 * Storage is injected so the rules are testable without a DOM. Production
 * uses localStorage plus a first-party cookie. First touch wins for 90 days,
 * including a visit that had no UTM parameters, so a later campaign link does
 * not overwrite the original landing.
 *
 * What is stored, and nothing else from the URL:
 *   utm_source, utm_medium, utm_campaign, utm_term, utm_content
 *   gclid, fbclid, ttclid
 *   channel, channel_source, detected_via — labels only
 *   the landing path, with no origin, query string, or hash
 *   the referrer's domain, with no path or query
 * The user agent is read to name an in-app browser and is never stored.
 * Invite and reset links put access_token and refresh_token in the hash.
 * Those fragments are never written to localStorage, the cookie, or
 * account_signup_attribution.
 *
 * Keep normalizeUtmValue in sync with public.normalize_utm_value in
 * supabase/migrations/20261014230000_activation_tracking_and_signup_utm.sql.
 */

export const UTM_PARAM_KEYS = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
] as const;

export type UtmParamKey = (typeof UTM_PARAM_KEYS)[number];

export const UTM_STORAGE_KEY = "tw-utm-first-touch";
export const UTM_COOKIE_NAME = "tw_utm";
export const UTM_TTL_MS = 90 * 24 * 60 * 60 * 1000;
export const UTM_TTL_SECONDS = 90 * 24 * 60 * 60;

/** App shells and auth links are not a marketing landing. A direct visit
 * there must not become the first touch and block a real campaign link
 * captured later. Invite and reset URLs also carry session tokens. */
const NO_CAPTURE_PREFIXES = [
  "/dashboard",
  "/staff",
  "/portal",
  "/admin",
  "/set-password",
  "/auth",
  "/accept-invite",
  "/reset-password",
];

export interface UtmStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface UtmCookieJar {
  get(): string | null;
  set(value: string): void;
  clear(): void;
}

/** Raw query values. Null means the parameter was absent. Not normalized. */
export interface CapturedUtm {
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_term: string | null;
  utm_content: string | null;
  referrer: string | null;
  landing_page: string | null;
  gclid: string | null;
  fbclid: string | null;
  ttclid: string | null;
  channel: string | null;
  channel_source: string | null;
  detected_via: string | null;
  capturedAt: number;
}

export interface SignupAttributionArgs {
  p_utm_source: string | null;
  p_utm_medium: string | null;
  p_utm_campaign: string | null;
  p_utm_term: string | null;
  p_utm_content: string | null;
  p_referrer: string | null;
  p_landing_page: string | null;
  p_captured_at: string | null;
  p_channel: string | null;
  p_channel_source: string | null;
  p_detected_via: string | null;
  p_gclid: string | null;
  p_fbclid: string | null;
  p_ttclid: string | null;
}

export type DetectedVia = "utm" | "click_id" | "user_agent" | "referrer" | "native" | "direct";

export interface ChannelClassification {
  channel: string;
  channel_source: string | null;
  detected_via: DetectedVia;
}

export interface ClassifyChannelInput {
  utm_source?: string | null;
  utm_medium?: string | null;
  utm_campaign?: string | null;
  utm_term?: string | null;
  utm_content?: string | null;
  gclid?: string | null;
  fbclid?: string | null;
  ttclid?: string | null;
  /** Read to classify an in-app browser. Never written to storage or the database. */
  userAgent?: string | null;
  referrer?: string | null;
  native?: boolean;
}

/** What the database stores. Normalized source is never null. */
export interface NormalizedUtm {
  utm_source_raw: string | null;
  utm_source: string;
  utm_medium_raw: string | null;
  utm_medium: string | null;
  utm_campaign_raw: string | null;
  utm_campaign: string | null;
  utm_term_raw: string | null;
  utm_term: string | null;
  utm_content_raw: string | null;
  utm_content: string | null;
}

export interface StoredSignupAttribution extends NormalizedUtm {
  referrer: string | null;
  landing_page: string | null;
  channel: string | null;
  channel_source: string | null;
  detected_via: string | null;
  gclid: string | null;
  fbclid: string | null;
  ttclid: string | null;
}

const CHANNEL_LABELS: Record<string, string> = {
  tiktok: "TikTok",
  instagram: "Instagram",
  facebook: "Facebook",
  reddit: "Reddit",
  google: "Google",
  google_ads: "Google Ads",
  organic_search: "Organic search",
  x: "X",
  direct: "Direct",
  referral: "Referral",
  ios_app: "iOS app",
};

const DETECTED_VIA_LABELS: Record<string, string> = {
  utm: "UTM",
  click_id: "Click id",
  user_agent: "In-app browser",
  referrer: "Referrer",
  native: "iOS app",
  direct: "Direct",
};

const PAID_MEDIUMS = new Set(["cpc", "ppc", "paid", "paidsocial", "paid_social", "cpm", "cpa", "display", "ads"]);

export function channelLabel(channel: string): string {
  return CHANNEL_LABELS[channel] ?? channel;
}

interface StoredCapture extends CapturedUtm {
  expiresAt: number;
}

function defaultStorage(): UtmStorage {
  if (typeof localStorage !== "undefined") return localStorage;
  return {
    getItem: () => null,
    setItem: () => undefined,
    removeItem: () => undefined,
  };
}

function cookieDomainAttribute(): string {
  if (typeof location === "undefined") return "";
  const host = location.hostname;
  if (host === "jointidywise.com" || host.endsWith(".jointidywise.com")) {
    return "; Domain=.jointidywise.com";
  }
  return "";
}

function defaultCookies(): UtmCookieJar | undefined {
  if (typeof document === "undefined") return undefined;
  return {
    get: () => {
      const prefix = `${UTM_COOKIE_NAME}=`;
      const part = document.cookie.split("; ").find((item) => item.startsWith(prefix));
      if (!part) return null;
      try {
        return decodeURIComponent(part.slice(prefix.length));
      } catch {
        return null;
      }
    },
    set: (value: string) => {
      if (value.length > 3500) return;
      const secure = typeof location !== "undefined" && location.protocol === "https:";
      const parts = [
        `${UTM_COOKIE_NAME}=${encodeURIComponent(value)}`,
        "Path=/",
        `Max-Age=${UTM_TTL_SECONDS}`,
        "SameSite=Lax",
      ];
      if (secure) parts.push("Secure");
      document.cookie = parts.join("; ") + cookieDomainAttribute();
    },
    clear: () => {
      document.cookie = `${UTM_COOKIE_NAME}=; Path=/; Max-Age=0; SameSite=Lax${cookieDomainAttribute()}`;
    },
  };
}

/** Trim and lowercase. Empty after trim is absent. Does not reject unknown words. */
export function normalizeUtmValue(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const normalized = raw.trim().toLowerCase();
  return normalized.length > 0 ? normalized : null;
}

/** As received, except whitespace-only, which is absent. Matches utm_raw_or_null. */
function rawOrNull(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  if (value.trim().length === 0) return null;
  return value;
}

/**
 * The pair of columns written for one signup.
 * 'direct' is applied only to the normalized source, and only when no source
 * was received. The raw column stays null in that case.
 */
export function normalizeCapturedUtm(captured: {
  utm_source?: string | null;
  utm_medium?: string | null;
  utm_campaign?: string | null;
  utm_term?: string | null;
  utm_content?: string | null;
}): NormalizedUtm {
  const sourceRaw = rawOrNull(captured.utm_source);
  const mediumRaw = rawOrNull(captured.utm_medium);
  const campaignRaw = rawOrNull(captured.utm_campaign);
  const termRaw = rawOrNull(captured.utm_term);
  const contentRaw = rawOrNull(captured.utm_content);
  return {
    utm_source_raw: sourceRaw,
    utm_source: normalizeUtmValue(sourceRaw) ?? "direct",
    utm_medium_raw: mediumRaw,
    utm_medium: normalizeUtmValue(mediumRaw),
    utm_campaign_raw: campaignRaw,
    utm_campaign: normalizeUtmValue(campaignRaw),
    utm_term_raw: termRaw,
    utm_term: normalizeUtmValue(termRaw),
    utm_content_raw: contentRaw,
    utm_content: normalizeUtmValue(contentRaw),
  };
}

function readParam(params: URLSearchParams, key: string): string | null {
  const value = params.get(key);
  if (value == null || value.length === 0) return null;
  return value;
}

export function extractUtmFromSearch(search: string): Pick<CapturedUtm, UtmParamKey> {
  const qs = search.startsWith("?") ? search.slice(1) : search;
  const params = new URLSearchParams(qs);
  return {
    utm_source: readParam(params, "utm_source"),
    utm_medium: readParam(params, "utm_medium"),
    utm_campaign: readParam(params, "utm_campaign"),
    utm_term: readParam(params, "utm_term"),
    utm_content: readParam(params, "utm_content"),
  };
}

export function hasAnyUtm(fields: Pick<CapturedUtm, UtmParamKey>): boolean {
  return UTM_PARAM_KEYS.some((key) => fields[key] != null);
}

/** True for marketing and signup URLs. False for app shells and auth links. */
export function shouldCaptureLanding(pathname: string): boolean {
  const path = pathname.length > 0 ? pathname : "/";
  return !NO_CAPTURE_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

function hashRoutePath(hash: string): string | null {
  if (!hash.startsWith("#/")) return null;
  const raw = hash.slice(1);
  let cut = raw.length;
  for (const mark of ["?", "&", "#"]) {
    const at = raw.indexOf(mark);
    if (at >= 0) cut = Math.min(cut, at);
  }
  return raw.slice(0, cut) || "/";
}

/**
 * Path only. A full URL is reduced to its pathname. A client route in the
 * hash (`#/signup`) contributes that path. A token fragment
 * (`#access_token=`) is dropped. Query strings are dropped.
 */
export function sanitizeLandingPath(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  let path = value.trim();
  if (path.length === 0) return null;
  if (path.includes("://")) {
    try {
      const url = new URL(path);
      path = hashRoutePath(url.hash) ?? url.pathname;
    } catch {
      // Not a URL. The query and hash strip below still applies.
    }
  }
  const hashAt = path.indexOf("#");
  if (hashAt >= 0) {
    const route = hashRoutePath(path.slice(hashAt));
    path = route ?? path.slice(0, hashAt);
  }
  const queryAt = path.indexOf("?");
  if (queryAt >= 0) path = path.slice(0, queryAt);
  const ampAt = path.indexOf("&");
  if (ampAt >= 0) path = path.slice(0, ampAt);
  path = path.trim();
  if (path.length === 0) return "/";
  if (!path.startsWith("/")) path = `/${path}`;
  return cap(path, 2000);
}

/** Hostname only. Path, query, hash, userinfo, and port are dropped. */
export function referrerDomain(value: string | null | undefined): string | null {
  const raw = rawOrNull(value);
  if (!raw) return null;
  try {
    const url = new URL(raw.includes("://") ? raw : `https://${raw}`);
    const host = url.hostname.trim().toLowerCase();
    if (host.length === 0) return null;
    return cap(host, 253);
  } catch {
    return null;
  }
}

function cap(value: string | null, max: number): string | null {
  if (value == null) return null;
  return value.length > max ? value.slice(0, max) : value;
}

function presentText(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function bareHost(host: string): string {
  return host.startsWith("www.") ? host.slice(4) : host;
}

function hostIs(host: string, pattern: RegExp): boolean {
  return pattern.test(bareHost(host));
}

function isOwnHost(host: string): boolean {
  const bare = bareHost(host);
  return bare === "jointidywise.com" || bare.endsWith(".jointidywise.com");
}

function channelFromUtm(source: string | null, medium: string | null): { channel: string; channel_source: string | null } {
  const paid = medium != null && PAID_MEDIUMS.has(medium);
  let channel = "utm";
  if (source === "tiktok" || source === "tt") channel = "tiktok";
  else if (source === "instagram" || source === "ig") channel = "instagram";
  else if (source === "facebook" || source === "fb" || source === "meta") channel = "facebook";
  else if (source === "reddit") channel = "reddit";
  else if (source === "google") channel = paid ? "google_ads" : "google";
  else if (source === "adwords" || source === "google_ads") channel = "google_ads";
  else if (source === "bing" || source === "duckduckgo" || source === "yahoo") channel = paid ? source : "organic_search";
  else if (source === "twitter" || source === "x" || source === "t.co") channel = "x";
  else if (source && /^[a-z0-9][a-z0-9_-]{0,63}$/.test(source)) channel = source;
  return { channel, channel_source: cap(source ?? medium, 120) };
}

function channelFromUserAgent(userAgent: string): ChannelClassification | null {
  if (/musical_ly|BytedanceWebview|TikTok/i.test(userAgent)) {
    return { channel: "tiktok", channel_source: "TikTok", detected_via: "user_agent" };
  }
  if (/Instagram/i.test(userAgent)) {
    return { channel: "instagram", channel_source: "Instagram", detected_via: "user_agent" };
  }
  if (/FBAN|FBAV|FB_IAB/i.test(userAgent)) {
    return { channel: "facebook", channel_source: "Facebook", detected_via: "user_agent" };
  }
  if (/Reddit/i.test(userAgent)) {
    return { channel: "reddit", channel_source: "Reddit", detected_via: "user_agent" };
  }
  return null;
}

function channelFromReferrer(host: string): ChannelClassification | null {
  const bare = bareHost(host);
  if (
    /^google\.[a-z.]+$/.test(bare)
    || hostIs(host, /(^|\.)bing\.com$/)
    || hostIs(host, /(^|\.)duckduckgo\.com$/)
    || /(^|\.)yahoo\.[a-z.]+$/.test(bare)
  ) {
    return { channel: "organic_search", channel_source: host, detected_via: "referrer" };
  }
  if (hostIs(host, /(^|\.)tiktok\.com$/)) {
    return { channel: "tiktok", channel_source: host, detected_via: "referrer" };
  }
  if (hostIs(host, /(^|\.)instagram\.com$/)) {
    return { channel: "instagram", channel_source: host, detected_via: "referrer" };
  }
  if (
    bare === "facebook.com"
    || bare === "l.facebook.com"
    || bare === "lm.facebook.com"
    || bare === "m.facebook.com"
    || hostIs(host, /(^|\.)facebook\.com$/)
  ) {
    return { channel: "facebook", channel_source: host, detected_via: "referrer" };
  }
  if (
    bare === "reddit.com"
    || bare === "old.reddit.com"
    || bare === "out.reddit.com"
    || hostIs(host, /(^|\.)reddit\.com$/)
  ) {
    return { channel: "reddit", channel_source: host, detected_via: "referrer" };
  }
  if (host === "t.co" || bare === "x.com" || bare === "twitter.com" || hostIs(host, /(^|\.)(?:twitter|x)\.com$/)) {
    return { channel: "x", channel_source: host, detected_via: "referrer" };
  }
  return null;
}

/**
 * First match wins:
 * UTM, then click id, then in-app user agent, then referrer, then
 * iOS app when the visit would otherwise be direct, then direct or referral.
 * The returned object is labels only. The user agent is not copied into it.
 */
export function classifyChannel(input: ClassifyChannelInput): ChannelClassification {
  const source = normalizeUtmValue(input.utm_source);
  const medium = normalizeUtmValue(input.utm_medium);
  const campaign = normalizeUtmValue(input.utm_campaign);
  const term = normalizeUtmValue(input.utm_term);
  const content = normalizeUtmValue(input.utm_content);
  if (source || medium || campaign || term || content) {
    const named = channelFromUtm(source, medium);
    return {
      channel: named.channel,
      channel_source: named.channel_source ?? cap(campaign ?? term ?? content, 120),
      detected_via: "utm",
    };
  }

  if (presentText(input.ttclid)) return { channel: "tiktok", channel_source: "ttclid", detected_via: "click_id" };
  if (presentText(input.fbclid)) return { channel: "facebook", channel_source: "fbclid", detected_via: "click_id" };
  if (presentText(input.gclid)) return { channel: "google_ads", channel_source: "gclid", detected_via: "click_id" };

  const userAgent = presentText(input.userAgent);
  if (userAgent) {
    const fromAgent = channelFromUserAgent(userAgent);
    if (fromAgent) return fromAgent;
  }

  const host = referrerDomain(input.referrer);
  if (host) {
    const fromReferrer = channelFromReferrer(host);
    if (fromReferrer) return fromReferrer;
  }

  const native = input.native === true || (userAgent != null && /TidyWise-iOS/i.test(userAgent));
  if (host && !isOwnHost(host)) {
    return { channel: "referral", channel_source: host, detected_via: "referrer" };
  }
  if (native) return { channel: "ios_app", channel_source: "ios", detected_via: "native" };
  return { channel: "direct", channel_source: null, detected_via: "direct" };
}

export interface ChannelSignals {
  userAgent?: string | null;
  native?: boolean;
}

function runtimeSignals(override?: ChannelSignals): { userAgent: string | null; native: boolean } {
  if (override && (override.userAgent !== undefined || override.native !== undefined)) {
    return { userAgent: presentText(override.userAgent), native: override.native === true };
  }
  let userAgent: string | null = null;
  let native = false;
  try {
    if (typeof navigator !== "undefined") userAgent = presentText(navigator.userAgent);
  } catch {
    userAgent = null;
  }
  try {
    const capBridge = (globalThis as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
    if (typeof capBridge?.isNativePlatform === "function") native = capBridge.isNativePlatform() === true;
  } catch {
    native = false;
  }
  return { userAgent, native };
}

function extractClickIds(search: string): Pick<CapturedUtm, "gclid" | "fbclid" | "ttclid"> {
  const qs = search.startsWith("?") ? search.slice(1) : search;
  const params = new URLSearchParams(qs);
  return {
    gclid: cap(readParam(params, "gclid"), 200),
    fbclid: cap(readParam(params, "fbclid"), 200),
    ttclid: cap(readParam(params, "ttclid"), 200),
  };
}

function hasAnyClick(ids: Pick<CapturedUtm, "gclid" | "fbclid" | "ttclid">): boolean {
  return ids.gclid != null || ids.fbclid != null || ids.ttclid != null;
}

function mergeClickIds(
  primary: Pick<CapturedUtm, "gclid" | "fbclid" | "ttclid">,
  fallback: Pick<CapturedUtm, "gclid" | "fbclid" | "ttclid">,
): Pick<CapturedUtm, "gclid" | "fbclid" | "ttclid"> {
  return {
    gclid: primary.gclid ?? fallback.gclid,
    fbclid: primary.fbclid ?? fallback.fbclid,
    ttclid: primary.ttclid ?? fallback.ttclid,
  };
}

function landingFromLocation(loc: { pathname: string; hash?: string }): string | null {
  return sanitizeLandingPath(hashRoutePath(loc.hash ?? "") ?? (loc.pathname || "/"));
}

function parseStored(raw: string | null, now: number): CapturedUtm | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<StoredCapture>;
    if (typeof parsed.expiresAt === "number" && parsed.expiresAt < now) return null;
    if (typeof parsed.capturedAt !== "number") return null;
    const fields = extractUtmFromSearch("");
    for (const key of UTM_PARAM_KEYS) {
      const value = parsed[key];
      fields[key] = typeof value === "string" && value.length > 0 ? value : null;
    }
    const click = (key: "gclid" | "fbclid" | "ttclid") =>
      typeof parsed[key] === "string" && parsed[key].length > 0 ? parsed[key] : null;
    return {
      ...fields,
      referrer: typeof parsed.referrer === "string" && parsed.referrer.length > 0 ? parsed.referrer : null,
      landing_page: typeof parsed.landing_page === "string" ? parsed.landing_page : null,
      gclid: click("gclid"),
      fbclid: click("fbclid"),
      ttclid: click("ttclid"),
      channel: typeof parsed.channel === "string" && parsed.channel.length > 0 ? parsed.channel : null,
      channel_source: typeof parsed.channel_source === "string" && parsed.channel_source.length > 0 ? parsed.channel_source : null,
      detected_via: typeof parsed.detected_via === "string" && parsed.detected_via.length > 0 ? parsed.detected_via : null,
      capturedAt: parsed.capturedAt,
    };
  } catch {
    return null;
  }
}

function remember(
  capture: CapturedUtm,
  storage: UtmStorage,
  now: number,
  cookies?: UtmCookieJar,
): void {
  const payload = JSON.stringify({
    ...capture,
    expiresAt: now + UTM_TTL_MS,
  } satisfies StoredCapture);
  storage.setItem(UTM_STORAGE_KEY, payload);
  try {
    (cookies ?? defaultCookies())?.set(payload);
  } catch {
    // Cookie rejected. localStorage still holds the landing.
  }
}

/**
 * Record the landing if nothing is stored yet.
 * Pass `referrer` from document.referrer. Never throws.
 */
export function captureUtmFromLocation(
  loc: { href?: string; origin?: string; search: string; pathname: string; hash?: string },
  referrer: string | null = null,
  storage: UtmStorage = defaultStorage(),
  now: number = Date.now(),
  cookies?: UtmCookieJar,
  signals?: ChannelSignals,
): void {
  try {
    if (readCapturedUtm(storage, now, cookies)) return;

    const fromSearch = extractUtmFromSearch(loc.search);
    const hash = loc.hash ?? "";
    const hashQueryAt = hash.indexOf("?");
    const hashQuery = hashQueryAt >= 0 ? hash.slice(hashQueryAt) : "";
    const fromHash = hashQuery ? extractUtmFromSearch(hashQuery) : extractUtmFromSearch("");
    const fields: Pick<CapturedUtm, UtmParamKey> = { ...fromSearch };
    for (const key of UTM_PARAM_KEYS) {
      if (fields[key] == null) fields[key] = fromHash[key];
    }
    const clicks = mergeClickIds(extractClickIds(loc.search), extractClickIds(hashQuery));

    const route = hashRoutePath(hash) ?? loc.pathname ?? "/";
    if (!hasAnyUtm(fields) && !hasAnyClick(clicks) && !shouldCaptureLanding(route)) return;

    const live = runtimeSignals(signals);
    const referrerHost = referrerDomain(referrer);
    const classified = classifyChannel({
      ...fields,
      ...clicks,
      referrer: referrerHost,
      userAgent: live.userAgent,
      native: live.native,
    });
    const capture: CapturedUtm = {
      ...fields,
      ...clicks,
      referrer: referrerHost,
      landing_page: landingFromLocation(loc),
      channel: classified.channel,
      channel_source: classified.channel_source,
      detected_via: classified.detected_via,
      capturedAt: now,
    };
    remember(capture, storage, now, cookies);
  } catch {
    // Storage unavailable. Losing attribution must not take down the page.
  }
}

function scrubCaptured(capture: CapturedUtm): CapturedUtm {
  return {
    ...capture,
    referrer: referrerDomain(capture.referrer),
    landing_page: sanitizeLandingPath(capture.landing_page),
  };
}

/** A capture written before the path/domain limit is rewritten in place. */
function presentCapture(
  parsed: CapturedUtm,
  storage: UtmStorage,
  cookies: UtmCookieJar | undefined,
): CapturedUtm {
  const clean = scrubCaptured(parsed);
  if (clean.referrer === parsed.referrer && clean.landing_page === parsed.landing_page) return clean;
  try {
    remember(clean, storage, parsed.capturedAt, cookies);
  } catch {
    // The in-memory value is already reduced. A failed rewrite must not throw.
  }
  return clean;
}

export function readCapturedUtm(
  storage: UtmStorage = defaultStorage(),
  now: number = Date.now(),
  cookies?: UtmCookieJar,
): CapturedUtm | null {
  try {
    const stored = parseStored(storage.getItem(UTM_STORAGE_KEY), now);
    if (stored) return presentCapture(stored, storage, cookies ?? defaultCookies());
  } catch {
    // Fall through to the cookie.
  }
  try {
    const jar = cookies ?? defaultCookies();
    const stored = parseStored(jar?.get() ?? null, now);
    if (!stored) return null;
    return presentCapture(stored, storage, jar);
  } catch {
    return null;
  }
}

export function clearCapturedUtm(
  storage: UtmStorage = defaultStorage(),
  cookies?: UtmCookieJar,
): void {
  try {
    storage.removeItem(UTM_STORAGE_KEY);
  } catch {
    // Nothing to do.
  }
  try {
    (cookies ?? defaultCookies())?.clear();
  } catch {
    // Cookie jar unavailable.
  }
}

/** Arguments for public.save_signup_attribution. Raw values, capped. Labels only — never a user agent. */
export function signupAttributionArgs(
  captured: CapturedUtm | null,
  now: number = Date.now(),
  signals?: ChannelSignals,
): SignupAttributionArgs {
  const fields: CapturedUtm = captured ?? {
    utm_source: null,
    utm_medium: null,
    utm_campaign: null,
    utm_term: null,
    utm_content: null,
    referrer: null,
    landing_page: null,
    gclid: null,
    fbclid: null,
    ttclid: null,
    channel: null,
    channel_source: null,
    detected_via: null,
    capturedAt: now,
  };
  const classified = fields.channel && fields.detected_via
    ? {
      channel: fields.channel,
      channel_source: fields.channel_source,
      detected_via: fields.detected_via,
    }
    : classifyChannel({ ...fields, ...runtimeSignals(signals) });
  return {
    p_utm_source: cap(fields.utm_source, 500),
    p_utm_medium: cap(fields.utm_medium, 500),
    p_utm_campaign: cap(fields.utm_campaign, 500),
    p_utm_term: cap(fields.utm_term, 500),
    p_utm_content: cap(fields.utm_content, 500),
    p_referrer: referrerDomain(fields.referrer),
    p_landing_page: sanitizeLandingPath(fields.landing_page),
    p_captured_at: new Date(fields.capturedAt ?? now).toISOString(),
    p_channel: cap(classified.channel, 64),
    p_channel_source: cap(classified.channel_source, 120),
    p_detected_via: cap(classified.detected_via, 32),
    p_gclid: cap(fields.gclid ?? null, 200),
    p_fbclid: cap(fields.fbclid ?? null, 200),
    p_ttclid: cap(fields.ttclid ?? null, 200),
  };
}

function textOrNull(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** Narrow an API payload. Null when this signup has no attribution row. */
export function parseStoredAttribution(raw: unknown): StoredSignupAttribution | null {
  if (!raw || typeof raw !== "object") return null;
  const source = raw as Record<string, unknown>;
  if (!("utm_source" in source) && !("utm_source_raw" in source)) return null;
  return {
    utm_source_raw: textOrNull(source.utm_source_raw),
    utm_source: textOrNull(source.utm_source) ?? "direct",
    utm_medium_raw: textOrNull(source.utm_medium_raw),
    utm_medium: textOrNull(source.utm_medium),
    utm_campaign_raw: textOrNull(source.utm_campaign_raw),
    utm_campaign: textOrNull(source.utm_campaign),
    utm_term_raw: textOrNull(source.utm_term_raw),
    utm_term: textOrNull(source.utm_term),
    utm_content_raw: textOrNull(source.utm_content_raw),
    utm_content: textOrNull(source.utm_content),
    referrer: textOrNull(source.referrer),
    landing_page: textOrNull(source.landing_page),
    channel: textOrNull(source.channel),
    channel_source: textOrNull(source.channel_source),
    detected_via: textOrNull(source.detected_via),
    gclid: textOrNull(source.gclid),
    fbclid: textOrNull(source.fbclid),
    ttclid: textOrNull(source.ttclid),
  };
}

/** Stored channel, or a fresh classification that refuses to call a referred visit direct. */
function detectedForRow(row: StoredSignupAttribution): ChannelClassification {
  if (row.channel) {
    return {
      channel: row.channel,
      channel_source: row.channel_source,
      detected_via: (row.detected_via as DetectedVia | null) ?? "direct",
    };
  }
  return classifyChannel({
    utm_source: row.utm_source_raw ?? (row.utm_source !== "direct" ? row.utm_source : null),
    utm_medium: row.utm_medium,
    utm_campaign: row.utm_campaign,
    utm_term: row.utm_term,
    utm_content: row.utm_content,
    referrer: row.referrer,
    gclid: row.gclid,
    fbclid: row.fbclid,
    ttclid: row.ttclid,
  });
}

/** Badge text. A stored or inferred channel wins over a bare "direct" when a referrer exists. */
export function summariseUtm(raw: unknown): { primary: string } | null {
  const row = parseStoredAttribution(raw);
  if (!row) return null;
  const detected = detectedForRow(row);
  if (row.channel || (row.utm_source === "direct" && !row.utm_source_raw && detected.channel !== "direct")) {
    return { primary: channelLabel(detected.channel) };
  }
  return { primary: row.utm_medium ? `${row.utm_source} / ${row.utm_medium}` : row.utm_source };
}

export interface UtmDetailLine {
  label: string;
  value: string;
}

/** Popover lines. A raw line is included only when it differs from the normalized value. */
export function describeUtm(raw: unknown): UtmDetailLine[] {
  const row = parseStoredAttribution(raw);
  if (!row) return [];
  const detected = detectedForRow(row);
  const lines: UtmDetailLine[] = [
    { label: "Detected", value: channelLabel(detected.channel) },
    { label: "Detected via", value: DETECTED_VIA_LABELS[detected.detected_via] ?? detected.detected_via },
  ];
  if (detected.channel_source && detected.channel_source !== detected.channel) {
    lines.push({ label: "Matched", value: detected.channel_source });
  }
  lines.push({ label: "Source", value: row.utm_source });
  if (row.utm_source_raw && row.utm_source_raw !== row.utm_source) {
    lines.push({ label: "Source as received", value: row.utm_source_raw });
  }
  const pairs: Array<[string, string | null, string | null]> = [
    ["Medium", row.utm_medium, row.utm_medium_raw],
    ["Campaign", row.utm_campaign, row.utm_campaign_raw],
    ["Term", row.utm_term, row.utm_term_raw],
    ["Content", row.utm_content, row.utm_content_raw],
  ];
  for (const [label, normalized, received] of pairs) {
    if (!normalized && !received) continue;
    if (normalized) lines.push({ label, value: normalized });
    if (received && received !== normalized) {
      lines.push({ label: `${label} as received`, value: received });
    }
  }
  if (row.referrer) lines.push({ label: "Referrer", value: row.referrer });
  if (row.landing_page) lines.push({ label: "Landing page", value: row.landing_page });
  if (row.ttclid) lines.push({ label: "ttclid", value: row.ttclid });
  if (row.fbclid) lines.push({ label: "fbclid", value: row.fbclid });
  if (row.gclid) lines.push({ label: "gclid", value: row.gclid });
  return lines;
}

/** True when save_signup_attribution accepted the call. An error keeps the
 * capture so the next signed-in page can retry. A skipped insert (account
 * already had a row, or the landing was too late) still counts: the database
 * did not ask for another try. */
export function attributionSaveSucceeded(error: { message?: string } | null | undefined): boolean {
  return error == null;
}

export function countWithAttribution(rows: Array<{ attribution?: unknown }>): number {
  return rows.reduce((count, row) => (parseStoredAttribution(row.attribution) ? count + 1 : count), 0);
}
