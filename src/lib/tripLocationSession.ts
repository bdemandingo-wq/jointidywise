/**
 * On My Way background location.
 *
 * The watcher runs only on iOS, only during an active trip, and only after
 * Always is granted. Web and Android stay on the foreground watch. While
 * Using stays on the foreground watch too. The explainer has Continue only;
 * declining happens in the iOS prompt. Once Always has been requested, later
 * trips skip the explainer. Every stop, including the 3 hour limit, ends the watcher.
 */

export const TRIP_DISTANCE_FILTER_METERS = 25;

/** Hard stop for an On My Way trip. */
export const TRIP_MAX_DURATION_MS = 3 * 60 * 60 * 1000;

export const ALWAYS_LOCATION_EXPLAINER_HEADING = 'Keep sharing while your phone is locked?';

export const ALWAYS_LOCATION_EXPLAINER_BODY =
  "To keep your customer updated, TidyWise can share your location during On My Way even if the app is closed or your phone is locked. It only runs during a trip and stops when you arrive, the job starts, the job ends, or after 3 hours. You'll see a blue location indicator while it's on.";

export const FOREGROUND_LOCATION_SHARE_BANNER =
  'Sharing your location with your company admins and the customer while this screen is open, until the job starts. Sharing pauses if you leave the app.';

export const BACKGROUND_LOCATION_SHARE_BANNER =
  'Sharing your location with your company admins and the customer while your trip is active, even if your phone is locked, until the job starts. Sharing also stops when you arrive, the job ends, or after 3 hours.';

/**
 * Foreground trips have no locked-phone heartbeat. While the screen can
 * run JavaScript, rewrite recorded_at on this interval so the 15 minute
 * reaper does not close a stationary While Using, Android, or web trip.
 * Same spacing as the native heartbeat, inside that window.
 */
export const TRIP_HEARTBEAT_MS = 4 * 60 * 1000;

/**
 * Same gap as the native arrival retry. The JS follow-up waits, then
 * doubles, and never waits longer than the native heartbeat.
 */
export const NATIVE_ARRIVAL_JS_RETRY_MS = 45_000;

export function nativeArrivalRetryDelayMs(failures: number): number {
  const n = Number.isFinite(failures) && failures > 0 ? Math.floor(failures) : 1;
  const delay = NATIVE_ARRIVAL_JS_RETRY_MS * 2 ** (n - 1);
  return Math.min(delay, TRIP_HEARTBEAT_MS);
}

/**
 * The iOS Always watcher sends the arrival text itself. A JS geofence
 * check at the same time sends a second text.
 */
export function jsArrivalCheckEnabled(nativeWatcherActive: boolean): boolean {
  return !nativeWatcherActive;
}

/**
 * A position write that updates no active row means the trip was closed.
 * Sharing on screen has to stop. A failed request is not a closed trip,
 * and an unknown row count is not one either.
 */
export function trackingUpdateDisposition(input: {
  error: boolean;
  affectedRows: number | null;
}): 'ok' | 'closed' | 'failed' {
  if (input.error) return 'failed';
  if (input.affectedRows === 0) return 'closed';
  return 'ok';
}

/**
 * Heartbeats stamp the time of the write. A retried parked fix must not
 * reuse the GPS timestamp, or the reaper sees a stale recorded_at.
 * Movement writes keep the fix time.
 */
export function recordedAtForLocationWrite(input: {
  heartbeat: boolean;
  nowIso: string;
  fixIso: string;
}): string {
  return input.heartbeat ? input.nowIso : input.fixIso;
}

export type TripPlatform = 'ios' | 'android' | 'web';

export type TripLocationAuth =
  | 'always'
  | 'whenInUse'
  | 'denied'
  | 'restricted'
  | 'prompt'
  | 'unavailable';

export type TripWatchMode = 'background' | 'foreground' | 'none';

export type TripStopReason =
  | 'arrival'
  | 'job_started'
  | 'stop_tracking'
  | 'job_finished'
  | 'consent_revoked'
  | 'closed'
  | 'unmount'
  | 'timeout';

export function bannerPlatform(platform: string): TripPlatform {
  if (platform === 'ios' || platform === 'android' || platform === 'web') return platform;
  return 'web';
}

/** The pause sentence stays on web, Android, and iOS While Using. */
export function locationShareBanner(platform: TripPlatform, backgroundActive: boolean): string {
  if (platform === 'ios' && backgroundActive) return BACKGROUND_LOCATION_SHARE_BANNER;
  return FOREGROUND_LOCATION_SHARE_BANNER;
}

export function classifyTripAuth(status: string | null | undefined): TripLocationAuth {
  switch (status) {
    case 'always':
      return 'always';
    case 'whenInUse':
      return 'whenInUse';
    case 'denied':
      return 'denied';
    case 'restricted':
      return 'restricted';
    case 'prompt':
      return 'prompt';
    default:
      return 'unavailable';
  }
}

export type AlwaysPromptPlan =
  | { action: 'background' }
  | { action: 'foreground' }
  | { action: 'explain' }
  | { action: 'request-always' }
  | { action: 'none' };

/**
 * Always is requested only on iOS, and only after the explainer.
 * A missing plugin (`unavailable`) keeps the foreground watch.
 * Denied and restricted do not open a watch and do not show the explainer.
 */
export function planAlwaysPrompt(input: {
  platform: TripPlatform;
  auth: TripLocationAuth;
  /** True after requestAlways has already been shown. Later trips skip the explainer. */
  alwaysRequested?: boolean;
  explainerAccepted: boolean | null;
}): AlwaysPromptPlan {
  if (input.platform !== 'ios') return { action: 'foreground' };
  if (input.auth === 'always') return { action: 'background' };
  if (input.auth === 'unavailable') return { action: 'foreground' };
  if (input.auth === 'denied' || input.auth === 'restricted') return { action: 'none' };
  if (input.alwaysRequested) return { action: 'foreground' };
  if (input.explainerAccepted === null) return { action: 'explain' };
  if (input.explainerAccepted === false) return { action: 'foreground' };
  return { action: 'request-always' };
}

export function watchModeAfterAlwaysRequest(auth: TripLocationAuth): TripWatchMode {
  if (auth === 'always') return 'background';
  if (auth === 'denied' || auth === 'restricted') return 'none';
  return 'foreground';
}

export interface ChooseTripWatchInput {
  platform: TripPlatform;
  readAuth: () => Promise<TripLocationAuth>;
  explain: () => Promise<boolean>;
  requestAlways: () => Promise<TripLocationAuth>;
  /** Always was already requested. Skips the explainer on later trips. */
  alwaysRequested?: boolean;
  /** Persists that requestAlways ran, so the next trip does not explain again. */
  rememberRequested?: () => Promise<void>;
}

/**
 * Decides the watch for a trip that is about to start.
 * Web and Android never read auth, never explain, and never request Always.
 * A thrown plugin call falls back to the foreground watch.
 */
export async function chooseTripWatch(input: ChooseTripWatchInput): Promise<TripWatchMode> {
  if (input.platform !== 'ios') return 'foreground';

  let auth: TripLocationAuth;
  try {
    auth = await input.readAuth();
  } catch {
    return 'foreground';
  }

  let plan = planAlwaysPrompt({
    platform: 'ios',
    auth,
    alwaysRequested: input.alwaysRequested,
    explainerAccepted: null,
  });
  if (plan.action === 'explain') {
    let accepted = false;
    try {
      accepted = await input.explain();
    } catch {
      accepted = false;
    }
    plan = planAlwaysPrompt({
      platform: 'ios',
      auth,
      alwaysRequested: input.alwaysRequested,
      explainerAccepted: accepted,
    });
  }

  if (plan.action === 'background') return 'background';
  if (plan.action === 'foreground') return 'foreground';
  if (plan.action === 'none') return 'none';

  try {
    const next = await input.requestAlways();
    try {
      await input.rememberRequested?.();
    } catch {
      // This trip already has its answer. The next launch may explain once more.
    }
    return watchModeAfterAlwaysRequest(next);
  } catch {
    return 'foreground';
  }
}

export interface TripWatchSession {
  mode: TripWatchMode;
}

export function initialTripWatchSession(): TripWatchSession {
  return { mode: 'none' };
}

export interface TripWatchTransition {
  session: TripWatchSession;
  startBackground: boolean;
  stopBackground: boolean;
  reason: TripStopReason | 'trip_started';
}

/** Opens a watch for an active trip. Starting background twice does not start it again. */
export function beginTripWatch(session: TripWatchSession, mode: Exclude<TripWatchMode, 'none'>): TripWatchTransition {
  return {
    session: { mode },
    startBackground: mode === 'background' && session.mode !== 'background',
    stopBackground: session.mode === 'background' && mode !== 'background',
    reason: 'trip_started',
  };
}

/** Ends the watch. Background stops only when it was actually running. */
export function endTripWatch(session: TripWatchSession, reason: TripStopReason): TripWatchTransition {
  return {
    session: { mode: 'none' },
    startBackground: false,
    stopBackground: session.mode === 'background',
    reason,
  };
}

export function tripWatchCommands(transition: TripWatchTransition): Array<'stop-background' | 'start-background'> {
  const commands: Array<'stop-background' | 'start-background'> = [];
  if (transition.stopBackground) commands.push('stop-background');
  if (transition.startBackground) commands.push('start-background');
  return commands;
}

/** True once an On My Way trip has been running for 3 hours. */
export function tripTimedOut(startedAtMs: number, nowMs: number): boolean {
  return nowMs - startedAtMs >= TRIP_MAX_DURATION_MS;
}
