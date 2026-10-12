import { useEffect, useState, useCallback, useRef } from 'react';
import { Capacitor } from '@capacitor/core';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';

// The native runtime sets this before the webview evaluates JS (it looks for
// webkit.messageHandlers.bridge). A second check against window.Capacitor
// covers a bridge that injected the global without the import seeing it.
const isNativePlatform = () => {
  try {
    if (Capacitor.isNativePlatform()) return true;
    const win = window as Window & { Capacitor?: { isNativePlatform?: () => boolean } };
    return win.Capacitor?.isNativePlatform?.() === true;
  } catch {
    return false;
  }
};

// Shared across hook instances. The settings page and the post-login
// registrar each call this hook; only a saved device token counts as
// registered, and both screens need to see that.
let nativeTokenSaved = false;
const registeredListeners = new Set<(value: boolean) => void>();

function publishTokenSaved(value: boolean) {
  nativeTokenSaved = value;
  registeredListeners.forEach((listener) => listener(value));
}

// One OS permission dialog at a time. The registrar and a settings toggle
// can both fire during the same launch.
let nativeRegisterInFlight: Promise<boolean> | null = null;

// Lazy load the push notifications plugin
const getPushPlugin = async () => {
  try {
    const { PushNotifications } = await import('@capacitor/push-notifications');
    return PushNotifications;
  } catch (error) {
    console.log('[PUSH] Push notifications plugin not available:', error);
    return null;
  }
};

// Generous enough that a legitimately-shown OS prompt awaiting the user's tap
// won't falsely time out, but short enough that a native call that never
// responds surfaces as an error instead of an infinite spinner.
const PERMISSION_TIMEOUT_MS = 20000;

// Race a native call against a timeout so a stalled bridge (no resolve, no
// reject) becomes a visible error. Rejects with `label` context.
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timeoutId: number;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = window.setTimeout(
      () => reject(new Error(`${label} timed out after ${ms / 1000}s. The native layer never responded.`)),
      ms,
    );
  });
  return Promise.race([promise, timeout]).finally(() => window.clearTimeout(timeoutId));
}

type NotificationPayload = {
  title: string;
  body?: string;
  tag?: string;
  onClick?: () => void;
};

export const canUseBrowserNotifications = () => {
  return typeof window !== 'undefined' && 'Notification' in window;
};

export const showBrowserNotification = ({ title, body, tag, onClick }: NotificationPayload) => {
  if (!canUseBrowserNotifications() || Notification.permission !== 'granted') {
    return;
  }

  try {
    const notification = new Notification(title, {
      body,
      tag,
      icon: '/favicon.ico',
      badge: '/favicon.ico',
    });

    notification.onclick = () => {
      window.focus();
      onClick?.();
      notification.close();
    };
  } catch (error) {
    console.error('[PUSH] Error showing browser notification:', error);
  }
};

export type PushRegistrationOptions = {
  /** Automatic post-login call: no error toast if the user declines. */
  quiet?: boolean;
  /** Active company. register-push-token checks the caller belongs to it. */
  organizationId?: string | null;
};

export function usePushNotifications(staffId?: string) {
  const [token, setToken] = useState<string | null>(null);
  const [isSupported, setIsSupported] = useState(false);
  const [isRegistered, setIsRegistered] = useState(nativeTokenSaved);
  const [isRegistering, setIsRegistering] = useState(false);
  const nativeListenersAttachedRef = useRef(false);
  const nativeListenerHandlesRef = useRef<Array<{ remove: () => Promise<void> }>>([]);

  const cleanupNativeListeners = useCallback(async () => {
    if (nativeListenerHandlesRef.current.length === 0) return;

    await Promise.allSettled(nativeListenerHandlesRef.current.map((handle) => handle.remove()));
    nativeListenerHandlesRef.current = [];
    nativeListenersAttachedRef.current = false;
  }, []);

  const attachNativeListeners = useCallback(async () => {
    if (!isNativePlatform() || nativeListenersAttachedRef.current) return;

    const PushNotifications = await getPushPlugin();
    if (!PushNotifications) return;

    const handles = await Promise.all([
      PushNotifications.addListener('pushNotificationReceived', (notification: { title?: string; body?: string }) => {
        toast.info(notification.title || 'New notification', {
          description: notification.body,
        });
      }),
      PushNotifications.addListener('pushNotificationActionPerformed', (notification: { notification: { data?: { bookingId?: string } } }) => {
        const data = notification.notification.data;
        if (data?.bookingId) {
          window.location.href = `/staff?booking=${data.bookingId}`;
        }
      }),
    ]);

    nativeListenerHandlesRef.current = handles;
    nativeListenersAttachedRef.current = true;
  }, []);

  useEffect(() => {
    registeredListeners.add(setIsRegistered);
    return () => {
      registeredListeners.delete(setIsRegistered);
    };
  }, []);

  useEffect(() => {
    // Check support for native or web. OS permission "granted" is not the
    // same as a token saved on our server — checkPermissions used to flip
    // isRegistered and the staff portal then skipped register() entirely.
    if (isNativePlatform()) {
      setIsSupported(true);
      void attachNativeListeners();
    } else if ('Notification' in window) {
      setIsSupported(true);
      if (Notification.permission === 'granted') {
        setIsRegistered(true);
      }
    }
    return () => {
      void cleanupNativeListeners();
    };
  }, [attachNativeListeners, cleanupNativeListeners, staffId]);

  const registerNative = async (options?: PushRegistrationOptions): Promise<{ ok: boolean; prompted: boolean }> => {
    const quiet = options?.quiet === true;
    const organizationId = options?.organizationId ?? null;
    const PushNotifications = await getPushPlugin();
    if (!PushNotifications) {
      const message = 'Push notifications are not available on this device';
      console.error('[PUSH]', message);
      toast.error(message);
      return { ok: false, prompted: false };
    }

    // Already-denied is a settled OS state. Calling requestPermissions again
    // does not show a dialog and must not toast on every cold start.
    let prompted = false;
    try {
      const current = await PushNotifications.checkPermissions();
      if (current.receive === 'denied') {
        if (!quiet) toast.error('Push notification permission denied. Enable notifications for TidyWise in iOS Settings.');
        return { ok: false, prompted: false };
      }
      if (current.receive !== 'granted') {
        prompted = true;
        // The manual toggle times out so a stalled bridge can't spin forever.
        // The post-login prompt does not: the system dialog stays open until
        // the person taps it, and abandoning that promise would leave the
        // Settings row without a device token.
        const permStatus = quiet
          ? await PushNotifications.requestPermissions()
          : await withTimeout(
              PushNotifications.requestPermissions(),
              PERMISSION_TIMEOUT_MS,
              'PushNotifications.requestPermissions()',
            );
        if (permStatus.receive !== 'granted') {
          if (!quiet) toast.error('Push notification permission denied');
          return { ok: false, prompted: true };
        }
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      console.error('[PUSH] requestPermissions failed or stalled:', detail);
      toast.error(`Couldn't enable notifications: ${detail}`);
      return { ok: false, prompted };
    }

    await attachNativeListeners();

    /*
      Held on an object rather than in two `let`s. The assignments happen inside
      a nested async IIFE within the Promise executor, which TypeScript's
      control-flow analysis cannot see — so it narrowed both bindings to `null`
      and reported `.remove` on type `never`. The listeners were being attached
      and removed correctly the whole time; only the types disagreed. Property
      writes are not narrowed the same way, so this keeps the declared union.
    */
    const handles: {
      registration: { remove: () => Promise<void> } | null;
      error: { remove: () => Promise<void> } | null;
    } = { registration: null, error: null };

    try {
      const nativeToken = await new Promise<string>((resolve, reject) => {
        const timeoutId = window.setTimeout(() => {
          reject(new Error('Push registration timed out. Please try again.'));
        }, 12000);

        (async () => {
          try {
            handles.registration = await PushNotifications.addListener('registration', (tokenData: { value: string }) => {
              window.clearTimeout(timeoutId);
              resolve(tokenData.value);
            });

            handles.error = await PushNotifications.addListener('registrationError', (error: { error?: string }) => {
              window.clearTimeout(timeoutId);
              reject(new Error(error?.error || 'Failed to register for push notifications'));
            });

            await PushNotifications.register();
          } catch (error) {
            window.clearTimeout(timeoutId);
            reject(error);
          }
        })();
      });

      // Don't log the raw token — it's a credential that can be used to send
      // arbitrary push notifications to this device until it rotates.
      console.log('[PUSH] Push registration success');
      setToken(nativeToken);

      // The device itself is registered with APNs/FCM at this point — that
      // part genuinely succeeded. But if the token never reaches our
      // server, send-push-notification has nothing to send to, so this
      // device won't actually receive anything despite the OS-level
      // registration. Track that distinctly rather than reporting success.
      let tokenSaved = false;
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.access_token) {
          const { error: saveError } = await supabase.functions.invoke('register-push-token', {
            // register-push-token reads platform from the body (and defaults to
            // 'ios' only when it's absent). Returns 'ios' | 'android' | 'web';
            // we are inside registerNative(), so it is never 'web' here.
            //
            // organization_id is the company the app is signed into. The
            // function confirms this user is a member or staff there. Without
            // it, an owner of more than one business used to fail the
            // single-row membership lookup and store a token with no org.
            //
            // apns_env is a hint. TestFlight and App Store ship a production
            // bundle (import.meta.env.PROD) and Apple issues production tokens.
            // A dev server inside the simulator is sandbox. The push function
            // still retries the other host if this hint is wrong.
            body: {
              token: nativeToken,
              platform: Capacitor.getPlatform(),
              ...(organizationId ? { organization_id: organizationId } : {}),
              ...(Capacitor.getPlatform() === 'ios'
                ? { apns_env: import.meta.env.PROD ? 'production' : 'sandbox' }
                : {}),
            },
            headers: { Authorization: `Bearer ${session.access_token}` },
          });
          if (saveError) {
            console.error('[PUSH] Failed to save token', saveError);
          } else {
            tokenSaved = true;
            console.log('[PUSH] Token saved to Supabase');
          }
        }
      } catch (err) {
        console.error('[PUSH] Error saving token', err);
      }

      if (staffId) {
        // Dev placeholder until staff-token persistence is wired up. Never log
        // the actual token alongside the staff id — that's a deanonymizing pair.
        console.log('[PUSH] Push token ready for staff registration');
      }

      if (!tokenSaved) {
        toast.error("Your device registered, but we couldn't save your notification settings. Please try again.");
        return { ok: false, prompted };
      }

      publishTokenSaved(true);
      return { ok: true, prompted };
    } catch (error) {
      console.error('[PUSH] Push registration error:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to register for push notifications');
      return { ok: false, prompted };
    } finally {
      await Promise.allSettled([
        handles.registration?.remove() ?? Promise.resolve(),
        handles.error?.remove() ?? Promise.resolve(),
      ]);
    }
  };

  const registerWeb = async () => {
    const permission = await Notification.requestPermission();
    if (permission === 'granted') {
      setIsRegistered(true);
      return true;
    }
    if (permission === 'denied') {
      toast.error('Notifications blocked. Enable them in your browser settings.');
    }
    return false;
  };

  const registerDevice = useCallback(async (options?: PushRegistrationOptions) => {
    const quiet = options?.quiet === true;
    if (isNativePlatform() && nativeRegisterInFlight) {
      return nativeRegisterInFlight;
    }

    setIsRegistering(true);
    const run = (async () => {
      try {
        let result: { ok: boolean; prompted: boolean } = { ok: false, prompted: false };
        if (isNativePlatform()) {
          result = await registerNative(options);
        } else if ('Notification' in window) {
          const ok = await registerWeb();
          result = { ok, prompted: true };
        } else if (!quiet) {
          toast.error('Push notifications are not supported on this device');
        }
        // Already-granted launches re-save the token quietly. The first
        // Allow still confirms, and the settings button always confirms.
        if (result.ok && (!quiet || result.prompted)) {
          toast.success('Notifications enabled!');
        }
        return result.ok;
      } catch (error) {
        console.error('[PUSH] Error enabling notifications:', error);
        if (!quiet) toast.error('Failed to enable notifications');
        return false;
      } finally {
        setIsRegistering(false);
      }
    })();

    if (isNativePlatform()) {
      nativeRegisterInFlight = run.finally(() => {
        nativeRegisterInFlight = null;
      });
      return nativeRegisterInFlight;
    }
    return run;
  // registerNative closes over stable listener handles and staffId. Recreating
  // this callback every render resets the post-login timer before it fires.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [staffId]);

  const requestPermission = useCallback(() => registerDevice(), [registerDevice]);

  return {
    token,
    isSupported,
    isRegistered,
    isRegistering,
    requestPermission,
    registerDevice,
  };
}
