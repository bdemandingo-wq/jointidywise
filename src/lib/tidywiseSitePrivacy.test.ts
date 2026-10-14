// node --experimental-strip-types --test src/lib/tidywiseSitePrivacy.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  BANNER_BODY,
  DO_NOT_SELL_LABEL,
  PRIVACY_CHOICE_KEY,
  conversionPayload,
  isTagHostnameAllowed,
  isTidyWiseMarketingOrSignupPath,
  isTidyWiseTagSurface,
  optOutTagPlan,
  planMetaCommand,
  readGlobalPrivacyControl,
  readPrivacyChoice,
  sanitizeAdsId,
  sanitizeGa4Id,
  sanitizeMetaPixelId,
  shouldShowCookieNotice,
  tagHostOptionsFromEnv,
  tidyWiseConversionAllowed,
  tidyWiseTagDecision,
  writePrivacyChoice,
  type PrivacyStorage,
} from './tidywiseSitePrivacy.ts';

function memoryStorage(initial?: string): PrivacyStorage & { snapshot(): string | null } {
  let value = initial ?? null;
  return {
    getItem(key: string) {
      return key === PRIVACY_CHOICE_KEY ? value : null;
    },
    setItem(key: string, next: string) {
      if (key === PRIVACY_CHOICE_KEY) value = next;
    },
    snapshot() {
      return value;
    },
  };
}

test('banner copy and the opt-out label are the approved strings', () => {
  assert.equal(
    BANNER_BODY,
    'We use cookies and similar tools from Google and Meta to measure our site and show you relevant ads.',
  );
  assert.equal(DO_NOT_SELL_LABEL, 'Do Not Sell or Share My Personal Information');
});

test('marketing and signup paths are the only notice surface', () => {
  for (const path of [
    '/',
    '/signup',
    '/pricing',
    '/blog',
    '/blog/how-to-start-a-cleaning-business',
    '/compare/jobber',
    '/features/booking',
    '/cleaning-business-software',
    '/cleaning-business-software/texas',
    '/score/search',
    '/privacy-policy',
    '/do-not-sell',
    '/contact',
    '/demo',
    '/get-the-app',
  ]) {
    assert.equal(isTidyWiseMarketingOrSignupPath(path), true, path);
  }
});

test('booking, admin, cleaner portal, and auth paths are not the notice surface', () => {
  for (const path of [
    '/book/acme',
    '/book',
    '/tip/token',
    '/deposit/token',
    '/review/token',
    '/track/token',
    '/dashboard',
    '/dashboard/settings',
    '/admin',
    '/staff',
    '/staff/login',
    '/portal',
    '/portal/dashboard',
    '/login',
    '/auth',
    '/onboarding',
    '/choose-plan',
    '/billing/checkout',
  ]) {
    assert.equal(isTidyWiseMarketingOrSignupPath(path), false, path);
  }
});

test('native platform hides the banner and blocks tags even on the homepage', () => {
  assert.equal(shouldShowCookieNotice({ pathname: '/', native: true, choice: null, hostnameAllowed: true }), false);
  const tags = tidyWiseTagDecision({
    pathname: '/',
    native: true,
    choice: null,
    gpc: false,
    hostnameAllowed: true,
    metaId: '1234567890123',
    ga4Id: 'G-ABC1234',
    adsId: 'AW-123456',
  });
  assert.deepEqual(tags, { loadMeta: false, loadGa4: false, loadAds: false });
});

test('banner shows only until a choice is stored', () => {
  assert.equal(shouldShowCookieNotice({ pathname: '/signup', native: false, choice: null, hostnameAllowed: true }), true);
  assert.equal(shouldShowCookieNotice({ pathname: '/signup', native: false, choice: 'acknowledged', hostnameAllowed: true }), false);
  assert.equal(shouldShowCookieNotice({ pathname: '/signup', native: false, choice: 'opted_out', hostnameAllowed: true }), false);
  assert.equal(shouldShowCookieNotice({ pathname: '/book/acme', native: false, choice: null, hostnameAllowed: true }), false);
  assert.equal(shouldShowCookieNotice({ pathname: '/do-not-sell', native: false, choice: null, hostnameAllowed: true }), false);
  assert.equal(shouldShowCookieNotice({ pathname: '/terms', native: false, choice: null, hostnameAllowed: true }), false);
  assert.equal(shouldShowCookieNotice({ pathname: '/privacy-policy', native: false, choice: null, hostnameAllowed: true }), false);
  assert.equal(shouldShowCookieNotice({ pathname: '/feedback', native: false, choice: null, hostnameAllowed: true }), false);
  assert.equal(shouldShowCookieNotice({ pathname: '/', native: false, choice: null, hostnameAllowed: true, tourActive: true }), false);
  assert.equal(shouldShowCookieNotice({ pathname: '/', native: false, choice: null, hostnameAllowed: false }), false);
});

test('acknowledged allows tags, opted_out and Global Privacy Control block them', () => {
  const base = {
    pathname: '/signup',
    native: false,
    hostnameAllowed: true,
    metaId: '1234567890123',
    ga4Id: 'G-ABC1234',
    adsId: 'AW-123456',
  };
  assert.deepEqual(
    tidyWiseTagDecision({ ...base, choice: null, gpc: false }),
    { loadMeta: true, loadGa4: true, loadAds: true },
  );
  assert.deepEqual(
    tidyWiseTagDecision({ ...base, choice: 'acknowledged', gpc: false }),
    { loadMeta: true, loadGa4: true, loadAds: true },
  );
  assert.deepEqual(
    tidyWiseTagDecision({ ...base, choice: 'opted_out', gpc: false }),
    { loadMeta: false, loadGa4: false, loadAds: false },
  );
  assert.deepEqual(
    tidyWiseTagDecision({ ...base, choice: 'acknowledged', gpc: true }),
    { loadMeta: false, loadGa4: false, loadAds: false },
  );
  assert.equal(readGlobalPrivacyControl({ globalPrivacyControl: true }), true);
  assert.equal(readGlobalPrivacyControl({ globalPrivacyControl: false }), false);
  assert.equal(readGlobalPrivacyControl({}), false);
  assert.equal(readGlobalPrivacyControl(null), false);
});

test('unset or invalid tag ids load nothing', () => {
  assert.equal(sanitizeMetaPixelId(''), null);
  assert.equal(sanitizeMetaPixelId('not-a-pixel'), null);
  assert.equal(sanitizeMetaPixelId('1234567890123'), '1234567890123');
  assert.equal(sanitizeGa4Id(''), null);
  assert.equal(sanitizeGa4Id('UA-1234-1'), null);
  assert.equal(sanitizeGa4Id('AW-123456'), null);
  assert.equal(sanitizeGa4Id('G-ABC1234'), 'G-ABC1234');
  assert.equal(sanitizeAdsId(''), null);
  assert.equal(sanitizeAdsId('UA-1234-1'), null);
  assert.equal(sanitizeAdsId('G-ABC1234'), null);
  assert.equal(sanitizeAdsId('AW-123456'), 'AW-123456');
  assert.deepEqual(
    tidyWiseTagDecision({
      pathname: '/',
      native: false,
      choice: null,
      gpc: false,
      hostnameAllowed: true,
      metaId: null,
      ga4Id: null,
      adsId: null,
    }),
    { loadMeta: false, loadGa4: false, loadAds: false },
  );
});

test('booking pages and legal pages never load TidyWise tags', () => {
  for (const pathname of ['/book/acme', '/terms', '/privacy-policy', '/feedback']) {
    assert.equal(isTidyWiseTagSurface(pathname), false, pathname);
    assert.deepEqual(
      tidyWiseTagDecision({
        pathname,
        native: false,
        choice: null,
        gpc: false,
        hostnameAllowed: true,
        metaId: '1234567890123',
        ga4Id: 'G-ABC1234',
        adsId: 'AW-123456',
      }),
      { loadMeta: false, loadGa4: false, loadAds: false },
      pathname,
    );
  }
  assert.equal(isTidyWiseMarketingOrSignupPath('/terms'), true);
  assert.equal(isTidyWiseMarketingOrSignupPath('/feedback'), true);
});

test('production ignores extra tag hosts', () => {
  assert.equal(isTagHostnameAllowed('jointidywise.com', { production: true, extraHosts: ['localhost'] }), true);
  assert.equal(isTagHostnameAllowed('www.jointidywise.com', { production: true, extraHosts: [] }), true);
  assert.equal(isTagHostnameAllowed('localhost', { production: true, extraHosts: ['localhost'] }), false);
  assert.equal(isTagHostnameAllowed('evil.example', { production: false, extraHosts: ['localhost'] }), false);
  assert.equal(isTagHostnameAllowed('localhost', { production: false, extraHosts: ['localhost', '127.0.0.1'] }), true);
  assert.deepEqual(
    tagHostOptionsFromEnv({ PROD: true, VITE_TIDYWISE_TAG_TEST_HOSTS: 'localhost,127.0.0.1' }),
    { production: true, extraHosts: [] },
  );
  assert.deepEqual(
    tagHostOptionsFromEnv({ PROD: false, VITE_TIDYWISE_TAG_TEST_HOSTS: 'localhost, 127.0.0.1' }),
    { production: false, extraHosts: ['localhost', '127.0.0.1'] },
  );
});

test('trial_started is allowed on onboarding and the dashboard, signup_completed stays on signup', () => {
  const base = {
    native: false,
    choice: null as const,
    gpc: false,
    hostnameAllowed: true,
    hasDestination: true,
  };
  assert.equal(tidyWiseConversionAllowed({ ...base, event: 'trial_started', pathname: '/onboarding' }), true);
  assert.equal(tidyWiseConversionAllowed({ ...base, event: 'trial_started', pathname: '/dashboard' }), true);
  assert.equal(tidyWiseConversionAllowed({ ...base, event: 'trial_started', pathname: '/book/acme' }), false);
  assert.equal(tidyWiseConversionAllowed({ ...base, event: 'signup_completed', pathname: '/signup' }), true);
  assert.equal(tidyWiseConversionAllowed({ ...base, event: 'signup_completed', pathname: '/dashboard' }), false);
  assert.equal(tidyWiseConversionAllowed({ ...base, event: 'trial_started', pathname: '/onboarding', gpc: true }), false);
  assert.equal(tidyWiseConversionAllowed({ ...base, event: 'signup_completed', pathname: '/signup', choice: 'opted_out' }), false);
});

test('acknowledged and opted_out persist as distinct values', () => {
  const storage = memoryStorage();
  assert.equal(readPrivacyChoice(storage), null);
  writePrivacyChoice(storage, 'acknowledged');
  assert.equal(readPrivacyChoice(storage), 'acknowledged');
  assert.equal(storage.snapshot(), 'acknowledged');
  writePrivacyChoice(storage, 'opted_out');
  assert.equal(readPrivacyChoice(storage), 'opted_out');
  assert.notEqual(storage.snapshot(), 'acknowledged');
  const junk = memoryStorage('yes');
  assert.equal(readPrivacyChoice(junk), null);
});

test('org broadcast track is not sent to the TidyWise pixel once other pixels are known', () => {
  assert.deepEqual(
    planMetaCommand({
      command: 'track',
      pixelId: null,
      ourId: '1111111111',
      ourAllowed: true,
      otherIds: ['2222222222'],
    }),
    { action: 'fanout', pixelIds: ['2222222222'] },
  );
  assert.deepEqual(
    planMetaCommand({
      command: 'trackSingle',
      pixelId: '1111111111',
      ourId: '1111111111',
      ourAllowed: false,
      otherIds: ['2222222222'],
    }),
    { action: 'drop' },
  );
  assert.deepEqual(
    planMetaCommand({
      command: 'track',
      pixelId: null,
      ourId: null,
      ourAllowed: false,
      otherIds: [],
    }),
    { action: 'passthrough' },
  );
});

test('conversion names stay on the TidyWise tags', () => {
  assert.deepEqual(conversionPayload('signup_completed'), { meta: 'CompleteRegistration', ga: 'sign_up' });
  assert.deepEqual(conversionPayload('trial_started'), { meta: 'StartTrial', ga: 'trial_started' });
});

test('the notice layout rules keep a 44px target, safe area, and page clearance', () => {
  const css = readFileSync(new URL('../index.css', import.meta.url), 'utf8');
  assert.match(css, /\.tw-cookie-notice\s*\{[^}]*position:\s*fixed/s);
  assert.match(css, /\.tw-cookie-notice\s*\{[^}]*background:\s*#fff/s);
  assert.match(css, /\.tw-cookie-notice\s*\{[^}]*border-top:\s*1px solid/s);
  assert.match(css, /env\(safe-area-inset-bottom,\s*0px\)/);
  assert.match(css, /\.tw-cookie-notice__copy\s*\{[^}]*font-size:\s*14px/s);
  assert.match(css, /\.tw-cookie-notice__link\s*\{[^}]*text-decoration:\s*underline/s);
  assert.match(css, /\.tw-cookie-notice__link\s*\{[^}]*min-height:\s*44px/s);
  assert.match(css, /\.tw-cookie-notice__ok\s*\{[^}]*min-height:\s*44px/s);
  assert.match(css, /@media \(max-width:\s*399px\)/);
  assert.match(css, /html\.tw-cookie-notice-open #root\s*\{[^}]*padding-bottom:\s*var\(--tw-cookie-bar-height/s);
});

test('opting out mid-session revokes consent and drops later tracks', () => {
  const plan = optOutTagPlan();
  assert.deepEqual(plan.metaConsent, ['consent', 'revoke']);
  assert.equal(plan.googleConsentUpdate.ad_storage, 'denied');
  assert.equal(plan.googleConsentUpdate.ad_user_data, 'denied');
  assert.equal(plan.googleConsentUpdate.ad_personalization, 'denied');
  assert.deepEqual(plan.clearCookieNames, ['_fbp', '_fbc', '_ga', '_gcl_']);
  assert.equal(plan.reloadWhenStored, true);
  assert.deepEqual(
    planMetaCommand({
      command: 'track',
      pixelId: null,
      ourId: '1111111111',
      ourAllowed: false,
      otherIds: ['2222222222'],
      revoked: true,
    }),
    { action: 'drop' },
  );
  assert.deepEqual(
    planMetaCommand({
      command: 'trackSingle',
      pixelId: '1111111111',
      ourId: '1111111111',
      ourAllowed: false,
      otherIds: ['2222222222'],
      revoked: true,
    }),
    { action: 'drop' },
  );
  assert.deepEqual(
    planMetaCommand({
      command: 'trackSingle',
      pixelId: '2222222222',
      ourId: '1111111111',
      ourAllowed: false,
      otherIds: ['2222222222'],
      revoked: true,
    }),
    { action: 'passthrough' },
  );
  const tags = readFileSync(new URL('./tidywiseTags.ts', import.meta.url), 'utf8');
  assert.match(tags, /fbqFn\(\)\?\.\(\.\.\.plan\.metaConsent\)/);
  assert.match(tags, /consent', 'default'/);
  assert.match(tags, /ga-disable-/);
});

test('the banner has no close X and the footer keeps the opt-out link', () => {
  const notice = readFileSync(new URL('../components/TidyWiseCookieNotice.tsx', import.meta.url), 'utf8');
  const footer = readFileSync(new URL('../components/SiteFooter.tsx', import.meta.url), 'utf8');
  const pixels = readFileSync(new URL('../components/TrackingPixels.tsx', import.meta.url), 'utf8');
  const tags = readFileSync(new URL('./tidywiseTags.ts', import.meta.url), 'utf8');
  const site = readFileSync(new URL('../components/TidyWiseSitePrivacy.tsx', import.meta.url), 'utf8');
  assert.match(notice, /BANNER_BODY/);
  assert.match(notice, /OK/);
  assert.equal(notice.includes('aria-label="Close"'), false);
  assert.equal(notice.includes('✕'), false);
  assert.match(notice, /metaKey/);
  assert.match(footer, /DoNotSellShareLink/);
  assert.equal(pixels.includes('VITE_TIDYWISE'), false);
  assert.match(tags, /send_to/);
  assert.match(tags, /trackSingle/);
  assert.equal(site.includes('createPortal'), false);
  assert.equal(site.includes('MutationObserver'), false);
});
