import {
  CONSENT_COPY_VERSION,
  buildConsentLogRow,
  consentLogsForAction,
  onMyWayLocationPlan,
  type ConsentLogEvent,
  type ConsentLogRow,
  type LocationConsentDecision,
  type OsLocationState,
} from './locationConsent.ts';

export type WebOnMyWayStep = 'sheet' | 'consent_row' | 'geolocation' | 'sms';

export type WebOnMyWayStage = 'before_choice' | 'continue' | 'not_now';

/**
 * Order of the web On My Way flow.
 * The browser prompt is navigator.geolocation. It runs when the OS will
 * still allow it. The consent row is written when that permission is
 * granted, not as a step the cleaner has to accept first.
 */
export function webOnMyWaySteps(input: {
  stage: WebOnMyWayStage;
  hasDecision: boolean;
  decision: LocationConsentDecision | null;
  osState: OsLocationState;
}): WebOnMyWayStep[] {
  void input.stage;
  void input.hasDecision;
  void input.decision;
  const plan = onMyWayLocationPlan({
    hasDecision: input.hasDecision,
    decision: input.decision,
    osState: input.osState,
  });
  return plan.startTracking ? ['geolocation', 'sms'] : ['sms'];
}

/** True when this plan never calls geolocation, or the sheet comes first. */
export function geolocationFollowsSheet(steps: readonly WebOnMyWayStep[]): boolean {
  const geo = steps.indexOf('geolocation');
  if (geo === -1) return true;
  const sheet = steps.indexOf('sheet');
  return sheet !== -1 && sheet < geo;
}

export function webOnMyWayConsentEvents(input: {
  stage: 'continue' | 'not_now';
  osState: OsLocationState;
}): ConsentLogEvent[] {
  if (input.stage === 'not_now') {
    return consentLogsForAction({
      latest: null,
      action: { type: 'sheet', choice: 'not_now', osDenied: false },
    });
  }
  return consentLogsForAction({
    latest: null,
    action: { type: 'sheet', choice: 'continue', osDenied: input.osState === 'denied' },
  });
}

const ALLOW_OR_DECLINE = new Set<LocationConsentDecision>([
  'granted',
  'declined',
  'toggled_on',
  'toggled_off',
]);

/** Allow and decline rows always carry the current copy version. */
export function consentRowsForDecisions(
  events: readonly ConsentLogEvent[],
  ids: { staffId: string; organizationId: string; userId: string },
): ConsentLogRow[] {
  return events
    .filter((event) => ALLOW_OR_DECLINE.has(event.decision))
    .map((event) => buildConsentLogRow({
      staffId: ids.staffId,
      organizationId: ids.organizationId,
      userId: ids.userId,
      decision: event.decision,
      source: event.source,
    }));
}

export function everyAllowOrDeclineIsCopyVersion(
  rows: readonly ConsentLogRow[],
  version = CONSENT_COPY_VERSION,
): boolean {
  return rows.length > 0 && rows.every((row) => row.copy_version === version);
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
