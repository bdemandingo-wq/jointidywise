/**
 * Cleaner consent for sharing location during On My Way.
 *
 * Owner's final approval of this wording is pending.
 */
export const CONSENT_COPY_VERSION = 'v1';

export const LOCATION_CONSENT_HEADING = "Share your location while you're on the way";

export const LOCATION_CONSENT_TOGGLE_LABEL = 'Share location during On My Way';

export const LOCATION_SHARING_OFF_NOTE = 'Location sharing is off. Turn on in Settings.';

/**
 * Owner's final approval of this wording is pending.
 * `{businessName}` is filled from the organization's name.
 */
export const LOCATION_CONSENT_COPY =
  "TidyWise shares your location with {businessName} admins only while the app is open, from when you tap On My Way until the job starts or is cancelled. Sharing pauses if you leave the app, and admins may see your last shared location until the job's start time. You can turn it off anytime in Settings.";

/**
 * Proposed replacement for both iOS location usage strings.
 * Not written into Info.plist here: that file is compiled into the app
 * binary, so the system prompt keeps the current text until a new iOS build.
 */
export const PROPOSED_IOS_LOCATION_USAGE_DESCRIPTION =
  "TidyWise shares your location with your company's admins only while you're on the way to a job.";

export const CONSENT_DECISIONS = [
  'granted',
  'declined',
  'toggled_on',
  'toggled_off',
  'os_denied',
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
  if (value === 'granted' || value === 'declined' || value === 'toggled_on' || value === 'toggled_off' || value === 'os_denied') {
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
  return decision === 'granted' || decision === 'toggled_on';
}

/**
 * Tracking may start only when the latest logged decision is an explicit yes
 * and the operating system has granted location.
 */
export function canStartLocationTracking(input: {
  decision: LocationConsentDecision | null;
  osPermissionGranted: boolean;
}): boolean {
  return consentAllowsTracking(input.decision) && input.osPermissionGranted;
}

export function settingsToggleOn(decision: LocationConsentDecision | null): boolean {
  return consentAllowsTracking(decision);
}

export function onMyWayLocationPlan(input: {
  hasDecision: boolean;
  decision: LocationConsentDecision | null;
  osState: OsLocationState;
}): OnMyWayLocationPlan {
  if (!input.hasDecision) {
    return { showSheet: true, startTracking: false, showOffNote: false };
  }
  const startTracking =
    consentAllowsTracking(input.decision) &&
    (input.osState === 'granted' || input.osState === 'prompt');
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
