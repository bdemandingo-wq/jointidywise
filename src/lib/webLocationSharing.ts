import { onMyWayLocationPlan, type OsLocationState } from './locationConsent.ts';

export type WebOnMyWayStep = 'geolocation' | 'sms';

/**
 * Order of the web On My Way flow.
 * The browser prompt is navigator.geolocation. It runs when the OS will
 * still allow it. There is no consent sheet in front of that prompt.
 */
export function webOnMyWaySteps(osState: OsLocationState): WebOnMyWayStep[] {
  const plan = onMyWayLocationPlan(osState);
  return plan.startTracking ? ['geolocation', 'sms'] : ['sms'];
}

export type WebSharePhase = 'idle' | 'sharing' | 'paused';

export type WebShareSignal =
  | { type: 'visibility'; visibilityState: 'visible' | 'hidden' | 'prerender' }
  | { type: 'pagehide' }
  | { type: 'unload' };

/**
 * Web sharing pauses when the document is hidden or the page is going away.
 * It stays paused until the document is visible again. Idle never starts
 * from a visibility event.
 */
export function nextWebSharePhase(phase: WebSharePhase, signal: WebShareSignal): WebSharePhase {
  if (phase === 'idle') return 'idle';
  if (signal.type === 'pagehide' || signal.type === 'unload') return 'paused';
  if (signal.type === 'visibility') {
    if (signal.visibilityState === 'hidden') return 'paused';
    if (signal.visibilityState === 'visible') return phase === 'paused' ? 'sharing' : phase;
  }
  return phase;
}

/** navigator.geolocation may run only while a web share is active and visible. */
export function webShareShouldReadGeolocation(phase: WebSharePhase): boolean {
  return phase === 'sharing';
}
