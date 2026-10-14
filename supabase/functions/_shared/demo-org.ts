/**
 * Pure demo-send decision. No Deno, no network. Edge helpers and the
 * boundary test both import this so the rule stays in one place.
 *
 * A send is blocked when the organization has demo mode on, when the
 * organization id is the in-memory Harbor & Pine preview, or when a
 * recipient is sample data. Sample rows are never a send target.
 */

export const DEMO_ORG_ID = "d00000de-0000-4000-8000-000000000001";

/** Per-org demo flag cache. A flipped switch is visible within a minute. */
export const DEMO_FLAG_TTL_MS = 60_000;

/**
 * Harbor & Pine fixture sizes. Keep these equal to STAFF, FIRST, and
 * leadStatuses in src/lib/demo/dataset.ts. The boundary test fails if a
 * fixture phone is not in this set.
 */
const DEMO_STAFF_COUNT = 5;
const DEMO_CUSTOMER_COUNT = 25;
const DEMO_LEAD_COUNT = 8;

const DEMO_PHONE_DIGITS = new Set<string>();

function rememberDemoPhone(national: string) {
  DEMO_PHONE_DIGITS.add(national);
  DEMO_PHONE_DIGITS.add(`1${national}`);
}

for (let index = 0; index < DEMO_STAFF_COUNT; index++) {
  rememberDemoPhone(`51255501${index + 1}0`);
}
for (let index = 0; index < DEMO_CUSTOMER_COUNT; index++) {
  rememberDemoPhone(`512555${String(2000 + index).slice(1)}`);
}
for (let index = 0; index < DEMO_LEAD_COUNT; index++) {
  rememberDemoPhone(`51255503${index}0`);
}

export function isKnownDemoOrganization(organizationId: string | null | undefined): boolean {
  return organizationId === DEMO_ORG_ID;
}

/**
 * Stripe payouts, manual charges, invoices, and subscription create/cancel
 * must run for a real organization even when demo mode is on. The in-app
 * banner already stops those clicks in the browser. The server blocks only
 * the public preview org id, which has no Stripe account.
 */
export function stripeClientBlockReason(organizationId?: string | null): string | null {
  if (isKnownDemoOrganization(organizationId)) return "demo_org";
  return null;
}

/** True while a cached demo-flag lookup is still inside its TTL. */
export function demoFlagCacheFresh(storedAt: number, now: number, ttlMs = DEMO_FLAG_TTL_MS): boolean {
  if (!Number.isFinite(storedAt) || !Number.isFinite(now) || ttlMs <= 0) return false;
  const age = now - storedAt;
  return age >= 0 && age < ttlMs;
}

/**
 * Sample customers, staff, and leads from the in-browser demo dataset.
 * Phone match is the whole digit string (optional leading 1), never a
 * substring. A real 512-555-1212 contains "512555" and must still send.
 */
export function isSampleSendTarget(value: string | null | undefined): boolean {
  if (!value) return false;
  const text = value.trim().toLowerCase();
  if (!text) return false;
  if (text.endsWith("@example.com") || text.endsWith("@harborpine.example")) return true;
  const digits = text.replace(/\D/g, "");
  return DEMO_PHONE_DIGITS.has(digits);
}

export function isDemoSendBlocked(error: unknown): boolean {
  return !!error && typeof error === "object" && (error as { name?: string }).name === "DemoSendBlocked";
}

/**
 * A skipped demo send is not a delivery. Callers use this before writing
 * status "sent". A DemoSendBlocked error and a skip body both return false.
 */
export function shouldRecordDeliveryAsSent(input: {
  error?: unknown;
  ok?: boolean;
  body?: { skipped?: boolean; demo?: boolean; id?: string | null } | null;
}): boolean {
  if (isDemoSendBlocked(input.error)) return false;
  if (input.body?.skipped === true || input.body?.demo === true) return false;
  if (input.body?.id === "demo-skipped") return false;
  if (input.ok === false) return false;
  return true;
}

export function demoSendBlockReason(input: {
  organizationId?: string | null;
  demoModeEnabled?: boolean | null;
  recipients?: Array<string | null | undefined>;
  /** STOP confirmation and other replies the recipient just asked for. */
  requestedReply?: boolean;
}): string | null {
  if (input.requestedReply) return null;
  if (input.demoModeEnabled) return "demo_mode_enabled";
  if (isKnownDemoOrganization(input.organizationId)) return "demo_org";
  if ((input.recipients ?? []).some((recipient) => isSampleSendTarget(recipient))) {
    return "sample_recipient";
  }
  return null;
}

export type StripeSubscriptionSnapshot = {
  status?: string | null;
  plan?: string | null;
};

/**
 * Mirrors public.is_demo_or_test. An active or past_due Stripe subscription
 * whose plan is not Lifetime is a real customer and is never demo/test.
 */
export function isDemoOrTest(input: {
  demoModeEnabled?: boolean | null;
  name?: string | null;
  slug?: string | null;
  ownerEmail?: string | null;
  subscriptions?: StripeSubscriptionSnapshot[] | null;
}): boolean {
  const paying = (input.subscriptions ?? []).some((row) => {
    const status = (row.status ?? "").toLowerCase();
    const plan = (row.plan ?? "").toLowerCase();
    return (status === "active" || status === "past_due") && plan !== "lifetime";
  });
  if (paying) return false;
  if (input.demoModeEnabled) return true;
  const name = input.name ?? "";
  if (/(^|[^a-z])(test|qa|demo|sandbox)([^a-z]|$)/i.test(name)) return true;
  const slug = input.slug ?? "";
  if (/^(test|qa|demo|sandbox)/i.test(slug)) return true;
  const email = (input.ownerEmail ?? "").toLowerCase();
  if (/@tidywise1\.com$|^applereview@|@example\.com$|\+(qa|test)/i.test(email)) return true;
  return false;
}
