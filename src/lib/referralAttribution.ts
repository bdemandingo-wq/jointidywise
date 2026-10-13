/**
 * Referral attribution capture.
 *
 * A referral link is `https://jointidywise.com/?ref=ABC23456`. The code has to
 * survive the whole journey from that landing to the moment an organization
 * row exists, which is when the server can finally be asked to record who
 * referred whom. That gap is why this holds the code in storage rather than
 * passing it through the signup form.
 *
 * THE CLIENT NEVER RECORDS ATTRIBUTION. It only carries the code. The decision
 * about which org gets credit, whether the pair is a self-referral, and what
 * status the referral takes is made server-side by the `claim-referral` edge
 * function on the service role — because `organizations`' INSERT policy is
 * `(auth.uid() = owner_id)` with no column enumeration, so anything a client
 * can write, a client can forge.
 *
 * Storage is injected so the rules are testable without a DOM. Production
 * passes nothing and gets localStorage.
 */

import { normalizeReferralCode } from './referralCode.ts';

/** The slice of the Storage API this needs. */
export interface ReferralStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const KEY = 'tw-referral-code';

/** First-party cookie. Same 30-day window as the localStorage capture. */
export const REFERRAL_COOKIE_NAME = 'tw_ref';
export const REFERRAL_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const REFERRAL_TTL_SECONDS = 30 * 24 * 60 * 60;

export interface ReferralCookieJar {
  get(): string | null;
  set(code: string): void;
  clear(): void;
}

interface StoredReferral {
  code: string;
  expiresAt: number;
}

/**
 * localStorage when it exists, and a no-op otherwise so this module is safe to
 * import during SSR, in tests, and in any context without a window.
 */
function defaultStorage(): ReferralStorage {
  if (typeof localStorage !== 'undefined') return localStorage;
  return {
    getItem: () => null,
    setItem: () => undefined,
    removeItem: () => undefined,
  };
}

/**
 * Pull `ref` out of a query string and normalise it. Accepts the string with
 * or without its leading `?`. Returns null when there is nothing usable, so a
 * malformed code is indistinguishable from no code — both mean "no referral".
 */
export function extractReferralFromSearch(search: string): string | null {
  const qs = search.startsWith('?') ? search.slice(1) : search;
  return normalizeReferralCode(new URLSearchParams(qs).get('ref'));
}

/** Pull a code out of `/r/CODE`, including a hash-router path. */
export function extractReferralFromPath(pathname: string): string | null {
  const match = pathname.match(/(?:^|\/)r\/([^/?#]+)/i);
  if (!match) return null;
  try {
    return normalizeReferralCode(decodeURIComponent(match[1]));
  } catch {
    return normalizeReferralCode(match[1]);
  }
}

function defaultCookies(): ReferralCookieJar | undefined {
  if (typeof document === 'undefined') return undefined;
  return {
    get: () => {
      const prefix = `${REFERRAL_COOKIE_NAME}=`;
      const part = document.cookie.split('; ').find((item) => item.startsWith(prefix));
      if (!part) return null;
      try {
        return decodeURIComponent(part.slice(prefix.length));
      } catch {
        return null;
      }
    },
    set: (code: string) => {
      const secure = typeof location !== 'undefined' && location.protocol === 'https:';
      const parts = [
        `${REFERRAL_COOKIE_NAME}=${encodeURIComponent(code)}`,
        'Path=/',
        `Max-Age=${REFERRAL_TTL_SECONDS}`,
        'SameSite=Lax',
      ];
      if (secure) parts.push('Secure');
      document.cookie = parts.join('; ');
    },
    clear: () => {
      document.cookie = `${REFERRAL_COOKIE_NAME}=; Path=/; Max-Age=0; SameSite=Lax`;
    },
  };
}

function decodeStored(raw: string | null, now: number): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed) as Partial<StoredReferral>;
      if (typeof parsed.expiresAt === 'number' && parsed.expiresAt < now) return null;
      return normalizeReferralCode(typeof parsed.code === 'string' ? parsed.code : null);
    } catch {
      return null;
    }
  }
  // Plain strings are the previous capture format. They have no expiry of
  // their own; new captures always store an expiresAt.
  return normalizeReferralCode(trimmed);
}

function remember(
  code: string,
  storage: ReferralStorage,
  now: number,
  cookies?: ReferralCookieJar,
): void {
  const payload = JSON.stringify({ code, expiresAt: now + REFERRAL_TTL_MS } satisfies StoredReferral);
  storage.setItem(KEY, payload);
  try {
    (cookies ?? defaultCookies())?.set(code);
  } catch {
    // Cookie rejected. localStorage still holds the code.
  }
}

/**
 * Record the code from a landing URL. FIRST TOUCH WINS: an existing capture is
 * never overwritten, so someone who clicks A's link, browses, then arrives via
 * B's link before signing up is still attributed to A.
 *
 * Never throws. Safari in private browsing throws on setItem, and losing an
 * attribution is a support ticket where taking down the landing page is not.
 */
export function captureReferralFromUrl(
  search: string,
  storage: ReferralStorage = defaultStorage(),
  now: number = Date.now(),
  cookies?: ReferralCookieJar,
): void {
  captureReferralCode(extractReferralFromSearch(search), storage, now, cookies);
}

export function captureReferralFromPath(
  pathname: string,
  storage: ReferralStorage = defaultStorage(),
  now: number = Date.now(),
  cookies?: ReferralCookieJar,
): void {
  captureReferralCode(extractReferralFromPath(pathname), storage, now, cookies);
}

/**
 * Capture from a browser location, including HashRouter (`#/r/CODE` and
 * `#/signup?ref=`). First touch still wins across the search, the path, and
 * the hash.
 */
export function captureReferralFromLocation(
  loc: { search: string; pathname: string; hash?: string },
  storage: ReferralStorage = defaultStorage(),
  now: number = Date.now(),
  cookies?: ReferralCookieJar,
): void {
  captureReferralFromUrl(loc.search, storage, now, cookies);
  captureReferralFromPath(loc.pathname, storage, now, cookies);
  const hash = loc.hash ?? '';
  if (hash.length <= 1) return;
  const raw = hash.startsWith('#') ? hash.slice(1) : hash;
  const queryAt = raw.indexOf('?');
  const path = queryAt >= 0 ? raw.slice(0, queryAt) : raw;
  const search = queryAt >= 0 ? raw.slice(queryAt) : '';
  captureReferralFromPath(path, storage, now, cookies);
  if (search) captureReferralFromUrl(search, storage, now, cookies);
}

function captureReferralCode(
  code: string | null,
  storage: ReferralStorage,
  now: number,
  cookies?: ReferralCookieJar,
): void {
  if (!code) return;
  try {
    if (readCapturedReferral(storage, now, cookies)) return; // first touch wins
    remember(code, storage, now, cookies);
  } catch {
    // Storage unavailable or denied. No attribution, no crash.
  }
}

/**
 * Keep a referral code on an OAuth or email-confirmation redirect so the
 * round trip through Google (or Apple) does not drop it when storage is not
 * shared with the browser that comes back.
 */
export function appendReferralParam(url: string, code: string | null | undefined): string {
  const normalized = normalizeReferralCode(code);
  if (!normalized) return url;
  const hashAt = url.indexOf('#');
  const before = hashAt >= 0 ? url.slice(0, hashAt) : url;
  const hash = hashAt >= 0 ? url.slice(hashAt) : '';
  const sep = before.includes('?') ? '&' : '?';
  return `${before}${sep}ref=${encodeURIComponent(normalized)}${hash}`;
}

/**
 * The captured code, or null. Re-normalised on the way out because
 * localStorage is user-editable and a hand-edited value must not reach the
 * server as though it were a real code.
 */
export function readCapturedReferral(
  storage: ReferralStorage = defaultStorage(),
  now: number = Date.now(),
  cookies?: ReferralCookieJar,
): string | null {
  try {
    const stored = decodeStored(storage.getItem(KEY), now);
    if (stored) return stored;
  } catch {
    // Fall through to the cookie.
  }
  try {
    const jar = cookies ?? defaultCookies();
    return normalizeReferralCode(jar?.get() ?? null);
  } catch {
    return null;
  }
}

/**
 * Drop the capture. Call this once `claim-referral` has accepted (or finally
 * rejected) the code.
 *
 * Not housekeeping — correctness. Left in place, the same browser creating a
 * SECOND organization would attribute that one to the same referrer as well,
 * earning an extra free month per org from a single link click.
 */
export function clearCapturedReferral(
  storage: ReferralStorage = defaultStorage(),
  cookies?: ReferralCookieJar,
): void {
  try {
    storage.removeItem(KEY);
  } catch {
    // Nothing to do; a stale capture is bounded by referral_signups'
    // UNIQUE constraint on referred_org_id server-side.
  }
  try {
    (cookies ?? defaultCookies())?.clear();
  } catch {
    // Cookie jar unavailable. The stored code is already gone.
  }
}
