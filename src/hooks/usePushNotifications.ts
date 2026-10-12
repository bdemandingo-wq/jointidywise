import { useEffect, useState, useCallback, useRef } from 'react';
import { Capacitor } from '@capacitor/core';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import {
  describePushRuntime,
  readPushRuntimeFacts,
  routePushEnable,
} from '@/lib/pushRuntime';

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
// can both fire during the same launch. The promise resolves with a message
// the screen can show; it does not toast. Callers decide whether to toast.
let nativeRegisterInFlight: Promise<PushAttempt> | null = null;

export type PushStatusPhase = 'idle' | 'working' | 'saved' | 'failed';

export interface PushStatus {
  phase: PushStatusPhase;
  message: string;
}

export interface PushAttempt {
  ok: boolean;
  prompted: boolean;
  /** Bridge missing, plugin missing, timeout, or a thrown native error. */
  hard: boolean;
  message: string;
}

let pushStatus: PushStatus = { phase: 'idle', message: '' };
const statusListeners = new Set<(status: PushStatus) => void>();

function publishPushStatus(next: PushStatus) {
  pushStatus = next;
  statusListeners.forEach((listener) => listener(next));
}

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

// checkPermissions should return immediately. A hang means the bridge accepted
// the call and never answered (plugin not on the bridge). The system dialog
// itself is requestPermissions, so that wait is long enough for a person to
// read the prompt and tap it.
const CHECK_TIMEOUT_MS = 8000;
const REQUEST_TIMEOUT_MS = 45000;

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
  const [status, setStatus] = useState<PushStatus>(pushStatus);
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
    statusListeners.add(setStatus);
    setStatus(pushStatus);
    return () => {
      registeredListeners.delete(setIsRegistered);
      statusListeners.delete(setStatus);
    };
  }, []);

  useEffect(() => {
    // Check support for native or web. OS permission "granted" is not the
    // same as a token saved on our server — checkPermissions used to flip
    // isRegistered and the staff portal then skipped register() entirely.
    const facts = readPushRuntimeFacts();
    // The iOS shell must not treat window.Notification as "already registered".
    // That API is the web view, not the app's Settings permission, and a
    // granted/denied value there used to hide the Enable button.
    if (facts.iosShell || isNativePlatform()) {
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

  const registerNative = async (options?: PushRegistrationOptions): Promise<PushAttempt> => {
    const organizationId = options?.organizationId ?? null;
    const facts = readPushRuntimeFacts();
    const PushNotifications = await getPushPlugin();
    if (!PushNotifications) {
      const message = `Push notifications are not available on this device. ${describePushRuntime(facts)}`;
      console.error('[PUSH]', message);
      return { ok: false, prompted: false, hard: true, message };
    }

    const permissionState = (status: { receive?: string } | null | undefined): 'granted' | 'denied' | 'prompt' | 'missing' => {
      if (status?.receive === 'granted' || status?.receive === 'denied' || status?.receive === 'prompt') {
        return status.receive;
      }
      return 'missing';
    };

    // Already-denied is a settled OS state. Calling requestPermissions again
    // does not show a dialog and must not toast on every cold start.
    // Both calls are timed out. A missing plugin makes Capacitor drop the
    // call without resolving the promise, and a quiet caller used to wait
    // forever — the Enable button then joined that same promise and the
    // screen never changed.
    let prompted = false;
    try {
      const current = permissionState(await withTimeout(
        PushNotifications.checkPermissions(),
        CHECK_TIMEOUT_MS,
        'PushNotifications.checkPermissions()',
      ));
      if (current === 'missing') {
        const message = `TidyWise asked the iPhone for notification permission, but the push plugin did not return a permission state, so the system dialog was not shown. ${describePushRuntime(facts)}`;
        console.error('[PUSH]', message);
        return { ok: false, prompted: false, hard: true, message };
      }
      if (current === 'denied') {
        const message = 'Notifications are off for TidyWise. Open the iPhone Settings app, tap TidyWise, tap Notifications, and turn Allow Notifications on.';
        return { ok: false, prompted: false, hard: false, message };
      }
      if (current !== 'granted') {
        prompted = true;
        const permStatus = permissionState(await withTimeout(
          PushNotifications.requestPermissions(),
          REQUEST_TIMEOUT_MS,
          'PushNotifications.requestPermissions()',
        ));
        if (permStatus === 'missing') {
          const message = `TidyWise asked the iPhone to show the notification prompt, but the push plugin did not return a permission state, so the system dialog was not shown. ${describePushRuntime(facts)}`;
          console.error('[PUSH]', message);
          return { ok: false, prompted: true, hard: true, message };
        }
        if (permStatus !== 'granted') {
          const message = 'Notifications were not allowed. To turn them on later, open the iPhone Settings app, tap TidyWise, then Notifications.';
          return { ok: false, prompted: true, hard: false, message };
        }
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      const message = `Couldn't enable notifications. ${detail} ${describePushRuntime(facts)}`;
      console.error('[PUSH] requestPermissions failed or stalled:', detail);
      return { ok: false, prompted, hard: true, message };
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
        const message = "Your iPhone registered with Apple, but TidyWise couldn't save the device token. Pull to refresh and tap Enable Notifications again.";
        return { ok: false, prompted, hard: true, message };
      }

      publishTokenSaved(true);
      return { ok: true, prompted, hard: false, message: 'Notifications are enabled on this iPhone.' };
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Failed to register for push notifications';
      console.error('[PUSH] Push registration error:', error);
      return { ok: false, prompted, hard: true, message: `${detail} ${describePushRuntime(readPushRuntimeFacts())}` };
    } finally {
      await Promise.allSettled([
        handles.registration?.remove() ?? Promise.resolve(),
        handles.error?.remove() ?? Promise.resolve(),
      ]);
    }
  };

  const registerWeb = async (): Promise<PushAttempt> => {
    const permission = await Notification.requestPermission();
    if (permission === 'granted') {
      setIsRegistered(true);
      return { ok: true, prompted: true, hard: false, message: 'Notifications are enabled in this browser.' };
    }
    if (permission === 'denied') {
      return {
        ok: false,
        prompted: true,
        hard: false,
        message: 'Notifications are blocked in this browser. Allow them for this site in the browser settings, then try again.',
      };
    }
    return {
      ok: false,
      prompted: true,
      hard: false,
      message: 'The browser did not grant notification permission.',
    };
  };

  const registerDevice = useCallback(async (options?: PushRegistrationOptions) => {
    const quiet = options?.quiet === true;
    const facts = readPushRuntimeFacts();
    const decision = routePushEnable(facts);

    // A tap must change the screen even when a quiet post-login call is
    // already waiting. Joining that promise used to return before
    // setIsRegistering, so the button looked dead.
    if (!quiet) setIsRegistering(true);
    publishPushStatus({
      phase: 'working',
      message: decision.route === 'native'
        ? `Asking iOS to show the notification prompt… ${describePushRuntime(facts)}`
        : 'Asking this device for notification permission…',
    });

    const finish = (result: PushAttempt) => {
      if (result.ok) {
        publishPushStatus({ phase: 'saved', message: result.message });
        if (!quiet || result.prompted) toast.success('Notifications enabled!');
      } else {
        publishPushStatus({ phase: 'failed', message: result.message });
        // A quiet cold start should not toast when the person simply
        // declines. A stall, a missing bridge, or a plugin error should.
        if (!quiet || result.hard) toast.error(result.message, { duration: 12000 });
      }
      return result.ok;
    };

    try {
      if (decision.route === 'unavailable') {
        const result: PushAttempt = {
          ok: false,
          prompted: false,
          hard: true,
          message: decision.reason ?? `Push notifications are not available. ${describePushRuntime(facts)}`,
        };
        console.error('[PUSH]', result.message);
        return finish(result);
      }

      if (decision.route === 'native') {
        if (!nativeRegisterInFlight) {
          const run = registerNative(options).finally(() => {
            nativeRegisterInFlight = null;
          });
          nativeRegisterInFlight = run;
        }
        return finish(await nativeRegisterInFlight);
      }

      return finish(await registerWeb());
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Failed to enable notifications';
      console.error('[PUSH] Error enabling notifications:', error);
      return finish({
        ok: false,
        prompted: false,
        hard: true,
        message: `${detail} ${describePushRuntime(facts)}`,
      });
    } finally {
      if (!quiet) setIsRegistering(false);
    }
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
    status,
    runtimeFacts: readPushRuntimeFacts(),
    requestPermission,
    registerDevice,
  };
}
