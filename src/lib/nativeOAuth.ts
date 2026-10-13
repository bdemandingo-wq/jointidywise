/**
 * Native OAuth helper for iOS App Store Guideline 4.0 compliance.
 */

import { Capacitor } from '@capacitor/core';
import { supabase } from '@/lib/supabase';
import { appendReferralParam, captureReferralFromUrl, readCapturedReferral } from '@/lib/referralAttribution';

const NATIVE_CALLBACK_URL = 'com.TidyWiseApp.app://auth/callback';
const WEB_CALLBACK_URL = 'https://www.jointidywise.com';

export function getOAuthRedirectUrl(): string {
  return Capacitor.isNativePlatform() ? NATIVE_CALLBACK_URL : WEB_CALLBACK_URL;
}

export async function signInWithOAuthNative(
  provider: 'google' | 'apple'
): Promise<{ error: Error | null }> {
  try {
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: appendReferralParam(NATIVE_CALLBACK_URL, readCapturedReferral()),
        skipBrowserRedirect: true,
      },
    });

    if (error) {
      return { error };
    }

    if (data?.url) {
      const { Browser } = await import('@capacitor/browser');
      await Browser.open({
        url: data.url,
        presentationStyle: 'fullscreen',
      });
    }

    return { error: null };
  } catch (err) {
    return { error: err instanceof Error ? err : new Error(String(err)) };
  }
}

export function setupDeepLinkListener(): (() => void) | undefined {
  if (!Capacitor.isNativePlatform()) return undefined;

  const listener = (async () => {
    const { App } = await import('@capacitor/app');
    const { Browser } = await import('@capacitor/browser');

    return App.addListener('appUrlOpen', async ({ url }) => {
      // Handle widget deep links — native uses HashRouter so navigate via hash
      if (url.startsWith('tidywise://')) {
        const path = url.replace('tidywise://', '');

        if (path.startsWith('booking/')) {
          window.location.hash = '#/dashboard/bookings';
        } else if (path === 'new-booking') {
          window.location.hash = '#/dashboard/bookings?newBooking=true';
        } else if (path === 'new-customer') {
          window.location.hash = '#/dashboard/customers?newCustomer=true';
        } else if (path === 'today' || path === 'bookings') {
          window.location.hash = '#/dashboard/bookings';
        } else if (path === 'dashboard') {
          window.location.hash = '#/dashboard';
        } else if (path === 'payroll') {
          window.location.hash = '#/dashboard/payroll';
        } else if (path === 'reports') {
          window.location.hash = '#/dashboard/reports';
        }
        return;
      }

      try {
        const callback = new URL(url);
        const ref = callback.searchParams.get('ref');
        if (ref) captureReferralFromUrl(`?ref=${ref}`);
      } catch {
        // A malformed callback still falls through to the token parser below.
      }

      if (!url.includes('auth/callback')) {
        return;
      }

      try {
        await Browser.close();
      } catch {
        // Browser may already be closed
      }

      // Detect what the URL carries — hash tokens (implicit) or query code (PKCE)
      const hashIndex = url.indexOf('#');
      const queryIndex = url.indexOf('?');
      const hasHash = hashIndex !== -1;
      const hasQuery = queryIndex !== -1;

      if (hasQuery) {
        const qStr = hasHash ? url.substring(queryIndex + 1, hashIndex) : url.substring(queryIndex + 1);
        const queryParams = new URLSearchParams(qStr);

        // PKCE flow: the URL has ?code=... instead of #access_token=...
        if (queryParams.has('code')) {
          try {
            await supabase.auth.exchangeCodeForSession(queryParams.get('code')!);
          } catch (err) {
            console.error('OAuth code exchange failed:', err);
          }
          return;
        }

        if (queryParams.has('error')) {
          console.error('OAuth callback error:', queryParams.get('error'), queryParams.get('error_description'));
          return;
        }
      }

      // Implicit flow: hash has access_token + refresh_token
      if (hasHash) {
        const hashParams = new URLSearchParams(url.substring(hashIndex + 1));
        const accessToken = hashParams.get('access_token');
        const refreshToken = hashParams.get('refresh_token');

        if (accessToken && refreshToken) {
          try {
            await supabase.auth.setSession({
              access_token: accessToken,
              refresh_token: refreshToken,
            });
          } catch (err) {
            console.error('OAuth session set failed:', err);
          }
        }
      }
    });
  })();

  return () => {
    listener.then(l => l.remove());
  };
}
