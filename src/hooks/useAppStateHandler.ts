import { useEffect } from 'react';
import { Capacitor } from '@capacitor/core';
import { supabase } from '@/lib/supabase';
import { useQueryClient } from '@tanstack/react-query';
import { syncWidgetData } from '@/lib/syncWidgetData';
import { refreshBadges } from '@/lib/badgeRefresh';

// Routes that are considered "root" tabs — back button should not navigate away from these
const ROOT_ROUTES = [
  '/dashboard',
  '/login',
  '/signup',
  '/auth',
  '/',
];

function isRootRoute(path: string): boolean {
  // Exact match for root routes
  if (ROOT_ROUTES.includes(path)) return true;
  // /dashboard with no sub-path is root
  if (path === '/dashboard' || path === '/dashboard/') return true;
  return false;
}

function isAuthRoute(path: string): boolean {
  return path === '/login' || path === '/signup' || path === '/auth' || path === '/logout';
}

/**
 * Routes that belong to the signed-in app. The back-button interceptor below
 * exists for these and ONLY these.
 *
 * Everything else — the marketing site, pricing, the comparison and feature
 * pages, the blog, the public booking form, the client portal login — is a
 * normal web page where the browser's own back button is correct and must not
 * be touched.
 */
function isInAppRoute(path: string): boolean {
  return (
    path === '/dashboard' || path.startsWith('/dashboard/') ||
    path === '/staff' || path.startsWith('/staff/') ||
    path.startsWith('/portal/')   // NOT bare /portal, which is the public login
  );
}

/**
 * Determine the parent route for in-app back navigation.
 * Returns null if already at a root route (should stay / minimize).
 */
function getParentRoute(path: string): string | null {
  // Already at root
  if (isRootRoute(path)) return null;

  // Dashboard sub-pages → go to /dashboard
  if (path.startsWith('/dashboard/')) {
    return '/dashboard';
  }

  // Staff sub-pages → go to /staff
  if (path.startsWith('/staff/')) {
    return '/staff';
  }

  // Portal sub-pages → go to /portal/dashboard
  if (path.startsWith('/portal/') && path !== '/portal/dashboard') {
    return '/portal/dashboard';
  }

  // Blog sub-pages → go to /blog
  if (path.startsWith('/blog/')) {
    return '/blog';
  }

  return '/dashboard';
}

export function useAppStateHandler() {
  const queryClient = useQueryClient();
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) {
      // --- Web: intercept popstate to prevent logout on back ---
      //
      // SCOPE, and why it is this narrow (2026-07-31):
      //
      // This handler used to run on EVERY page for EVERY visitor. Because
      // getParentRoute() falls through to '/dashboard' for any path not
      // explicitly listed, and ROOT_ROUTES contains only five entries, pressing
      // browser Back on any marketing page ran
      //   window.location.replace('/dashboard')
      // which for a signed-out visitor lands on /login. Measured with Playwright
      // on 2026-07-31: back from /pricing, /compare/jobber, /features/booking,
      // /blog and /portal ALL produced a login screen. Every visitor who backed
      // out of a marketing page hit a login wall.
      //
      // The handler's actual purpose is in-app back behaviour for a signed-in
      // user. So it now installs only when BOTH are true: there is a session,
      // and we are on an in-app route. On the public site the browser's own back
      // button is correct and is left alone.
      let ignoreNextPop = false;
      let cancelled = false;
      let cleanupPop: (() => void) | undefined;

      const handlePopState = (e: PopStateEvent) => {
        if (ignoreNextPop) {
          ignoreNextPop = false;
          return;
        }

        const currentPath = window.location.pathname;

        // Left the app since the listener was installed (signed out, or
        // navigated to the marketing site). Stop interfering.
        if (!isInAppRoute(currentPath)) return;

        // Never allow back to navigate to auth routes — block it
        if (isAuthRoute(currentPath)) {
          // We landed on an auth route via back — push forward again
          window.history.pushState({ appGuard: true }, '', '/dashboard');
          window.location.replace('/dashboard');
          return;
        }

        // If at a root route, just re-push state (stay put)
        if (isRootRoute(currentPath)) {
          window.history.pushState({ appGuard: true }, '', window.location.href);
          return;
        }

        // Navigate to parent route
        const parent = getParentRoute(currentPath);
        if (parent) {
          ignoreNextPop = true;
          window.history.pushState({ appGuard: true }, '', parent);
          // Use replace to actually navigate the React router
          window.location.replace(parent);
        } else {
          window.history.pushState({ appGuard: true }, '', window.location.href);
        }
      };

      // Install only for a signed-in user who is inside the app. Both checks
      // matter: the session alone would still hijack Back for a logged-in user
      // reading the blog, and the route alone would hijack it for a signed-out
      // visitor on /portal/... .
      //
      // The session lookup is async, so guard against the effect being torn
      // down while it is in flight — otherwise a fast unmount leaves a listener
      // attached with no way to remove it.
      //
      // AND it must re-run on sign-in. This effect has [] deps and is mounted
      // once for the life of the tab, so a single getSession() at mount saw no
      // session for the ordinary flow — land signed-out, log in, get routed to
      // /dashboard by client-side navigation — and the guard then never
      // installed at all. It only worked on a hard refresh while already
      // authenticated. onAuthStateChange re-runs install() on SIGNED_IN, and
      // tears the listener down again on SIGNED_OUT so a signed-out user
      // browsing the marketing site is never intercepted.
      // install() with no args: called at mount, OUTSIDE the auth lock.
      // Safe to call getSession() here — it acquires the lock but nothing
      // is holding it at mount time.
      const installFromMount = async () => {
        if (cleanupPop) return;
        const { data: { session } } = await supabase.auth.getSession();
        if (cancelled) return;
        installWithSession(session);
      };

      // installWithSession(): called from onAuthStateChange, which runs
      // INSIDE the auth lock. Must NOT call getSession() or any other
      // lock-acquiring method — that would deadlock the app. The session
      // is passed directly from the callback parameter instead.
      const installWithSession = (session: { user: { id: string } } | null) => {
        if (cleanupPop) return;
        if (!session) return;
        if (!isInAppRoute(window.location.pathname)) return;

        window.history.pushState({ appGuard: true }, '', window.location.href);
        window.addEventListener('popstate', handlePopState);
        cleanupPop = () => window.removeEventListener('popstate', handlePopState);
      };

      void installFromMount();

      const { data: authSub } = supabase.auth.onAuthStateChange((event, session) => {
        if (cancelled) return;
        if (event === 'SIGNED_IN' || event === 'INITIAL_SESSION' || event === 'TOKEN_REFRESHED') {
          installWithSession(session);
        } else if (event === 'SIGNED_OUT') {
          cleanupPop?.();
          cleanupPop = undefined;
        }
      });

      return () => {
        cancelled = true;
        authSub?.subscription?.unsubscribe();
        cleanupPop?.();
      };
    }

    // --- Native Capacitor ---
    let cleanup: (() => void) | undefined;

    const init = async () => {
      const { App } = await import('@capacitor/app');

      // Widget sync is five booking reads plus a native bridge call. It used
      // to start during the same tick as the dashboard's own queries and
      // hold the auth lock. The home screen can wait.
      const widgetTimer = window.setTimeout(() => { void syncWidgetData(); }, 8000);

      const resumeListener = await App.addListener('appStateChange', async ({ isActive }) => {
        if (isActive) {
          void queryClient.invalidateQueries({ queryKey: ['bookings'] });
          void queryClient.invalidateQueries({ queryKey: ['customers'] });
          void queryClient.invalidateQueries({ queryKey: ['startup-subscription'] });
          refreshBadges(queryClient);
          void syncWidgetData();
          try {
            const { data: { session } } = await supabase.auth.getSession();
            if (session) {
              const expiresAt = session.expires_at ?? 0;
              const expiresInSec = expiresAt - Math.floor(Date.now() / 1000);
              if (expiresInSec < 300) {
                await supabase.auth.refreshSession();
              }
            }
          } catch {
            // Non-fatal
          }
        }
      });

      const backListener = await App.addListener('backButton', ({ canGoBack }) => {
        const currentPath = window.location.hash.replace('#', '') || '/';

        // Never go back to auth routes
        if (isAuthRoute(currentPath)) {
          window.location.hash = '#/dashboard';
          return;
        }

        // At root → minimize app instead of exiting
        if (isRootRoute(currentPath)) {
          App.minimizeApp();
          return;
        }

        // Navigate to parent route within the app
        const parent = getParentRoute(currentPath);
        if (parent) {
          window.location.hash = '#' + parent;
        } else if (canGoBack) {
          window.history.back();
        } else {
          App.minimizeApp();
        }
      });

      cleanup = () => {
        window.clearTimeout(widgetTimer);
        resumeListener.remove();
        backListener.remove();
      };
    };

    init().catch(console.error);

    return () => {
      cleanup?.();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- queryClient is stable from QueryClientProvider; runs once on mount
  }, []);
}
