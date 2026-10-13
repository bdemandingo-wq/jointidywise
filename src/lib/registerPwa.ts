import { Capacitor } from '@capacitor/core';
import { registerSW } from 'virtual:pwa-register';
import { DISMISSED_BUILD_KEY, shouldOfferAppUpdate } from '@/lib/appUpdate';

/**
 * The iOS shell sets this on the web view even when the Capacitor bridge has
 * not been injected yet. isNativePlatform() alone has registered a service
 * worker inside WKWebView, which then precaches the whole build.
 */
export function isNativeAppShell(): boolean {
  if (typeof navigator !== 'undefined' && navigator.userAgent.includes('TidyWise-iOS')) return true;
  try {
    return Capacitor.isNativePlatform() || Capacitor.getPlatform() === 'ios';
  } catch {
    return false;
  }
}

function unregisterNativeServiceWorkers(): void {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  void navigator.serviceWorker.getRegistrations().then((regs) => {
    for (const reg of regs) void reg.unregister();
  });
  if (typeof caches !== 'undefined') {
    void caches.keys().then((keys) => {
      for (const key of keys) void caches.delete(key);
    });
  }
}

/**
 * Registers the service worker that makes TidyWise installable on desktop.
 *
 * NEVER on native. Capacitor bundles its own assets locally with no
 * `server.url`, so a worker caching inside that WebView would serve stale files
 * in the one environment where a reload cannot clear them — the same reason
 * `chunkReload` refuses to reload on native.
 *
 * NEVER in dev. A worker caching a dev server's output makes HMR lie about what
 * is on screen, which costs far more than the feature is worth locally.
 *
 * The update is OFFERED, not applied. `registerType: 'prompt'` means a new
 * worker installs and then waits; nothing about the running tab changes until
 * the person says so. Taking over mid-session is what produces a chunk-load
 * error, because the tab's already-parsed index.html points at assets the new
 * worker has replaced.
 *
 * Declining is safe: `cleanupOutdatedCaches` is false, so the old chunks a
 * long-lived tab still needs remain resolvable rather than 404ing.
 */
export function registerPwa(): void {
  if (isNativeAppShell()) {
    unregisterNativeServiceWorkers();
    return;
  }
  if (import.meta.env.DEV) return;
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;

  // A waiting worker is not proof of a new deploy. Workbox calls
  // onNeedRefresh on every load while a worker is waiting, which is why the
  // banner was covering mobile on each visit. version.json is emitted beside
  // the bundle and is not precached; the offer is the string compare in
  // shouldOfferAppUpdate.
  let updateSW: (reloadPage?: boolean) => Promise<void> = async () => {
    window.location.reload();
  };

  const offerUpdate = async () => {
    let remoteBuildId: string | null = null;
    try {
      const response = await fetch(`/version.json?ts=${Date.now()}`, { cache: 'no-store' });
      if (response.ok) {
        const body = await response.json() as { buildId?: unknown };
        remoteBuildId = typeof body.buildId === 'string' ? body.buildId : null;
      }
    } catch {
      remoteBuildId = null;
    }
    let dismissed: string | null = null;
    try {
      dismissed = localStorage.getItem(DISMISSED_BUILD_KEY);
    } catch {
      dismissed = null;
    }
    const show = shouldOfferAppUpdate({
      localBuildId: import.meta.env.VITE_APP_BUILD_ID,
      remoteBuildId,
      dismissedBuildId: dismissed,
    });
    if (!show) {
      document.getElementById('tw-update-banner')?.remove();
      return;
    }
    if (document.getElementById('tw-update-banner')) return;
    const bar = document.createElement('div');
    bar.id = 'tw-update-banner';
    bar.setAttribute('role', 'status');
    bar.style.cssText = [
      'position:fixed',
      'z-index:80',
      'top:0',
      'left:0',
      'right:0',
      'display:flex',
      'align-items:center',
      'justify-content:center',
      'gap:8px',
      'flex-wrap:wrap',
      'padding:8px 12px',
      'padding-top:calc(env(safe-area-inset-top, 0px) + 8px)',
      'background:#0f172a',
      'color:#fff',
      'font:500 13px/1.3 ui-sans-serif,system-ui,sans-serif',
    ].join(';');
    const text = document.createElement('span');
    text.textContent = 'A new version of TidyWise is ready.';
    const reload = document.createElement('button');
    reload.type = 'button';
    reload.textContent = 'Reload';
    reload.style.cssText = 'background:#fff;color:#0f172a;border:0;border-radius:999px;padding:4px 12px;font:600 13px ui-sans-serif,system-ui;cursor:pointer';
    reload.addEventListener('click', () => {
      void updateSW(true);
    });
    const dismiss = document.createElement('button');
    dismiss.type = 'button';
    dismiss.textContent = 'Not now';
    dismiss.setAttribute('aria-label', 'Dismiss update notice');
    dismiss.style.cssText = 'background:transparent;color:#fff;border:1px solid rgba(255,255,255,.45);border-radius:999px;padding:4px 12px;font:500 13px ui-sans-serif,system-ui;cursor:pointer';
    dismiss.addEventListener('click', () => {
      try {
        if (remoteBuildId) localStorage.setItem(DISMISSED_BUILD_KEY, remoteBuildId);
      } catch {
        /* private mode */
      }
      bar.remove();
    });
    bar.append(text, reload, dismiss);
    document.body.append(bar);
  };

  updateSW = registerSW({
    onNeedRefresh() {
      void offerUpdate();
    },
    onRegisterError(error) {
      console.warn('[pwa] service worker registration failed', error);
    },
  });
  void offerUpdate();
}
