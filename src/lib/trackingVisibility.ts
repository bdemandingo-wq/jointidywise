/** A map coordinate. Rejects blanks, NaN, and values outside the earth. */
export function finitePoint(lat: unknown, lng: unknown): { lat: number; lng: number } | null {
  if (lat == null || lng == null || lat === '' || lng === '') return null;
  const la = typeof lat === 'number' ? lat : Number(lat);
  const ln = typeof lng === 'number' ? lng : Number(lng);
  if (!Number.isFinite(la) || !Number.isFinite(ln)) return null;
  if (Math.abs(la) > 90 || Math.abs(ln) > 180) return null;
  return { lat: la, lng: ln };
}

/** GPS older than this is "Paused" rather than live. */
export const TRACKING_STALE_AFTER_SEC = 90;

/** Driving-time lookups are limited to one Google call per cleaner per minute. */
export const DRIVING_ETA_MIN_INTERVAL_MS = 60_000;

/**
 * These booking statuses are no longer "on the way". Pins must leave the map.
 * `in_progress` is the job starting. The database trigger closes the tracking
 * row for the same set; the client hides the pin even if that update is late.
 */
export const TRACKING_CLOSED_STATUSES = ['in_progress', 'completed', 'cancelled', 'no_show'] as const;

export type TrackingPinState = 'live' | 'paused' | 'location_off' | 'hidden';

export type TrackingPinInput = {
  isActive: boolean;
  latitude: unknown;
  longitude: unknown;
  recordedAt: string | null;
  scheduledAt: string | null;
  bookingStatus: string | null | undefined;
  now: number;
};

function isClosedStatus(status: string | null | undefined): boolean {
  return !!status && (TRACKING_CLOSED_STATUSES as readonly string[]).includes(status);
}

/**
 * Whether an active tracking row may appear, and how.
 * A missing or unusable coordinate is location-off: list only, never a pin,
 * including the paused style. A paused fix is shown only until the job's
 * scheduled start.
 */
export function trackingPinState(input: TrackingPinInput): TrackingPinState {
  if (!input.isActive || isClosedStatus(input.bookingStatus)) return 'hidden';
  if (!finitePoint(input.latitude, input.longitude)) return 'location_off';
  const recorded = input.recordedAt ? Date.parse(input.recordedAt) : NaN;
  const ageSec = Number.isFinite(recorded) ? (input.now - recorded) / 1000 : Number.POSITIVE_INFINITY;
  if (ageSec <= TRACKING_STALE_AFTER_SEC) return 'live';
  const start = input.scheduledAt ? Date.parse(input.scheduledAt) : NaN;
  if (Number.isFinite(start) && input.now >= start) return 'hidden';
  return 'paused';
}

export function showsMapPin(state: TrackingPinState): boolean {
  return state === 'live' || state === 'paused';
}

/** Paused marker label. `recordedAt` is the last GPS fix, not the schedule. */
export function pausedLastSeenLabel(recordedAt: string | null, now: number): string {
  const recorded = recordedAt ? Date.parse(recordedAt) : NaN;
  if (!Number.isFinite(recorded)) return 'Paused · last seen unknown';
  const mins = Math.max(0, Math.round((now - recorded) / 60_000));
  if (mins < 1) return 'Paused · last seen just now';
  return `Paused · last seen ${mins} min ago`;
}

/**
 * Someone who tapped On My Way but never produced a usable fix.
 * Closed jobs are not en route. A usable fix is a pin (or a paused pin),
 * not this state.
 */
export function isLocationOffEnRoute(input: {
  bookingStatus: string | null | undefined;
  hasUsableFix: boolean;
}): boolean {
  if (input.hasUsableFix) return false;
  if (isClosedStatus(input.bookingStatus)) return false;
  return true;
}

export function shouldRequestDrivingEta(lastRequestedAt: number | null, now: number, stale: boolean): boolean {
  if (stale) return false;
  if (lastRequestedAt == null) return true;
  return now - lastRequestedAt >= DRIVING_ETA_MIN_INTERVAL_MS;
}

export type NextJobCandidate = {
  scheduledAt: string;
  status: string | null;
  isDraft?: boolean | null;
};

/** Earliest still-open job whose start is still ahead. Past jobs are not "next". */
export function pickNextJob<T extends NextJobCandidate>(jobs: T[], now: number): T | null {
  const upcoming = jobs
    .filter((job) => {
      if (job.isDraft) return false;
      if (isClosedStatus(job.status)) return false;
      const start = Date.parse(job.scheduledAt);
      return Number.isFinite(start) && start >= now;
    })
    .sort((a, b) => Date.parse(a.scheduledAt) - Date.parse(b.scheduledAt) || a.scheduledAt.localeCompare(b.scheduledAt));
  return upcoming[0] ?? null;
}

export type ClusterItem = { lat: number; lng: number };

/** Groups fixes that sit on top of each other. ~0.0008° is about 90 meters. */
export function clusterNearby<T extends ClusterItem>(items: T[], thresholdDeg = 0.0008): T[][] {
  const groups: T[][] = [];
  for (const item of items) {
    const group = groups.find((existing) => {
      const anchor = existing[0];
      return Math.abs(anchor.lat - item.lat) <= thresholdDeg && Math.abs(anchor.lng - item.lng) <= thresholdDeg;
    });
    if (group) group.push(item);
    else groups.push([item]);
  }
  return groups;
}
