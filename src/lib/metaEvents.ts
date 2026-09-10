import { registerPlugin } from '@capacitor/core';
import { Capacitor } from '@capacitor/core';

export interface MetaEventsPlugin {
  logEvent(options: { name: string; params?: Record<string, string | number> }): Promise<void>;
  logPurchase(options: { amount: number; currency: string }): Promise<void>;
  requestTracking(): Promise<{ status: string }>;
}

const MetaEvents = registerPlugin<MetaEventsPlugin>('MetaEvents');

/**
 * Log a Meta (Facebook) standard or custom event.
 * No-ops silently on web — events only fire on native iOS.
 */
export async function logMetaEvent(name: string, params?: Record<string, string | number>): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  try {
    await MetaEvents.logEvent({ name, params });
  } catch (err) {
    console.log('[MetaEvents] logEvent failed (non-critical):', err);
  }
}

/**
 * Log a Meta purchase event.
 * No-ops silently on web.
 */
export async function logMetaPurchase(amount: number, currency: string): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  try {
    await MetaEvents.logPurchase({ amount, currency });
  } catch (err) {
    console.log('[MetaEvents] logPurchase failed (non-critical):', err);
  }
}

/**
 * Request App Tracking Transparency authorization.
 * Call this AFTER the app is fully loaded — not during startup.
 * No-ops on web; returns "authorized" on iOS < 14.
 */
export async function requestTrackingPermission(): Promise<string> {
  if (!Capacitor.isNativePlatform()) return 'not_applicable';
  try {
    const result = await MetaEvents.requestTracking();
    return result.status;
  } catch (err) {
    console.log('[MetaEvents] requestTracking failed (non-critical):', err);
    return 'error';
  }
}
