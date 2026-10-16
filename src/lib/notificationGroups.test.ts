/**
 * Group-to-event mapping for the simplified notification settings screen.
 *
 * Run with:  node --test src/lib/notificationGroups.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NOTIFICATION_TYPES, isChannelEnabled, typeByKey } from './notificationCatalog.ts';
import {
  ADVANCED_ONLY_EVENT_KEYS,
  CUSTOMER_NOTIFICATION_TOGGLES,
  OWNER_NOTIFICATION_GROUPS,
  OWNER_SMS_BUSINESS_COLUMNS,
  OWNER_SMS_SETTINGS_COLUMNS,
  briefsVisual,
  eventArmed,
  eventsForGroup,
  groupCountsAsOn,
  groupVisual,
  matrixPatchForGroupToggle,
  ownerDeliveryEnabled,
  ownerDeliveryPatch,
  ownerSmsColumnUpdates,
  presetMatrix,
  OWNER_TEXT_EVENTS,
  ownerTextMeEnabled,
  systemNotificationCatalogKey,
} from './notificationGroups.ts';

const catalogKeys = NOTIFICATION_TYPES.map((type) => type.key);

test('every group event exists in the catalog', () => {
  for (const group of OWNER_NOTIFICATION_GROUPS) {
    for (const key of group.eventKeys) {
      assert.ok(typeByKey(key), `${group.id} references unknown event ${key}`);
    }
  }
});

test('no event sits in two owner groups', () => {
  const seen = new Map<string, string>();
  for (const group of OWNER_NOTIFICATION_GROUPS) {
    for (const key of group.eventKeys) {
      const prior = seen.get(key);
      assert.equal(prior, undefined, `${key} is in both ${prior} and ${group.id}`);
      seen.set(key, group.id);
    }
  }
});

test('every catalog event is either in a group or explicitly advanced-only', () => {
  const grouped = new Set(OWNER_NOTIFICATION_GROUPS.flatMap((group) => [...group.eventKeys]));
  const advanced = new Set(ADVANCED_ONLY_EVENT_KEYS);
  const uncovered = catalogKeys.filter((key) => !grouped.has(key) && !advanced.has(key));
  const overlap = catalogKeys.filter((key) => grouped.has(key) && advanced.has(key));
  assert.deepEqual(uncovered, []);
  assert.deepEqual(overlap, []);
  assert.equal(grouped.size + advanced.size, catalogKeys.length);
});

test('daily summary is a brief toggle, not a catalog event', () => {
  const daily = OWNER_NOTIFICATION_GROUPS.find((group) => group.id === 'daily');
  assert.ok(daily);
  assert.deepEqual([...daily.eventKeys], []);
  assert.equal(briefsVisual(true, true), 'on');
  assert.equal(briefsVisual(false, false), 'off');
  assert.equal(briefsVisual(true, false), 'mixed');
});

test('an empty matrix reads as on and is not rewritten', () => {
  const matrix = {};
  for (const group of OWNER_NOTIFICATION_GROUPS) {
    if (group.id === 'daily') continue;
    assert.equal(groupVisual(group.id, matrix), 'on', group.id);
  }
  const patch = matrixPatchForGroupToggle('bookings', true, matrix);
  assert.deepEqual(patch, {});
  assert.deepEqual(matrix, {});
});

test('turning a group off writes false for every channel and leaves other events', () => {
  const matrix = {
    'booking.new': { email: true, sms: true },
    'lead.new': { email: true },
  };
  const before = structuredClone(matrix);
  const patch = matrixPatchForGroupToggle('bookings', false, matrix);
  assert.deepEqual(matrix, before);

  for (const key of eventsForGroup('bookings')) {
    assert.ok(patch[key], key);
    for (const channel of ['sidebar', 'bell', 'browser_push', 'native_push', 'email', 'sms']) {
      assert.equal(patch[key][channel], false, `${key}.${channel}`);
    }
  }
  assert.equal(patch['lead.new'], undefined);
  assert.equal(groupVisual('bookings', { ...matrix, ...patch }), 'off');
  assert.equal(groupVisual('reviews', { ...matrix, ...patch }), 'on');
});

test('turning a group on fills defaults only for events that are fully off', () => {
  const matrix = {
    'booking.new': { email: false, sms: true, sidebar: true, bell: true, browser_push: false, native_push: false },
    'booking.cancelled': {
      sidebar: false,
      bell: false,
      browser_push: false,
      native_push: false,
      email: false,
      sms: false,
    },
  };
  const patch = matrixPatchForGroupToggle('bookings', true, matrix);
  assert.equal(patch['booking.new'], undefined);
  assert.ok(patch['booking.cancelled']);
  const cancelled = typeByKey('booking.cancelled');
  assert.equal(patch['booking.cancelled'].email, !!cancelled?.defaults?.email);
  assert.equal(patch['booking.cancelled'].sms, !!cancelled?.defaults?.sms);
  assert.equal(patch['booking.cancelled'].bell, true);

  const merged = { ...matrix, ...patch };
  assert.equal(eventArmed('booking.new', merged), true);
  assert.equal(isChannelEnabled('booking.new', 'sms', merged, undefined), true);
  assert.equal(isChannelEnabled('booking.new', 'email', merged, undefined), false);
});

test('a partial group shows mixed and still counts as on for legacy SMS', () => {
  const off = {
    sidebar: false,
    bell: false,
    browser_push: false,
    native_push: false,
    email: false,
    sms: false,
  };
  const matrix = { 'booking.cancelled': off };
  assert.equal(groupVisual('bookings', matrix), 'mixed');
  assert.equal(groupCountsAsOn('mixed'), true);
  assert.equal(groupCountsAsOn('off'), false);
});

test('managers do not see or write finance-only payment events', () => {
  const visible = eventsForGroup('payments', { includeManagerLocked: false });
  assert.deepEqual(visible, ['booking.payment_failed']);
  const patch = matrixPatchForGroupToggle('payments', false, {}, { includeManagerLocked: false });
  assert.deepEqual(Object.keys(patch), ['booking.payment_failed']);
  assert.equal(patch['invoice.paid'], undefined);
});

test('push master maps to browser and native push without dropping other flags', () => {
  const channels = { 'channel.sidebar_badge': false, 'master.email': false };
  assert.equal(ownerDeliveryEnabled('push', channels), true);
  assert.equal(ownerDeliveryEnabled('email', channels), false);
  assert.equal(ownerDeliveryEnabled('sms', {}), true);

  const patch = ownerDeliveryPatch('push', false);
  assert.deepEqual(patch, { 'master.browser_push': false, 'master.native_push': false });
  const merged = { ...channels, ...patch };
  assert.equal(merged['channel.sidebar_badge'], false);
  assert.equal(merged['master.email'], false);
  assert.equal(ownerDeliveryEnabled('push', merged), false);
  assert.equal(ownerDeliveryEnabled('push', { ...merged, ...ownerDeliveryPatch('push', true) }), true);
});

test('owner SMS columns follow the text switch and the group, and customer toggles stay separate', () => {
  assert.deepEqual(ownerSmsColumnUpdates({ smsMasterOn: true, bookingsOn: true, cleanerOn: false }), {
    business: { notify_new_booking: true, notify_cancellations: true },
    sms: { notify_admin_on_the_way: false, notify_admin_arrived: false },
  });
  assert.deepEqual(ownerSmsColumnUpdates({ smsMasterOn: false, bookingsOn: true, cleanerOn: true }), {
    business: { notify_new_booking: false, notify_cancellations: false },
    sms: { notify_admin_on_the_way: false, notify_admin_arrived: false },
  });

  const ownerColumns = new Set<string>([
    ...OWNER_SMS_BUSINESS_COLUMNS.bookings,
    ...OWNER_SMS_SETTINGS_COLUMNS.cleaner,
  ]);
  for (const toggle of CUSTOMER_NOTIFICATION_TOGGLES) {
    assert.equal(ownerColumns.has(toggle.id), false, toggle.id);
    assert.equal(catalogKeys.includes(toggle.id), false, toggle.id);
  }
  assert.equal(CUSTOMER_NOTIFICATION_TOGGLES.filter((toggle) => toggle.table === 'business_settings').map((toggle) => toggle.id).join(), 'notify_reminders');
});

test('balanced preset writes catalog defaults and does not touch events it was not given', () => {
  const sample = NOTIFICATION_TYPES.filter((type) => type.key === 'booking.new' || type.key === 'booking.confirmed');
  const matrix = presetMatrix('balanced', sample);
  assert.deepEqual(Object.keys(matrix).sort(), ['booking.confirmed', 'booking.new']);
  assert.equal(matrix['booking.new'].email, true);
  assert.equal(matrix['booking.confirmed'].email, false);
  assert.equal(matrix['booking.confirmed'].bell, true);
  assert.equal(matrix['lead.new'], undefined);

  const action = presetMatrix('action', sample);
  assert.equal(action['booking.new'].bell, true);
  assert.equal(action['booking.new'].email, false);
  assert.equal(action['booking.confirmed'].bell, false);
});

test('system bell rows map only for events the owner can silence', () => {
  assert.equal(systemNotificationCatalogKey('time_off_request'), 'staff.time_off_request');
  assert.equal(systemNotificationCatalogKey('staff_activity'), 'staff.activity');
  assert.equal(systemNotificationCatalogKey('booking.new'), 'booking.new');
  assert.equal(systemNotificationCatalogKey('job.arrived'), 'job.arrived');
  assert.equal(systemNotificationCatalogKey('booking.confirmed'), undefined);
  assert.equal(systemNotificationCatalogKey('lead.new'), undefined);
  assert.equal(systemNotificationCatalogKey('email_change_request'), undefined);
  assert.equal(systemNotificationCatalogKey('trial_reminder'), undefined);
  assert.equal(systemNotificationCatalogKey('email_send_failure'), undefined);
  assert.equal(systemNotificationCatalogKey(null), undefined);
});

test('owner texts default off and turn on only for an explicit Also text me', () => {
  for (const event of OWNER_TEXT_EVENTS) {
    const type = typeByKey(event.key);
    assert.ok(type, event.key);
    assert.equal(type?.defaults?.sms, false, event.key);
    assert.equal(isChannelEnabled(event.key, 'sms', {}, undefined), false);
    assert.equal(ownerTextMeEnabled(event.key, {}, {}), false);
    assert.equal(ownerTextMeEnabled(event.key, { [event.key]: { sms: true } }, {}), true);
    assert.equal(ownerTextMeEnabled(event.key, { [event.key]: { sms: true } }, { 'master.sms': false }), false);
  }
});
