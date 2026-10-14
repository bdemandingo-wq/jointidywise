/**
 * What may leave the browser while sample demo is on.
 * Side effects toast. Telemetry is dropped quietly. A few reads are answered
 * from memory so the public booking form can open without a database.
 */

const ACCOUNT_READS = new Set([
  'check-subscription',
  'get-lifetime-spots',
  'public-growth',
]);

const CANNED_READS = new Set([
  'public-booking-data',
  'check-availability',
]);

const SILENT_FUNCTIONS = new Set([
  'resume-abandoned-booking',
]);

const SIDE_EFFECT_SNIPPETS = [
  'send-',
  'notify',
  'sms',
  'email',
  'push',
  'stripe',
  'payout',
  'webhook',
  'checkout',
  'subscription',
  'zapier',
  'invoice',
  'payment',
  'dispatch',
  'welcome',
  'onboarding',
  'invite',
  'password',
  'delete-my',
  'migration',
  'dispute',
  'campaign',
  'broadcast',
  'twilio',
  'resend',
  'openphone',
  'setup-intent',
  'charge-',
  'booking-submit',
];

export type DemoInvokeKind = 'allow' | 'canned' | 'block' | 'silent';

export function demoInvokeKind(name: string): DemoInvokeKind {
  const normalized = name.toLowerCase();
  if (CANNED_READS.has(normalized)) return 'canned';
  if (ACCOUNT_READS.has(normalized)) return 'allow';
  if (SILENT_FUNCTIONS.has(normalized)) return 'silent';
  if (SIDE_EFFECT_SNIPPETS.some((snippet) => normalized.includes(snippet))) return 'block';
  return 'allow';
}

export function isBlockedDemoFunction(name: string): boolean {
  return demoInvokeKind(name) === 'block';
}

const MUTATING_RPC_PREFIXES = [
  'create_',
  'update_',
  'delete_',
  'set_',
  'submit_',
  'claim_',
  'complete_',
  'remove_',
  'redeem_',
  'reopen_',
  'insert_',
  'mark_',
];

const MUTATING_RPC = new Set([
  'claim_booking',
  'complete_assigned_booking',
  'reopen_assigned_booking',
  'redeem_access_code',
  'update_org_member_role',
  'remove_org_member',
  'create_client_portal_user',
  'create_booking_from_request',
  'submit_review_by_token',
  'set_campaign_run_status',
  'mark_abandoned_booking_progress',
]);

const SILENT_RPC = new Set([
  'mark_abandoned_booking_progress',
]);

export function isMutatingDemoRpc(name: string): boolean {
  const normalized = name.toLowerCase();
  if (MUTATING_RPC.has(normalized)) return true;
  return MUTATING_RPC_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

export function isSilentDemoRpc(name: string): boolean {
  return SILENT_RPC.has(name.toLowerCase());
}

/** Writes that are telemetry. Still blocked, but they must not toast. */
export const SILENT_DEMO_TABLES = new Set([
  'system_logs',
  'user_sessions',
  'booking_link_tracking',
  'onboarding_progress',
  'product_tour_events',
]);
