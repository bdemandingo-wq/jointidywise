// Plain-language groups over the existing notification catalog.
//
// Nothing here writes preferences by itself. The settings screen derives each
// group switch from the saved matrix (and the daily-summary columns), and only
// writes when the owner moves a switch. An empty matrix keeps catalog defaults,
// so opening the new screen never resets a saved preference.
//
// Owner texts are the per-event matrix sms flag ("Also text me"), off until
// the owner turns one on. ownerSmsColumnUpdates still describes the legacy
// business_settings / organization_sms_settings columns. The settings screen
// no longer writes those columns.

import {
  CHANNELS,
  isChannelEnabled,
  isMasterChannelOn,
  masterChannelKey,
  typeByKey,
  type NotificationChannel,
} from './notificationCatalog.ts';

export type ChannelMatrix = Record<string, Record<string, boolean>>;
export type FlagMap = Record<string, boolean>;
export type SnoozeMap = Record<string, string>;

export type GroupVisual = 'on' | 'off' | 'mixed';
export type OwnerDelivery = 'push' | 'email' | 'sms';

export interface OwnerNotificationGroup {
  id: string;
  label: string;
  description: string;
  /** Catalog keys this switch controls. Daily summary has none; it uses brief columns. */
  eventKeys: readonly string[];
}

export const OWNER_NOTIFICATION_GROUPS: readonly OwnerNotificationGroup[] = [
  {
    id: 'bookings',
    label: 'New & changed bookings',
    description: 'New requests, confirmations, cancellations, reschedules, and schedule conflicts.',
    eventKeys: [
      'booking.new',
      'booking.confirmed',
      'booking.cancelled',
      'booking.rescheduled',
      'booking.unassigned',
      'booking.conflicts',
      'booking.cleaner_assigned',
      'booking.cleaner_claimed',
      'client.portal_request',
      'client.reschedule_request',
      'client.cancel_request',
    ],
  },
  {
    id: 'cleaner',
    label: 'Cleaner updates',
    description: 'On the way, started, finished, late, or missing photos and checklists.',
    eventKeys: [
      'job.on_the_way',
      'job.arrived',
      'job.completed',
      'booking.late_checkin',
      'booking.completed',
      'booking.missing_checklists',
      'booking.missing_photos',
      'staff.activity',
      'staff.job_claimed',
    ],
  },
  {
    id: 'payments',
    label: 'Payments',
    description: 'Failed charges, invoices, Stripe, payouts, and payroll alerts.',
    eventKeys: [
      'booking.payment_failed',
      'invoice.overdue',
      'invoice.paid',
      'invoice.failed',
      'stripe.disconnected',
      'stripe.verification',
      'payout.issue',
      'finance.payroll',
      'finance.alert',
      'finance.report',
      'staff.payout_issue',
      'staff.stripe_verification',
    ],
  },
  {
    id: 'reviews',
    label: 'Reviews & messages',
    description: 'Customer texts, unread messages, feedback, low ratings, and complaints.',
    eventKeys: [
      'client.message',
      'client.feedback',
      'client.complaint',
      'client.low_rating',
      'messages.inbound_sms',
      'messages.unread',
      'messages.failed',
    ],
  },
  {
    id: 'staff',
    label: 'Staff time off & documents',
    description: 'Time-off requests and staff documents that are missing or expiring.',
    eventKeys: [
      'staff.time_off_request',
      'staff.time_off_approved',
      'staff.time_off_denied',
      'staff.missing_documents',
    ],
  },
  {
    id: 'daily',
    label: 'Daily summary',
    description: 'Morning brief at 8:00 AM and end-of-day report at 7:00 PM, Eastern, by email.',
    eventKeys: [],
  },
];

/**
 * Catalog events that stay in Advanced only. They still save and still drive
 * sidebar badges; they are not on the short list because most of them never
 * send a push, email, or text.
 */
export const ADVANCED_ONLY_EVENT_KEYS: readonly string[] = [
  'lead.new',
  'lead.hot',
  'lead.follow_up',
  'lead.stale',
  'lead.converted',
  'lead.lost',
  'crm.new_customer',
  'tasks.new',
  'tasks.overdue',
  'tasks.completed',
  'inventory.low',
  'inventory.out',
  'automation.failed',
  'campaign.failed',
  'integration.disconnected',
  'import.failed',
];

/** business_settings columns the booking SMS senders actually read. */
export const OWNER_SMS_BUSINESS_COLUMNS = {
  bookings: ['notify_new_booking', 'notify_cancellations'],
} as const;

/** organization_sms_settings columns the cleaner-update SMS senders actually read. */
export const OWNER_SMS_SETTINGS_COLUMNS = {
  cleaner: ['notify_admin_on_the_way', 'notify_admin_arrived'],
} as const;

export type CustomerToggleTable = 'organization_sms_settings' | 'business_settings';

export interface CustomerNotificationToggle {
  id: string;
  table: CustomerToggleTable;
  label: string;
  description: string;
}

/** Texts and emails that go to the business's customers, not the owner. */
export const CUSTOMER_NOTIFICATION_TOGGLES: readonly CustomerNotificationToggle[] = [
  {
    id: 'notify_client_on_the_way',
    table: 'organization_sms_settings',
    label: 'Text when the cleaner is on the way',
    description: 'Sent to the customer from your business number.',
  },
  {
    id: 'notify_client_distance_eta',
    table: 'organization_sms_settings',
    label: 'Include arrival time in that text',
    description: 'Adds the ETA when the cleaner entered one.',
  },
  {
    id: 'notify_client_arrived',
    table: 'organization_sms_settings',
    label: 'Text when the cleaner arrives',
    description: 'Sent to the customer.',
  },
  {
    id: 'sms_booking_confirmation',
    table: 'organization_sms_settings',
    label: 'Booking confirmation text',
    description: 'Sent to the customer after a booking is confirmed.',
  },
  {
    id: 'sms_appointment_reminder',
    table: 'organization_sms_settings',
    label: 'Appointment reminder text',
    description: 'Sent to the customer before the job.',
  },
  {
    id: 'notify_reminders',
    table: 'business_settings',
    label: 'Appointment reminder email',
    description: 'Sent to the customer, not to you. Turning this off also stops the reminder text.',
  },
];

/**
 * admin_system_notifications.type values that correspond to a catalog event.
 * Unlisted types (trial reminders, email-change requests, failed sends) stay
 * visible so a preference cannot hide them.
 */
export const SYSTEM_NOTIFICATION_CATALOG_KEYS: Record<string, string> = {
  time_off_request: 'staff.time_off_request',
  staff_activity: 'staff.activity',
};

/**
 * Owner texts are off until the owner turns on "Also text me" for that event.
 * These are the events notifyOwner can text. Customer texts are not in this list.
 */
export const OWNER_TEXT_EVENTS: readonly { key: string; label: string }[] = [
  { key: 'booking.new', label: 'New booking' },
  { key: 'client.portal_request', label: 'Client portal request' },
  { key: 'booking.cancelled', label: 'Cancellation' },
  { key: 'job.on_the_way', label: 'Cleaner on the way' },
  { key: 'job.arrived', label: 'Cleaner arrived' },
  { key: 'job.completed', label: 'Job completed' },
];

export function systemNotificationCatalogKey(type: string | null | undefined): string | undefined {
  if (!type) return undefined;
  const mapped = SYSTEM_NOTIFICATION_CATALOG_KEYS[type];
  if (mapped) return mapped;
  // Owner alerts store the catalog key itself. Other catalog keys stay visible.
  if (OWNER_TEXT_EVENTS.some((event) => event.key === type)) return type;
  return undefined;
}

/**
 * The bell already builds these from bookings and portal requests.
 * A matching admin_system_notifications row would show the same event twice.
 */
const LIVE_BELL_EVENT_KEYS = new Set(['booking.new', 'client.portal_request', 'booking.cancelled']);

export function systemBellDuplicatesLiveEvent(type: string | null | undefined): boolean {
  return !!type && LIVE_BELL_EVENT_KEYS.has(type);
}

/** Copy for the settings banner when no operator iPhone is registered. */
export function ownerInstallBanner(args: { emailOn: boolean; emailReady: boolean }): string {
  const lead = 'Install the TidyWise iPhone app to get alerts as push notifications.';
  if (!args.emailOn) {
    return `${lead} Email alerts are turned off, so they won't be emailed until you turn email on.`;
  }
  if (!args.emailReady) {
    return `${lead} No alert email is set up, so they won't be emailed until you add one.`;
  }
  return `${lead} Until then, we'll email them.`;
}

/** True only when this event's matrix sms flag is explicitly on and the text master is on. */
export function ownerTextMeEnabled(
  eventKey: string,
  matrix: ChannelMatrix | undefined,
  channels: FlagMap | undefined,
): boolean {
  return ownerDeliveryEnabled('sms', channels) && matrix?.[eventKey]?.sms === true;
}

export function ownerGroupById(id: string): OwnerNotificationGroup | undefined {
  return OWNER_NOTIFICATION_GROUPS.find((group) => group.id === id);
}

export function eventsForGroup(
  groupId: string,
  opts?: { includeManagerLocked?: boolean },
): string[] {
  const group = ownerGroupById(groupId);
  if (!group) return [];
  const includeLocked = opts?.includeManagerLocked !== false;
  return group.eventKeys.filter((key) => {
    const type = typeByKey(key);
    if (!type) return false;
    if (type.managerLocked && !includeLocked) return false;
    return true;
  });
}

function defaultRow(typeKey: string): Record<string, boolean> {
  const type = typeByKey(typeKey);
  const row: Record<string, boolean> = {};
  for (const channel of CHANNELS) {
    row[channel.key] = !!type?.defaults?.[channel.key];
  }
  return row;
}

function allOffRow(): Record<string, boolean> {
  const row: Record<string, boolean> = {};
  for (const channel of CHANNELS) row[channel.key] = false;
  return row;
}

/** True when any channel would fire for this event, ignoring master switches and snooze. */
export function eventArmed(
  typeKey: string,
  matrix: ChannelMatrix | undefined,
): boolean {
  return CHANNELS.some((channel) =>
    isChannelEnabled(typeKey, channel.key, matrix, undefined),
  );
}

export function groupVisual(
  groupId: string,
  matrix: ChannelMatrix | undefined,
  opts?: { includeManagerLocked?: boolean },
): GroupVisual {
  const keys = eventsForGroup(groupId, opts);
  if (keys.length === 0) return 'off';
  const armed = keys.map((key) => eventArmed(key, matrix));
  if (armed.every(Boolean)) return 'on';
  if (armed.some(Boolean)) return 'mixed';
  return 'off';
}

/**
 * Matrix rows to merge when the owner flips a group switch.
 * Turning on fills defaults only for events that are fully off, so a custom
 * per-channel setup is left alone. Turning off writes an explicit false on
 * every channel. The input matrix is not mutated.
 */
export function matrixPatchForGroupToggle(
  groupId: string,
  on: boolean,
  matrix: ChannelMatrix | undefined,
  opts?: { includeManagerLocked?: boolean },
): ChannelMatrix {
  const patch: ChannelMatrix = {};
  for (const key of eventsForGroup(groupId, opts)) {
    if (on && eventArmed(key, matrix)) continue;
    patch[key] = on ? defaultRow(key) : allOffRow();
  }
  return patch;
}

export function ownerDeliveryEnabled(delivery: OwnerDelivery, channels: FlagMap | undefined): boolean {
  if (delivery === 'push') {
    return isMasterChannelOn('browser_push', channels) && isMasterChannelOn('native_push', channels);
  }
  const channel: NotificationChannel = delivery === 'email' ? 'email' : 'sms';
  return isMasterChannelOn(channel, channels);
}

/** Keys to merge into organization_notification_preferences.channels. */
export function ownerDeliveryPatch(delivery: OwnerDelivery, on: boolean): FlagMap {
  if (delivery === 'push') {
    return {
      [masterChannelKey('browser_push')]: on,
      [masterChannelKey('native_push')]: on,
    };
  }
  const channel: NotificationChannel = delivery === 'email' ? 'email' : 'sms';
  return { [masterChannelKey(channel)]: on };
}

export function briefsVisual(morning: boolean, evening: boolean): GroupVisual {
  if (morning && evening) return 'on';
  if (!morning && !evening) return 'off';
  return 'mixed';
}

/**
 * Columns senders honor for owner SMS. Call only after the owner moves the
 * text-message switch or the bookings / cleaner group switch — never on load.
 * A group that is mixed still counts as on, matching the switch.
 */
export function ownerSmsColumnUpdates(args: {
  smsMasterOn: boolean;
  bookingsOn: boolean;
  cleanerOn: boolean;
}): { business: FlagMap; sms: FlagMap } {
  const bookings = args.smsMasterOn && args.bookingsOn;
  const cleaner = args.smsMasterOn && args.cleanerOn;
  return {
    business: {
      notify_new_booking: bookings,
      notify_cancellations: bookings,
    },
    sms: {
      notify_admin_on_the_way: cleaner,
      notify_admin_arrived: cleaner,
    },
  };
}

export function groupCountsAsOn(visual: GroupVisual): boolean {
  return visual !== 'off';
}

export type NotificationPreset = 'action' | 'balanced' | 'everything';

/**
 * Explicit per-event rows for a preset. Balanced writes the catalog defaults
 * (rather than an empty object) so saving it actually replaces a custom matrix.
 * Events omitted from `types` are left untouched by a merge.
 */
export function presetMatrix(
  preset: NotificationPreset,
  types: ReadonlyArray<{
    key: string;
    sidebarKey?: string;
    defaults?: Partial<Record<NotificationChannel, boolean>>;
  }>,
): ChannelMatrix {
  const matrix: ChannelMatrix = {};
  for (const type of types) {
    const row: Record<string, boolean> = {};
    if (preset === 'everything') {
      for (const channel of CHANNELS) {
        // Also text me stays off. Everything else in the preset turns on.
        row[channel.key] = channel.key === 'sms' && OWNER_TEXT_EVENTS.some((event) => event.key === type.key)
          ? false
          : true;
      }
    } else if (preset === 'action') {
      for (const channel of CHANNELS) row[channel.key] = false;
      if (type.sidebarKey) {
        row.sidebar = true;
        row.bell = true;
      }
    } else {
      for (const channel of CHANNELS) row[channel.key] = !!type.defaults?.[channel.key];
    }
    matrix[type.key] = row;
  }
  return matrix;
}
