import { Capacitor } from '@capacitor/core';
import { loadPrivacyChoice } from './tidywisePrivacyStore';
import {
  conversionPayload,
  cookieMatchesOptOutClear,
  googleAdsConsent,
  isTagHostnameAllowed,
  optOutTagPlan,
  planMetaCommand,
  readGlobalPrivacyControl,
  sanitizeAdsId,
  sanitizeGa4Id,
  sanitizeMetaPixelId,
  tagHostOptionsFromEnv,
  tidyWiseConversionAllowed,
  tidyWiseTagDecision,
  type TidyWiseConversion,
} from './tidywiseSitePrivacy';

/**
 * TidyWise-owned Meta Pixel, GA4, and Google Ads tags.
 *
 * Loaded only when tidyWiseTagDecision says so. Org pixels stay on
 * window.fbq / window.gtag. Opt-out calls fbq('consent','revoke') and a
 * gtag consent update, then reloads when the choice was stored so scripts
 * already running are gone.
 *
 * Meta: once our pixel id is initialized, broadcast track() calls are
 * rewritten to trackSingle for the other pixel ids only. After revoke,
 * broadcast track() is dropped until the reload.
 * Google: consent defaults are set before config. Hits to our ids are
 * also stopped with ga-disable-ID. Our events use send_to so they do not
 * land on an org property.
 */

const FIRED_KEY = 'tw-tidywise-conversion-fired';
const META_MARKER_ID = 'tw-owned-meta';
const GA_MARKER_ID = 'tw-owned-ga';

type FbqFn = (...args: unknown[]) => void;

interface TestIds {
  metaId?: string;
  ga4Id?: string;
  adsId?: string;
}

const metaGate = {
  ourId: null as string | null,
  allowed: false,
  revoked: false,
  inited: false,
  guardInstalled: false,
  others: new Set<string>(),
};

const gaGate = {
  ids: [] as string[],
  allowed: false,
};

let lastTrackedPath: string | null = null;
const firedMemory = new Set<string>();

function browserNavigator(): { globalPrivacyControl?: boolean } | null {
  if (typeof navigator === 'undefined') return null;
  return navigator as Navigator & { globalPrivacyControl?: boolean };
}

export function detectNativePlatform(): boolean {
  try {
    if (Capacitor.isNativePlatform()) return true;
  } catch {
    // The web bundle can load without the native bridge.
  }
  try {
    const cap = (window as Window & {
      Capacitor?: { isNativePlatform?: () => boolean };
    }).Capacitor;
    return cap?.isNativePlatform?.() === true;
  } catch {
    return false;
  }
}

function readEnvId(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function readTestIds(): TestIds | null {
  if (import.meta.env.PROD) return null;
  if (typeof window === 'undefined') return null;
  const injected = (window as Window & { __TW_TIDYWISE_TEST_IDS?: TestIds }).__TW_TIDYWISE_TEST_IDS;
  if (!injected || typeof injected !== 'object') return null;
  return injected;
}

export function tidyWiseIdsFromEnv(): { metaId: string | null; ga4Id: string | null; adsId: string | null } {
  const fromEnv = {
    metaId: sanitizeMetaPixelId(readEnvId(import.meta.env.VITE_TIDYWISE_META_PIXEL_ID)),
    ga4Id: sanitizeGa4Id(readEnvId(import.meta.env.VITE_TIDYWISE_GA4_ID)),
    adsId: sanitizeAdsId(readEnvId(import.meta.env.VITE_TIDYWISE_GOOGLE_ADS_ID)),
  };
  const test = readTestIds();
  if (!test) return fromEnv;
  return {
    metaId: sanitizeMetaPixelId(test.metaId) ?? fromEnv.metaId,
    ga4Id: sanitizeGa4Id(test.ga4Id) ?? fromEnv.ga4Id,
    adsId: sanitizeAdsId(test.adsId) ?? fromEnv.adsId,
  };
}

function hostAllowed(): boolean {
  if (typeof window === 'undefined') return false;
  const options = tagHostOptionsFromEnv({
    PROD: import.meta.env.PROD === true,
    VITE_TIDYWISE_TAG_TEST_HOSTS: import.meta.env.VITE_TIDYWISE_TAG_TEST_HOSTS,
  });
  return isTagHostnameAllowed(window.location.hostname, options);
}

function currentDecision(pathname: string) {
  const ids = tidyWiseIdsFromEnv();
  const decision = tidyWiseTagDecision({
    pathname,
    native: detectNativePlatform(),
    choice: loadPrivacyChoice(),
    gpc: readGlobalPrivacyControl(browserNavigator()),
    hostnameAllowed: hostAllowed(),
    metaId: ids.metaId,
    ga4Id: ids.ga4Id,
    adsId: ids.adsId,
  });
  return { ...decision, ...ids, pathname };
}

function fbqFn(): FbqFn | null {
  const fbq = window.fbq;
  return typeof fbq === 'function' ? (fbq as FbqFn) : null;
}

function rememberOtherPixels(fbq: FbqFn): void {
  const state = fbq as FbqFn & {
    instance?: { pixelsByID?: Record<string, unknown> };
  };
  const byId = state.instance?.pixelsByID;
  if (!byId || typeof byId !== 'object') return;
  for (const id of Object.keys(byId)) {
    if (id !== metaGate.ourId) metaGate.others.add(id);
  }
}

function installMetaGuard(): void {
  if (metaGate.guardInstalled) return;
  const current = fbqFn();
  if (!current) return;
  rememberOtherPixels(current);
  // Proxy so fbevents.js can still read and write queue / callMethod on the
  // original function. A plain wrapper would drop those properties and break
  // every pixel on the page, including an org pixel.
  const guarded = new Proxy(current, {
    apply(target, thisArg, argList: unknown[]) {
      const command = typeof argList[0] === 'string' ? argList[0] : '';
      const pixelId = typeof argList[1] === 'string' ? argList[1] : null;
      if (command === 'init' && pixelId && pixelId !== metaGate.ourId) {
        metaGate.others.add(pixelId);
      }
      if (command === 'track' || command === 'trackCustom') {
        rememberOtherPixels(target);
      }
      const plan = planMetaCommand({
        command,
        pixelId,
        ourId: metaGate.ourId,
        ourAllowed: metaGate.allowed,
        otherIds: [...metaGate.others],
        revoked: metaGate.revoked,
      });
      if (plan.action === 'drop') return undefined;
      if (plan.action === 'fanout') {
        const single = command === 'trackCustom' ? 'trackSingleCustom' : 'trackSingle';
        for (const id of plan.pixelIds) {
          Reflect.apply(target, thisArg, [single, id, ...argList.slice(1)]);
        }
        return undefined;
      }
      return Reflect.apply(target, thisArg, argList);
    },
  });
  window.fbq = guarded as Window['fbq'];
  metaGate.guardInstalled = true;
}

function ensureMetaSnippet(): void {
  if (document.getElementById(META_MARKER_ID) || window.fbq) return;
  const script = document.createElement('script');
  script.id = META_MARKER_ID;
  script.text = `
    !function(f,b,e,v,n,t,s)
    {if(f.fbq)return;n=f.fbq=function(){n.callMethod?
    n.callMethod.apply(n,arguments):n.queue.push(arguments)};
    if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
    n.queue=[];t=b.createElement(e);t.async=!0;
    t.src=v;s=b.getElementsByTagName(e)[0];
    s.parentNode.insertBefore(t,s)}(window, document,'script',
    'https://connect.facebook.net/en_US/fbevents.js');
  `;
  document.head.appendChild(script);
}

function setGaDisabled(id: string, disabled: boolean): void {
  (window as unknown as Record<string, unknown>)[`ga-disable-${id}`] = disabled;
}

function gtagFn(): FbqFn | null {
  const gtag = window.gtag;
  return typeof gtag === 'function' ? (gtag as FbqFn) : null;
}

function ensureGtagQueue(): FbqFn {
  const dataLayer = window.dataLayer ?? [];
  window.dataLayer = dataLayer;
  if (typeof window.gtag !== 'function') {
    // The Google snippet pushes the Arguments object. A rest array is not the same value.
    window.gtag = function gtag() {
      // eslint-disable-next-line prefer-rest-params
      dataLayer.push(arguments);
    };
  }
  return gtagFn() as FbqFn;
}

function ensureGaSnippet(ids: string[], granted: boolean): void {
  const consent = googleAdsConsent(granted);
  const gtag = ensureGtagQueue();
  if (!document.getElementById(GA_MARKER_ID)) {
    // Consent default is pushed before config so the tag cannot fire first.
    gtag('consent', 'default', consent);
    const primary = ids[0];
    const loader = document.createElement('script');
    loader.id = `${GA_MARKER_ID}-loader`;
    loader.async = true;
    loader.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(primary)}`;
    document.head.appendChild(loader);

    const inline = document.createElement('script');
    inline.id = GA_MARKER_ID;
    inline.text = `window.gtag('js', new Date());`;
    document.head.appendChild(inline);
  }
  for (const id of ids) {
    if (!gaGate.ids.includes(id)) gaGate.ids.push(id);
    setGaDisabled(id, !granted);
    gtag('config', id, { send_page_view: false });
  }
}

function metaMarker(): void {
  if (document.getElementById(META_MARKER_ID)) return;
  const marker = document.createElement('script');
  marker.id = META_MARKER_ID;
  marker.type = 'application/json';
  marker.text = '{}';
  document.head.appendChild(marker);
}

function activeGoogleIds(decision: { loadGa4: boolean; loadAds: boolean; ga4Id: string | null; adsId: string | null }): string[] {
  const ids: string[] = [];
  if (decision.loadGa4 && decision.ga4Id) ids.push(decision.ga4Id);
  if (decision.loadAds && decision.adsId) ids.push(decision.adsId);
  return ids;
}

function sendPageViews(pathname: string, metaId: string | null, googleIds: string[]): void {
  if (lastTrackedPath === pathname) return;
  lastTrackedPath = pathname;
  if (metaId && metaGate.allowed) {
    fbqFn()?.('trackSingle', metaId, 'PageView');
  }
  if (googleIds.length > 0 && gaGate.allowed) {
    const gtag = gtagFn();
    for (const id of googleIds) {
      gtag?.('event', 'page_view', {
        send_to: id,
        page_path: pathname,
        page_location: window.location.href,
        page_title: document.title,
      });
    }
  }
}

function loadAllowedTags(decision: ReturnType<typeof currentDecision>): void {
  if (decision.loadMeta && decision.metaId) {
    metaGate.ourId = decision.metaId;
    metaGate.allowed = true;
    metaGate.revoked = false;
    const fbqExisted = typeof window.fbq === 'function';
    ensureMetaSnippet();
    if (fbqExisted) metaMarker();
    installMetaGuard();
    if (!metaGate.inited) {
      const fbq = fbqFn();
      fbq?.('set', 'autoConfig', false, decision.metaId);
      fbq?.('init', decision.metaId);
      metaGate.inited = true;
    }
  }

  const googleIds = activeGoogleIds(decision);
  if (googleIds.length > 0) {
    gaGate.allowed = true;
    ensureGaSnippet(googleIds, true);
  }
}

export function syncTidyWiseTags(pathname: string): void {
  if (typeof document === 'undefined') return;
  const decision = currentDecision(pathname);

  if (decision.loadMeta && decision.metaId) {
    loadAllowedTags(decision);
  } else if (metaGate.ourId) {
    metaGate.allowed = false;
    fbqFn()?.('set', 'autoConfig', false, metaGate.ourId);
  }

  const googleIds = activeGoogleIds(decision);
  if (googleIds.length > 0) {
    loadAllowedTags(decision);
  } else if (gaGate.ids.length > 0) {
    gaGate.allowed = false;
    const gtag = gtagFn();
    for (const id of gaGate.ids) {
      setGaDisabled(id, true);
      gtag?.('config', id, {
        send_page_view: false,
        allow_google_signals: false,
        allow_ad_personalization_signals: false,
      });
    }
    gtag?.('consent', 'update', googleAdsConsent(false));
  }

  if (!decision.loadMeta && googleIds.length === 0) {
    lastTrackedPath = null;
    return;
  }

  sendPageViews(pathname, decision.loadMeta ? decision.metaId : null, googleIds);
}

function clearOptOutCookies(): void {
  let pairs: string[] = [];
  try {
    pairs = document.cookie.split(';');
  } catch {
    return;
  }
  const host = window.location.hostname;
  const domains = new Set<string>([host]);
  const parts = host.split('.');
  if (parts.length >= 2) domains.add(`.${parts.slice(-2).join('.')}`);
  for (const raw of pairs) {
    const name = raw.split('=')[0]?.trim();
    if (!name || !cookieMatchesOptOutClear(name)) continue;
    document.cookie = `${name}=; Max-Age=0; path=/`;
    for (const domain of domains) {
      document.cookie = `${name}=; Max-Age=0; path=/; domain=${domain}`;
    }
  }
}

/** Revoke Meta and Google consent for tags already on the page. Does not reload. */
export function revokeTidyWiseTags(): void {
  if (typeof window === 'undefined') return;
  const plan = optOutTagPlan();
  metaGate.allowed = false;
  metaGate.revoked = true;
  try {
    fbqFn()?.(...plan.metaConsent);
  } catch {
    // The pixel may not be on the page. The reload still drops it.
  }
  gaGate.allowed = false;
  const gtag = gtagFn();
  for (const id of gaGate.ids) setGaDisabled(id, true);
  try {
    gtag?.('consent', 'update', plan.googleConsentUpdate);
  } catch {
    // gtag was never loaded.
  }
  clearOptOutCookies();
  document.documentElement.dataset.twTagRevoked = 'true';
}

function firedKey(event: TidyWiseConversion, dedupeKey: string | undefined): string {
  return dedupeKey ? `${event}:${dedupeKey}` : event;
}

function alreadyFired(key: string): boolean {
  if (firedMemory.has(key)) return true;
  try {
    const raw = sessionStorage.getItem(FIRED_KEY);
    const list: unknown = raw ? JSON.parse(raw) : [];
    if (Array.isArray(list) && list.includes(key)) {
      firedMemory.add(key);
      return true;
    }
  } catch {
    // sessionStorage can be blocked. The in-memory set still dedupes this tab.
  }
  return false;
}

function markFired(key: string): void {
  firedMemory.add(key);
  try {
    const raw = sessionStorage.getItem(FIRED_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    const list = Array.isArray(parsed) ? parsed.filter((item) => typeof item === 'string') : [];
    list.push(key);
    sessionStorage.setItem(FIRED_KEY, JSON.stringify(list));
  } catch {
    // The memory set already recorded the fire.
  }
}

function conversionDecision(event: TidyWiseConversion, pathname: string) {
  const ids = tidyWiseIdsFromEnv();
  const choice = loadPrivacyChoice();
  const gpc = readGlobalPrivacyControl(browserNavigator());
  const hostnameAllowed = hostAllowed();
  const native = detectNativePlatform();
  const hasDestination = !!(ids.metaId || ids.ga4Id || ids.adsId);
  const allowed = tidyWiseConversionAllowed({
    event,
    pathname,
    native,
    choice,
    gpc,
    hostnameAllowed,
    hasDestination,
  });
  return { allowed, ...ids, choice, gpc, hostnameAllowed, native };
}

/**
 * Fires when the privacy rules allow it.
 * trial_started is allowed on /onboarding and /dashboard, where the trial
 * is created. The scripts load for that event only; those routes do not
 * get a pageview tag.
 * dedupeKey stays in this tab. The pixel payload is the event name and send_to.
 */
export function trackTidyWiseConversion(event: TidyWiseConversion, dedupeKey?: string): void {
  try {
    if (typeof window === 'undefined') return;
    const decision = conversionDecision(event, window.location.pathname);
    if (!decision.allowed) return;
    const key = firedKey(event, dedupeKey);
    if (alreadyFired(key)) return;
    const pageDecision = tidyWiseTagDecision({
      pathname: window.location.pathname,
      native: decision.native,
      choice: decision.choice,
      gpc: decision.gpc,
      hostnameAllowed: decision.hostnameAllowed,
      metaId: decision.metaId,
      ga4Id: decision.ga4Id,
      adsId: decision.adsId,
    });
    // App routes are not a pageview surface. Load the same ids just long
    // enough to deliver this one event.
    const load = pageDecision.loadMeta || pageDecision.loadGa4 || pageDecision.loadAds
      ? { ...currentDecision(window.location.pathname) }
      : {
          ...currentDecision(window.location.pathname),
          loadMeta: !!decision.metaId,
          loadGa4: !!decision.ga4Id,
          loadAds: !!decision.adsId,
        };
    loadAllowedTags(load);
    const payload = conversionPayload(event);
    if (decision.metaId) {
      const prev = metaGate.allowed;
      metaGate.allowed = true;
      metaGate.revoked = false;
      try {
        const metaCommand = payload.metaCustom ? 'trackSingleCustom' : 'trackSingle';
        fbqFn()?.(metaCommand, decision.metaId, payload.meta);
      } finally {
        metaGate.allowed = prev;
      }
    }
    const googleIds = [decision.ga4Id, decision.adsId].filter((id): id is string => !!id);
    if (googleIds.length > 0) {
      const gtag = gtagFn();
      for (const id of googleIds) {
        gtag?.('event', payload.ga, { send_to: id });
      }
    }
    const onTagSurface = pageDecision.loadMeta || pageDecision.loadGa4 || pageDecision.loadAds;
    if (!onTagSurface) {
      // The event is already queued. Later calls on the app must not keep
      // measuring. Disable on the next turn so this beacon can leave first.
      metaGate.allowed = false;
      window.setTimeout(() => {
        if (metaGate.allowed) return;
        gaGate.allowed = false;
        for (const id of gaGate.ids) setGaDisabled(id, true);
      }, 1000);
    }
    markFired(key);
    document.documentElement.dataset.twConversion = event;
  } catch (err) {
    console.warn('TidyWise conversion event failed', err);
  }
}

/** Non-production tests set window.__TW_MOCK_GOOGLE_SIGNUP to finish without leaving the page. */
export function readMockedGoogleSignupUserId(): string | null {
  if (import.meta.env.PROD) return null;
  if (typeof window === 'undefined') return null;
  const mock = (window as Window & { __TW_MOCK_GOOGLE_SIGNUP?: { userId?: string } }).__TW_MOCK_GOOGLE_SIGNUP;
  const userId = mock?.userId;
  return typeof userId === 'string' && userId.trim() ? userId.trim() : null;
}
