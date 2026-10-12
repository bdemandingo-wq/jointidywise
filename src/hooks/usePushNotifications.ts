import { useEffect, useState, useCallback, useRef } from 'react';
import { Capacitor } from '@capacitor/core';
import { PushNotifications } from '@capacitor/push-notifications';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { NotificationAuth } from '@/lib/notificationAuth';
import {
  describePushRuntime,
  readPushRuntimeFacts,
  routePushEnable,
  type PushDiagnosticDetail,
} from '@/lib/pushRuntime';

// PushNotifications is created here, at module scope, the same way MetaEvents
// is. App Tracking Transparency shows because requestTrackingPermission awaits
// MetaEvents.requestTracking() — a real Promise. Awaiting a helper that
// *returns* the push plugin does not. Capacitor 8.0.0's proxy answers `.then`
// with a native method wrapper, the engine treats that return value as a
// thenable, and the await hangs before requestPermissions runs
// (ionic-team/capacitor#8469). Do not return this proxy from an async function.

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

// checkPermissions and a plugin call that never reached iOS must not spin.
// requestAuthorization on the direct plugin waits until the person taps the
// system dialog, so that call gets a longer limit.
const NATIVE_RESPONSE_TIMEOUT_MS = 10_000;
const SYSTEM_PROMPT_TIMEOUT_MS = 60_000;

type PermissionReceive = 'granted' | 'denied' | 'prompt' | 'missing';

interface PermissionRead {
  receive: PermissionReceive;
  source: string;
  authorizationStatus?: string;
  error?: string;
}

function asPermissionRead(
  status: { receive?: string; authorizationStatus?: string; error?: string; source?: string } | null | undefined,
  source: string,
): PermissionRead {
  const receive: PermissionReceive = status?.receive === 'granted' || status?.receive === 'denied' || status?.receive === 'prompt'
    ? status.receive
    : 'missing';
  return {
    receive,
    source: status?.source || source,
    authorizationStatus: status?.authorizationStatus,
    error: status?.error,
  };
}

function diagnosticFrom(read: PermissionRead | null, error?: string | null): PushDiagnosticDetail {
  const reportedError = error || read?.error || null;
  return {
    permission: read?.receive ?? (reportedError ? 'no result' : null),
    authorizationStatus: read?.authorizationStatus ?? null,
    source: read?.source ?? null,
    error: reportedError,
  };
}

// Race a native call against a timeout so a stalled bridge (no resolve, no
// reject) becomes a visible error. Rejects with `label` context. A late
// rejection from the abandoned call is swallowed so it does not surface as
// an unhandled rejection after the timeout already won.
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timeoutId: number;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = window.setTimeout(
      () => reject(new Error(`${label} timed out after ${ms / 1000}s. The native layer never responded.`)),
      ms,
    );
  });
  void promise.catch(() => {});
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

    // Already-denied is a settled OS state. Calling requestPermissions again
    // does not show a dialog and must not toast on every cold start.
    // The official plugin is tried first. If that call does not return in
    // 10s, NotificationAuth calls requestAuthorization in the app target.
    // That is the call that creates Settings → TidyWise → Notifications.
    let prompted = false;
    let permission: PermissionRead | null = null;
    let officialError: string | null = null;

    const reportPermission = (phase: 'working' | 'failed', message: string, error?: string | null) => {
      publishPushStatus({
        phase,
        message: `${message} ${describePushRuntime(facts, diagnosticFrom(permission, error))}`,
      });
    };

    try {
      permission = asPermissionRead(
        await withTimeout(
          PushNotifications.checkPermissions(),
          NATIVE_RESPONSE_TIMEOUT_MS,
          'PushNotifications.checkPermissions()',
        ),
        'PushNotifications',
      );
      if (permission.receive === 'missing') {
        throw new Error('PushNotifications.checkPermissions() returned no permission state.');
      }
      if (permission.receive !== 'granted' && permission.receive !== 'denied') {
        prompted = true;
        reportPermission('working', 'iOS has not asked yet. Asking the push plugin to show the notification prompt…');
        permission = asPermissionRead(
          await withTimeout(
            PushNotifications.requestPermissions(),
            NATIVE_RESPONSE_TIMEOUT_MS,
            'PushNotifications.requestPermissions()',
          ),
          'PushNotifications',
        );
        if (permission.receive !== 'granted' && permission.receive !== 'denied') {
          throw new Error(`PushNotifications.requestPermissions() returned ${permission.receive}. The system dialog was not completed.`);
        }
      }
    } catch (error) {
      officialError = error instanceof Error ? error.message : String(error);
      console.error('[PUSH] PushNotifications permission call failed:', officialError);
      try {
        reportPermission(
          'working',
          'No permission result yet. Asking iOS directly…',
          officialError,
        );
        permission = asPermissionRead(
          await withTimeout(
            NotificationAuth.checkPermissions(),
            NATIVE_RESPONSE_TIMEOUT_MS,
            'NotificationAuth.checkPermissions()',
          ),
          'NotificationAuth',
        );
        if (permission.receive !== 'granted' && permission.receive !== 'denied') {
          prompted = true;
          reportPermission(
            'working',
            'Waiting for the iOS notification prompt…',
            officialError,
          );
          permission = asPermissionRead(
            await withTimeout(
              NotificationAuth.requestPermissions(),
              SYSTEM_PROMPT_TIMEOUT_MS,
              'NotificationAuth.requestPermissions()',
            ),
            'NotificationAuth',
          );
        }
      } catch (fallbackError) {
        const fallbackMessage = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
        const combined = `${officialError} | ${fallbackMessage}`;
        console.error('[PUSH] direct notification permission failed:', fallbackMessage);
        return {
          ok: false,
          prompted,
          hard: true,
          message: `Couldn't enable notifications. ${combined} ${describePushRuntime(facts, diagnosticFrom(permission, combined))}`,
        };
      }
    }

    if (!permission || permission.receive === 'missing') {
      const message = `TidyWise asked the iPhone for notification permission, but iOS did not return a permission state, so the system dialog was not shown. ${describePushRuntime(facts, diagnosticFrom(permission, officialError))}`;
      console.error('[PUSH]', message);
      return { ok: false, prompted, hard: true, message };
    }
    if (permission.error) {
      officialError = officialError ? `${officialError} | ${permission.error}` : permission.error;
    }
    if (permission.receive === 'denied') {
      const message = `Notifications are off for TidyWise. Open the iPhone Settings app, tap TidyWise, tap Notifications, and turn Allow Notifications on. ${describePushRuntime(facts, diagnosticFrom(permission, officialError))}`;
      return { ok: false, prompted, hard: false, message };
    }
    if (permission.receive !== 'granted') {
      // Still `prompt` means iOS has not recorded a choice, so Settings has
      // no Notifications row yet. Sending the person there cannot help.
      const message = `iOS has not recorded a notification choice, so the system prompt did not finish. ${describePushRuntime(facts, diagnosticFrom(permission, officialError))}`;
      return { ok: false, prompted: true, hard: true, message };
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
        }, 25000);

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

            try {
              await withTimeout(
                PushNotifications.register(),
                NATIVE_RESPONSE_TIMEOUT_MS,
                'PushNotifications.register()',
              );
            } catch (registerError) {
              console.error('[PUSH] PushNotifications.register() failed; calling registerForRemoteNotifications directly', registerError);
              await withTimeout(
                NotificationAuth.register(),
                NATIVE_RESPONSE_TIMEOUT_MS,
                'NotificationAuth.register()',
              );
            }
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
      return {
        ok: false,
        prompted,
        hard: true,
        message: `${detail} ${describePushRuntime(readPushRuntimeFacts(), diagnosticFrom(permission, officialError))}`,
      };
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
