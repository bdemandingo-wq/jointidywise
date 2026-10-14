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
import { DEMO_ORG_ID, demoSendBlockReason, isSampleSendTarget } from './demo-org.ts';

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
];

const GUARDED_HELPERS = [
  '_shared/send-openphone.ts',
  '_shared/send-resend.ts',
  '_shared/apns-deliver.ts',
  '_shared/stripe-client.ts',
  '_shared/make-subscription-webhook.ts',
  '_shared/gmail-send-core.ts',
  '_shared/send-org-email.ts',
  '_shared/send-push.ts',
];

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) out.push(full);
  }
  return out;
}

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

test('edge functions send SMS, email, push, and Stripe only through the demo-aware helpers', () => {
  const files = walk(functionsRoot);
  const violations: string[] = [];
  for (const file of files) {
    const rel = path.relative(functionsRoot, file).split(path.sep).join('/');
    const text = fs.readFileSync(file, 'utf8');
    for (const rule of RULES) {
      if (rule.allow.includes(rel)) continue;
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
