import { Capacitor } from '@capacitor/core';
import {
  classifyPermissionFailure,
  classifyPluginStatus,
  classifyWebPermission,
  type LocationStatusKind,
} from '@/lib/locationPermission';
import type { OsLocationState } from '@/lib/locationConsent';

export function osStateFromKind(kind: LocationStatusKind): OsLocationState {
  if (kind === 'on-always' || kind === 'on-while-using') return 'granted';
  if (kind === 'off') return 'denied';
  if (kind === 'not-asked') return 'prompt';
  return 'unknown';
}

/** Reads the current permission. Does not prompt. */
export async function readOsLocationState(): Promise<OsLocationState> {
  if (Capacitor.isNativePlatform()) {
    try {
      const { Geolocation } = await import('@capacitor/geolocation');
      const status = await Geolocation.checkPermissions();
      return osStateFromKind(classifyPluginStatus(status).kind);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err ?? '');
      return osStateFromKind(classifyPermissionFailure(message).kind);
    }
  }

  let permission: 'granted' | 'denied' | 'prompt' | null = null;
  try {
    if (typeof navigator !== 'undefined' && navigator.permissions?.query) {
      const status = await navigator.permissions.query({ name: 'geolocation' });
      if (status.state === 'granted' || status.state === 'denied' || status.state === 'prompt') {
        permission = status.state;
      }
    }
  } catch {
    permission = null;
  }

  return osStateFromKind(
    classifyWebPermission({
      hasGeolocation: typeof navigator !== 'undefined' && !!navigator.geolocation,
      permission,
    }).kind,
  );
}
