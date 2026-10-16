import { registerPlugin } from '@capacitor/core';

/**
 * Local iOS plugin (ios/App/App/NotificationAuthPlugin.swift).
 *
 * It calls UNUserNotificationCenter from the app target. The Capacitor push
 * plugin stays the path that saves the APNs token. This one exists so a hung
 * or missing PushNotifications method can still present the system prompt.
 * That prompt is what creates Settings → TidyWise → Notifications.
 *
 * The proxy is created here, at module scope. Do not return it from an async
 * function: Capacitor 8.0.0 treats plugin proxies as thenables and the await
 * never resolves.
 *
 * register() also returns the APNs device token when the app delegate has
 * one. PushNotifications.register() resolves before that token exists.
 */
export interface NotificationAuthResult {
  receive?: string;
  authorizationStatus?: string;
  source?: string;
  error?: string;
  /** Hex APNs device token, when register() waited for or already had one. */
  token?: string;
}

export interface NotificationAuthPlugin {
  checkPermissions(): Promise<NotificationAuthResult>;
  requestPermissions(): Promise<NotificationAuthResult>;
  register(): Promise<NotificationAuthResult>;
}

export const NotificationAuth = registerPlugin<NotificationAuthPlugin>('NotificationAuth');
