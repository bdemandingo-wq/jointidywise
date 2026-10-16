import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  ALWAYS_LOCATION_EXPLAINER_BODY,
  ALWAYS_LOCATION_EXPLAINER_HEADING,
  BACKGROUND_LOCATION_SHARE_BANNER,
  FOREGROUND_LOCATION_SHARE_BANNER,
  TRIP_DISTANCE_FILTER_METERS,
  TRIP_MAX_DURATION_MS,
  beginTripWatch,
  chooseTripWatch,
  endTripWatch,
  initialTripWatchSession,
  locationShareBanner,
  planAlwaysPrompt,
  tripTimedOut,
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
  'closed',
  'unmount',
  'timeout',
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
  assert.equal(ALWAYS_LOCATION_EXPLAINER_HEADING, 'Keep sharing while your phone is locked?');
  assert.equal(
    ALWAYS_LOCATION_EXPLAINER_BODY,
    "To keep your customer updated, TidyWise can share your location during On My Way even if the app is closed or your phone is locked. It only runs during a trip and stops when you arrive, the job starts, the job ends, or after 3 hours. You'll see a blue location indicator while it's on.",
  );
  assert.match(ALWAYS_LOCATION_EXPLAINER_BODY, /job ends/);
  assert.match(ALWAYS_LOCATION_EXPLAINER_BODY, /3 hours/);
  assert.equal(TRIP_MAX_DURATION_MS, 3 * 60 * 60 * 1000);
  assert.equal(tripTimedOut(1_000, 1_000 + TRIP_MAX_DURATION_MS - 1), false);
  assert.equal(tripTimedOut(1_000, 1_000 + TRIP_MAX_DURATION_MS), true);
  assert.equal(planAlwaysPrompt({ platform: 'ios', auth: 'always', explainerAccepted: null }).action, 'background');
  assert.equal(planAlwaysPrompt({ platform: 'ios', auth: 'whenInUse', explainerAccepted: null }).action, 'explain');
  assert.equal(planAlwaysPrompt({ platform: 'ios', auth: 'whenInUse', explainerAccepted: null, alwaysRequested: true }).action, 'foreground');
  assert.equal(planAlwaysPrompt({ platform: 'ios', auth: 'always', explainerAccepted: null, alwaysRequested: true }).action, 'background');
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

  calls.length = 0;
  let skipped = false;
  const stillExplains = () => chooseTripWatch({
    platform: 'ios',
    readAuth: async () => {
      calls.push('read');
      return 'whenInUse';
    },
    explain: async () => {
      calls.push('explain');
      return false;
    },
    requestAlways: async () => {
      calls.push('request');
      return 'always';
    },
    rememberRequested: async () => { skipped = true; },
  });
  assert.equal(await stillExplains(), 'foreground');
  assert.deepEqual(calls, ['read', 'explain']);
  assert.equal(skipped, false);
  calls.length = 0;
  assert.equal(await stillExplains(), 'foreground');
  assert.deepEqual(calls, ['read', 'explain']);

  calls.length = 0;
  let remembered = false;
  assert.equal(await chooseTripWatch({
    platform: 'ios',
    readAuth: async () => 'whenInUse',
    explain: async () => { throw new Error('dialog missing'); },
    requestAlways: async () => 'always',
    rememberRequested: async () => { remembered = true; },
  }), 'foreground');
  assert.equal(remembered, false);

  calls.length = 0;
  let requested = false;
  const requestedWatch = () => chooseTripWatch({
    platform: 'ios',
    alwaysRequested: requested,
    readAuth: async () => {
      calls.push('read');
      return 'whenInUse';
    },
    explain: async () => {
      calls.push('explain');
      return true;
    },
    requestAlways: async () => {
      calls.push('request');
      return 'whenInUse';
    },
    rememberRequested: async () => {
      calls.push('remember-request');
      requested = true;
    },
  });
  assert.equal(await requestedWatch(), 'foreground');
  assert.deepEqual(calls, ['read', 'explain', 'request', 'remember-request']);
  calls.length = 0;
  assert.equal(await requestedWatch(), 'foreground');
  assert.deepEqual(calls, ['read']);

  calls.length = 0;
  assert.equal(await chooseTripWatch({
    platform: 'ios',
    alwaysRequested: true,
    readAuth: async () => {
      calls.push('read');
      return 'always';
    },
    explain: async () => {
      calls.push('explain');
      return false;
    },
    requestAlways: async () => {
      calls.push('request');
      return 'whenInUse';
    },
  }), 'background');
  assert.deepEqual(calls, ['read']);
});

test('the pause banner stays unless iOS background sharing is active', () => {
  assert.equal(locationShareBanner('web', true), FOREGROUND_LOCATION_SHARE_BANNER);
  assert.equal(locationShareBanner('android', true), FOREGROUND_LOCATION_SHARE_BANNER);
  assert.equal(locationShareBanner('ios', false), FOREGROUND_LOCATION_SHARE_BANNER);
  assert.match(FOREGROUND_LOCATION_SHARE_BANNER, /Sharing pauses if you leave the app/);
  assert.match(FOREGROUND_LOCATION_SHARE_BANNER, /customer/);
  assert.equal(/even with the app closed/.test(FOREGROUND_LOCATION_SHARE_BANNER), false);
  assert.equal(locationShareBanner('ios', true), BACKGROUND_LOCATION_SHARE_BANNER);
  assert.equal(/pauses if you leave the app/.test(BACKGROUND_LOCATION_SHARE_BANNER), false);
  assert.match(BACKGROUND_LOCATION_SHARE_BANNER, /customer/);
  assert.match(BACKGROUND_LOCATION_SHARE_BANNER, /while your trip is active, even if your phone is locked/);
  assert.match(BACKGROUND_LOCATION_SHARE_BANNER, /job ends/);
  assert.match(BACKGROUND_LOCATION_SHARE_BANNER, /3 hours/);
  assert.equal(/even with the app closed/.test(BACKGROUND_LOCATION_SHARE_BANNER), false);
});

test('the hook starts background updates on the shared write path and stops them on every stop', () => {
  const hook = read('../hooks/useCleanerTracking.ts');
  const card = read('../components/staff/MyJobCard.tsx');
  const wrapper = read('./tripBackgroundLocation.ts');
  const swift = read('../../ios/App/App/TripBackgroundLocationPlugin.swift');
  const plist = read('../../ios/App/App/Info.plist');
  const delegate = read('../../ios/App/App/AppDelegate.swift');
  const entry = read('../../src/main.tsx');

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
  assert.match(hook, /confirmLabel: 'Continue'/);
  assert.match(hook, /hideCancel: true/);
  assert.equal(hook.includes("cancelLabel: 'Not now'"), false);
  assert.equal(hook.includes('readAlwaysExplainerDeclined'), false);
  assert.match(hook, /readAlwaysLocationRequested\(\)/);
  assert.match(hook, /rememberRequested: rememberAlwaysLocationRequested/);
  const writeAt = hook.indexOf('const writePosition');
  const arrivalAt = hook.indexOf('void checkArrival(latitude, longitude);', writeAt);
  const throttleAt = hook.indexOf('MIN_WRITE_INTERVAL_MS', writeAt);
  assert.ok(writeAt >= 0 && arrivalAt > writeAt && throttleAt > arrivalAt);
  assert.match(hook, /stopTrackingRef\.current\('timeout'\)/);
  assert.match(hook, /TRIP_MAX_DURATION_MS/);
  assert.match(hook, /select\('id, tracking_token, created_at'\)/);
  assert.match(swift, /showsBackgroundLocationIndicator = true/);
  assert.match(swift, /3 \* 60 \* 60/);
  assert.match(swift, /notifyListeners\("timeout"/);
  assert.match(swift, /notifyListeners\("arrival"/);
  assert.match(swift, /"reason": "timeout"/);
  assert.match(swift, /"reason": "closed"/);
  assert.match(swift, /"reason": "arrived"/);
  assert.match(swift, /functions\/v1\/send-arrival-sms/);
  assert.match(swift, /arrived_at/);
  assert.match(swift, /distance\(from: destination\)/);
  assert.match(swift, /arrivalRadius: CLLocationDistance = 100/);
  assert.match(swift, /destinationLat/);
  assert.match(swift, /ALREADY_RUNNING/);
  assert.match(swift, /retainedEventArguments = \[:\]/);
  assert.match(swift, /heartbeatInterval: TimeInterval = 4 \* 60/);
  assert.match(swift, /authStorageKey\(url\)/);
  assert.equal(swift.includes('authStorageKey(url:'), false);
  assert.equal(swift.includes('timeIntervalSince1970 + 60'), false);
  assert.match(swift, /startedRefresh/);
  assert.ok((swift.match(/UserDefaults\.standard\.string\(forKey: defaultsKey\)/g) ?? []).length >= 2);

  assert.match(card, /stopTracking\('job_started'\)/);
  assert.match(card, /stopTracking\('job_finished'\)/);
  assert.match(card, /booking\.status === 'no_show'/);
  assert.match(hook, /reason === 'arrived'/);
  assert.match(hook, /reason === 'closed'/);
  assert.match(hook, /stopTrackingRef\.current\('closed'\)/);
  assert.match(hook, /sms === 'failed'/);
  assert.match(hook, /fireArrival\('native'\)/);
  assert.match(hook, /destinationLat: destCoordsRef\.current\?\.lat/);
  assert.match(hook, /bookingId,/);
  assert.match(hook, /trackingId: trackingIdRef\.current/);
  assert.match(hook, /supabaseUrl: SUPABASE_PUBLIC_URL/);
  assert.match(swift, /kCLLocationAccuracyHundredMeters/);
  assert.match(swift, /showsBackgroundLocationIndicator = false/);
  assert.match(swift, /rest\/v1\/cleaner_location_tracking/);
  assert.match(swift, /Bearer \\\(token\)/);
  assert.match(swift, /CapacitorStorage\./);
  assert.match(swift, /sb-\\\(ref\)-auth-token/);
  assert.equal(swift.includes('service_role'), false);
  assert.match(card, /locationShareBanner\(/);
  assert.equal(card.includes('Sharing pauses if you leave the app'), false);

  assert.match(wrapper, /addListener\('arrival'/);
  assert.match(wrapper, /acceptedEpoch/);
  assert.match(wrapper, /destinationLat: lat/);
  assert.match(wrapper, /A trip watcher is already running/);
  assert.match(wrapper, /distanceFilter: TRIP_DISTANCE_FILTER_METERS/);
  assert.match(wrapper, /TripBackgroundLocation\.stop\(\)/);
  assert.match(wrapper, /stopIdleNativeTripWatcher/);
  assert.match(wrapper, /await idleStop/);
  assert.match(entry, /stopIdleNativeTripWatcher\(\)/);

  assert.match(swift, /allowsBackgroundLocationUpdates = true/);
  assert.match(swift, /showsBackgroundLocationIndicator = true/);
  assert.match(swift, /activityType = \.automotiveNavigation/);
  assert.match(swift, /pausesLocationUpdatesAutomatically = false/);
  assert.match(swift, /var seconds/);
  assert.match(swift, /wallDeadline: DispatchWallTime\.now\(\)/);
  assert.match(swift, /tripDeadline/);
  assert.match(swift, /Date\(\) >= tripDeadline/);
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
