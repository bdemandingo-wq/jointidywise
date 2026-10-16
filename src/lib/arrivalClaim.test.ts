import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ARRIVAL_CLAIM_STALE_MS, arrivalOpenPhoneClaim, nextArrivalClaimAction } from '../../supabase/functions/_shared/arrival-claim.ts';

test('the first insert wins the arrival send', () => {
  assert.equal(nextArrivalClaimAction({
    insertError: 'none',
    row: 'none',
    pendingAgeMs: null,
  }), 'send');
});

test('a sent reminder row is a duplicate and does not send again', () => {
  assert.equal(nextArrivalClaimAction({
    insertError: 'conflict',
    row: 'sent',
    pendingAgeMs: 5_000,
  }), 'duplicate');
  assert.equal(nextArrivalClaimAction({
    insertError: 'conflict',
    row: 'other',
    pendingAgeMs: 5_000,
  }), 'duplicate');
});

test('a fresh pending row waits, and a stale one can be taken over', () => {
  assert.equal(ARRIVAL_CLAIM_STALE_MS, 90_000);
  assert.equal(nextArrivalClaimAction({
    insertError: 'conflict',
    row: 'pending',
    pendingAgeMs: ARRIVAL_CLAIM_STALE_MS - 1,
  }), 'in_progress');
  assert.equal(nextArrivalClaimAction({
    insertError: 'conflict',
    row: 'pending',
    pendingAgeMs: null,
  }), 'in_progress');
  assert.equal(nextArrivalClaimAction({
    insertError: 'conflict',
    row: 'pending',
    pendingAgeMs: ARRIVAL_CLAIM_STALE_MS,
  }), 'takeover');
});

test('an OpenPhone non-2xx releases the claim instead of marking it sent', () => {
  assert.equal(arrivalOpenPhoneClaim([]), 'mark_sent');
  assert.equal(arrivalOpenPhoneClaim([true]), 'mark_sent');
  assert.equal(arrivalOpenPhoneClaim([true, true]), 'mark_sent');
  assert.equal(arrivalOpenPhoneClaim([false]), 'release');
  assert.equal(arrivalOpenPhoneClaim([true, false]), 'release');
  assert.equal(arrivalOpenPhoneClaim([false, true]), 'release');
});

test('a failed insert or a conflict with no row refuses to send', () => {
  assert.equal(nextArrivalClaimAction({
    insertError: 'failed',
    row: 'none',
    pendingAgeMs: null,
  }), 'refuse');
  assert.equal(nextArrivalClaimAction({
    insertError: 'conflict',
    row: 'none',
    pendingAgeMs: null,
  }), 'refuse');
});
