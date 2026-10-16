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
  }): Promise<void>;
  stop(): Promise<void>;
  addListener(
    eventName: 'location',
    listenerFunc: (event: { latitude?: number; longitude?: number }) => void,
  ): Promise<PluginListenerHandle>;
  addListener(
    eventName: 'authorization',
    listenerFunc: (event: { status?: string }) => void,
  ): Promise<PluginListenerHandle>;
  addListener(
    eventName: 'timeout',
    listenerFunc: () => void,
  ): Promise<PluginListenerHandle>;
}

const TripBackgroundLocation = registerPlugin<TripBackgroundLocationPlugin>('TripBackgroundLocation');

type PositionHandler = (latitude: number, longitude: number) => void;
type AuthorizationHandler = (auth: TripLocationAuth) => void;
type TimeoutHandler = () => void;

let generation = 0;
let started = false;
let idleStopStarted = false;
let idleStop: Promise<void> = Promise.resolve();
let positionHandler: PositionHandler | null = null;
let authorizationHandler: AuthorizationHandler | null = null;
let timeoutHandler: TimeoutHandler | null = null;
let locationListener: PluginListenerHandle | null = null;
let authorizationListener: PluginListenerHandle | null = null;
let timeoutListener: PluginListenerHandle | null = null;

async function removeListeners(): Promise<void> {
  const location = locationListener;
  const authorization = authorizationListener;
  const timeout = timeoutListener;
  locationListener = null;
  authorizationListener = null;
  timeoutListener = null;
  if (location) {
    try { await location.remove(); } catch { /* already gone */ }
  }
  if (authorization) {
    try { await authorization.remove(); } catch { /* already gone */ }
  }
  if (timeout) {
    try { await timeout.remove(); } catch { /* already gone */ }
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
  onTimeout?: TimeoutHandler,
  maxDurationSeconds?: number,
  writeTarget?: TripBackgroundWriteTarget,
): Promise<number> {
  const token = ++generation;
  await idleStop;
  if (token !== generation) return token;
  positionHandler = onPosition;
  authorizationHandler = onAuthorization ?? null;
  timeoutHandler = onTimeout ?? null;

  if (!started) {
    locationListener = await TripBackgroundLocation.addListener('location', (event) => {
      if (typeof event?.latitude !== 'number' || typeof event?.longitude !== 'number') return;
      positionHandler?.(event.latitude, event.longitude);
    });
    authorizationListener = await TripBackgroundLocation.addListener('authorization', (event) => {
      authorizationHandler?.(classifyTripAuth(event?.status));
    });
    timeoutListener = await TripBackgroundLocation.addListener('timeout', () => {
      timeoutHandler?.();
    });
    try {
      await TripBackgroundLocation.start({
        distanceFilter: TRIP_DISTANCE_FILTER_METERS,
        maxDurationSeconds: maxDurationSeconds ?? TRIP_MAX_DURATION_MS / 1000,
        trackingId: writeTarget?.trackingId ?? '',
        supabaseUrl: writeTarget?.supabaseUrl ?? '',
        supabaseAnonKey: writeTarget?.supabaseAnonKey ?? '',
        writeIntervalSeconds: NATIVE_WRITE_INTERVAL_SECONDS,
      });
      started = true;
    } catch (err) {
      started = false;
      if (token === generation) {
        positionHandler = null;
        authorizationHandler = null;
        timeoutHandler = null;
      }
      await removeListeners();
      throw err;
    }
  }

  return token;
}

export async function stopTripBackgroundUpdates(token: number): Promise<void> {
  if (token !== generation) return;
  generation += 1;
  positionHandler = null;
  authorizationHandler = null;
  timeoutHandler = null;
  started = false;
  await removeListeners();
  try {
    await TripBackgroundLocation.stop();
  } catch {
    // stop is idempotent; a missing plugin must not block ending the trip
  }
}
