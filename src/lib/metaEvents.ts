/**
 * Native Meta app events and App Tracking Transparency used to go through
 * the Facebook iOS SDK. That SDK is removed so the App Store binary does
 * not track users. The website Meta pixel in TrackingPixels.tsx is unchanged.
 * These functions stay so existing callers compile, and they do nothing.
 */

export async function logMetaEvent(
  _name: string,
  _params?: Record<string, string | number>,
): Promise<void> {
  return;
}

export async function logMetaPurchase(_amount: number, _currency: string): Promise<void> {
  return;
}

export async function requestTrackingPermission(): Promise<string> {
  return 'not_applicable';
}
