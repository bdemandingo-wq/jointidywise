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
 *   the landing path, with no origin, query string, or hash
 *   the referrer's domain, with no path or query
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
    return {
      ...fields,
      referrer: typeof parsed.referrer === "string" && parsed.referrer.length > 0 ? parsed.referrer : null,
      landing_page: typeof parsed.landing_page === "string" ? parsed.landing_page : null,
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
): void {
  try {
    if (readCapturedUtm(storage, now, cookies)) return;

    const fromSearch = extractUtmFromSearch(loc.search);
    const hash = loc.hash ?? "";
    const hashQueryAt = hash.indexOf("?");
    const fromHash = hashQueryAt >= 0 ? extractUtmFromSearch(hash.slice(hashQueryAt)) : extractUtmFromSearch("");
    const fields: Pick<CapturedUtm, UtmParamKey> = { ...fromSearch };
    for (const key of UTM_PARAM_KEYS) {
      if (fields[key] == null) fields[key] = fromHash[key];
    }

    const route = hashRoutePath(hash) ?? loc.pathname ?? "/";
    if (!hasAnyUtm(fields) && !shouldCaptureLanding(route)) return;

    const capture: CapturedUtm = {
      ...fields,
      referrer: referrerDomain(referrer),
      landing_page: landingFromLocation(loc),
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

/** Arguments for public.save_signup_attribution. Raw values, capped. */
export function signupAttributionArgs(captured: CapturedUtm | null, now: number = Date.now()): SignupAttributionArgs {
  const fields = captured ?? {
    utm_source: null,
    utm_medium: null,
    utm_campaign: null,
    utm_term: null,
    utm_content: null,
    referrer: null,
    landing_page: null,
    capturedAt: now,
  };
  return {
    p_utm_source: cap(fields.utm_source, 500),
    p_utm_medium: cap(fields.utm_medium, 500),
    p_utm_campaign: cap(fields.utm_campaign, 500),
    p_utm_term: cap(fields.utm_term, 500),
    p_utm_content: cap(fields.utm_content, 500),
    p_referrer: referrerDomain(fields.referrer),
    p_landing_page: sanitizeLandingPath(fields.landing_page),
    p_captured_at: new Date(fields.capturedAt).toISOString(),
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
  };
}

/** Badge text. Normalized source, with medium when one was captured. */
export function summariseUtm(raw: unknown): { primary: string } | null {
  const row = parseStoredAttribution(raw);
  if (!row) return null;
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
  const lines: UtmDetailLine[] = [{ label: "Source", value: row.utm_source }];
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
