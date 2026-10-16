import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  nextWebSharePhase,
  webOnMyWaySteps,
  webShareShouldReadGeolocation,
  type WebSharePhase,
  type WebShareSignal,
} from './webLocationSharing.ts';

test('web On My Way asks the browser for location without a consent sheet', () => {
  assert.deepEqual(webOnMyWaySteps('prompt'), ['geolocation', 'sms']);
  assert.deepEqual(webOnMyWaySteps('granted'), ['geolocation', 'sms']);
  const browserDenied = webOnMyWaySteps('denied');
  assert.deepEqual(browserDenied, ['sms']);
  assert.equal(browserDenied.includes('geolocation'), false);
  assert.equal(webOnMyWaySteps('unknown').includes('geolocation'), false);
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
