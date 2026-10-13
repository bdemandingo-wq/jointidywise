import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  remainingSpots, teamBadge, teamSummary, claimedLabel, teamCleanerPay, teamFieldsForSave,
  shouldKeepClaimedCleaners, mirroredCleanerWage, claimPayShare,
} from './teamJobs.ts';
import { resolveCleanerPay, type WageBooking } from './wageCalculation.ts';

test('remaining spots = needed minus claimed', () => {
  assert.equal(remainingSpots({ cleaners_needed: 2 }, 0), 2);
  assert.equal(remainingSpots({ cleaners_needed: 2 }, 1), 1);
  assert.equal(remainingSpots({ cleaners_needed: 2 }, 2), 0);
});
test('remaining spots never negative on over-full data', () => {
  assert.equal(remainingSpots({ cleaners_needed: 2 }, 3), 0);
});
test('single-cleaner job has one spot', () => {
  assert.equal(remainingSpots({ cleaners_needed: 1 }, 0), 1);
  assert.equal(remainingSpots({ cleaners_needed: null }, 1), 0);
});

test('badge before any claim, flat', () => {
  assert.equal(teamBadge({ cleaners_needed: 2, pay_per_cleaner: 100, pay_type: 'flat' }, 0),
    '2 cleaners needed · $100 each potential pay');
});
test('badge after one claim', () => {
  assert.equal(teamBadge({ cleaners_needed: 2, pay_per_cleaner: 100, pay_type: 'flat' }, 1),
    '1 more cleaner needed · $100 each potential pay');
});
test('badge hourly', () => {
  assert.equal(teamBadge({ cleaners_needed: 3, pay_per_cleaner: 25, pay_type: 'hourly' }, 0),
    '3 cleaners needed · $25/hr each potential pay');
});
test('admin summary line', () => {
  assert.equal(teamSummary({ cleaners_needed: 2, pay_per_cleaner: 100, pay_type: 'flat' }), '2 cleaners · $100 each (flat)');
  assert.equal(claimedLabel({ cleaners_needed: 2 }, 1), '1 of 2 claimed');
});

test('unchecked team saves 1 cleaner and null pay', () => {
  assert.deepEqual(teamFieldsForSave(false, 4, '100', 'flat'), { cleaners_needed: 1, pay_per_cleaner: null, pay_type: null });
});
test('team count clamped to 2–6', () => {
  assert.equal(teamFieldsForSave(true, 9, '100', 'flat').cleaners_needed, 6);
  assert.equal(teamFieldsForSave(true, 1, '100', 'flat').cleaners_needed, 2);
});

const base: WageBooking = {
  cleaner_actual_payment: null, cleaner_pay_expected: null, cleaner_wage: 20, cleaner_wage_type: 'hourly',
  cleaner_checkin_at: null, cleaner_checkout_at: null, cleaner_override_hours: 4, duration: 240, total_amount: 300,
};

test('team flat pay applies to each cleaner', () => {
  const b = { ...base, cleaners_needed: 2, pay_per_cleaner: 100, pay_type: 'flat' };
  assert.equal(resolveCleanerPay(b, null, null, 2).calculatedPay, 100);
  assert.equal(teamCleanerPay(b, 4), 100);
});
test('team hourly pay = rate × hours', () => {
  const b = { ...base, cleaners_needed: 2, pay_per_cleaner: 25, pay_type: 'hourly' };
  assert.equal(resolveCleanerPay(b, null, null, 2).calculatedPay, 100);
});
test('single-cleaner booking unchanged by team fields', () => {
  const solo = resolveCleanerPay(base, null, null, 1).calculatedPay;
  const withNulls = resolveCleanerPay({ ...base, cleaners_needed: 1, pay_per_cleaner: 999, pay_type: 'flat' }, null, null, 1).calculatedPay;
  assert.equal(solo, 80);
  assert.equal(withNulls, 80);
});

test('locked pay beats the team rate', () => {
  const b = { ...base, cleaners_needed: 2, pay_per_cleaner: 100, pay_type: 'flat', pay_locked: true, cleaner_pay_expected: 40 };
  assert.equal(resolveCleanerPay(b, null, null, 2).calculatedPay, 40);
});

test('saving a claim-style team job keeps cleaners who already claimed', () => {
  assert.equal(shouldKeepClaimedCleaners(true, false), true);
  assert.equal(shouldKeepClaimedCleaners(true, true), false);
  assert.equal(shouldKeepClaimedCleaners(false, false), false);
});

test('team pay is what gets stored as the booking wage', () => {
  assert.deepEqual(mirroredCleanerWage(true, '100', 'flat', '20', 'hourly'), { wage: '100', wageType: 'flat' });
  assert.deepEqual(mirroredCleanerWage(true, '', 'flat', '20', 'hourly'), { wage: '20', wageType: 'hourly' });
  assert.deepEqual(mirroredCleanerWage(false, '100', 'flat', '20', 'hourly'), { wage: '20', wageType: 'hourly' });
});

test('hourly team pay_share stays empty so hours are not frozen', () => {
  assert.equal(claimPayShare('flat', 100), 100);
  assert.equal(claimPayShare('hourly', 25), null);
  assert.equal(claimPayShare('flat', null), null);
});
