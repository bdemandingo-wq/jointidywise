// Referral attribution capture: reading ?ref= off the landing URL and holding
// it until the org exists and the server can be asked to record it.
//
//   node --experimental-strip-types --test src/lib/referralAttribution.test.ts
//
// Storage is injected rather than reaching for localStorage directly, so the
// rules are testable without a DOM. The production default is localStorage.
//
// THE CONTROLS. Most assertions here are about a code being IGNORED — absent,
// malformed, already captured. A capture function that stored nothing would
// pass all of them and attribution would silently never happen, which looks
// exactly like "nobody used a referral link":
//
//   1. "a real code is captured and readable"  — proves capture works at all
//   2. "a different code stays distinct"        — proves it stores the actual
//      value rather than a constant
//
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  extractReferralFromSearch,
  extractReferralFromPath,
  captureReferralFromUrl,
  captureReferralFromPath,
  captureReferralFromLocation,
  readCapturedReferral,
  clearCapturedReferral,
  appendReferralParam,
  REFERRAL_TTL_MS,
  type ReferralStorage,
  type ReferralCookieJar,
} from './referralAttribution.ts';

/** In-memory stand-in for localStorage. */
function memoryStorage(seed: Record<string, string> = {}): ReferralStorage {
  const map = new Map(Object.entries(seed));
  return {
    getItem: (k) => (map.has(k) ? (map.get(k) as string) : null),
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}

// ─── extraction ─────────────────────────────────────────────────────────────

test('a code is pulled out of the query string and normalised', () => {
  assert.equal(extractReferralFromSearch('?ref=ABC23456'), 'ABC23456');
  assert.equal(extractReferralFromSearch('?ref=abc23456'), 'ABC23456');
  assert.equal(extractReferralFromSearch('?ref=abc-234-56'), 'ABC23456');
  assert.equal(extractReferralFromSearch('?utm_source=fb&ref=ABC23456&x=1'), 'ABC23456');
});

test('a missing or unusable ref yields nothing', () => {
  for (const s of ['', '?', '?utm_source=fb', '?ref=', '?ref=---', '?ref=%20%20']) {
    assert.equal(extractReferralFromSearch(s), null, `${JSON.stringify(s)} should yield null`);
  }
});

test('a leading ? is optional', () => {
  assert.equal(extractReferralFromSearch('ref=ABC23456'), 'ABC23456');
});

// ─── capture ────────────────────────────────────────────────────────────────

test('CONTROL: a real code is captured and readable', () => {
  // Without this, a capture that stored nothing passes every "ignored" test
  // below and attribution silently never happens.
  const s = memoryStorage();
  captureReferralFromUrl('?ref=ABC23456', s);
  assert.equal(readCapturedReferral(s), 'ABC23456');
});

test('CONTROL: a different code stays distinct', () => {
  const a = memoryStorage();
  const b = memoryStorage();
  captureReferralFromUrl('?ref=ABC23456', a);
  captureReferralFromUrl('?ref=XYZ98765', b);
  assert.notEqual(readCapturedReferral(a), readCapturedReferral(b));
});

test('first touch wins — a later link does not overwrite the first', () => {
  // The attribution rule. Someone who clicks A's link, browses, then clicks
  // B's link before signing up is still A's referral.
  const s = memoryStorage();
  captureReferralFromUrl('?ref=FIRSTAAA', s);
  captureReferralFromUrl('?ref=SECONDBB', s);
  assert.equal(readCapturedReferral(s), 'FIRSTAAA');
});

test('a landing with no ref does not disturb an existing capture', () => {
  const s = memoryStorage();
  captureReferralFromUrl('?ref=ABC23456', s);
  captureReferralFromUrl('?utm_source=newsletter', s);
  assert.equal(readCapturedReferral(s), 'ABC23456');
});

test('capturing nothing leaves nothing to read', () => {
  const s = memoryStorage();
  captureReferralFromUrl('?utm_source=fb', s);
  assert.equal(readCapturedReferral(s), null);
});

// ─── clearing ───────────────────────────────────────────────────────────────

test('clearing removes the capture', () => {
  // Called after a successful claim. Without it the same browser signing up a
  // SECOND org would attribute that one to the same referrer too — a free
  // extra month per org, from one link click.
  const s = memoryStorage();
  captureReferralFromUrl('?ref=ABC23456', s);
  clearCapturedReferral(s);
  assert.equal(readCapturedReferral(s), null);
});

test('clearing an empty store is not an error', () => {
  const s = memoryStorage();
  clearCapturedReferral(s);
  assert.equal(readCapturedReferral(s), null);
});

// ─── robustness ─────────────────────────────────────────────────────────────

test('a stored value that is no longer valid reads as nothing', () => {
  // localStorage is user-editable. A hand-edited or corrupted value must not
  // reach the server as a code.
  const s = memoryStorage({ 'tw-referral-code': '!!!' });
  assert.equal(readCapturedReferral(s), null);
});

test('a stored value is normalised on the way out too', () => {
  const s = memoryStorage({ 'tw-referral-code': 'abc-234-56' });
  assert.equal(readCapturedReferral(s), 'ABC23456');
});

test('a capture expires after 30 days and a later link can take its place', () => {
  const s = memoryStorage();
  const start = Date.parse('2026-01-01T00:00:00.000Z');
  captureReferralFromUrl('?ref=FIRSTAAA', s, start);
  assert.equal(readCapturedReferral(s, start + REFERRAL_TTL_MS), 'FIRSTAAA');
  assert.equal(readCapturedReferral(s, start + REFERRAL_TTL_MS + 1), null);
  captureReferralFromUrl('?ref=SECONDBB', s, start + REFERRAL_TTL_MS + 1);
  assert.equal(readCapturedReferral(s, start + REFERRAL_TTL_MS + 1), 'SECONDBB');
});

test('/r/CODE is captured, including from a hash route', () => {
  assert.equal(extractReferralFromPath('/r/abc23456'), 'ABC23456');
  const s = memoryStorage();
  captureReferralFromPath('/r/ABC23456', s);
  assert.equal(readCapturedReferral(s), 'ABC23456');
  const hashed = memoryStorage();
  captureReferralFromLocation({ search: '', pathname: '/', hash: '#/r/XYZ98765' }, hashed);
  assert.equal(readCapturedReferral(hashed), 'XYZ98765');
});

test('the code is also written to the cookie and read back from it', () => {
  let cookie: string | null = null;
  const jar: ReferralCookieJar = {
    get: () => cookie,
    set: (code) => { cookie = code; },
    clear: () => { cookie = null; },
  };
  const s = memoryStorage();
  captureReferralFromUrl('?ref=ABC23456', s, Date.now(), jar);
  assert.equal(cookie, 'ABC23456');
  const empty = memoryStorage();
  assert.equal(readCapturedReferral(empty, Date.now(), jar), 'ABC23456');
  clearCapturedReferral(s, jar);
  assert.equal(cookie, null);
});

test('oauth and email redirects keep the ref on the URL', () => {
  assert.equal(
    appendReferralParam('https://jointidywise.com/', 'abc23456'),
    'https://jointidywise.com/?ref=ABC23456',
  );
  assert.equal(
    appendReferralParam('com.TidyWiseApp.app://auth/callback', 'ABC23456'),
    'com.TidyWiseApp.app://auth/callback?ref=ABC23456',
  );
  assert.equal(appendReferralParam('https://jointidywise.com/signup', null), 'https://jointidywise.com/signup');
});

test('storage that throws does not take the page down', () => {
  // Safari private browsing throws on setItem. Losing attribution is a
  // support ticket; throwing here would break the landing page.
  const throwing: ReferralStorage = {
    getItem: () => { throw new Error('denied'); },
    setItem: () => { throw new Error('denied'); },
    removeItem: () => { throw new Error('denied'); },
  };
  assert.doesNotThrow(() => captureReferralFromUrl('?ref=ABC23456', throwing));
  assert.equal(readCapturedReferral(throwing), null);
  assert.doesNotThrow(() => clearCapturedReferral(throwing));
});
