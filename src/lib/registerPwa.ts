import { Capacitor } from '@capacitor/core';
import { registerSW } from 'virtual:pwa-register';
import { toast } from 'sonner';

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

  // The callback below closes over `updateSW` before the assignment completes.
  // Safe: onNeedRefresh only fires once a new worker has installed, long after
  // registerSW has returned and the binding is initialised.
  const updateSW = registerSW({
    onNeedRefresh() {
      toast('A new version of TidyWise is ready', {
        description: 'Reload when you reach a good stopping point.',
        // No auto-dismiss: this is the only affordance for taking the update,
        // and a toast that vanishes leaves the person on an old build with no
        // way back other than a manual refresh.
        duration: Infinity,
        action: {
          label: 'Reload',
          onClick: () => {
            void updateSW(true);
          },
        },
      });
    },
    onRegisterError(error) {
      // Not fatal and not worth interrupting anyone over — the app works
      // perfectly well uninstalled. Logged so it reaches Sentry's console
      // breadcrumbs rather than disappearing.
      console.warn('[pwa] service worker registration failed', error);
    },
  });
}
