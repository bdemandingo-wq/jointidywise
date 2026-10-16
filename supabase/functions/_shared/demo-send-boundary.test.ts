/**
 * Fails when an edge function reaches SMS, email, push, Stripe, or the
 * Make.com subscription webhook without the shared helper that checks
 * organization_pricing_settings.demo_mode_enabled.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { buildDemoTables } from '../../../src/lib/demo/dataset.ts';
import {
  DEMO_FLAG_TTL_MS,
  DEMO_ORG_ID,
  assertStripeClientAllowed,
  demoFlagCacheDecision,
  demoFlagCacheFresh,
  demoSendBlockReason,
  isDemoOrTest,
  isDemoSendBlocked,
  isSampleSendTarget,
  shouldRecordDeliveryAsSent,
  stripeClientBlockReason,
  batchSendErrorPlan,
  demoQueueDeferUntil,
  excludeOrgFilter,
  DEMO_QUEUE_DEFER_MS,
} from './demo-org.ts';

const functionsRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const RULES: { label: string; pattern: RegExp; allow: string[] }[] = [
  {
    label: 'OpenPhone SMS',
    pattern: /api\.openphone\.com\/v1\/messages/,
    allow: ['_shared/send-openphone.ts'],
  },
  {
    label: 'Resend email',
    pattern: /api\.resend\.com\/emails/,
    allow: ['_shared/send-resend.ts'],
  },
  {
    label: 'Resend SDK',
    pattern: /new Resend\b|\.emails\.send\b/,
    allow: ['_shared/send-resend.ts'],
  },
  {
    label: 'Stripe',
    pattern: /new Stripe\s*\(/,
    allow: ['_shared/stripe-client.ts'],
  },
  {
    label: 'Apple push',
    pattern: /api\.push\.apple\.com|api\.sandbox\.push\.apple\.com/,
    allow: ['_shared/apns-deliver.ts'],
  },
  {
    label: 'Make.com subscription webhook',
    pattern: /hook\.us2\.make\.com/,
    allow: ['_shared/make-subscription-webhook.ts'],
  },
  {
    label: 'Gmail send',
    pattern: /gmail\.googleapis\.com\/gmail\/v1\/users\/me\/messages\/send/,
    allow: ['_shared/gmail-send-core.ts'],
  },
  {
    label: 'Gmail SMTP',
    pattern: /new SMTPClient\s*\(|smtp\.gmail\.com/,
    allow: ['_shared/send-org-email.ts', 'send-gmail-test-email/index.ts'],
  },
];

const GUARDED_HELPERS = [
  '_shared/send-openphone.ts',
  '_shared/send-resend.ts',
  '_shared/apns-deliver.ts',
  '_shared/make-subscription-webhook.ts',
  '_shared/gmail-send-core.ts',
  '_shared/send-org-email.ts',
  '_shared/send-push.ts',
];

/**
 * PR #52 (cursor/platform-account-metrics-aae9) merges before this branch.
 * Its copy of stripe-subscription-webhook fetches api.openphone.com/v1/messages
 * once, for an internal trial-converted alert to platformAdminPhones()
 * (ADMIN_PHONES). That one call is allowed so this test still passes after
 * rebase. Any other direct messages URL in that file still fails. On rebase,
 * route the alert through sendOpenPhoneMessage instead of adding more fetches.
 * This branch already sends that alert through the helper.
 */
const PLATFORM_ADMIN_OPENPHONE_ALERT = 'stripe-subscription-webhook/index.ts';

export function openPhoneAdminAlertOnly(text: string): boolean {
  const hits = text.match(/api\.openphone\.com\/v1\/messages/g) ?? [];
  if (hits.length === 0) return true;
  if (hits.length !== 1) return false;
  return /platformAdminPhones\s*\(|\bADMIN_PHONES\b/.test(text);
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) out.push(full);
  }
  return out;
}

test('sample phones are the exact Harbor & Pine numbers', () => {
  const tables = buildDemoTables();
  const phones = [
    ...tables.staff.map((row) => String(row.phone)),
    ...tables.customers.map((row) => String(row.phone)),
    ...tables.leads.map((row) => String(row.phone)),
  ];
  assert.ok(phones.length >= 30);
  for (const phone of phones) {
    assert.equal(isSampleSendTarget(phone), true, phone);
    assert.equal(isSampleSendTarget(`+1 ${phone}`), true, phone);
  }
  assert.equal(isSampleSendTarget('+15125550110'), true);
  assert.equal(isSampleSendTarget('+15125551212'), false);
  assert.equal(isSampleSendTarget('+15125561212'), false);
  assert.equal(isSampleSendTarget('9995125550110'), false);
  assert.equal(isSampleSendTarget('+12125550100'), false);
  assert.equal(isSampleSendTarget('+151255501101'), false);
});

test('demo flag cache expires after about a minute', () => {
  const storedAt = 1_000_000;
  assert.equal(demoFlagCacheFresh(storedAt, storedAt), true);
  assert.equal(demoFlagCacheFresh(storedAt, storedAt + DEMO_FLAG_TTL_MS - 1), true);
  assert.equal(demoFlagCacheFresh(storedAt, storedAt + DEMO_FLAG_TTL_MS), false);
  assert.equal(demoFlagCacheFresh(storedAt, storedAt - 1), false);
  const guard = fs.readFileSync(path.join(functionsRoot, '_shared/demo-guard.ts'), 'utf8');
  assert.match(guard, /demoFlagCacheFresh/);
  assert.match(guard, /DEMO_FLAG_TTL_MS/);
});

test('a skipped demo send is not recorded as sent', () => {
  const blocked = new Error('Disabled in demo mode');
  blocked.name = 'DemoSendBlocked';
  assert.equal(isDemoSendBlocked(blocked), true);
  assert.equal(shouldRecordDeliveryAsSent({ error: blocked, ok: true }), false);
  assert.equal(shouldRecordDeliveryAsSent({ ok: true, body: { skipped: true, demo: true } }), false);
  assert.equal(shouldRecordDeliveryAsSent({ ok: true, body: { id: 'demo-skipped' } }), false);
  assert.equal(shouldRecordDeliveryAsSent({ ok: true, body: { id: 're_123' } }), true);
  const openphone = fs.readFileSync(path.join(functionsRoot, '_shared/send-openphone.ts'), 'utf8');
  const resend = fs.readFileSync(path.join(functionsRoot, '_shared/send-resend.ts'), 'utf8');
  assert.match(openphone, /throw new DemoSendBlocked/);
  assert.match(resend, /throw new DemoSendBlocked/);
  assert.doesNotMatch(openphone, /status:\s*200/);
});

test('paying non-lifetime subscriptions are never demo or test', () => {
  const paying = { status: 'active', plan: 'pro' };
  assert.equal(isDemoOrTest({
    demoModeEnabled: true,
    name: 'Demo Cleaning',
    slug: 'demo-cleaning',
    ownerEmail: 'qa@tidywise1.com',
    subscriptions: [paying],
  }), false);
  assert.equal(isDemoOrTest({
    name: 'Harbor Cleaning',
    subscriptions: [{ status: 'past_due', plan: null }],
  }), false);
  assert.equal(isDemoOrTest({
    demoModeEnabled: true,
    subscriptions: [{ status: 'active', plan: 'lifetime' }],
  }), true);
  assert.equal(isDemoOrTest({
    demoModeEnabled: true,
    subscriptions: [{ status: 'trialing', plan: 'pro' }],
  }), true);
  assert.equal(isDemoOrTest({
    name: 'Real Cleaning Co',
    slug: 'real-cleaning',
    ownerEmail: 'owner@real-cleaning.com',
    subscriptions: [],
  }), false);
  const migration = fs.readFileSync(
    path.resolve(functionsRoot, '../migrations/20261015000000_demo_mode_off_and_paid_not_demo.sql'),
    'utf8',
  );
  assert.match(migration, /demo_mode_enabled = false/);
  assert.match(migration, /status\) IN \('active', 'past_due'\)/);
  assert.match(migration, /<> 'lifetime'/);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.is_demo_or_test/);
  assert.match(migration, /d00000de-0000-4000-8000-000000000001/);
  const payingInput = {
    demoModeEnabled: true,
    name: 'Demo Cleaning',
    slug: 'demo-cleaning',
    ownerEmail: 'qa@tidywise1.com',
    subscriptions: [paying],
  };
  assert.equal(stripeClientBlockReason(payingInput), null);
  assert.equal(demoSendBlockReason(payingInput), null);
  assert.equal(isDemoOrTest({ organizationId: DEMO_ORG_ID, subscriptions: [paying] }), true);
  assert.equal(stripeClientBlockReason({ organizationId: DEMO_ORG_ID, subscriptions: [paying] }), 'demo_org');
  const flagged = {
    organizationId: 'org-1',
    demoModeEnabled: true,
    name: 'Harbor Cleaning',
    slug: 'harbor-cleaning',
    ownerEmail: 'owner@real-cleaning.com',
    subscriptions: [] as { status: string; plan: string }[],
  };
  assert.equal(isDemoOrTest(flagged), true);
  assert.equal(stripeClientBlockReason(flagged), 'demo_mode_enabled');
  assert.equal(demoSendBlockReason(flagged), 'demo_mode_enabled');
  const named = { organizationId: 'org-2', name: 'QA Sandbox', slug: 'harbor', ownerEmail: 'owner@real-cleaning.com' };
  assert.equal(isDemoOrTest(named), true);
  assert.equal(stripeClientBlockReason(named), 'demo_org');
  assert.equal(demoSendBlockReason(named), 'demo_org');
});

test('a phone suppression is written only for a real opt-out', () => {
  assert.equal(demoSendBlockReason({
    demoModeEnabled: true,
    organizationId: 'real-org',
    requestedReply: true,
    recipients: ['owner@real-cleaning.com'],
  }), null);
  const webhook = fs.readFileSync(path.join(functionsRoot, 'openphone-webhook/index.ts'), 'utf8');
  assert.match(webhook, /classifySmsOptOut/);
  assert.match(webhook, /sendSmsOptOutConfirmation/);
  assert.doesNotMatch(webhook, /stop-opt-out|isInboundStop|STOP_CONFIRMATION_TEXT/);
  const optOutAt = webhook.indexOf('if (optOutClassification.optOut)');
  const upsertAt = webhook.indexOf("from('sms_suppressions')");
  const resubscribeAt = webhook.indexOf('if (consentStep?.smsResubscribed');
  assert.ok(optOutAt !== -1 && upsertAt > optOutAt && resubscribeAt > upsertAt);
  const beforeOptOut = webhook.slice(0, optOutAt);
  assert.match(beforeOptOut, /optOutClassification\.needsReview/);
  assert.doesNotMatch(beforeOptOut, /sms_suppressions/);
});

test('a demo send failure releases the claim and the batch continues', () => {
  const blocked = new Error('Disabled in demo mode');
  blocked.name = 'DemoSendBlocked';
  assert.deepEqual(batchSendErrorPlan(blocked), {
    releaseClaim: true,
    continueBatch: true,
    demoSkip: true,
  });
  assert.deepEqual(batchSendErrorPlan(new Error('network')), {
    releaseClaim: true,
    continueBatch: true,
    demoSkip: false,
  });
  const batchFiles = [
    'send-trial-reminders/index.ts',
    'send-onboarding-winback/index.ts',
    'weekly-business-report/index.ts',
    'run-winback-drip/index.ts',
    'copilot-reengagement-cron/index.ts',
  ];
  for (const rel of batchFiles) {
    const text = fs.readFileSync(path.join(functionsRoot, rel), 'utf8');
    assert.match(text, /batchSendErrorPlan/, rel);
    assert.match(text, /demoSkip/, rel);
  }
  const trial = fs.readFileSync(path.join(functionsRoot, 'send-trial-reminders/index.ts'), 'utf8');
  const sendAt = trial.indexOf('await sendResendEmail');
  const tryAt = trial.lastIndexOf('try {', sendAt);
  assert.ok(tryAt !== -1 && tryAt < sendAt);
  assert.match(trial, /from\("trial_reminder_log"\)\.delete\(\)/);
  const winback = fs.readFileSync(path.join(functionsRoot, 'send-onboarding-winback/index.ts'), 'utf8');
  assert.match(winback, /organizationId: row\.organization_id/);
  assert.match(winback, /\[stampColumn\]: null/);
  const copilot = fs.readFileSync(path.join(functionsRoot, 'copilot-reengagement-cron/index.ts'), 'utf8');
  assert.match(copilot, /if \(result\.demoSkipped\) return \{ success: false, demoSkipped: true \}/);
  const drip = fs.readFileSync(path.join(functionsRoot, 'run-winback-drip/index.ts'), 'utf8');
  const dripSend = drip.indexOf('await sendOrgEmail');
  assert.ok(drip.lastIndexOf('try {', dripSend) < dripSend);
});

test('a demo-blocked queue row leaves the oldest window', () => {
  const deferred = Date.parse(demoQueueDeferUntil(0));
  assert.equal(deferred, DEMO_QUEUE_DEFER_MS);
  assert.equal(excludeOrgFilter([]), null);
  assert.equal(excludeOrgFilter(['org-a', 'org-a', '']), '("org-a")');
  const campaign = fs.readFileSync(path.join(functionsRoot, 'send-winback-campaign/index.ts'), 'utf8');
  assert.match(campaign, /organizationId: recipient\.organization_id/);
  assert.doesNotMatch(campaign, /organizationId:\s*organizationId\b/);
  for (const rel of ['process-rebooking-reminders/index.ts', 'process-recurring-offers/index.ts']) {
    const text = fs.readFileSync(path.join(functionsRoot, rel), 'utf8');
    assert.match(text, /listDemoModeOrgIds/, rel);
    assert.match(text, /excludeOrgFilter/, rel);
    assert.match(text, /deferred_until: demoQueueDeferUntil\(\)/, rel);
  }
  const reviews = fs.readFileSync(path.join(functionsRoot, 'process-review-sms-queue/index.ts'), 'utf8');
  assert.match(reviews, /listDemoModeOrgIds/);
  assert.match(reviews, /send_at: demoQueueDeferUntil\(\)/);
  assert.doesNotMatch(reviews, /status:\s*"pending"/);
  const sendAt = reviews.indexOf('await sendOpenPhoneMessage');
  const insertAt = reviews.indexOf('.from("review_requests")');
  assert.ok(sendAt !== -1 && insertAt > sendAt);
});

test('createStripeClient refuses a demo org before constructing Stripe', async () => {
  await assert.rejects(
    () => assertStripeClientAllowed({ organizationId: 'demo-org', isDemoOrg: async () => true }),
    (err: unknown) => isDemoSendBlocked(err),
  );
  await assertStripeClientAllowed({ organizationId: 'paying-org', isDemoOrg: async () => false });
  await assert.rejects(
    () => assertStripeClientAllowed({
      organizationId: DEMO_ORG_ID,
      isDemoOrg: async () => false,
    }),
    (err: unknown) => isDemoSendBlocked(err),
  );
  await assert.rejects(
    () => assertStripeClientAllowed({
      organizationId: 'real-org',
      isDemoOrg: async () => {
        throw new Error('db down');
      },
    }),
    (err: unknown) => isDemoSendBlocked(err),
  );
  await assertStripeClientAllowed({ organizationId: null, isDemoOrg: async () => true });
  const stripe = fs.readFileSync(path.join(functionsRoot, '_shared/stripe-client.ts'), 'utf8');
  const fnAt = stripe.indexOf('export async function createStripeClient');
  const body = stripe.slice(fnAt);
  const guardAt = body.indexOf('assertStripeClientAllowed');
  const uncheckedAt = body.indexOf('createStripeClientUnchecked');
  assert.ok(guardAt !== -1 && uncheckedAt > guardAt);
  assert.match(body, /demoModeEnabledForOrg/);
  assert.doesNotMatch(body.slice(0, uncheckedAt), /new Stripe/);
});

test('a failed demo lookup fails closed and is not cached', () => {
  assert.deepEqual(demoFlagCacheDecision({ ok: false }), { value: true, store: false });
  assert.deepEqual(demoFlagCacheDecision({ ok: true, value: false }), { value: false, store: true });
  assert.deepEqual(demoFlagCacheDecision({ ok: true, value: true }), { value: true, store: true });
  const guard = fs.readFileSync(path.join(functionsRoot, '_shared/demo-guard.ts'), 'utf8');
  const catchAt = guard.indexOf('} catch (err)');
  const nextFn = guard.indexOf('export async function listDemoModeOrgIds');
  const catchBody = guard.slice(catchAt, nextFn);
  assert.match(catchBody, /ok: false/);
  assert.doesNotMatch(catchBody, /cache\.set/);
  const success = guard.indexOf('demoFlagCacheDecision({ ok: true');
  const setAt = guard.indexOf('cache.set');
  assert.ok(success !== -1 && setAt > success);
  assert.equal(guard.indexOf('cache.set', setAt + 1), -1);
});

test('demo check runs before Stripe objects and database writes', () => {
  const cases: { rel: string; markers: string[] }[] = [
    {
      rel: 'create-stripe-invoice/index.ts',
      markers: ['stripe.customers.create', 'stripe.checkout.sessions.create', 'status: "sent"'],
    },
    {
      rel: 'send-card-link-sms/index.ts',
      markers: ['stripe.customers.create', 'stripe.checkout.sessions.create', "from('booking_link_tracking')"],
    },
    {
      rel: 'send-invoice/index.ts',
      markers: ['stripe.customers.create', 'stripe.checkout.sessions.create'],
    },
  ];
  for (const item of cases) {
    const text = fs.readFileSync(path.join(functionsRoot, item.rel), 'utf8');
    const checkAt = text.indexOf('await createStripeClient');
    assert.ok(checkAt !== -1, item.rel);
    for (const marker of item.markers) {
      const at = text.indexOf(marker);
      assert.ok(at > checkAt, `${item.rel} ${marker}`);
    }
  }
  for (const rel of ['buy-lifetime/index.ts', 'create-lifetime-checkout/index.ts', 'upgrade-now/index.ts']) {
    const text = fs.readFileSync(path.join(functionsRoot, rel), 'utf8');
    const memberAt = text.indexOf('from("org_memberships")');
    const clientAt = text.indexOf('await createStripeClient');
    assert.ok(memberAt !== -1 && clientAt > memberAt, rel);
    assert.match(text, /await createStripeClient\([\s\S]{0,160}organizationId/, rel);
    const sessionAt = text.indexOf('checkout.sessions.create');
    assert.ok(sessionAt > clientAt, rel);
  }
});

test('Gmail SMTP is checked for demo mode before the client opens', () => {
  const testEmail = fs.readFileSync(path.join(functionsRoot, 'send-gmail-test-email/index.ts'), 'utf8');
  const skipAt = testEmail.indexOf('demoSendShouldSkip');
  const smtpAt = testEmail.indexOf('new SMTPClient');
  assert.ok(skipAt !== -1 && smtpAt > skipAt);
  const orgEmail = fs.readFileSync(path.join(functionsRoot, '_shared/send-org-email.ts'), 'utf8');
  const orgSkip = orgEmail.indexOf('demoSendShouldSkip');
  const orgSend = orgEmail.indexOf('await sendViaGmailSmtp');
  assert.ok(orgSkip !== -1 && orgSend > orgSkip);
});

test('demo orgs and sample recipients are not send targets', () => {
  assert.equal(demoSendBlockReason({ demoModeEnabled: true, organizationId: 'real-org' }), 'demo_mode_enabled');
  assert.equal(demoSendBlockReason({ organizationId: DEMO_ORG_ID }), 'demo_org');
  assert.equal(demoSendBlockReason({ recipients: ['elena.vargas@example.com'] }), 'sample_recipient');
  assert.equal(demoSendBlockReason({ recipients: ['maya.chen@harborpine.example'] }), 'sample_recipient');
  assert.equal(isSampleSendTarget('+15125550110'), true);
  assert.equal(demoSendBlockReason({
    organizationId: 'real-org',
    demoModeEnabled: false,
    recipients: ['owner@real-cleaning.com', '+15125561212'],
  }), null);
});

test('only the platform-admin conversion alert may fetch OpenPhone directly', () => {
  const helper = 'const ADMIN_PHONES = platformAdminPhones();\nfetch("https://api.openphone.com/v1/messages"';
  assert.equal(openPhoneAdminAlertOnly(helper), true);
  assert.equal(openPhoneAdminAlertOnly(`${helper}\nfetch("https://api.openphone.com/v1/messages"`), false);
  assert.equal(openPhoneAdminAlertOnly('fetch("https://api.openphone.com/v1/messages"'), false);
  assert.equal(openPhoneAdminAlertOnly('sendOpenPhoneMessage('), true);
  const current = fs.readFileSync(path.join(functionsRoot, PLATFORM_ADMIN_OPENPHONE_ALERT), 'utf8');
  assert.equal(openPhoneAdminAlertOnly(current), true);
  assert.match(current, /sendOpenPhoneMessage/);
  assert.doesNotMatch(current, /api\.openphone\.com\/v1\/messages/);
});

test('edge functions send SMS, email, push, and Stripe only through the demo-aware helpers', () => {
  const files = walk(functionsRoot);
  const violations: string[] = [];
  for (const file of files) {
    const rel = path.relative(functionsRoot, file).split(path.sep).join('/');
    const text = fs.readFileSync(file, 'utf8');
    for (const rule of RULES) {
      if (rule.allow.includes(rel)) continue;
      if (rule.label === 'OpenPhone SMS' && rel === PLATFORM_ADMIN_OPENPHONE_ALERT) {
        if (openPhoneAdminAlertOnly(text)) continue;
        violations.push(`${rel} calls OpenPhone SMS directly beyond the one platform-admin alert`);
        continue;
      }
      if (rule.label === 'OpenPhone SMS' && rel === 'openphone-webhook/index.ts') {
        const hits = text.match(/api\.openphone\.com\/v1\/messages/g) ?? [];
        if (hits.length === 1 && text.includes('function sendSmsOptOutConfirmation')) continue;
        violations.push(`${rel} calls OpenPhone SMS directly beyond the opt-out confirmation`);
        continue;
      }
      if (rule.pattern.test(text)) violations.push(`${rel} calls ${rule.label} directly`);
    }
  }
  assert.deepEqual(violations, []);
});

test('shared send helpers check the org demo flag', () => {
  for (const rel of GUARDED_HELPERS) {
    const text = fs.readFileSync(path.join(functionsRoot, rel), 'utf8');
    assert.match(text, /demoSendShouldSkip|demoModeEnabledForOrg/, rel);
  }
  const abandoned = fs.readFileSync(path.join(functionsRoot, 'followup-abandoned-booking/index.ts'), 'utf8');
  assert.match(abandoned, /demoModeEnabledForOrg/);
  assert.match(abandoned, /sendOpenPhoneMessage/);
  const makeCaller = fs.readFileSync(path.join(functionsRoot, 'stripe-invoice-webhook/index.ts'), 'utf8');
  assert.match(makeCaller, /postMakeSubscriptionWebhook/);
  assert.doesNotMatch(makeCaller, /hook\.us2\.make\.com/);
});
