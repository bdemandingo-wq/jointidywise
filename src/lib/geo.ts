import { Capacitor } from '@capacitor/core';

/**
 * Shared location read for the cleaner portal.
 *
 * High-accuracy GPS with maximumAge 0 is what made check-in sit for ~20s
 * indoors and then give up: a fresh satellite fix often never arrives inside
 * a house, and the timeout does not start until the permission prompt is
 * dismissed. This tries a coarse/cached fix first (Wi-Fi and cell, which
 * work indoors), then a real GPS lock, then one last coarse read.
 *
 * On iOS the read goes through @capacitor/geolocation (CLLocationManager).
 * The browser geolocation API is only the web fallback.
 */

export interface GeoPosition {
  latitude: number;
  longitude: number;
  accuracy: number | null;
}

export type GeoFailureCode = 'denied' | 'timeout' | 'unavailable' | 'unknown';

type PositionRequest = {
  enableHighAccuracy: boolean;
  timeout: number;
  maximumAge: number;
};

export function geoFailureCode(err: unknown): GeoFailureCode {
  const code = (err as { code?: number | string } | null)?.code;
  const message = String((err as { message?: string } | null)?.message ?? err ?? '').toLowerCase();
  const codeText = String(code ?? '');

  if (
    code === 1 ||
    message.includes('denied') ||
    message.includes('not authorized') ||
    message.includes('permission') ||
    codeText.includes('0003') ||
    codeText.includes('0008') ||
    codeText.includes('0009')
  ) {
    return 'denied';
  }
  if (
    code === 3 ||
    message.includes('timeout') ||
    message.includes('timed out') ||
    message.includes('in time') ||
    codeText.includes('0010')
  ) {
    return 'timeout';
  }
  if (
    code === 2 ||
    message.includes('unavailable') ||
    message.includes('not enabled') ||
    message.includes('restricted') ||
    codeText.includes('0002') ||
    codeText.includes('0007')
  ) {
    return 'unavailable';
  }
  return 'unknown';
}

export function geoFailureLabel(code: GeoFailureCode): string {
  switch (code) {
    case 'denied':
      return 'Location access denied. Enable location for TidyWise in Settings, While Using the App.';
    case 'timeout':
      return "Couldn't get a location fix (timed out).";
    case 'unavailable':
      return 'Location services are off or there is no signal.';
    default:
      return "Couldn't read your location.";
  }
}

async function readPosition(options: PositionRequest): Promise<GeoPosition> {
  if (Capacitor.isNativePlatform()) {
    const { Geolocation } = await import('@capacitor/geolocation');
    const pos = await Geolocation.getCurrentPosition(options);
    return {
      latitude: pos.coords.latitude,
      longitude: pos.coords.longitude,
      accuracy: pos.coords.accuracy ?? null,
    };
  }

  if (!navigator.geolocation) {
    throw Object.assign(new Error('Geolocation is not available on this device'), { code: 2 });
  }

  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({
        latitude: pos.coords.latitude,
        longitude: pos.coords.longitude,
        accuracy: pos.coords.accuracy ?? null,
      }),
      reject,
      options,
    );
  });
}

/**
 * Fast path first. A cached or network fix is usually back in under a second
 * and is accurate enough to check in and start a tracking link. GPS is the
 * second attempt, for when the device can actually see satellites.
 */
export async function getPositionWithFallback(): Promise<GeoPosition> {
  try {
    return await readPosition({ enableHighAccuracy: false, timeout: 5000, maximumAge: 120_000 });
  } catch (err) {
    if (geoFailureCode(err) === 'denied') throw err;
  }

  try {
    return await readPosition({ enableHighAccuracy: true, timeout: 8000, maximumAge: 0 });
  } catch (err) {
    if (geoFailureCode(err) === 'denied') throw err;
  }

  // Last resort: accept a coarse fix up to five minutes old. Indoors this is
  // often the only reading the device will ever produce.
  return await readPosition({ enableHighAccuracy: false, timeout: 8000, maximumAge: 300_000 });
}
