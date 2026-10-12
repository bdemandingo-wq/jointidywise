import { Capacitor } from '@capacitor/core';

export type WebNotificationPermission = 'absent' | 'default' | 'granted' | 'denied';

export interface PushRuntimeFacts {
  platform: string;
  native: boolean;
  bridge: boolean;
  iosShell: boolean;
  pushHeader: boolean;
  webNotification: WebNotificationPermission;
}

type CapacitorWindow = Window & {
  webkit?: { messageHandlers?: { bridge?: unknown } };
  Capacitor?: {
    isPluginAvailable?: (name: string) => boolean;
    PluginHeaders?: Array<{ name?: string }>;
  };
};

/**
 * The iOS shell appends "TidyWise-iOS" to the user agent in capacitor.config.
 * That string is set on the web view itself, so it is still present when
 * webkit.messageHandlers.bridge was not injected and Capacitor.isNativePlatform()
 * is false.
 */
export function isIosAppShell(): boolean {
  if (typeof window === 'undefined') return false;
  return readPushRuntimeFacts().iosShell;
}

export function readPushRuntimeFacts(): PushRuntimeFacts {
  if (typeof window === 'undefined') {
    return {
      platform: 'web',
      native: false,
      bridge: false,
      iosShell: false,
      pushHeader: false,
      webNotification: 'absent',
    };
  }

  const win = window as CapacitorWindow;
  const bridge = !!win.webkit?.messageHandlers?.bridge;
  let platform = 'web';
  let native = false;
  try {
    platform = Capacitor.getPlatform();
    native = Capacitor.isNativePlatform();
  } catch {
    platform = 'web';
    native = false;
  }

  const headers = win.Capacitor?.PluginHeaders ?? [];
  const pushHeader = headers.some((header) => header?.name === 'PushNotifications')
    || win.Capacitor?.isPluginAvailable?.('PushNotifications') === true;

  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  const iosShell = ua.includes('TidyWise-iOS') || platform === 'ios' || bridge;

  let webNotification: WebNotificationPermission = 'absent';
  if (typeof Notification !== 'undefined') {
    const permission = Notification.permission;
    if (permission === 'granted' || permission === 'denied' || permission === 'default') {
      webNotification = permission;
    }
  }

  return { platform, native, bridge, iosShell, pushHeader, webNotification };
}

export interface PushDiagnosticDetail {
  /** receive value from checkPermissions / requestPermissions. */
  permission?: string | null;
  /** UNAuthorizationStatus name from the direct iOS call, when we have one. */
  authorizationStatus?: string | null;
  /** PushNotifications or NotificationAuth. */
  source?: string | null;
  error?: string | null;
}

export function describePushRuntime(facts: PushRuntimeFacts, detail?: PushDiagnosticDetail): string {
  const parts = [
    `Platform: ${facts.platform}`,
    `Bridge: ${facts.bridge ? 'connected' : 'missing'}`,
    `Push plugin: ${facts.pushHeader ? 'registered' : 'not registered'}`,
    `Web Notification: ${facts.webNotification}`,
  ];
  if (detail?.permission) parts.push(`Permission: ${detail.permission}`);
  if (detail?.authorizationStatus) parts.push(`iOS authorization: ${detail.authorizationStatus}`);
  if (detail?.source) parts.push(`Source: ${detail.source}`);
  if (detail?.error) parts.push(`Error: ${detail.error}`);
  return parts.join('. ') + '.';
}

/**
 * Capacitor 8.0.0's plugin proxy returns a callable for every property,
 * including `then` (`core/src/runtime.ts`). An async function that returns
 * that proxy makes the engine adopt it as a thenable and call `proxy.then()`.
 * The native plugin has no `then` method, the call never settles, and the
 * `await` hangs with no error at the call site (ionic-team/capacitor#8469).
 * A plain wrapper is not a thenable, so the await resolves and the caller
 * can use `.plugin` in the same turn.
 */
export function holdPlugin<T extends object>(plugin: T): { plugin: T } {
  return { plugin };
}

export type PushRoute = 'native' | 'web' | 'unavailable';

/**
 * Inside the iOS app, window.Notification is the web view's website API.
 * It does not call UNUserNotificationCenter, so it cannot create the
 * Settings → TidyWise → Notifications row. Only the native plugin can.
 */
export function routePushEnable(facts: PushRuntimeFacts): { route: PushRoute; reason: string | null } {
  const ios = facts.iosShell || facts.platform === 'ios';
  if (ios && !facts.bridge) {
    return {
      route: 'unavailable',
      reason: `This iPhone build is not connected to the native app bridge, so iOS will not show a notification prompt and Settings will not list Notifications. ${describePushRuntime(facts)}`,
    };
  }
  if (ios || facts.native) {
    return { route: 'native', reason: null };
  }
  if (facts.webNotification === 'absent') {
    return {
      route: 'unavailable',
      reason: `Push notifications are not supported on this device. ${describePushRuntime(facts)}`,
    };
  }
  return { route: 'web', reason: null };
}
