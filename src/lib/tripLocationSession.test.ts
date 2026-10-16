import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { LOCATION_CONSENT_COPY } from './locationConsent.ts';
import {
  ALWAYS_LOCATION_EXPLAINER_BODY,
  BACKGROUND_LOCATION_SHARE_BANNER,
  FOREGROUND_LOCATION_SHARE_BANNER,
  TRIP_DISTANCE_FILTER_METERS,
  beginTripWatch,
  chooseTripWatch,
  endTripWatch,
  initialTripWatchSession,
  locationShareBanner,
  planAlwaysPrompt,
  tripWatchCommands,
  type TripLocationAuth,
  type TripPlatform,
  type TripStopReason,
} from './tripLocationSession.ts';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

const STOP_REASONS: TripStopReason[] = [
  'arrival',
  'job_started',
  'stop_tracking',
  'job_finished',
  'consent_revoked',
  'unmount',
];

test('background location is iOS Always during a trip, and every stop ends it', async () => {
  assert.equal(TRIP_DISTANCE_FILTER_METERS, 25);

  const idle = initialTripWatchSession();
  for (const reason of STOP_REASONS) {
    const ended = endTripWatch(idle, reason);
    assert.deepEqual(tripWatchCommands(ended), []);
    assert.equal(ended.session.mode, 'none');
    assert.equal(ended.reason, reason);
  }

  const started = beginTripWatch(idle, 'background');
  assert.deepEqual(tripWatchCommands(started), ['start-background']);
  const again = beginTripWatch(started.session, 'background');
  assert.deepEqual(tripWatchCommands(again), []);

  for (const reason of STOP_REASONS) {
    const ended = endTripWatch(started.session, reason);
    assert.deepEqual(tripWatchCommands(ended), ['stop-background']);
    assert.equal(ended.startBackground, false);
    assert.equal(ended.session.mode, 'none');
  }

  const foreground = beginTripWatch(started.session, 'foreground');
  assert.deepEqual(tripWatchCommands(foreground), ['stop-background']);
  assert.deepEqual(tripWatchCommands(endTripWatch(foreground.session, 'stop_tracking')), []);
});

test('Always is requested only on iOS after the explainer, and While Using stays foreground', async () => {
  assert.equal(ALWAYS_LOCATION_EXPLAINER_BODY.includes(LOCATION_CONSENT_COPY), true);
  assert.match(ALWAYS_LOCATION_EXPLAINER_BODY, /Allow Always/);
  assert.match(ALWAYS_LOCATION_EXPLAINER_BODY, /While Using the App/);
  assert.equal(planAlwaysPrompt({ platform: 'ios', auth: 'always', explainerAccepted: null }).action, 'background');
  assert.equal(planAlwaysPrompt({ platform: 'ios', auth: 'whenInUse', explainerAccepted: null }).action, 'explain');
  assert.equal(planAlwaysPrompt({ platform: 'ios', auth: 'whenInUse', explainerAccepted: false }).action, 'foreground');
  assert.equal(planAlwaysPrompt({ platform: 'ios', auth: 'whenInUse', explainerAccepted: true }).action, 'request-always');
  assert.equal(planAlwaysPrompt({ platform: 'ios', auth: 'denied', explainerAccepted: null }).action, 'none');
  assert.equal(planAlwaysPrompt({ platform: 'web', auth: 'prompt', explainerAccepted: null }).action, 'foreground');

  const calls: string[] = [];
  const watch = (
    platform: TripPlatform,
    auth: TripLocationAuth,
    accept: boolean,
    after: TripLocationAuth,
  ) => chooseTripWatch({
    platform,
    readAuth: async () => {
      calls.push('read');
      return auth;
    },
    explain: async () => {
      calls.push('explain');
      return accept;
    },
    requestAlways: async () => {
      calls.push('request');
      return after;
    },
  });

  calls.length = 0;
  assert.equal(await watch('web', 'whenInUse', true, 'always'), 'foreground');
  assert.deepEqual(calls, []);

  calls.length = 0;
  assert.equal(await watch('android', 'whenInUse', true, 'always'), 'foreground');
  assert.deepEqual(calls, []);

  calls.length = 0;
  assert.equal(await watch('ios', 'always', true, 'whenInUse'), 'background');
  assert.deepEqual(calls, ['read']);

  calls.length = 0;
  assert.equal(await watch('ios', 'whenInUse', false, 'always'), 'foreground');
  assert.deepEqual(calls, ['read', 'explain']);

  calls.length = 0;
  assert.equal(await watch('ios', 'whenInUse', true, 'whenInUse'), 'foreground');
  assert.deepEqual(calls, ['read', 'explain', 'request']);

  calls.length = 0;
  assert.equal(await watch('ios', 'whenInUse', true, 'always'), 'background');
  assert.deepEqual(calls, ['read', 'explain', 'request']);

  calls.length = 0;
  assert.equal(await watch('ios', 'whenInUse', true, 'denied'), 'none');
  assert.deepEqual(calls, ['read', 'explain', 'request']);

  calls.length = 0;
  assert.equal(await watch('ios', 'denied', true, 'always'), 'none');
  assert.deepEqual(calls, ['read']);

  calls.length = 0;
  assert.equal(await chooseTripWatch({
    platform: 'ios',
    readAuth: async () => { throw new Error('plugin missing'); },
    explain: async () => { calls.push('explain'); return true; },
    requestAlways: async () => { calls.push('request'); return 'always'; },
  }), 'foreground');
  assert.deepEqual(calls, []);
});

test('the pause banner stays unless iOS background sharing is active', () => {
  assert.equal(locationShareBanner('web', true), FOREGROUND_LOCATION_SHARE_BANNER);
  assert.equal(locationShareBanner('android', true), FOREGROUND_LOCATION_SHARE_BANNER);
  assert.equal(locationShareBanner('ios', false), FOREGROUND_LOCATION_SHARE_BANNER);
  assert.match(FOREGROUND_LOCATION_SHARE_BANNER, /Sharing pauses if you leave the app/);
  assert.equal(locationShareBanner('ios', true), BACKGROUND_LOCATION_SHARE_BANNER);
  assert.equal(/pauses if you leave the app/.test(BACKGROUND_LOCATION_SHARE_BANNER), false);
  assert.match(BACKGROUND_LOCATION_SHARE_BANNER, /phone is locked/);
});

test('the hook starts background updates on the shared write path and stops them on every stop', () => {
  const hook = read('../hooks/useCleanerTracking.ts');
  const card = read('../components/staff/MyJobCard.tsx');
  const wrapper = read('./tripBackgroundLocation.ts');
  const swift = read('../../ios/App/App/TripBackgroundLocationPlugin.swift');
  const plist = read('../../ios/App/App/Info.plist');
  const delegate = read('../../ios/App/App/AppDelegate.swift');

  assert.match(hook, /chooseTripWatch\(/);
  assert.match(hook, /if \(Capacitor\.getPlatform\(\) === 'ios'\)/);
  assert.match(hook, /endTripWatch\(sessionRef\.current, resolvedReason\)/);
  assert.match(hook, /haltWatchRef\.current\(markArrivedAt\)/);
  assert.match(hook, /reason \?\? \(markArrivedAt \? 'arrival' : 'job_finished'\)/);
  assert.match(hook, /stopTrackingRef\.current\('consent_revoked'\)/);
  assert.match(hook, /stopTracking\('unmount'\)/);
  assert.match(hook, /startTripBackgroundUpdates\(\(latitude, longitude\) =>/);
  assert.match(hook, /writePositionRef\.current\(latitude, longitude\)/);
  assert.match(hook, /MIN_WRITE_INTERVAL_MS = 8_000/);
  assert.match(hook, /runArrivalAttempt\(arrivedRef/);
  assert.equal(hook.match(/functions\.invoke\('send-arrival-sms'/g)?.length, 1);
  assert.match(hook, /explainAlwaysLocation/);

  assert.match(card, /stopTracking\('job_started'\)/);
  assert.match(card, /stopTracking\('job_finished'\)/);
  assert.match(card, /locationShareBanner\(/);
  assert.equal(card.includes('Sharing pauses if you leave the app'), false);

  assert.match(wrapper, /distanceFilter: TRIP_DISTANCE_FILTER_METERS/);
  assert.match(wrapper, /TripBackgroundLocation\.stop\(\)/);

  assert.match(swift, /allowsBackgroundLocationUpdates = true/);
  assert.match(swift, /showsBackgroundLocationIndicator = true/);
  assert.match(swift, /activityType = \.automotiveNavigation/);
  assert.match(swift, /pausesLocationUpdatesAutomatically = true/);
  assert.match(swift, /authorizationStatus == \.authorizedAlways/);
  assert.match(swift, /requestAlwaysAuthorization\(\)/);
  assert.match(swift, /startUpdatingLocation\(\)/);
  assert.equal(swift.includes('func load()'), false);

  assert.match(plist, /<string>location<\/string>/);
  assert.match(plist, /NSLocationAlwaysAndWhenInUseUsageDescription/);
  assert.match(delegate, /registerPluginInstance\(TripBackgroundLocationPlugin\(\)\)/);
  assert.equal(delegate.includes('startUpdatingLocation'), false);
  assert.equal(delegate.includes('requestAlwaysAuthorization'), false);
});
