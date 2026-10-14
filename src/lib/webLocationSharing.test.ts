import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CONSENT_COPY_VERSION, consentLogsForAction } from './locationConsent.ts';
import {
  consentRowsForDecisions,
  everyAllowOrDeclineIsCopyVersion,
  geolocationFollowsSheet,
  nextWebSharePhase,
  webOnMyWayConsentEvents,
  webOnMyWaySteps,
  webShareShouldReadGeolocation,
  type WebSharePhase,
  type WebShareSignal,
} from './webLocationSharing.ts';

const IDS = { staffId: 'staff-1', organizationId: 'org-1', userId: 'user-1' };

test('web shows the consent sheet before navigator.geolocation', () => {
  const firstTap = webOnMyWaySteps({
    stage: 'before_choice',
    hasDecision: false,
    decision: null,
    osState: 'prompt',
  });
  assert.deepEqual(firstTap, ['sheet']);
  assert.equal(firstTap.includes('geolocation'), false);
  assert.equal(geolocationFollowsSheet(firstTap), true);

  const allow = webOnMyWaySteps({
    stage: 'continue',
    hasDecision: false,
    decision: null,
    osState: 'prompt',
  });
  assert.deepEqual(allow, ['sheet', 'consent_row', 'geolocation', 'sms']);
  assert.equal(geolocationFollowsSheet(allow), true);
  assert.ok(allow.indexOf('sheet') < allow.indexOf('geolocation'));

  const decline = webOnMyWaySteps({
    stage: 'not_now',
    hasDecision: false,
    decision: null,
    osState: 'prompt',
  });
  assert.deepEqual(decline, ['sheet', 'consent_row', 'sms']);
  assert.equal(decline.includes('geolocation'), false);

  const browserDenied = webOnMyWaySteps({
    stage: 'continue',
    hasDecision: false,
    decision: null,
    osState: 'denied',
  });
  assert.equal(browserDenied.includes('geolocation'), false);
  assert.equal(geolocationFollowsSheet(browserDenied), true);

  const settingsAllow = webOnMyWaySteps({
    stage: 'before_choice',
    hasDecision: true,
    decision: 'toggled_on',
    osState: 'prompt',
  });
  assert.deepEqual(settingsAllow, ['sheet']);
  assert.equal(settingsAllow.includes('geolocation'), false);
});

test('every web allow or decline writes a consent row with copy version v1', () => {
  assert.equal(CONSENT_COPY_VERSION, 'v1');
  const decisions = [
    webOnMyWayConsentEvents({ stage: 'continue', osState: 'prompt' }),
    webOnMyWayConsentEvents({ stage: 'continue', osState: 'denied' }),
    webOnMyWayConsentEvents({ stage: 'not_now', osState: 'prompt' }),
    consentLogsForAction({
      latest: null,
      action: { type: 'settings', nextOn: true, osDenied: false },
    }),
    consentLogsForAction({
      latest: 'toggled_on',
      action: { type: 'settings', nextOn: false, osDenied: false },
    }),
  ];
  for (const events of decisions) {
    const rows = consentRowsForDecisions(events, IDS);
    assert.equal(everyAllowOrDeclineIsCopyVersion(rows, 'v1'), true);
    assert.ok(rows.some((row) =>
      row.decision === 'granted' ||
      row.decision === 'declined' ||
      row.decision === 'toggled_on' ||
      row.decision === 'toggled_off',
    ));
  }

  const allow = consentRowsForDecisions(
    webOnMyWayConsentEvents({ stage: 'continue', osState: 'prompt' }),
    IDS,
  );
  assert.deepEqual(allow.map((row) => row.decision), ['granted']);
  assert.equal(allow[0].copy_version, 'v1');

  const decline = consentRowsForDecisions(
    webOnMyWayConsentEvents({ stage: 'not_now', osState: 'prompt' }),
    IDS,
  );
  assert.deepEqual(decline.map((row) => row.decision), ['declined']);
  assert.equal(decline[0].copy_version, 'v1');
});

test('web sharing pauses while hidden or unloading and resumes only when visible', () => {
  const hidden: WebShareSignal = { type: 'visibility', visibilityState: 'hidden' };
  const visible: WebShareSignal = { type: 'visibility', visibilityState: 'visible' };
  const pagehide: WebShareSignal = { type: 'pagehide' };
  const unload: WebShareSignal = { type: 'unload' };

  let phase: WebSharePhase = 'sharing';
  phase = nextWebSharePhase(phase, hidden);
  assert.equal(phase, 'paused');
  assert.equal(webShareShouldReadGeolocation(phase), false);

  phase = nextWebSharePhase(phase, hidden);
  assert.equal(phase, 'paused');
  phase = nextWebSharePhase(phase, pagehide);
  assert.equal(phase, 'paused');
  phase = nextWebSharePhase(phase, unload);
  assert.equal(phase, 'paused');
  assert.equal(webShareShouldReadGeolocation(phase), false);

  phase = nextWebSharePhase(phase, visible);
  assert.equal(phase, 'sharing');
  assert.equal(webShareShouldReadGeolocation(phase), true);

  assert.equal(nextWebSharePhase('sharing', pagehide), 'paused');
  assert.equal(nextWebSharePhase('sharing', unload), 'paused');
  assert.equal(nextWebSharePhase('idle', visible), 'idle');
  assert.equal(webShareShouldReadGeolocation('idle'), false);
  assert.equal(nextWebSharePhase('paused', { type: 'visibility', visibilityState: 'prerender' }), 'paused');
});
