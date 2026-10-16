import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildLocationSectionModel,
  classifyPermissionFailure,
  classifyPluginStatus,
  classifyWebPermission,
  locationBannerCopy,
  locationSettingsSteps,
  locationStatusLabel,
  staffLocationSearch,
} from './locationPermission.ts';

test('native granted is on, and Always and While Using share that label', () => {
  const classified = classifyPluginStatus({ location: 'granted', coarseLocation: 'granted' });
  assert.equal(classified.kind, 'on-while-using');
  assert.equal(classified.precise, true);
  assert.equal(locationStatusLabel(classified.kind), 'On (Always / While Using)');
});

test('a dedicated always kind keeps its own label', () => {
  assert.equal(locationStatusLabel('on-always'), 'On (Always)');
});

test('android approximate location stays on and flags precise as off', () => {
  const classified = classifyPluginStatus({ location: 'denied', coarseLocation: 'granted' });
  assert.deepEqual(classified, { kind: 'on-while-using', precise: false });
});

test('denied, not asked, and an unknown plugin value', () => {
  assert.equal(classifyPluginStatus({ location: 'denied', coarseLocation: 'denied' }).kind, 'off');
  assert.equal(classifyPluginStatus({ location: 'prompt', coarseLocation: 'prompt' }).kind, 'not-asked');
  assert.equal(
    classifyPluginStatus({ location: 'prompt-with-rationale', coarseLocation: 'prompt-with-rationale' }).kind,
    'not-asked',
  );
  assert.equal(classifyPluginStatus({ location: 'weird' }).kind, 'error');
});

test('system location switch off is Off, any other plugin failure is an error', () => {
  assert.equal(
    classifyPermissionFailure('Location services are not enabled.').kind,
    'off',
  );
  assert.equal(classifyPermissionFailure('OS-PLUG-GLOC-0007').kind, 'off');
  assert.equal(classifyPermissionFailure('bridge timeout').kind, 'error');
});

test('web permission states, including a browser with no geolocation', () => {
  assert.equal(classifyWebPermission({ hasGeolocation: false, permission: null }).kind, 'unavailable');
  assert.equal(classifyWebPermission({ hasGeolocation: true, permission: 'granted' }).kind, 'on-while-using');
  assert.equal(classifyWebPermission({ hasGeolocation: true, permission: 'denied' }).kind, 'off');
  assert.equal(classifyWebPermission({ hasGeolocation: true, permission: 'prompt' }).kind, 'not-asked');
  assert.equal(classifyWebPermission({ hasGeolocation: true, permission: null }).kind, 'not-asked');
});

test('iOS denied model has the settings button and three plain steps', () => {
  const model = buildLocationSectionModel({
    kind: 'off',
    precise: false,
    platform: 'ios',
    native: true,
    userAgent: '',
  });
  assert.equal(model.label, 'Off');
  assert.equal(model.showTurnOn, true);
  assert.equal(model.showOpenSettings, true);
  assert.equal(model.androidHandNote, null);
  assert.equal(model.stepsTitle, 'On iPhone');
  assert.deepEqual(model.steps, locationSettingsSteps('ios'));
  assert.equal(model.steps?.length, 3);
  assert.match(model.steps?.[2] ?? '', /While Using the App/);
  assert.match(model.steps?.[2] ?? '', /Precise Location/);
  assert.equal(
    model.why,
    "Location is shared while you're On My Way and recorded at clock in, clock out and job photos.",
  );
  assert.equal(
    model.whyMore,
    "We share your location with your business and its customer only while you're On My Way, and stop when you arrive. If location is on, we also record it when you clock in or out and take job photos. Admins may see your last shared location until the job's start time. You can turn it off anytime in Settings.",
  );
});

test('android denied model explains that Settings must be opened by hand', () => {
  const model = buildLocationSectionModel({
    kind: 'off',
    precise: false,
    platform: 'android',
    native: true,
    userAgent: '',
  });
  assert.equal(model.showOpenSettings, false);
  assert.match(model.androidHandNote ?? '', /cannot jump/);
  assert.equal(model.stepsTitle, 'On Android');
  assert.equal(model.steps?.length, 3);
  assert.match(model.steps?.[2] ?? '', /while using the app/i);
});

test('web without geolocation is Unavailable and has no settings button', () => {
  const model = buildLocationSectionModel({
    kind: 'unavailable',
    precise: null,
    platform: 'web',
    native: false,
    userAgent: 'Mozilla/5.0',
  });
  assert.equal(model.label, 'Unavailable');
  assert.equal(model.showOpenSettings, false);
  assert.equal(model.steps, null);
  assert.match(model.statusNote ?? '', /does not have location/);
});

test('a denied desktop browser gets browser help, not phone steps', () => {
  const model = buildLocationSectionModel({
    kind: 'off',
    precise: false,
    platform: 'web',
    native: false,
    userAgent: 'Mozilla/5.0 (Macintosh)',
  });
  assert.equal(model.steps, null);
  assert.match(model.browserHelp ?? '', /address bar/);
});

test('banner is hidden while location is on or still loading', () => {
  assert.equal(locationBannerCopy('checking'), null);
  assert.equal(locationBannerCopy('on-while-using'), null);
  assert.equal(locationBannerCopy('on-always'), null);
  assert.match(locationBannerCopy('off')?.title ?? '', /off/);
  assert.match(locationBannerCopy('not-asked')?.title ?? '', /not on yet/);
  assert.match(locationBannerCopy('unavailable')?.title ?? '', /unavailable/i);
});

test('the jobs banner links into the profile tab location section', () => {
  const next = staffLocationSearch(new URLSearchParams('payout=1'));
  assert.equal(next.get('tab'), 'profile');
  assert.equal(next.get('focus'), 'location');
  assert.equal(next.get('payout'), '1');
});
