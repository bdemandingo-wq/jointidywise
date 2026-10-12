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

export function describePushRuntime(facts: PushRuntimeFacts): string {
  return [
    `Platform: ${facts.platform}`,
    `Bridge: ${facts.bridge ? 'connected' : 'missing'}`,
    `Push plugin: ${facts.pushHeader ? 'registered' : 'not registered'}`,
    `Web Notification: ${facts.webNotification}`,
  ].join('. ') + '.';
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
