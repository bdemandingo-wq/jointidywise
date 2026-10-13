// Reward rules for the org-owner referral programme.
//
//   node --experimental-strip-types --test src/lib/referralProgram.test.ts
//
// THE CONTROL. Most of these cases are about a credit that must NOT be
// granted — a trial, a $0 invoice, a webhook retry, a refund after 30 days.
// A function that always granted a month would fail the "two paying referrals"
// cases below, and a function that never granted one would fail the pair
// that does qualify. Both directions are asserted.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  balanceCreditAmount,
  balanceReversalAmount,
  countPaying,
  creditApplication,
  decideInvoiceEffect,
  monthCreditCents,
  ownerReferralLink,
  progressLabel,
  reconcileRewards,
  referralShareCopy,
  selfReferralReason,
  shouldReverseReferral,
  REVERSAL_WINDOW_MS,
  type RewardReferral,
  type RewardRow,
} from './referralProgram.ts';
import {
  balanceCreditAmount as edgeCredit,
  reconcileRewards as edgeReconcile,
  selfReferralReason as edgeSelf,
  shouldReverseReferral as edgeReverse,
  decideInvoiceEffect as edgeInvoice,
} from '../../supabase/functions/_shared/saas-referral-logic.ts';

const DAY = 24 * 60 * 60 * 1000;
const paidAt = '2026-01-01T00:00:00.000Z';

const identity = (overrides: Partial<Parameters<typeof selfReferralReason>[0]> = {}) => ({
  orgId: 'org-a',
  userId: 'user-a',
  email: 'owner@acmecleaning.com',
  stripeCustomerId: 'cus_a',
  ...overrides,
});

const referral = (overrides: Partial<RewardReferral> = {}): RewardReferral => ({
  id: 'ref-a',
  status: 'paid',
  paidAt,
  blockReason: null,
  ...overrides,
});

test('CONTROL: two paying referrals earn one month and a retry does not earn another', () => {
  const rows = [
    referral({ id: 'a', paidAt: '2026-01-01T00:00:00.000Z' }),
    referral({ id: 'b', paidAt: '2026-01-02T00:00:00.000Z' }),
  ];
  const first = reconcileRewards(rows, []);
  assert.equal(first.grants.length, 1);
  assert.deepEqual(first.grants[0].sourceReferralIds, ['a', 'b']);
  assert.equal(first.grants[0].rewardIndex, 0);
  assert.deepEqual(
    first.referralStatusUpdates.map((row) => row.id).sort(),
    ['a', 'b'],
  );

  const granted: RewardRow[] = [{
    id: 'reward-0',
    rewardIndex: 0,
    status: 'banked',
    sourceReferralIds: ['a', 'b'],
  }];
  const rewarded = rows.map((row) => ({ ...row, status: 'rewarded' as const }));
  const second = reconcileRewards(rewarded, granted);
  assert.deepEqual(second.grants, []);
  assert.deepEqual(second.reversals, []);
  assert.deepEqual(second.referralStatusUpdates, []);
});

test('one paying referral earns nothing and reads as 1 of 2', () => {
  const result = reconcileRewards([referral({ id: 'only' })], []);
  assert.deepEqual(result.grants, []);
  assert.equal(progressLabel(1), '1 of 2 paying referrals');
  assert.equal(progressLabel(0), '0 of 2 paying referrals');
  assert.equal(progressLabel(2), '0 of 2 paying referrals');
  assert.equal(progressLabel(3), '1 of 2 paying referrals');
});

test('every further pair earns another month', () => {
  const rows = ['a', 'b', 'c', 'd'].map((id, index) =>
    referral({ id, paidAt: `2026-01-0${index + 1}T00:00:00.000Z` }),
  );
  const result = reconcileRewards(rows, []);
  assert.equal(result.grants.length, 2);
  assert.deepEqual(result.grants[0].sourceReferralIds, ['a', 'b']);
  assert.deepEqual(result.grants[1].sourceReferralIds, ['c', 'd']);
  assert.equal(result.grants[1].rewardIndex, 1);
});

test('a trial signup and a zero-dollar invoice are not payments', () => {
  assert.deepEqual(
    decideInvoiceEffect(
      { status: 'signed_up', qualifyingInvoiceId: null, blockReason: null },
      { id: 'in_trial', amountPaid: 0 },
    ),
    { action: 'mark_trialing' },
  );
  assert.deepEqual(
    decideInvoiceEffect(
      { status: 'trialing', qualifyingInvoiceId: null, blockReason: null },
      { id: 'in_trial', amountPaid: 0 },
    ),
    { action: 'ignore', reason: 'zero_amount' },
  );
  assert.equal(countPaying([{ status: 'trialing' }, { status: 'signed_up' }]), 0);
});

test('the first successful invoice counts once, including when the webhook is retried', () => {
  const fresh = { status: 'trialing' as const, qualifyingInvoiceId: null, blockReason: null };
  assert.deepEqual(
    decideInvoiceEffect(fresh, { id: 'in_1', amountPaid: 4900 }),
    { action: 'mark_paid' },
  );
  assert.deepEqual(
    decideInvoiceEffect(
      { status: 'paid', qualifyingInvoiceId: 'in_1', blockReason: null },
      { id: 'in_1', amountPaid: 4900 },
    ),
    { action: 'ignore', reason: 'duplicate_invoice' },
  );
  assert.deepEqual(
    decideInvoiceEffect(
      { status: 'paid', qualifyingInvoiceId: 'in_1', blockReason: null },
      { id: 'in_2', amountPaid: 4900 },
    ),
    { action: 'ignore', reason: 'already_counted' },
  );
});

test('a refund or dispute inside 30 days reverses the count and claws the month back', () => {
  const inside = new Date(Date.parse(paidAt) + 29 * DAY).toISOString();
  const edge = new Date(Date.parse(paidAt) + REVERSAL_WINDOW_MS).toISOString();
  assert.equal(shouldReverseReferral({ status: 'paid', paidAt, eventAt: inside }), true);
  assert.equal(shouldReverseReferral({ status: 'rewarded', paidAt, eventAt: edge }), true);

  const rows = [
    referral({ id: 'a', status: 'reversed' }),
    referral({ id: 'b', status: 'rewarded', paidAt: '2026-01-02T00:00:00.000Z' }),
  ];
  const rewards: RewardRow[] = [{
    id: 'reward-0',
    rewardIndex: 0,
    status: 'applied',
    sourceReferralIds: ['a', 'b'],
  }];
  const result = reconcileRewards(rows, rewards);
  assert.deepEqual(result.reversals, [{ rewardId: 'reward-0', rewardIndex: 0 }]);
  assert.deepEqual(result.referralStatusUpdates, [{ id: 'b', status: 'paid' }]);
  assert.deepEqual(result.grants, []);
});

test('a refund after 30 days leaves the count alone, and a second reversal is a no-op', () => {
  const late = new Date(Date.parse(paidAt) + REVERSAL_WINDOW_MS + 1).toISOString();
  assert.equal(shouldReverseReferral({ status: 'paid', paidAt, eventAt: late }), false);
  assert.equal(shouldReverseReferral({ status: 'reversed', paidAt, eventAt: paidAt }), false);
  assert.equal(shouldReverseReferral({ status: 'trialing', paidAt: null, eventAt: paidAt }), false);
});

test('after a reversal the partner can pair with the next paying referral under a new reward index', () => {
  const rows = [
    referral({ id: 'a', status: 'reversed' }),
    referral({ id: 'b', paidAt: '2026-01-02T00:00:00.000Z' }),
    referral({ id: 'c', paidAt: '2026-01-03T00:00:00.000Z' }),
  ];
  const rewards: RewardRow[] = [{
    id: 'reward-0',
    rewardIndex: 0,
    status: 'reversed',
    sourceReferralIds: ['a', 'b'],
  }];
  const result = reconcileRewards(rows, rewards);
  assert.equal(result.grants.length, 1);
  assert.equal(result.grants[0].rewardIndex, 1);
  assert.deepEqual(result.grants[0].sourceReferralIds, ['b', 'c']);
  assert.deepEqual(result.reversals, []);
});

test('self-referral is blocked for the same user, email, company domain, or Stripe customer', () => {
  const referrer = identity();
  assert.equal(
    selfReferralReason(referrer, identity({ orgId: 'org-b', email: 'other@elsewhere.com', stripeCustomerId: 'cus_b' })),
    'same_user',
  );
  assert.equal(
    selfReferralReason(
      referrer,
      identity({ orgId: 'org-b', userId: 'user-b', stripeCustomerId: 'cus_b' }),
    ),
    'same_email',
  );
  assert.equal(
    selfReferralReason(
      referrer,
      identity({
        orgId: 'org-b',
        userId: 'user-b',
        email: 'staff@acmecleaning.com',
        stripeCustomerId: 'cus_b',
      }),
    ),
    'same_domain',
  );
  assert.equal(
    selfReferralReason(
      referrer,
      identity({
        orgId: 'org-b',
        userId: 'user-b',
        email: 'other@elsewhere.com',
        stripeCustomerId: 'cus_a',
      }),
    ),
    'same_stripe_customer',
  );
  assert.equal(selfReferralReason(referrer, identity()), 'same_org');
});

test('two gmail addresses are not the same business, and a real pair is allowed', () => {
  const referrer = identity({ email: 'ada@gmail.com', stripeCustomerId: null });
  assert.equal(
    selfReferralReason(
      referrer,
      identity({
        orgId: 'org-b',
        userId: 'user-b',
        email: 'grace@gmail.com',
        stripeCustomerId: null,
      }),
    ),
    null,
  );
  assert.equal(
    selfReferralReason(
      identity({ stripeCustomerId: null }),
      identity({
        orgId: 'org-b',
        userId: 'user-b',
        email: 'owner@othercleaning.com',
        stripeCustomerId: null,
      }),
    ),
    null,
  );
});

test('missing Stripe customers at signup are not treated as a match', () => {
  assert.equal(
    selfReferralReason(
      identity({ stripeCustomerId: null }),
      identity({ orgId: 'org-b', userId: 'user-b', email: 'a@other.com', stripeCustomerId: null }),
    ),
    null,
  );
});

test('a referrer still on trial banks the month; an active subscription applies it', () => {
  assert.equal(creditApplication('trialing'), 'bank');
  assert.equal(creditApplication(null), 'bank');
  assert.equal(creditApplication('past_due'), 'bank');
  assert.equal(creditApplication('active'), 'apply');
});

test('the Stripe balance entry is a credit, never a charge', () => {
  assert.equal(balanceCreditAmount(4900), -4900);
  assert.equal(balanceReversalAmount(4900), 4900);
  assert.throws(() => balanceCreditAmount(0));
  assert.throws(() => balanceCreditAmount(-100));
  assert.equal(monthCreditCents({ unitAmount: null, interval: null, plan: 'pro' }), 9700);
  assert.equal(monthCreditCents({ unitAmount: 58800, interval: 'year', plan: null }), 4900);
  assert.equal(monthCreditCents({ unitAmount: null, interval: null, plan: 'lifetime' }), null);
});

test('the share link is jointidywise.com/r/CODE and the share text includes it', () => {
  const link = ownerReferralLink('abc23456');
  assert.equal(link, 'https://jointidywise.com/r/ABC23456');
  const copy = referralShareCopy(link!);
  assert.match(copy.sms, /jointidywise\.com\/r\/ABC23456/);
  assert.match(copy.emailBody, /jointidywise\.com\/r\/ABC23456/);
  assert.equal(ownerReferralLink(''), null);
  assert.equal(ownerReferralLink('ABC'), null);
});

test('the edge copy makes the same reward decisions', () => {
  const referrer = identity();
  const referred = identity({
    orgId: 'org-b',
    userId: 'user-b',
    email: 'staff@acmecleaning.com',
    stripeCustomerId: 'cus_b',
  });
  assert.equal(selfReferralReason(referrer, referred), edgeSelf(referrer, referred));
  assert.equal(balanceCreditAmount(9700), edgeCredit(9700));

  const invoice = decideInvoiceEffect(
    { status: 'trialing', qualifyingInvoiceId: null, blockReason: null },
    { id: 'in_9', amountPaid: 4900 },
  );
  assert.deepEqual(invoice, edgeInvoice(
    { status: 'trialing', qualifyingInvoiceId: null, blockReason: null },
    { id: 'in_9', amountPaid: 4900 },
  ));

  const reversal = { status: 'paid' as const, paidAt, eventAt: paidAt };
  assert.equal(shouldReverseReferral(reversal), edgeReverse(reversal));

  const rows = [
    referral({ id: 'a' }),
    referral({ id: 'b', paidAt: '2026-01-02T00:00:00.000Z' }),
  ];
  assert.deepEqual(reconcileRewards(rows, []), edgeReconcile(rows, []));
});
