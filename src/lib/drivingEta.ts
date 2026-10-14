import { supabase } from '@/lib/supabase';
import { calculateDistanceMiles } from '@/lib/distanceUtils';
import { shouldRequestDrivingEta } from '@/lib/trackingVisibility';

export type DrivingEta = { durationMinutes: number; distanceMiles: number };

const requestedAt = new Map<string, number>();
const cached = new Map<string, DrivingEta>();

function fallbackEta(origin: { lat: number; lng: number }, dest: { lat: number; lng: number }): DrivingEta {
  const dist = calculateDistanceMiles(origin.lat, origin.lng, dest.lat, dest.lng) * 1.4;
  return {
    durationMinutes: Math.round((dist / 25) * 60),
    distanceMiles: Math.round(dist * 10) / 10,
  };
}

/**
 * One Google lookup per cleaner per minute. Stale rows skip the network
 * and return null so a paused pin does not show an ETA. The cache key is
 * the tracking row, not the latest coordinate, so a GPS ping does not
 * bust the minute window.
 */
export async function loadDrivingEta(args: {
  cleanerId: string;
  organizationId: string;
  origin: { lat: number; lng: number };
  dest: { lat: number; lng: number };
  stale: boolean;
  now?: number;
}): Promise<DrivingEta | null> {
  if (args.stale) return null;
  const now = args.now ?? Date.now();
  const previous = requestedAt.get(args.cleanerId) ?? null;
  if (!shouldRequestDrivingEta(previous, now, false)) {
    return cached.get(args.cleanerId) ?? null;
  }
  requestedAt.set(args.cleanerId, now);
  try {
    const { data, error } = await supabase.functions.invoke('get-driving-eta', {
      body: {
        organizationId: args.organizationId,
        originLat: args.origin.lat,
        originLng: args.origin.lng,
        destLat: args.dest.lat,
        destLng: args.dest.lng,
      },
    });
    if (!error && data && !data.fallback && typeof data.durationMinutes === 'number') {
      const eta: DrivingEta = {
        durationMinutes: data.durationMinutes,
        distanceMiles: typeof data.distanceMiles === 'number' ? data.distanceMiles : 0,
      };
      cached.set(args.cleanerId, eta);
      return eta;
    }
  } catch {
    // Fall through to the local estimate. The minute window still applies.
  }
  const eta = fallbackEta(args.origin, args.dest);
  cached.set(args.cleanerId, eta);
  return eta;
}

export function forgetDrivingEta(cleanerId: string) {
  requestedAt.delete(cleanerId);
  cached.delete(cleanerId);
}
