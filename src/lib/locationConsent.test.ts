import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  CONSENT_COPY_VERSION,
  LOCATION_CONSENT_COPY,
  LOCATION_CONSENT_HEADING,
  LOCATION_CONSENT_TOGGLE_LABEL,
  LOCATION_SHARING_OFF_NOTE,
  PROPOSED_IOS_LOCATION_USAGE_DESCRIPTION,
  buildConsentLogRow,
  canStartLocationTracking,
  consentLogsForAction,
  consentLogsIfSharingOpen,
  formatLocationConsentCopy,
  latestConsentDecision,
  locationSharingAvailability,
  MIN_IOS_LOCATION_BUILD,
  onMyWayLocationPlan,
  remoteTrackingEnabled,
  settingsToggleOn,
  shouldLogOsDenied,
} from './locationConsent.ts';

const APPROVED_COPY =
  "TidyWise shares your location with {businessName} admins only while the app is open, from when you tap On My Way until the job starts or is cancelled. Sharing pauses if you leave the app, and admins may see your last shared location until the job's start time. You can turn it off anytime in Settings. If you allow location, job photos you take will also record where they were taken.";

test('consent copy is version v1 and fills the business name', () => {
  assert.equal(CONSENT_COPY_VERSION, 'v1');
  assert.equal(LOCATION_CONSENT_COPY, APPROVED_COPY);
  assert.equal(LOCATION_CONSENT_HEADING, "Share your location while you're on the way");
  assert.equal(LOCATION_CONSENT_TOGGLE_LABEL, 'Share location during On My Way');
  assert.equal(LOCATION_SHARING_OFF_NOTE, 'Location sharing is off. Turn on in Settings.');
  const filled = formatLocationConsentCopy('Bright Clean');
  assert.equal(filled.includes('{businessName}'), false);
  assert.equal(filled.includes('Bright Clean'), true);
  assert.equal(formatLocationConsentCopy('  '), filled.replace('Bright Clean', 'your company'));
  assert.equal(formatLocationConsentCopy(null).includes('your company'), true);
});

test('in-app copy and the proposed iOS string do not mention customers or background use', () => {
  const texts = [
    LOCATION_CONSENT_COPY,
    LOCATION_CONSENT_HEADING,
    LOCATION_SHARING_OFF_NOTE,
    PROPOSED_IOS_LOCATION_USAGE_DESCRIPTION,
  ];
  for (const text of texts) {
    assert.equal(/customer/i.test(text), false, text);
    assert.equal(/background/i.test(text), false, text);
  }
});

test('tracking starts only for a current yes plus a granted OS permission', () => {
  assert.equal(canStartLocationTracking({ decision: null, osPermissionGranted: true }), false);
  assert.equal(canStartLocationTracking({ decision: 'granted', osPermissionGranted: false }), false);
  assert.equal(canStartLocationTracking({ decision: 'toggled_on', osPermissionGranted: false }), false);
  assert.equal(canStartLocationTracking({ decision: 'declined', osPermissionGranted: true }), false);
  assert.equal(canStartLocationTracking({ decision: 'toggled_off', osPermissionGranted: true }), false);
  assert.equal(canStartLocationTracking({ decision: 'os_denied', osPermissionGranted: true }), false);
  assert.equal(canStartLocationTracking({ decision: 'granted', osPermissionGranted: true }), true);
  assert.equal(canStartLocationTracking({ decision: 'toggled_on', osPermissionGranted: true }), true);
});

test('the first-run sheet shows once, and a no or a later OS denial does not bring it back', () => {
  assert.deepEqual(onMyWayLocationPlan({ hasDecision: false, decision: null, osState: 'prompt' }), {
    showSheet: true,
    startTracking: false,
    showOffNote: false,
  });
  assert.deepEqual(onMyWayLocationPlan({ hasDecision: true, decision: 'declined', osState: 'granted' }), {
    showSheet: false,
    startTracking: false,
    showOffNote: true,
  });
  assert.deepEqual(onMyWayLocationPlan({ hasDecision: true, decision: 'os_denied', osState: 'denied' }), {
    showSheet: false,
    startTracking: false,
    showOffNote: true,
  });
  assert.deepEqual(onMyWayLocationPlan({ hasDecision: true, decision: 'toggled_off', osState: 'prompt' }), {
    showSheet: false,
    startTracking: false,
    showOffNote: true,
  });
  assert.deepEqual(onMyWayLocationPlan({ hasDecision: true, decision: 'granted', osState: 'granted' }), {
    showSheet: false,
    startTracking: true,
    showOffNote: false,
  });
  assert.deepEqual(onMyWayLocationPlan({ hasDecision: true, decision: 'toggled_on', osState: 'prompt' }), {
    showSheet: false,
    startTracking: true,
    showOffNote: false,
  });
  assert.deepEqual(onMyWayLocationPlan({ hasDecision: true, decision: 'granted', osState: 'denied' }), {
    showSheet: false,
    startTracking: false,
    showOffNote: true,
  });
  assert.deepEqual(onMyWayLocationPlan({ hasDecision: true, decision: 'granted', osState: 'unknown' }), {
    showSheet: false,
    startTracking: false,
    showOffNote: true,
  });
  assert.equal(settingsToggleOn('granted'), true);
  assert.equal(settingsToggleOn('toggled_on'), true);
  assert.equal(settingsToggleOn('declined'), false);
  assert.equal(settingsToggleOn('os_denied'), false);
  assert.equal(settingsToggleOn(null), false);
});

test('logging records the sheet and the settings toggle, including a following OS denial', () => {
  assert.deepEqual(
    consentLogsForAction({
      latest: null,
      action: { type: 'sheet', choice: 'continue', osDenied: false },
    }),
    [{ decision: 'granted', source: 'first_run_sheet' }],
  );
  assert.deepEqual(
    consentLogsForAction({
      latest: null,
      action: { type: 'sheet', choice: 'continue', osDenied: true },
    }),
    [
      { decision: 'granted', source: 'first_run_sheet' },
      { decision: 'os_denied', source: 'first_run_sheet' },
    ],
  );
  assert.deepEqual(
    consentLogsForAction({
      latest: null,
      action: { type: 'sheet', choice: 'not_now', osDenied: true },
    }),
    [{ decision: 'declined', source: 'first_run_sheet' }],
  );
  assert.deepEqual(
    consentLogsForAction({
      latest: 'declined',
      action: { type: 'settings', nextOn: true, osDenied: false },
    }),
    [{ decision: 'toggled_on', source: 'settings' }],
  );
  assert.deepEqual(
    consentLogsForAction({
      latest: 'toggled_on',
      action: { type: 'settings', nextOn: true, osDenied: true },
    }),
    [
      { decision: 'toggled_on', source: 'settings' },
      { decision: 'os_denied', source: 'settings' },
    ],
  );
  assert.deepEqual(
    consentLogsForAction({
      latest: 'granted',
      action: { type: 'settings', nextOn: false, osDenied: true },
    }),
    [{ decision: 'toggled_off', source: 'settings' }],
  );
});

test('an OS denial is logged once, from a current yes, and the row is append-only shaped', () => {
  assert.equal(shouldLogOsDenied('granted'), true);
  assert.equal(shouldLogOsDenied('toggled_on'), true);
  assert.equal(shouldLogOsDenied('declined'), false);
  assert.equal(shouldLogOsDenied('toggled_off'), false);
  assert.equal(shouldLogOsDenied('os_denied'), false);
  assert.equal(shouldLogOsDenied(null), false);
  assert.deepEqual(consentLogsForAction({ latest: 'granted', action: { type: 'os_turned_off' } }), [
    { decision: 'os_denied', source: 'settings' },
  ]);
  assert.deepEqual(consentLogsForAction({ latest: 'os_denied', action: { type: 'os_turned_off' } }), []);
  assert.deepEqual(consentLogsForAction({ latest: 'declined', action: { type: 'os_turned_off' } }), []);

  assert.deepEqual(
    buildConsentLogRow({
      staffId: 'staff-1',
      organizationId: 'org-1',
      userId: 'user-1',
      decision: 'declined',
      source: 'first_run_sheet',
    }),
    {
      staff_id: 'staff-1',
      organization_id: 'org-1',
      user_id: 'user-1',
      decision: 'declined',
      copy_version: 'v1',
      source: 'first_run_sheet',
    },
  );
});

const CONTINUE_SHEET = { type: 'sheet' as const, choice: 'continue' as const, osDenied: false };

function assertSharingClosed(gate: ReturnType<typeof locationSharingAvailability>) {
  assert.equal(gate.trackingEnabled, false);
  assert.equal(gate.showConsentSheet, false);
  assert.equal(gate.showSettingsToggle, false);
  assert.equal(gate.logConsent, false);
  assert.deepEqual(consentLogsIfSharingOpen(gate, CONTINUE_SHEET, null), []);
}

test('ios-old shows nothing and writes no consent decision', () => {
  assert.ok(MIN_IOS_LOCATION_BUILD > 1018);
  for (const build of ['1018', 1018, 'not-a-build', null]) {
    assertSharingClosed(locationSharingAvailability({ platform: 'ios', build, remoteEnabled: true }));
    assertSharingClosed(locationSharingAvailability({ platform: 'ios', build, remoteEnabled: false }));
  }
});

test('ios-new may share only when the remote switch is on', () => {
  assert.equal(remoteTrackingEnabled(undefined), false);
  assert.equal(remoteTrackingEnabled(false), false);
  assert.equal(remoteTrackingEnabled('true'), false);
  assert.equal(remoteTrackingEnabled(true), true);

  assertSharingClosed(locationSharingAvailability({
    platform: 'ios',
    build: String(MIN_IOS_LOCATION_BUILD),
    remoteEnabled: false,
  }));
  const open = locationSharingAvailability({
    platform: 'ios',
    build: MIN_IOS_LOCATION_BUILD,
    remoteEnabled: true,
  });
  assert.equal(open.trackingEnabled, true);
  assert.equal(open.showConsentSheet, true);
  assert.equal(open.showSettingsToggle, true);
  assert.equal(open.logConsent, true);
  assert.equal(consentLogsIfSharingOpen(open, CONTINUE_SHEET, null).length, 1);
});

test('android is always off', () => {
  for (const build of ['1018', '1019', 2000, null]) {
    assertSharingClosed(locationSharingAvailability({ platform: 'android', build, remoteEnabled: true }));
  }
});

test('unknown platform is off', () => {
  assertSharingClosed(locationSharingAvailability({ platform: 'electron', build: '2000', remoteEnabled: true }));
  assertSharingClosed(locationSharingAvailability({ platform: '', build: MIN_IOS_LOCATION_BUILD, remoteEnabled: true }));
});

test('web still follows only the remote switch', () => {
  const open = locationSharingAvailability({ platform: 'web', build: '1018', remoteEnabled: true });
  assert.equal(open.showSettingsToggle, true);
  assert.equal(open.showConsentSheet, true);
  assert.equal(open.logConsent, true);
  assertSharingClosed(locationSharingAvailability({ platform: 'web', build: null, remoteEnabled: false }));
});

test('the latest decision is the newest created_at, with id as the tiebreak', () => {
  const snapshot = latestConsentDecision([
    { id: 'a', created_at: '2026-10-14T00:00:00.000Z', decision: 'granted' },
    { id: 'c', created_at: '2026-10-14T00:00:01.000Z', decision: 'toggled_off' },
    { id: 'b', created_at: '2026-10-14T00:00:01.000Z', decision: 'toggled_on' },
  ]);
  assert.deepEqual(snapshot, { hasDecision: true, decision: 'toggled_off' });
  assert.deepEqual(latestConsentDecision([]), { hasDecision: false, decision: null });
  assert.equal(canStartLocationTracking({ decision: snapshot.decision, osPermissionGranted: true }), false);
});
