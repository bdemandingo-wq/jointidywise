import { LOCATION_CONSENT_COPY } from './locationConsent.ts';

/**
 * On My Way background location.
 *
 * The watcher runs only on iOS, only during an active trip, and only after
 * Always is granted. Web and Android stay on the foreground watch. While
 * Using stays on the foreground watch too. Every stop reason ends the
 * background watcher; none of them starts one.
 */

export const TRIP_DISTANCE_FILTER_METERS = 25;

export const ALWAYS_LOCATION_EXPLAINER_HEADING = 'Keep sharing while you drive';

/** Legal disclosure, then the Always choice. Shown before the system prompt. */
export const ALWAYS_LOCATION_EXPLAINER_BODY =
  `${LOCATION_CONSENT_COPY} Allow Always to keep sharing while Maps is open or the phone is locked. A blue location indicator stays on until you arrive or the job starts. Keep While Using the App if sharing should pause when you leave TidyWise.`;

export const FOREGROUND_LOCATION_SHARE_BANNER =
  'Sharing your location with your company admins while this screen is open. Sharing pauses if you leave the app.';

export const BACKGROUND_LOCATION_SHARE_BANNER =
  'Sharing your location with your company admins until you arrive or the job starts, including while your phone is locked.';

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
  | 'unmount';

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
  explainerAccepted: boolean | null;
}): AlwaysPromptPlan {
  if (input.platform !== 'ios') return { action: 'foreground' };
  if (input.auth === 'always') return { action: 'background' };
  if (input.auth === 'unavailable') return { action: 'foreground' };
  if (input.auth === 'denied' || input.auth === 'restricted') return { action: 'none' };
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

  let plan = planAlwaysPrompt({ platform: 'ios', auth, explainerAccepted: null });
  if (plan.action === 'explain') {
    let accepted = false;
    try {
      accepted = await input.explain();
    } catch {
      accepted = false;
    }
    plan = planAlwaysPrompt({ platform: 'ios', auth, explainerAccepted: accepted });
  }

  if (plan.action === 'background') return 'background';
  if (plan.action === 'foreground') return 'foreground';
  if (plan.action === 'none') return 'none';

  try {
    const next = await input.requestAlways();
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
