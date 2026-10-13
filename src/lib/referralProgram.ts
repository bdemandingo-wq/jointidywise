/**
 * Reward rules for the org-owner referral programme.
 *
 * Pure functions only — no Supabase, no Stripe, no clock — so the decisions
 * that grant or claw back a free month can be tested without a network.
 *
 * KEEP IN SYNC: `supabase/functions/_shared/saas-referral-logic.ts` is a copy
 * of the decision functions below its header. Edge functions run in Deno and
 * cannot import from `src/`. referralProgram.test.ts asserts the two agree.
 *
 * The rule: two referred organizations become paying customers (first
 * invoice.paid with amount > 0, not a trial) and the referrer earns one free
 * month. Every further pair earns another. A refund or dispute inside 30 days
 * of that first payment removes the referral from the count.
 */

import { normalizeReferralCode } from './referralCode.ts';

export const PAYING_PER_REWARD = 2;
export const REVERSAL_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
export const REFERRAL_LINK_ORIGIN = 'https://jointidywise.com';

export const SAAS_REFERRAL_STATUSES = [
  'signed_up',
  'trialing',
  'paid',
  'rewarded',
  'reversed',
] as const;

export type SaasReferralStatus = (typeof SAAS_REFERRAL_STATUSES)[number];
export type RewardLedgerStatus = 'banked' | 'applied' | 'reversed';

/** What an owner is told before they share. Pinned by tests. */
export const REFERRAL_OFFER: readonly string[] = [
  'Share your link with another cleaning business.',
  'When two of them become paying customers — the first invoice that actually charges, not a trial signup — you get one free month.',
  'Every two paying referrals earns another free month.',
  'If you are still on a trial, the free month is saved and applied when you subscribe.',
];

const PLAN_MONTHLY_CENTS: Record<string, number> = {
  basic: 4900,
  pro: 9700,
  custom: 19700,
};

/**
 * Consumer mailbox providers. Two people on gmail.com are not the same
 * business; two people on acmecleaning.com are.
 */
const PUBLIC_EMAIL_DOMAINS = new Set([
  'gmail.com',
  'googlemail.com',
  'yahoo.com',
  'yahoo.co.uk',
  'ymail.com',
  'hotmail.com',
  'outlook.com',
  'live.com',
  'msn.com',
  'icloud.com',
  'me.com',
  'mac.com',
  'aol.com',
  'proton.me',
  'protonmail.com',
  'pm.me',
  'gmx.com',
  'mail.com',
  'zoho.com',
]);

export interface ReferralIdentity {
  orgId: string | null;
  userId: string | null;
  email: string | null;
  stripeCustomerId: string | null;
}

export interface RewardReferral {
  id: string;
  status: SaasReferralStatus;
  paidAt: string | null;
  blockReason: string | null;
}

export interface RewardRow {
  id: string;
  rewardIndex: number;
  status: RewardLedgerStatus;
  sourceReferralIds: string[];
}

export interface ReconcileResult {
  grants: Array<{ rewardIndex: number; sourceReferralIds: [string, string] }>;
  reversals: Array<{ rewardId: string; rewardIndex: number }>;
  referralStatusUpdates: Array<{ id: string; status: 'paid' | 'rewarded' }>;
}

export interface InvoiceDecisionInput {
  status: SaasReferralStatus;
  qualifyingInvoiceId: string | null;
  blockReason: string | null;
}

export type InvoiceDecision =
  | { action: 'ignore'; reason: 'blocked' | 'zero_amount' | 'duplicate_invoice' | 'already_counted' }
  | { action: 'mark_trialing' }
  | { action: 'mark_paid' };

export function emailDomain(email: string | null | undefined): string | null {
  if (!email) return null;
  const trimmed = email.trim().toLowerCase();
  const at = trimmed.lastIndexOf('@');
  if (at <= 0 || at === trimmed.length - 1) return null;
  return trimmed.slice(at + 1);
}

/**
 * Null when the pair may be recorded. Otherwise a stable reason.
 * Identity checks run before anything else so a self-referral is reported as
 * one, and a missing Stripe customer (normal at signup) is not a match.
 */
export function selfReferralReason(
  referrer: ReferralIdentity,
  referred: ReferralIdentity,
): string | null {
  if (referrer.orgId && referred.orgId && referrer.orgId === referred.orgId) return 'same_org';
  if (referrer.userId && referred.userId && referrer.userId === referred.userId) return 'same_user';

  const referrerEmail = referrer.email?.trim().toLowerCase() || null;
  const referredEmail = referred.email?.trim().toLowerCase() || null;
  if (referrerEmail && referredEmail && referrerEmail === referredEmail) return 'same_email';

  const referrerDomain = emailDomain(referrerEmail);
  const referredDomain = emailDomain(referredEmail);
  if (
    referrerDomain &&
    referredDomain &&
    referrerDomain === referredDomain &&
    !PUBLIC_EMAIL_DOMAINS.has(referrerDomain)
  ) {
    return 'same_domain';
  }

  if (
    referrer.stripeCustomerId &&
    referred.stripeCustomerId &&
    referrer.stripeCustomerId === referred.stripeCustomerId
  ) {
    return 'same_stripe_customer';
  }

  return null;
}

/**
 * What to do with one invoice.paid delivery.
 *
 * A $0 trial invoice is not a payment. The same invoice id delivered again
 * is not a second payment. A later invoice is not a second referral — only
 * the first successful charge counts.
 */
export function decideInvoiceEffect(
  referral: InvoiceDecisionInput,
  invoice: { id: string; amountPaid: number },
): InvoiceDecision {
  if (referral.blockReason) return { action: 'ignore', reason: 'blocked' };
  if (referral.qualifyingInvoiceId && referral.qualifyingInvoiceId === invoice.id) {
    return { action: 'ignore', reason: 'duplicate_invoice' };
  }
  if (invoice.amountPaid <= 0) {
    if (referral.status === 'signed_up') return { action: 'mark_trialing' };
    return { action: 'ignore', reason: 'zero_amount' };
  }
  if (referral.status === 'paid' || referral.status === 'rewarded' || referral.status === 'reversed') {
    return { action: 'ignore', reason: 'already_counted' };
  }
  return { action: 'mark_paid' };
}

/** True only for a counted referral whose qualifying payment is still inside the window. */
export function shouldReverseReferral(input: {
  status: SaasReferralStatus;
  paidAt: string | null;
  eventAt: string;
}): boolean {
  if (input.status !== 'paid' && input.status !== 'rewarded') return false;
  if (!input.paidAt) return false;
  const paid = Date.parse(input.paidAt);
  const event = Date.parse(input.eventAt);
  if (!Number.isFinite(paid) || !Number.isFinite(event)) return false;
  const delta = event - paid;
  return delta >= 0 && delta <= REVERSAL_WINDOW_MS;
}

export function payingReferrals(rows: RewardReferral[]): RewardReferral[] {
  return rows
    .filter((row) => (row.status === 'paid' || row.status === 'rewarded') && !row.blockReason)
    .slice()
    .sort((a, b) => {
      const paidA = a.paidAt ?? '';
      const paidB = b.paidAt ?? '';
      if (paidA !== paidB) return paidA < paidB ? -1 : 1;
      if (a.id === b.id) return 0;
      return a.id < b.id ? -1 : 1;
    });
}

export function countPaying(rows: Array<{ status: string; blockReason?: string | null }>): number {
  return rows.filter(
    (row) => (row.status === 'paid' || row.status === 'rewarded') && !row.blockReason,
  ).length;
}

/**
 * Bring the ledger in line with "one free month per two paying referrals".
 *
 * Safe to run again on the same snapshot: a second pass grants nothing and
 * reverses nothing. A reward whose source referral is no longer paying is
 * reversed, and that referral's partner goes back to `paid` so it can pair
 * with someone else. Reward indexes are never reused, so a reversed row
 * cannot be overwritten into a second credit.
 */
export function reconcileRewards(
  referrals: RewardReferral[],
  rewards: RewardRow[],
): ReconcileResult {
  const paying = payingReferrals(referrals);
  const payingIds = new Set(paying.map((row) => row.id));
  const earned = Math.floor(paying.length / PAYING_PER_REWARD);

  const reversals: ReconcileResult['reversals'] = [];
  let stillValid = rewards.filter((row) => row.status !== 'reversed');
  const invalid = stillValid.filter(
    (row) =>
      row.sourceReferralIds.length !== 2 ||
      row.sourceReferralIds.some((id) => !payingIds.has(id)),
  );
  for (const reward of invalid) {
    reversals.push({ rewardId: reward.id, rewardIndex: reward.rewardIndex });
  }
  const invalidIds = new Set(invalid.map((row) => row.id));
  stillValid = stillValid.filter((row) => !invalidIds.has(row.id));
  stillValid.sort((a, b) => a.rewardIndex - b.rewardIndex);

  while (stillValid.length > earned) {
    const extra = stillValid.pop();
    if (!extra) break;
    reversals.push({ rewardId: extra.id, rewardIndex: extra.rewardIndex });
  }

  const covered = new Set(stillValid.flatMap((row) => row.sourceReferralIds));
  const uncovered = paying.filter((row) => !covered.has(row.id));
  const slots = earned - stillValid.length;
  const grants: ReconcileResult['grants'] = [];
  let nextIndex = rewards.reduce((max, row) => Math.max(max, row.rewardIndex), -1) + 1;

  for (let i = 0; i < slots; i++) {
    const left = uncovered[i * 2];
    const right = uncovered[i * 2 + 1];
    if (!left || !right) break;
    grants.push({
      rewardIndex: nextIndex,
      sourceReferralIds: [left.id, right.id],
    });
    covered.add(left.id);
    covered.add(right.id);
    nextIndex += 1;
  }

  const referralStatusUpdates: ReconcileResult['referralStatusUpdates'] = [];
  for (const referral of paying) {
    const want: 'paid' | 'rewarded' = covered.has(referral.id) ? 'rewarded' : 'paid';
    if (referral.status !== want) {
      referralStatusUpdates.push({ id: referral.id, status: want });
    }
  }

  return { grants, reversals, referralStatusUpdates };
}

/**
 * Apply the credit only once the referrer has an active paid subscription.
 * Trial, missing, past_due, and canceled subscriptions bank the month.
 */
export function creditApplication(
  subscriptionStatus: string | null | undefined,
): 'apply' | 'bank' {
  return subscriptionStatus === 'active' ? 'apply' : 'bank';
}

/**
 * One free month, in cents. A yearly Stripe price is divided by 12. Known
 * plan names are the monthly list price. Unknown plans return null so the
 * caller banks the reward instead of inventing an amount.
 */
export function monthCreditCents(input: {
  unitAmount: number | null;
  interval: string | null;
  plan: string | null;
}): number | null {
  const interval = (input.interval ?? '').toLowerCase();
  const yearly = interval === 'year' || interval === 'yearly';
  if (input.unitAmount != null && input.unitAmount > 0) {
    return yearly ? Math.round(input.unitAmount / 12) : input.unitAmount;
  }
  const plan = (input.plan ?? '').toLowerCase();
  return PLAN_MONTHLY_CENTS[plan] ?? null;
}

/**
 * Stripe customer balance: a negative amount is a credit applied to the next
 * invoice. A positive amount would charge the customer. This never returns one.
 */
export function balanceCreditAmount(cents: number): number {
  if (!Number.isInteger(cents) || cents <= 0) {
    throw new Error('A referral credit must be a positive number of cents');
  }
  return -cents;
}

/** Undo a credit that was already applied. Positive, so it removes the balance. */
export function balanceReversalAmount(creditedCents: number): number {
  if (!Number.isInteger(creditedCents) || creditedCents <= 0) {
    throw new Error('A referral reversal must undo a positive credit');
  }
  return creditedCents;
}

export function progressTowardNextReward(payingCount: number): { current: number; goal: number } {
  const safe = Math.max(0, Math.floor(payingCount));
  return { current: safe % PAYING_PER_REWARD, goal: PAYING_PER_REWARD };
}

export function progressLabel(payingCount: number): string {
  const { current, goal } = progressTowardNextReward(payingCount);
  return `${current} of ${goal} paying referrals`;
}

export function ownerReferralLink(code: string | null | undefined): string | null {
  const normalized = normalizeReferralCode(code);
  if (!normalized || !/^[A-HJ-NP-Z2-9]{8}$/.test(normalized)) return null;
  return `${REFERRAL_LINK_ORIGIN}/r/${normalized}`;
}

export function referralShareCopy(link: string): {
  sms: string;
  emailSubject: string;
  emailBody: string;
} {
  return {
    sms: `I run my cleaning business on TidyWise and thought you'd like it. Start here: ${link}`,
    emailSubject: 'Try TidyWise for your cleaning business',
    emailBody:
      `I run my cleaning business on TidyWise and thought you'd like it.\n\n` +
      `Create your account here:\n${link}\n`,
  };
}

export function smsShareHref(body: string): string {
  return `sms:?&body=${encodeURIComponent(body)}`;
}

export function emailShareHref(subject: string, body: string): string {
  return `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

export function saasReferralStatusLabel(status: string, blockReason: string | null): string {
  if (blockReason) return 'Not eligible';
  switch (status) {
    case 'signed_up':
      return 'Signed up';
    case 'trialing':
      return 'On a trial — not counted yet';
    case 'paid':
      return 'Paying customer';
    case 'rewarded':
      return 'Counted toward a free month';
    case 'reversed':
      return 'Reversed after a refund or dispute';
    default:
      return 'In progress';
  }
}

export function initialReferralStatus(planType: string | null | undefined): 'signed_up' | 'trialing' {
  return planType === 'trial' ? 'trialing' : 'signed_up';
}
