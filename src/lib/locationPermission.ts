/**
 * How the cleaner-facing Location section describes GPS permission.
 *
 * @capacitor/geolocation 8.2.0 collapses iOS `authorizedAlways` and
 * `authorizedWhenInUse` into one `granted` value (see
 * GeolocationPlugin.swift). The app only requests While Using — there is no
 * background location mode — so a granted read is "on", and the label names
 * both settings the phone may show. Splitting them would need a native plugin
 * this project does not have.
 */

export type LocationPlatform = 'ios' | 'android' | 'web';

export type LocationStatusKind =
  | 'on-always'
  | 'on-while-using'
  | 'off'
  | 'not-asked'
  | 'unavailable'
  | 'error';

export interface ClassifiedLocation {
  kind: LocationStatusKind;
  /**
   * false when Android granted approximate location only.
   * null when the platform cannot say.
   */
  precise: boolean | null;
}

export interface PluginPermissionStatus {
  location?: string;
  coarseLocation?: string;
}

const IOS_STEPS = [
  'Open the Settings app',
  'Tap TidyWise',
  'Tap Location, choose While Using the App, and turn Precise Location on',
] as const;

const ANDROID_STEPS = [
  'Open the Settings app',
  'Tap Apps, then TidyWise, then Permissions',
  'Tap Location, choose Allow only while using the app, and turn Precise location on',
] as const;

/** Capacitor's WebView opens this with UIApplication.open. No settings plugin. */
export const IOS_APP_SETTINGS_URL = 'app-settings:';

export const LOCATION_WHY =
  'TidyWise shares your location only during On My Way, until you arrive or until the job is marked started. It is shared with the business owner and the customer. It is deleted after 30 days. You can turn this off in iPhone Settings or in your browser settings.';

export function classifyPluginStatus(status: PluginPermissionStatus): ClassifiedLocation {
  const location = status.location ?? '';
  const coarse = status.coarseLocation ?? '';

  if (location === 'granted') {
    // Fine location is on. iOS reports Always and While Using as the same
    // granted value, so the label names both.
    return { kind: 'on-while-using', precise: true };
  }
  if (coarse === 'granted') {
    return { kind: 'on-while-using', precise: false };
  }
  if (location === 'denied' || coarse === 'denied') {
    return { kind: 'off', precise: false };
  }
  if (
    location === 'prompt' ||
    location === 'prompt-with-rationale' ||
    coarse === 'prompt' ||
    coarse === 'prompt-with-rationale'
  ) {
    return { kind: 'not-asked', precise: null };
  }
  return { kind: 'error', precise: null };
}

export function classifyWebPermission(input: {
  hasGeolocation: boolean;
  permission: 'granted' | 'denied' | 'prompt' | null;
}): ClassifiedLocation {
  if (!input.hasGeolocation) return { kind: 'unavailable', precise: null };
  if (input.permission === 'granted') return { kind: 'on-while-using', precise: true };
  if (input.permission === 'denied') return { kind: 'off', precise: false };
  return { kind: 'not-asked', precise: null };
}

/** checkPermissions throws this when the system Location switch is off. */
export function classifyPermissionFailure(message: string): ClassifiedLocation {
  const text = message.toLowerCase();
  if (text.includes('location services') || text.includes('os-plug-gloc-0007')) {
    return { kind: 'off', precise: false };
  }
  return { kind: 'error', precise: null };
}

export function locationStatusLabel(kind: LocationStatusKind): string {
  switch (kind) {
    case 'on-always':
      return 'On (Always)';
    case 'on-while-using':
      return 'On (Always / While Using)';
    case 'off':
      return 'Off';
    case 'not-asked':
      return 'Not asked yet';
    case 'unavailable':
      return 'Unavailable';
    case 'error':
      return "Couldn't check";
  }
}

export function deviceHintFromUserAgent(userAgent: string): 'ios' | 'android' | 'other' {
  if (/android/i.test(userAgent)) return 'android';
  if (/iPad|iPhone|iPod/.test(userAgent)) return 'ios';
  return 'other';
}

export function locationSettingsSteps(platform: 'ios' | 'android'): readonly string[] {
  return platform === 'android' ? ANDROID_STEPS : IOS_STEPS;
}

export function canOfferSystemSettings(platform: LocationPlatform, native: boolean): boolean {
  return native && platform === 'ios';
}

export interface LocationSectionModel {
  label: string;
  tone: 'on' | 'off' | 'warn' | 'neutral';
  why: string;
  statusNote: string | null;
  showTurnOn: boolean;
  showCheckAgain: boolean;
  showOpenSettings: boolean;
  androidHandNote: string | null;
  browserHelp: string | null;
  stepsTitle: string | null;
  steps: readonly string[] | null;
}

export function buildLocationSectionModel(input: {
  kind: LocationStatusKind;
  precise: boolean | null;
  platform: LocationPlatform;
  native: boolean;
  userAgent: string;
}): LocationSectionModel {
  const on = input.kind === 'on-always' || input.kind === 'on-while-using';
  const hint = input.native
    ? input.platform === 'android'
      ? 'android'
      : input.platform === 'ios'
        ? 'ios'
        : 'other'
    : deviceHintFromUserAgent(input.userAgent);
  const needsSteps = input.kind === 'off' || input.precise === false;
  const stepPlatform = hint === 'android' ? 'android' : hint === 'ios' ? 'ios' : null;

  let statusNote: string | null = null;
  if (input.kind === 'unavailable') {
    statusNote = 'This browser does not have location. Use the TidyWise app on your phone.';
  } else if (input.kind === 'error') {
    statusNote = "Couldn't check location permission. Try again.";
  } else if (input.precise === false) {
    statusNote = 'Precise Location is off. Clock-in is more accurate with it on.';
  } else if (on) {
    statusNote = 'Either Always or While Using the App is enough. Keep Precise Location on.';
  } else if (input.kind === 'not-asked') {
    statusNote = 'TidyWise has not asked for location yet.';
  } else if (input.kind === 'off') {
    statusNote = input.native
      ? 'Location is blocked. The phone will not ask again until you allow it in Settings.'
      : 'Location is blocked in this browser.';
  }

  return {
    label: locationStatusLabel(input.kind),
    tone: on ? 'on' : input.kind === 'off' ? 'off' : input.kind === 'not-asked' || input.kind === 'error' ? 'warn' : 'neutral',
    why: LOCATION_WHY,
    statusNote,
    showTurnOn: !on,
    showCheckAgain: on,
    showOpenSettings: canOfferSystemSettings(input.platform, input.native) && (input.kind === 'off' || input.precise === false),
    androidHandNote:
      input.native && input.platform === 'android' && needsSteps
        ? 'Open Settings yourself. This app cannot jump to the Android permission screen.'
        : null,
    browserHelp:
      !input.native && input.kind === 'off'
        ? 'Allow location for this site from the lock icon in the address bar. If you already blocked it, set Location to Allow.'
        : null,
    stepsTitle: needsSteps && stepPlatform === 'android' ? 'On Android' : needsSteps && stepPlatform === 'ios' ? 'On iPhone' : null,
    steps: needsSteps && stepPlatform ? locationSettingsSteps(stepPlatform) : null,
  };
}

export function locationBannerCopy(
  kind: LocationStatusKind | 'checking',
): { title: string; body: string } | null {
  if (kind === 'checking' || kind === 'on-always' || kind === 'on-while-using') return null;
  if (kind === 'off') {
    return {
      title: 'Location is off',
      body: 'Turn it on to share On My Way with the business owner and the customer. You can turn it off again in iPhone Settings or your browser settings.',
    };
  }
  if (kind === 'not-asked') {
    return {
      title: 'Location is not on yet',
      body: 'Turn it on to share On My Way with the business owner and the customer. You can turn it off again in iPhone Settings or your browser settings.',
    };
  }
  if (kind === 'unavailable') {
    return {
      title: 'Location is unavailable',
      body: 'This browser has no location. Use the TidyWise app on your phone.',
    };
  }
  return {
    title: "Couldn't check location",
    body: 'Open location settings and try again.',
  };
}

export function staffLocationSearch(current: URLSearchParams): URLSearchParams {
  const next = new URLSearchParams(current);
  next.set('tab', 'profile');
  next.set('focus', 'location');
  return next;
}
