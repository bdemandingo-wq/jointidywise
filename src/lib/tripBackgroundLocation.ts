import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import {
  TRIP_DISTANCE_FILTER_METERS,
  TRIP_MAX_DURATION_MS,
  classifyTripAuth,
  type TripLocationAuth,
} from './tripLocationSession.ts';

/** Matches useCleanerTracking's 8 second database throttle. */
const NATIVE_WRITE_INTERVAL_SECONDS = 8;

interface TripBackgroundLocationPlugin {
  checkAuthorization(): Promise<{ status?: string }>;
  requestAlways(): Promise<{ status?: string }>;
  start(options: {
    distanceFilter: number;
    maxDurationSeconds: number;
    trackingId: string;
    supabaseUrl: string;
    supabaseAnonKey: string;
    writeIntervalSeconds: number;
    destinationLat?: number;
    destinationLng?: number;
    bookingId?: string;
    staffId?: string;
  }): Promise<{ epoch?: number }>;
  stop(): Promise<void>;
  addListener(
    eventName: 'location',
    listenerFunc: (event: TripNativeEvent & { latitude?: number; longitude?: number }) => void,
  ): Promise<PluginListenerHandle>;
  addListener(
    eventName: 'authorization',
    listenerFunc: (event: TripNativeEvent & { status?: string }) => void,
  ): Promise<PluginListenerHandle>;
  addListener(
    eventName: 'timeout',
    listenerFunc: (event: TripNativeEvent) => void,
  ): Promise<PluginListenerHandle>;
  addListener(
    eventName: 'arrival',
    listenerFunc: (event: TripNativeEvent) => void,
  ): Promise<PluginListenerHandle>;
}

interface TripNativeEvent {
  reason?: string;
  sms?: string;
  epoch?: number;
  trackingId?: string;
}

const TripBackgroundLocation = registerPlugin<TripBackgroundLocationPlugin>('TripBackgroundLocation');

type PositionHandler = (latitude: number, longitude: number) => void;
type AuthorizationHandler = (auth: TripLocationAuth) => void;
export type NativeStopReason = 'arrived' | 'closed' | 'timeout';
type NativeStopHandler = (reason: NativeStopReason, sms?: string) => void;

let generation = 0;
let started = false;
let acceptedEpoch: number | null = null;
let activeTrackingId: string | null = null;
let idleStopStarted = false;
let idleStop: Promise<void> = Promise.resolve();
let positionHandler: PositionHandler | null = null;
let authorizationHandler: AuthorizationHandler | null = null;
let nativeStopHandler: NativeStopHandler | null = null;
let locationListener: PluginListenerHandle | null = null;
let authorizationListener: PluginListenerHandle | null = null;
let timeoutListener: PluginListenerHandle | null = null;
let arrivalListener: PluginListenerHandle | null = null;

function acceptsNativeEvent(event: TripNativeEvent | undefined): boolean {
  if (typeof event?.epoch === 'number' && acceptedEpoch != null && event.epoch !== acceptedEpoch) return false;
  if (event?.trackingId && activeTrackingId && event.trackingId !== activeTrackingId) return false;
  return true;
}

function nativeStopReason(value: string | undefined, fallback: NativeStopReason): NativeStopReason {
  if (value === 'arrived' || value === 'closed' || value === 'timeout') return value;
  return fallback;
}

async function removeListeners(): Promise<void> {
  const location = locationListener;
  const authorization = authorizationListener;
  const timeout = timeoutListener;
  const arrival = arrivalListener;
  locationListener = null;
  authorizationListener = null;
  timeoutListener = null;
  arrivalListener = null;
  if (location) {
    try { await location.remove(); } catch { /* already gone */ }
  }
  if (authorization) {
    try { await authorization.remove(); } catch { /* already gone */ }
  }
  if (timeout) {
    try { await timeout.remove(); } catch { /* already gone */ }
  }
  if (arrival) {
    try { await arrival.remove(); } catch { /* already gone */ }
  }
}

/**
 * JS startup has no active trip. Stop a native watcher left running by a
 * previous webview. start waits for this so the two calls cannot overlap.
 */
export function stopIdleNativeTripWatcher(): Promise<void> {
  if (Capacitor.getPlatform() !== 'ios') return Promise.resolve();
  if (started || idleStopStarted) return idleStop;
  idleStopStarted = true;
  idleStop = (async () => {
    if (started) return;
    try {
      await TripBackgroundLocation.stop();
    } catch {
      // stop is idempotent; a missing plugin must not block startup
    }
  })();
  return idleStop;
}

export async function readTripLocationAuth(): Promise<TripLocationAuth> {
  const result = await TripBackgroundLocation.checkAuthorization();
  return classifyTripAuth(result?.status);
}

export async function requestTripAlwaysAuthorization(): Promise<TripLocationAuth> {
  const result = await TripBackgroundLocation.requestAlways();
  return classifyTripAuth(result?.status);
}

export interface TripBackgroundWriteTarget {
  trackingId: string;
  supabaseUrl: string;
  supabaseAnonKey: string;
  destinationLat?: number;
  destinationLng?: number;
  bookingId?: string;
  staffId?: string;
}

/**
 * One native watcher for the process. A later start replaces the callbacks
 * and returns a new token; an older token cannot stop that later watcher.
 * While the app is open, positions go to the existing JS write path.
 * While the phone is locked, the native plugin writes them itself.
 */
export async function startTripBackgroundUpdates(
  onPosition: PositionHandler,
  onAuthorization?: AuthorizationHandler,
  onNativeStop?: NativeStopHandler,
  maxDurationSeconds?: number,
  writeTarget?: TripBackgroundWriteTarget,
): Promise<number> {
  const nextTrackingId = writeTarget?.trackingId ?? '';
  if (started && activeTrackingId && nextTrackingId && activeTrackingId !== nextTrackingId) {
    throw new Error('A trip watcher is already running.');
  }
  const token = ++generation;
  await idleStop;
  if (token !== generation) return token;
  positionHandler = onPosition;
  authorizationHandler = onAuthorization ?? null;
  nativeStopHandler = onNativeStop ?? null;

  if (started) return token;

  const lat = writeTarget?.destinationLat;
  const lng = writeTarget?.destinationLng;
  const hasDestination = typeof lat === 'number' && Number.isFinite(lat)
    && typeof lng === 'number' && Number.isFinite(lng);

  try {
    // start clears retained events. Listeners attach after that so a
    // timeout or arrival from the previous trip is not replayed.
    await removeListeners();
    const startedResult = await TripBackgroundLocation.start({
      distanceFilter: TRIP_DISTANCE_FILTER_METERS,
      maxDurationSeconds: maxDurationSeconds ?? TRIP_MAX_DURATION_MS / 1000,
      trackingId: nextTrackingId,
      supabaseUrl: writeTarget?.supabaseUrl ?? '',
      supabaseAnonKey: writeTarget?.supabaseAnonKey ?? '',
      writeIntervalSeconds: NATIVE_WRITE_INTERVAL_SECONDS,
      ...(hasDestination ? { destinationLat: lat, destinationLng: lng } : {}),
      bookingId: writeTarget?.bookingId ?? '',
      staffId: writeTarget?.staffId ?? '',
    });
    if (token !== generation) {
      try { await TripBackgroundLocation.stop(); } catch { /* start lost the race with stop */ }
      return token;
    }
    acceptedEpoch = typeof startedResult?.epoch === 'number' ? startedResult.epoch : null;
    activeTrackingId = nextTrackingId || null;
    locationListener = await TripBackgroundLocation.addListener('location', (event) => {
      if (!acceptsNativeEvent(event)) return;
      if (typeof event?.latitude !== 'number' || typeof event?.longitude !== 'number') return;
      positionHandler?.(event.latitude, event.longitude);
    });
    authorizationListener = await TripBackgroundLocation.addListener('authorization', (event) => {
      if (!acceptsNativeEvent(event)) return;
      authorizationHandler?.(classifyTripAuth(event?.status));
    });
    timeoutListener = await TripBackgroundLocation.addListener('timeout', (event) => {
      if (!acceptsNativeEvent(event)) return;
      nativeStopHandler?.(nativeStopReason(event?.reason, 'timeout'), event?.sms);
    });
    arrivalListener = await TripBackgroundLocation.addListener('arrival', (event) => {
      if (!acceptsNativeEvent(event)) return;
      nativeStopHandler?.('arrived', event?.sms);
    });
    started = true;
  } catch (err) {
    started = false;
    acceptedEpoch = null;
    activeTrackingId = null;
    if (token === generation) {
      positionHandler = null;
      authorizationHandler = null;
      nativeStopHandler = null;
    }
    await removeListeners();
    throw err;
  }

  return token;
}

export async function stopTripBackgroundUpdates(token: number): Promise<void> {
  if (token !== generation) return;
  generation += 1;
  positionHandler = null;
  authorizationHandler = null;
  nativeStopHandler = null;
  acceptedEpoch = null;
  activeTrackingId = null;
  started = false;
  await removeListeners();
  try {
    await TripBackgroundLocation.stop();
  } catch {
    // stop is idempotent; a missing plugin must not block ending the trip
  }
}
