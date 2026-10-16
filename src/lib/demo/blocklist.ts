/**
 * What may leave the browser while sample demo is on.
 * Unknown function names are blocked. A few reads are allowed, and the
 * public booking form's two reads are answered from memory.
 */

const ACCOUNT_READS = new Set([
  'get-lifetime-spots',
  'public-growth',
  'address-autocomplete',
]);

const CANNED_READS = new Set([
  'public-booking-data',
  'check-availability',
]);

const SILENT_FUNCTIONS = new Set([
  'resume-abandoned-booking',
]);

export type DemoInvokeKind = 'allow' | 'canned' | 'block' | 'silent';

export function demoInvokeKind(name: string): DemoInvokeKind {
  const normalized = name.toLowerCase();
  if (CANNED_READS.has(normalized)) return 'canned';
  if (ACCOUNT_READS.has(normalized)) return 'allow';
  if (SILENT_FUNCTIONS.has(normalized)) return 'silent';
  return 'block';
}

export function isBlockedDemoFunction(name: string): boolean {
  return demoInvokeKind(name) === 'block';
}

/** Reads the sample demo may still call. Everything else is blocked. */
const READ_RPC = new Set([
  'billing_payer_plan_types',
  'get_ai_credit_status',
  'get_demo_availability',
  'get_demo_booked_slots',
  'get_lifetime_spots_remaining',
  'get_my_staff_profile',
  'get_my_staff_wages',
  'get_org_email_settings_safe',
  'get_org_member_names',
  'get_org_staff_wages',
  'get_org_stripe_settings_safe',
  'get_org_tiers',
  'get_public_activity_feed',
  'get_public_growth_counters',
  'get_review_request_by_token',
  'get_staff_customers',
  'get_staff_sensitive_fields',
  'get_team_claim_counts',
  'has_openphone_api_key',
  'list_org_members',
  'my_effective_plan',
  'org_has_native_booking',
  'org_has_resend_api_key',
  'resolve_customer_tier',
  'resolve_short_url',
]);

/** Writes. Blocked with a toast. Listed so they cannot fall through as reads. */
const BLOCKED_RPC = new Set([
  'increment_coupon_use',
  'merge_customers',
  'save_signup_attribution',
  'unmerge_customers',
]);

const SILENT_RPC = new Set([
  'mark_abandoned_booking_progress',
  'claim_trial_started_pixel',
  'touch_my_last_login',
]);

export type DemoRpcKind = 'allow' | 'block' | 'silent';

export function demoRpcKind(name: string): DemoRpcKind {
  const normalized = name.toLowerCase();
  if (SILENT_RPC.has(normalized)) return 'silent';
  if (BLOCKED_RPC.has(normalized)) return 'block';
  if (READ_RPC.has(normalized)) return 'allow';
  return 'block';
}

export function isMutatingDemoRpc(name: string): boolean {
  return demoRpcKind(name) !== 'allow';
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
