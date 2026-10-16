import { Capacitor } from '@capacitor/core';
import { hydrate, type QueryClient } from '@tanstack/react-query';

const OFFLINE_CACHE_KEY = 'tw-offline-cache';
/** v4 drops caches that stored a false empty org from the sign-in race. */
export const OFFLINE_CACHE_BUSTER = 'v4-drop-empty-org';
const OFFLINE_CACHE_MAX_AGE_MS = 1000 * 60 * 60 * 24;

export function isNativeIos(): boolean {
  return Capacitor.getPlatform() === 'ios';
}

/** Class used by index.css so iOS chrome rules never apply on the website. */
export function markNativeIosDocument(): void {
  if (typeof document === 'undefined' || !isNativeIos()) return;
  document.documentElement.classList.add('ios-native');
}

/**
 * The persister restores after the first React paint. Reading the same
 * localStorage blob here lets the dashboard draw yesterday's rows on the
 * first frame. The async persister still runs and refreshes them.
 * Website launches skip this so their first paint stays as it is.
 */
export function hydrateNativeOfflineCache(client: QueryClient): void {
  if (typeof window === 'undefined' || !isNativeIos()) return;
  try {
    const raw = window.localStorage.getItem(OFFLINE_CACHE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as {
      timestamp?: number;
      buster?: string;
      clientState?: unknown;
    };
    if (parsed.buster !== OFFLINE_CACHE_BUSTER) return;
    if (typeof parsed.timestamp === 'number' && Date.now() - parsed.timestamp > OFFLINE_CACHE_MAX_AGE_MS) return;
    if (!parsed.clientState || typeof parsed.clientState !== 'object') return;
    hydrate(client, parsed.clientState);
  } catch {
    // A damaged cache must not block launch.
  }
}

/** Hide the launch splash on the frame after the first paint, and again if that never lands. */
export function hideNativeSplashAfterPaint(): void {
  if (!isNativeIos()) return;
  let hidden = false;
  const hide = () => {
    if (hidden) return;
    hidden = true;
    void import('@capacitor/splash-screen')
      .then(({ SplashScreen }) => SplashScreen.hide({ fadeOutDuration: 180 }))
      .catch(() => {});
  };
  requestAnimationFrame(() => requestAnimationFrame(hide));
  window.setTimeout(hide, 2500);
}

/** Status bar text follows the app theme. Dark theme uses light text. */
export function applyNativeStatusBar(resolvedTheme: string | undefined): void {
  if (!isNativeIos()) return;
  const darkBackground = resolvedTheme !== 'light';
  void import('@capacitor/status-bar')
    .then(({ StatusBar, Style }) =>
      StatusBar.setStyle({ style: darkBackground ? Style.Dark : Style.Light }),
    )
    .catch(() => {});
}
