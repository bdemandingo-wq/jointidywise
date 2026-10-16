// Canonical catalog of every notification type surfaced in the app.
// Each type has:
//  - key: stable identifier (used as matrix column)
//  - label: user-visible label
//  - route: destination when the notification is clicked
//  - category: grouping in Settings → Notifications
//  - sidebarKey: optional legacy sidebar-badge key it drives (for useSidebarBadges compat)
//  - managerLocked: if true, hidden for the manager role (financial-only)
//  - defaults: per-channel default when the org has not customized
//
// Channels: sidebar badge, in-app bell, browser push, native app push, email, SMS.

export type NotificationChannel =
  | 'sidebar'
  | 'bell'
  | 'browser_push'
  | 'native_push'
  | 'email'
  | 'sms';

export const CHANNELS: { key: NotificationChannel; label: string; short: string }[] = [
  { key: 'sidebar', label: 'Sidebar badge', short: 'Sidebar' },
  { key: 'bell', label: 'In-app bell', short: 'Bell' },
  { key: 'browser_push', label: 'Browser push', short: 'Browser' },
  { key: 'native_push', label: 'Native app push', short: 'Native' },
  { key: 'email', label: 'Email', short: 'Email' },
  { key: 'sms', label: 'SMS', short: 'SMS' },
];

export interface NotificationTypeDef {
  key: string;
  label: string;
  route: string;
  category: string;
  managerLocked?: boolean;
  sidebarKey?: string;
  defaults?: Partial<Record<NotificationChannel, boolean>>;
}

// Default: sidebar+bell on; browser/native/email/sms off unless flagged.
const D = (over: Partial<Record<NotificationChannel, boolean>> = {}): Partial<
  Record<NotificationChannel, boolean>
> => ({
  sidebar: true,
  bell: true,
  browser_push: false,
  native_push: false,
  email: false,
  sms: false,
  ...over,
});

// Informational-only default: everything off except bell.
const INFO = (over: Partial<Record<NotificationChannel, boolean>> = {}): Partial<
  Record<NotificationChannel, boolean>
> => ({
  sidebar: false,
  bell: true,
  browser_push: false,
  native_push: false,
  email: false,
  sms: false,
  ...over,
});

export const CATEGORY_ORDER = [
  'Bookings & Scheduling',
  'Staff',
  'Customers & Client Portal',
  'CRM',
  'Messages & Tasks',
  'Payments & Finance',
  'Inventory & Automations',
] as const;

export const NOTIFICATION_TYPES: NotificationTypeDef[] = [
  // ── Bookings & Scheduling
  { key: 'booking.new', label: 'New booking request', route: '/dashboard/bookings?status=new', category: 'Bookings & Scheduling', sidebarKey: 'bookings.pending', defaults: D({ email: true, browser_push: true, native_push: true }) },
  { key: 'booking.confirmed', label: 'Booking confirmed', route: '/dashboard/bookings?status=confirmed', category: 'Bookings & Scheduling', defaults: INFO() },
  { key: 'booking.cancelled', label: 'Booking cancelled', route: '/dashboard/bookings?status=cancelled', category: 'Bookings & Scheduling', defaults: D({ email: true, browser_push: true }) },
  { key: 'booking.rescheduled', label: 'Booking rescheduled', route: '/dashboard/bookings', category: 'Bookings & Scheduling', defaults: D() },
  { key: 'booking.unassigned', label: 'Unassigned booking', route: '/dashboard/bookings?status=unassigned', category: 'Bookings & Scheduling', sidebarKey: 'bookings.unassigned', defaults: D() },
  { key: 'booking.cleaner_assigned', label: 'Cleaner assigned', route: '/dashboard/bookings', category: 'Bookings & Scheduling', defaults: INFO() },
  { key: 'booking.cleaner_claimed', label: 'Cleaner claimed a booking', route: '/dashboard/bookings', category: 'Bookings & Scheduling', defaults: INFO({ email: true }) },
  { key: 'booking.late_checkin', label: 'Cleaner late or missed check-in', route: '/dashboard/bookings', category: 'Bookings & Scheduling', defaults: D({ email: true, sms: true, browser_push: true }) },
  { key: 'booking.conflicts', label: 'Schedule conflict', route: '/dashboard/scheduler', category: 'Bookings & Scheduling', sidebarKey: 'scheduler.overlaps', defaults: D({ email: true }) },
  { key: 'booking.payment_failed', label: 'Failed booking payment', route: '/dashboard/bookings?payment=failed', category: 'Bookings & Scheduling', sidebarKey: 'bookings.payment', defaults: D({ email: true, browser_push: true }) },
  { key: 'booking.completed', label: 'Booking completed', route: '/dashboard/bookings?status=completed', category: 'Bookings & Scheduling', defaults: INFO() },
  { key: 'job.on_the_way', label: 'Cleaner on the way', route: '/dashboard/bookings', category: 'Bookings & Scheduling', defaults: D({ email: true, browser_push: true, native_push: true }) },
  { key: 'job.arrived', label: 'Cleaner arrived', route: '/dashboard/bookings', category: 'Bookings & Scheduling', defaults: D({ email: true, browser_push: true, native_push: true }) },
  { key: 'job.completed', label: 'Job completed', route: '/dashboard/bookings?status=completed', category: 'Bookings & Scheduling', defaults: D({ email: true, browser_push: true, native_push: true }) },
  { key: 'booking.missing_checklists', label: 'Missing checklist', route: '/dashboard/bookings', category: 'Bookings & Scheduling', defaults: INFO() },
  { key: 'booking.missing_photos', label: 'Missing booking photos', route: '/dashboard/bookings', category: 'Bookings & Scheduling', defaults: INFO() },

  // ── Staff
  { key: 'staff.time_off_request', label: 'New time-off request', route: '/dashboard/staff?tab=time-off', category: 'Staff', sidebarKey: 'staff.time_off', defaults: D({ email: true, browser_push: true }) },
  { key: 'staff.time_off_approved', label: 'Time-off approved', route: '/dashboard/staff?tab=time-off', category: 'Staff', defaults: INFO() },
  { key: 'staff.time_off_denied', label: 'Time-off denied', route: '/dashboard/staff?tab=time-off', category: 'Staff', defaults: INFO() },
  { key: 'staff.missing_documents', label: 'Staff document missing or expiring', route: '/dashboard/staff?tab=documents', category: 'Staff', sidebarKey: 'staff.documents', defaults: D({ email: true }) },
  { key: 'staff.payout_issue', label: 'Staff payout setup issue', route: '/dashboard/staff?tab=team', category: 'Staff', sidebarKey: 'staff.payout', managerLocked: true, defaults: D({ email: true }) },
  { key: 'staff.stripe_verification', label: 'Stripe verification issue', route: '/dashboard/payment-integration', category: 'Staff', managerLocked: true, defaults: D({ email: true }) },
  { key: 'staff.activity', label: 'New staff activity', route: '/dashboard/staff', category: 'Staff', defaults: INFO() },
  { key: 'staff.job_claimed', label: 'Available job claimed', route: '/dashboard/bookings', category: 'Staff', defaults: INFO() },

  // ── Customers & Client Portal
  { key: 'client.portal_request', label: 'New client portal booking request', route: '/dashboard/client-portal', category: 'Customers & Client Portal', sidebarKey: 'client_portal.requests', defaults: D({ email: true, browser_push: true }) },
  { key: 'client.reschedule_request', label: 'Client reschedule request', route: '/dashboard/client-portal', category: 'Customers & Client Portal', sidebarKey: 'client_portal.reschedule', defaults: D({ email: true }) },
  { key: 'client.cancel_request', label: 'Client cancellation request', route: '/dashboard/client-portal', category: 'Customers & Client Portal', defaults: D({ email: true }) },
  { key: 'client.message', label: 'New client message', route: '/dashboard/messages', category: 'Customers & Client Portal', sidebarKey: 'messages.unread', defaults: D({ browser_push: true }) },
  { key: 'client.feedback', label: 'New feedback', route: '/dashboard/feedback', category: 'Customers & Client Portal', sidebarKey: 'feedback.low_rating', defaults: D() },
  { key: 'client.complaint', label: 'Unresolved complaint', route: '/dashboard/feedback?filter=complaints', category: 'Customers & Client Portal', sidebarKey: 'feedback.complaint', defaults: D({ email: true, sms: true }) },
  { key: 'client.low_rating', label: 'Low rating requiring follow-up', route: '/dashboard/feedback?filter=low', category: 'Customers & Client Portal', sidebarKey: 'feedback.low_rating', defaults: D({ email: true }) },

  // ── CRM
  { key: 'lead.new', label: 'New lead', route: '/dashboard/leads?status=new', category: 'CRM', sidebarKey: 'leads.new', defaults: D({ email: true, browser_push: true }) },
  { key: 'lead.hot', label: 'Hot lead', route: '/dashboard/leads?filter=hot', category: 'CRM', defaults: D({ email: true, sms: true }) },
  { key: 'lead.follow_up', label: 'Lead follow-up due', route: '/dashboard/leads?status=follow_up', category: 'CRM', defaults: D() },
  { key: 'lead.stale', label: 'Stale lead', route: '/dashboard/leads?filter=stale', category: 'CRM', sidebarKey: 'leads.stale', defaults: D() },
  { key: 'lead.converted', label: 'Lead converted', route: '/dashboard/leads?status=converted', category: 'CRM', defaults: INFO() },
  { key: 'lead.lost', label: 'Lead lost', route: '/dashboard/leads?status=lost', category: 'CRM', defaults: INFO({ bell: false }) },
  { key: 'crm.new_customer', label: 'New customer added', route: '/dashboard/customers', category: 'CRM', defaults: INFO() },

  // ── Messages & Tasks
  { key: 'messages.inbound_sms', label: 'New inbound SMS', route: '/dashboard/messages', category: 'Messages & Tasks', sidebarKey: 'messages.unread', defaults: D({ browser_push: true, native_push: true }) },
  { key: 'messages.unread', label: 'Unread customer message', route: '/dashboard/messages?filter=unread', category: 'Messages & Tasks', sidebarKey: 'messages.unread', defaults: D() },
  { key: 'messages.failed', label: 'Failed outbound message', route: '/dashboard/messages?filter=failed', category: 'Messages & Tasks', defaults: D({ email: true }) },
  { key: 'tasks.new', label: 'New task assigned', route: '/dashboard/tasks', category: 'Messages & Tasks', sidebarKey: 'tasks.open', defaults: D() },
  { key: 'tasks.overdue', label: 'Overdue task', route: '/dashboard/tasks?filter=overdue', category: 'Messages & Tasks', sidebarKey: 'tasks.overdue', defaults: D({ email: true }) },
  { key: 'tasks.completed', label: 'Task completed', route: '/dashboard/tasks?filter=completed', category: 'Messages & Tasks', defaults: INFO({ bell: false }) },

  // ── Payments & Finance (manager-locked)
  { key: 'invoice.overdue', label: 'Invoice overdue', route: '/dashboard/invoices?filter=overdue', category: 'Payments & Finance', managerLocked: true, sidebarKey: 'payments.failed_charges', defaults: D({ email: true }) },
  { key: 'invoice.paid', label: 'Payment received', route: '/dashboard/invoices?filter=paid', category: 'Payments & Finance', managerLocked: true, defaults: INFO() },
  // Routes to Subscription, not Invoices. This fires on invoice.payment_failed
  // from stripe-invoice-webhook, which is a TIDYWISE subscription renewal failing
  // — our billing of them, not their billing of a customer. It pointed at
  // /dashboard/invoices?filter=failed, where no invoice can ever hold
  // status='failed' (not in the CHECK constraint), so it was a dead end twice
  // over: wrong page, and a filter that could never match.
  { key: 'invoice.failed', label: 'Subscription payment failed', route: '/dashboard/subscription', category: 'Payments & Finance', managerLocked: true, sidebarKey: 'payments.failed_charges', defaults: D({ email: true, browser_push: true }) },
  // invoice.refund and invoice.dispute removed 2026-07-31. Both were
  // platform-level and could never fire for an org:
  //   - refunds are recorded nowhere. process-refund writes nothing to the
  //     database and there is no refunds table; the only local trace is a
  //     mutated bookings.total_amount.
  //   - disputes live in public.disputes, which has NO organization_id — it
  //     tracks TidyWise's own Stripe disputes, not an org's.
  // Nothing produced either key, so no notification could ever be raised with
  // them; they only ever appeared as toggles in settings for events that could
  // not happen.
  { key: 'stripe.disconnected', label: 'Stripe disconnected', route: '/dashboard/payment-integration', category: 'Payments & Finance', managerLocked: true, sidebarKey: 'payments.stripe_requirements', defaults: D({ email: true }) },
  { key: 'stripe.verification', label: 'Stripe verification requirement', route: '/dashboard/payment-integration', category: 'Payments & Finance', managerLocked: true, sidebarKey: 'payments.stripe_requirements', defaults: D({ email: true }) },
  { key: 'payout.issue', label: 'Payout issue', route: '/dashboard/staff?tab=team', category: 'Payments & Finance', managerLocked: true, sidebarKey: 'staff.payout', defaults: D({ email: true }) },
  { key: 'finance.payroll', label: 'Payroll alert', route: '/dashboard/payroll', category: 'Payments & Finance', managerLocked: true, defaults: D({ email: true }) },
  { key: 'finance.alert', label: 'Finance alert', route: '/dashboard/finance', category: 'Payments & Finance', managerLocked: true, defaults: D({ email: true }) },
  { key: 'finance.report', label: 'Report alert', route: '/dashboard/reports', category: 'Payments & Finance', managerLocked: true, defaults: INFO({ email: true }) },

  // ── Inventory & Automations
  { key: 'inventory.low', label: 'Low inventory', route: '/dashboard/inventory?filter=low', category: 'Inventory & Automations', sidebarKey: 'inventory.low', defaults: D() },
  { key: 'inventory.out', label: 'Out-of-stock item', route: '/dashboard/inventory?filter=out', category: 'Inventory & Automations', sidebarKey: 'inventory.low', defaults: D({ email: true }) },
  { key: 'automation.failed', label: 'Automation failed', route: '/dashboard/automation-center', category: 'Inventory & Automations', sidebarKey: 'automation.failed', defaults: D({ email: true }) },
  { key: 'campaign.failed', label: 'Campaign failed', route: '/dashboard/automation-center', category: 'Inventory & Automations', sidebarKey: 'automation.failed', defaults: D({ email: true }) },
  { key: 'integration.disconnected', label: 'Integration disconnected', route: '/dashboard/settings?tab=integrations', category: 'Inventory & Automations', defaults: D({ email: true }) },
  { key: 'import.failed', label: 'Import or sync failed', route: '/dashboard/settings', category: 'Inventory & Automations', defaults: D({ email: true }) },
];

// Preserve category order as declared above; drop any unknown category.
export const CATEGORIES: string[] = CATEGORY_ORDER.filter(c =>
  NOTIFICATION_TYPES.some(t => t.category === c)
);

export function typeByKey(key: string): NotificationTypeDef | undefined {
  return NOTIFICATION_TYPES.find(t => t.key === key);
}

/** Master-channel toggle key stored inside the `channels` prefs map. */
export function masterChannelKey(channel: NotificationChannel): string {
  return `master.${channel}`;
}

/**
 * True when the master toggle for a channel is on (or unset, defaulting to on).
 */
export function isMasterChannelOn(
  channel: NotificationChannel,
  channels: Record<string, boolean> | undefined
): boolean {
  const v = channels?.[masterChannelKey(channel)];
  return typeof v === 'boolean' ? v : true;
}

/**
 * Resolve whether a specific channel should fire for a given notification type,
 * merging saved matrix over defaults, and honoring:
 *   - per-type snooze (any channel muted until expiry)
 *   - master-channel toggle (turning email off silences email for every event)
 * Snoozed types are treated as OFF for every channel until the snooze expiry passes.
 */
export function isChannelEnabled(
  typeKey: string,
  channel: NotificationChannel,
  matrix: Record<string, Record<string, boolean>> | undefined,
  snoozed: Record<string, string> | undefined,
  channels?: Record<string, boolean>
): boolean {
  if (channels && !isMasterChannelOn(channel, channels)) return false;
  const def = typeByKey(typeKey);
  if (!def) return true;
  const snoozeIso = snoozed?.[typeKey];
  if (snoozeIso && new Date(snoozeIso).getTime() > Date.now()) return false;
  const saved = matrix?.[typeKey]?.[channel];
  if (typeof saved === 'boolean') return saved;
  return def.defaults?.[channel] ?? (channel === 'sidebar' || channel === 'bell');
}
