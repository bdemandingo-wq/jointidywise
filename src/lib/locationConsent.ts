/**
 * Cleaner disclosure for sharing location during On My Way.
 *
 * There is no separate in-app toggle. Tracking follows the iOS or browser
 * location permission. An os_permission_granted row is appended so the server
 * trigger can see a yes. Copy version v3 is the legal disclosure.
 */
export const CONSENT_COPY_VERSION = 'v3';

export const LOCATION_CONSENT_HEADING = "Share your location while you're on the way";

export const LOCATION_SHARING_OFF_NOTE = 'Location sharing is off. Turn on in Settings.';

/**
 * Shown on the location card and in NSLocationWhenInUseUsageDescription.
 * No business-name placeholder: the system prompt cannot fill one, and the
 * two strings have to be the same text.
 */
export const LOCATION_CONSENT_COPY =
  'TidyWise shares your location only during On My Way, until you arrive or until the job is marked started. It is shared with the business owner and the customer. It is deleted after 30 days. You can turn this off in iPhone Settings or in your browser settings.';

/**
 * Both NSLocationWhenInUseUsageDescription and
 * NSLocationAlwaysAndWhenInUseUsageDescription in Info.plist.
 * The system prompt uses this only after a new iOS build is shipped.
 */
export const PROPOSED_IOS_LOCATION_USAGE_DESCRIPTION = LOCATION_CONSENT_COPY;

/**
 * Native builds below this never share On My Way location.
 * PR #54 shipped the updated NSLocation usage strings in build 1008.
 */
export const MIN_IOS_LOCATION_BUILD = 1008;

/** platform_settings key. Stored false until someone turns tracking on. */
export const LOCATION_TRACKING_SWITCH_KEY = 'cleaner_location_tracking_enabled';

export interface LocationSharingAvailability {
  /** On My Way may share a location. Requires the remote switch and, on iOS, a new enough build. */
  trackingEnabled: boolean;
  showConsentSheet: boolean;
  showSettingsToggle: boolean;
  /** False means do not insert a cleaner_location_consents row. */
  logConsent: boolean;
}

export const LOCATION_SHARING_CLOSED: LocationSharingAvailability = {
  trackingEnabled: false,
  showConsentSheet: false,
  showSettingsToggle: false,
  logConsent: false,
};

export function parseNativeBuild(build: string | number | null | undefined): number | null {
  if (typeof build === 'number' && Number.isInteger(build) && build >= 0) return build;
  if (typeof build !== 'string' || !/^\d+$/.test(build.trim())) return null;
  return Number(build.trim());
}

/** Missing, false, and anything other than JSON true stay off. */
export function remoteTrackingEnabled(value: unknown): boolean {
  return value === true;
}

const LOCATION_SHARING_OPEN: LocationSharingAvailability = {
  trackingEnabled: true,
  showConsentSheet: false,
  showSettingsToggle: false,
  logConsent: true,
};

/**
 * Tracking needs the remote switch, which defaults to off.
 * Only iOS at or above MIN_IOS_LOCATION_BUILD may share on a device.
 * Web has no usage-string build, so only the switch applies.
 * An unreadable iOS build stays off.
 *
 * TODO: Android is always off. Before any MIN_ANDROID_LOCATION_BUILD is
 * added, show the consent sheet before the OS prompt and update the Play
 * Data safety form.
 */
export function locationSharingAvailability(input: {
  platform: string;
  build: string | number | null | undefined;
  remoteEnabled: boolean;
}): LocationSharingAvailability {
  if (!input.remoteEnabled) return LOCATION_SHARING_CLOSED;
  if (input.platform === 'web') return LOCATION_SHARING_OPEN;
  if (input.platform !== 'ios') return LOCATION_SHARING_CLOSED;
  const build = parseNativeBuild(input.build);
  if (build == null || build < MIN_IOS_LOCATION_BUILD) return LOCATION_SHARING_CLOSED;
  return LOCATION_SHARING_OPEN;
}

/** When the gate is closed, an On My Way action writes no consent rows. */
export function consentLogsIfSharingOpen(
  gate: LocationSharingAvailability,
  action: Parameters<typeof consentLogsForAction>[0]['action'],
  latest: LocationConsentDecision | null,
): ConsentLogEvent[] {
  if (!gate.logConsent) return [];
  return consentLogsForAction({ latest, action });
}

export const CONSENT_DECISIONS = [
  'granted',
  'declined',
  'toggled_on',
  'toggled_off',
  'os_denied',
  'os_permission_granted',
  'revoked',
] as const;

export type LocationConsentDecision = (typeof CONSENT_DECISIONS)[number];

export const CONSENT_SOURCES = ['first_run_sheet', 'settings'] as const;

export type LocationConsentSource = (typeof CONSENT_SOURCES)[number];

export type OsLocationState = 'granted' | 'denied' | 'prompt' | 'unknown';

export interface ConsentSnapshot {
  /** False only when this cleaner has no consent row yet. */
  hasDecision: boolean;
  decision: LocationConsentDecision | null;
}

export interface ConsentLogRow {
  staff_id: string;
  organization_id: string;
  user_id: string;
  decision: LocationConsentDecision;
  copy_version: string;
  source: LocationConsentSource;
}

export interface OnMyWayLocationPlan {
  /** Full-screen sheet. Only the first time, before any OS prompt. */
  showSheet: boolean;
  /**
   * Call startTracking. True when the latest decision allows sharing and the
   * OS is already granted or still willing to ask. The insert itself still
   * waits until the OS permission comes back granted.
   */
  startTracking: boolean;
  /** Quiet note. Not a second sheet. */
  showOffNote: boolean;
}

const BUSINESS_NAME_FALLBACK = 'your company';

export function formatLocationConsentCopy(businessName: string | null | undefined): string {
  const name = businessName?.trim() || BUSINESS_NAME_FALLBACK;
  return LOCATION_CONSENT_COPY.split('{businessName}').join(name);
}

export function parseConsentDecision(value: string | null | undefined): LocationConsentDecision | null {
  if (
    value === 'granted' ||
    value === 'declined' ||
    value === 'toggled_on' ||
    value === 'toggled_off' ||
    value === 'os_denied' ||
    value === 'os_permission_granted' ||
    value === 'revoked'
  ) {
    return value;
  }
  return null;
}

/** `decision` is ignored when `hasRow` is false. A row with an unknown value still counts as a decision. */
export function consentSnapshot(hasRow: boolean, decision?: string | null): ConsentSnapshot {
  if (!hasRow) return { hasDecision: false, decision: null };
  return { hasDecision: true, decision: parseConsentDecision(decision) };
}

export function consentAllowsTracking(decision: LocationConsentDecision | null): boolean {
  return decision === 'granted' || decision === 'toggled_on' || decision === 'os_permission_granted';
}

/**
 * On My Way tracking follows the operating-system permission. The consent
 * row is recorded when that permission is granted. It is not a second gate.
 */
export function canStartLocationTracking(input: {
  decision: LocationConsentDecision | null;
  osPermissionGranted: boolean;
}): boolean {
  void input.decision;
  return input.osPermissionGranted;
}

/**
 * One append-only granted row when permission is on and the latest decision
 * would still block the server trigger. An existing yes is left as-is.
 * Source stays `first_run_sheet`, which the consent table already allows.
 */
export function consentLogForOsPermissionGrant(
  latest: LocationConsentDecision | null,
): ConsentLogEvent | null {
  if (consentAllowsTracking(latest)) return null;
  return { decision: 'os_permission_granted', source: 'first_run_sheet' };
}

/** One append-only revoked row when a current yes loses the OS permission. */
export function consentLogForOsPermissionRevoke(
  latest: LocationConsentDecision | null,
): ConsentLogEvent | null {
  if (!consentAllowsTracking(latest)) return null;
  return { decision: 'revoked', source: 'settings' };
}

export function settingsToggleOn(decision: LocationConsentDecision | null): boolean {
  return consentAllowsTracking(decision);
}

export function onMyWayLocationPlan(input: {
  hasDecision: boolean;
  decision: LocationConsentDecision | null;
  osState: OsLocationState;
}): OnMyWayLocationPlan {
  void input.hasDecision;
  void input.decision;
  const startTracking = input.osState === 'granted' || input.osState === 'prompt';
  return {
    showSheet: false,
    startTracking,
    showOffNote: !startTracking,
  };
}

export function decisionForSheet(choice: 'continue' | 'not_now'): LocationConsentDecision {
  return choice === 'continue' ? 'granted' : 'declined';
}

export function decisionForSettingsToggle(nextOn: boolean): LocationConsentDecision {
  return nextOn ? 'toggled_on' : 'toggled_off';
}

/**
 * Record an OS denial only after an explicit yes, and only when that yes is
 * still the latest row. A later job does not append another `os_denied`.
 */
export function shouldLogOsDenied(decision: LocationConsentDecision | null): boolean {
  return consentAllowsTracking(decision);
}

export function buildConsentLogRow(input: {
  staffId: string;
  organizationId: string;
  userId: string;
  decision: LocationConsentDecision;
  source: LocationConsentSource;
  copyVersion?: string;
}): ConsentLogRow {
  return {
    staff_id: input.staffId,
    organization_id: input.organizationId,
    user_id: input.userId,
    decision: input.decision,
    copy_version: input.copyVersion ?? CONSENT_COPY_VERSION,
    source: input.source,
  };
}

export interface ConsentLogEvent {
  decision: LocationConsentDecision;
  source: LocationConsentSource;
}

/**
 * The rows an action appends, in order. OS denial is a second row after yes,
 * never a row after no, and never a repeat when the latest row is already
 * `os_denied`.
 */
export function consentLogsForAction(input: {
  latest: LocationConsentDecision | null;
  action:
    | { type: 'sheet'; choice: 'continue' | 'not_now'; osDenied: boolean }
    | { type: 'settings'; nextOn: boolean; osDenied: boolean }
    | { type: 'os_turned_off' };
}): ConsentLogEvent[] {
  if (input.action.type === 'sheet') {
    const decision = decisionForSheet(input.action.choice);
    const rows: ConsentLogEvent[] = [{ decision, source: 'first_run_sheet' }];
    if (input.action.osDenied && shouldLogOsDenied(decision)) {
      rows.push({ decision: 'os_denied', source: 'first_run_sheet' });
    }
    return rows;
  }
  if (input.action.type === 'settings') {
    const decision = decisionForSettingsToggle(input.action.nextOn);
    const rows: ConsentLogEvent[] = [{ decision, source: 'settings' }];
    if (input.action.osDenied && shouldLogOsDenied(decision)) {
      rows.push({ decision: 'os_denied', source: 'settings' });
    }
    return rows;
  }
  if (!shouldLogOsDenied(input.latest)) return [];
  return [{ decision: 'os_denied', source: 'settings' }];
}

export function latestConsentDecision(
  rows: readonly { decision: string; created_at: string; id: string }[],
): ConsentSnapshot {
  if (rows.length === 0) return consentSnapshot(false);
  const sorted = [...rows].sort((a, b) => {
    if (a.created_at !== b.created_at) return a.created_at < b.created_at ? 1 : -1;
    return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
  });
  return consentSnapshot(true, sorted[0].decision);
}
