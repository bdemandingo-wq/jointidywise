import { Capacitor } from '@capacitor/core';
import { loadPrivacyChoice } from './tidywisePrivacyStore';
import {
  conversionPayload,
  planMetaCommand,
  readGlobalPrivacyControl,
  sanitizeGaId,
  sanitizeMetaPixelId,
  tidyWiseTagDecision,
  type TidyWiseConversion,
} from './tidywiseSitePrivacy';

/**
 * TidyWise-owned Meta Pixel and Google tag.
 *
 * Loaded only when tidyWiseTagDecision says so. Org pixels stay on
 * window.fbq / window.gtag. This file does not revoke tracking for the
 * whole page, because that would silence a cleaning company's pixel on /book.
 *
 * Meta: once our pixel id is initialized, broadcast track() calls are
 * rewritten to trackSingle for the other pixel ids only.
 * Google: hits to our id are stopped with ga-disable-ID. Our events use
 * send_to so they do not land on an org property.
 */

const FIRED_KEY = 'tw-tidywise-conversion-fired';
const META_MARKER_ID = 'tw-owned-meta';
const GA_MARKER_ID = 'tw-owned-ga';

type FbqFn = (...args: unknown[]) => void;

const metaGate = {
  ourId: null as string | null,
  allowed: false,
  inited: false,
  guardInstalled: false,
  others: new Set<string>(),
};

const gaGate = {
  id: null as string | null,
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

export function tidyWiseIdsFromEnv(): { metaId: string | null; gaId: string | null } {
  return {
    metaId: sanitizeMetaPixelId(readEnvId(import.meta.env.VITE_TIDYWISE_META_PIXEL_ID)),
    gaId: sanitizeGaId(readEnvId(import.meta.env.VITE_TIDYWISE_GA_ID)),
  };
}

function currentDecision(pathname: string) {
  const ids = tidyWiseIdsFromEnv();
  const decision = tidyWiseTagDecision({
    pathname,
    native: detectNativePlatform(),
    choice: loadPrivacyChoice(),
    gpc: readGlobalPrivacyControl(browserNavigator()),
    metaId: ids.metaId,
    gaId: ids.gaId,
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

function ensureGaSnippet(id: string): void {
  if (document.getElementById(GA_MARKER_ID)) return;
  setGaDisabled(id, false);
  const loader = document.createElement('script');
  loader.id = `${GA_MARKER_ID}-loader`;
  loader.async = true;
  loader.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(id)}`;
  document.head.appendChild(loader);

  const inline = document.createElement('script');
  inline.id = GA_MARKER_ID;
  // The id is regex-checked before it reaches this string.
  inline.text = `
    window.dataLayer = window.dataLayer || [];
    window.gtag = window.gtag || function gtag(){window.dataLayer.push(arguments);};
    window.gtag('js', new Date());
    window.gtag('config', ${JSON.stringify(id)}, { send_page_view: false });
  `;
  document.head.appendChild(inline);
}

function metaMarker(): void {
  if (document.getElementById(META_MARKER_ID)) return;
  const marker = document.createElement('script');
  marker.id = META_MARKER_ID;
  marker.type = 'application/json';
  marker.text = '{}';
  document.head.appendChild(marker);
}

function sendPageViews(pathname: string, metaId: string | null, gaId: string | null): void {
  if (lastTrackedPath === pathname) return;
  lastTrackedPath = pathname;
  if (metaId && metaGate.allowed) {
    const fbq = fbqFn();
    fbq?.('trackSingle', metaId, 'PageView');
  }
  if (gaId && gaGate.allowed) {
    gtagFn()?.('event', 'page_view', {
      send_to: gaId,
      page_path: pathname,
      page_location: window.location.href,
      page_title: document.title,
    });
  }
}

export function syncTidyWiseTags(pathname: string): void {
  if (typeof document === 'undefined') return;
  const decision = currentDecision(pathname);

  if (decision.loadMeta && decision.metaId) {
    metaGate.ourId = decision.metaId;
    metaGate.allowed = true;
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
  } else if (metaGate.ourId) {
    metaGate.allowed = false;
    fbqFn()?.('set', 'autoConfig', false, metaGate.ourId);
  }

  if (decision.loadGa && decision.gaId) {
    gaGate.id = decision.gaId;
    gaGate.allowed = true;
    setGaDisabled(decision.gaId, false);
    ensureGaSnippet(decision.gaId);
  } else if (gaGate.id) {
    gaGate.allowed = false;
    setGaDisabled(gaGate.id, true);
    gtagFn()?.('config', gaGate.id, {
      send_page_view: false,
      allow_google_signals: false,
      allow_ad_personalization_signals: false,
    });
  }

  if (!decision.loadMeta && !decision.loadGa) {
    lastTrackedPath = null;
    return;
  }

  sendPageViews(
    pathname,
    decision.loadMeta ? decision.metaId : null,
    decision.loadGa ? decision.gaId : null,
  );
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

/** Fires only when the marketing-surface rules allow TidyWise tags. */
export function trackTidyWiseConversion(event: TidyWiseConversion, dedupeKey?: string): void {
  try {
    if (typeof window === 'undefined') return;
    const decision = currentDecision(window.location.pathname);
    if (!decision.loadMeta && !decision.loadGa) return;
    const key = firedKey(event, dedupeKey);
    if (alreadyFired(key)) return;
    const payload = conversionPayload(event);
    if (decision.loadMeta && decision.metaId) {
      fbqFn()?.('trackSingle', decision.metaId, payload.meta);
    }
    if (decision.loadGa && decision.gaId) {
      gtagFn()?.('event', payload.ga, { send_to: decision.gaId });
    }
    markFired(key);
  } catch (err) {
    console.warn('TidyWise conversion event failed', err);
  }
}
