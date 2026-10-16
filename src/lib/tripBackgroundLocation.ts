import { registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import {
  TRIP_DISTANCE_FILTER_METERS,
  classifyTripAuth,
  type TripLocationAuth,
} from './tripLocationSession.ts';

interface TripBackgroundLocationPlugin {
  checkAuthorization(): Promise<{ status?: string }>;
  requestAlways(): Promise<{ status?: string }>;
  start(options: { distanceFilter: number }): Promise<void>;
  stop(): Promise<void>;
  addListener(
    eventName: 'location',
    listenerFunc: (event: { latitude?: number; longitude?: number }) => void,
  ): Promise<PluginListenerHandle>;
  addListener(
    eventName: 'authorization',
    listenerFunc: (event: { status?: string }) => void,
  ): Promise<PluginListenerHandle>;
}

const TripBackgroundLocation = registerPlugin<TripBackgroundLocationPlugin>('TripBackgroundLocation');

type PositionHandler = (latitude: number, longitude: number) => void;
type AuthorizationHandler = (auth: TripLocationAuth) => void;

let generation = 0;
let started = false;
let positionHandler: PositionHandler | null = null;
let authorizationHandler: AuthorizationHandler | null = null;
let locationListener: PluginListenerHandle | null = null;
let authorizationListener: PluginListenerHandle | null = null;

async function removeListeners(): Promise<void> {
  const location = locationListener;
  const authorization = authorizationListener;
  locationListener = null;
  authorizationListener = null;
  if (location) {
    try { await location.remove(); } catch { /* already gone */ }
  }
  if (authorization) {
    try { await authorization.remove(); } catch { /* already gone */ }
  }
}

export async function readTripLocationAuth(): Promise<TripLocationAuth> {
  const result = await TripBackgroundLocation.checkAuthorization();
  return classifyTripAuth(result?.status);
}

export async function requestTripAlwaysAuthorization(): Promise<TripLocationAuth> {
  const result = await TripBackgroundLocation.requestAlways();
  return classifyTripAuth(result?.status);
}

/**
 * One native watcher for the process. A later start replaces the callbacks
 * and returns a new token; an older token cannot stop that later watcher.
 * Positions go to the same write path as the foreground watch.
 */
export async function startTripBackgroundUpdates(
  onPosition: PositionHandler,
  onAuthorization?: AuthorizationHandler,
): Promise<number> {
  const token = ++generation;
  positionHandler = onPosition;
  authorizationHandler = onAuthorization ?? null;

  if (!started) {
    locationListener = await TripBackgroundLocation.addListener('location', (event) => {
      if (typeof event?.latitude !== 'number' || typeof event?.longitude !== 'number') return;
      positionHandler?.(event.latitude, event.longitude);
    });
    authorizationListener = await TripBackgroundLocation.addListener('authorization', (event) => {
      authorizationHandler?.(classifyTripAuth(event?.status));
    });
    try {
      await TripBackgroundLocation.start({ distanceFilter: TRIP_DISTANCE_FILTER_METERS });
      started = true;
    } catch (err) {
      started = false;
      if (token === generation) {
        positionHandler = null;
        authorizationHandler = null;
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
  started = false;
  await removeListeners();
  try {
    await TripBackgroundLocation.stop();
  } catch {
    // stop is idempotent; a missing plugin must not block ending the trip
  }
}
