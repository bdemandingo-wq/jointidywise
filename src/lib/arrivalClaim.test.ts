import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  ARRIVAL_CLAIM_STALE_MS,
  ARRIVAL_MARK_SENT_ATTEMPTS,
  arrivalOpenPhoneClaim,
  arrivalReleaseMatchesClaim,
  claimedArrivalRowId,
  nextArrivalClaimAction,
  nextMarkSentStep,
  releaseArrivalClaimAfterError,
} from '../../supabase/functions/_shared/arrival-claim.ts';

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

test('a partial send marks the claim sent, and a total miss releases it', () => {
  assert.equal(arrivalOpenPhoneClaim([]), 'mark_sent');
  assert.equal(arrivalOpenPhoneClaim([true]), 'mark_sent');
  assert.equal(arrivalOpenPhoneClaim([true, true]), 'mark_sent');
  assert.equal(arrivalOpenPhoneClaim([true, false]), 'mark_sent');
  assert.equal(arrivalOpenPhoneClaim([false, true]), 'mark_sent');
  assert.equal(arrivalOpenPhoneClaim([false]), 'release');
  assert.equal(arrivalOpenPhoneClaim([false, false]), 'release');
});

test('a permanently bad admin number texts the customer exactly once', () => {
  let row: 'none' | 'pending' | 'sent' = 'none';
  let customerTexts = 0;

  const arrive = () => {
    const action = nextArrivalClaimAction({
      insertError: row === 'none' ? 'none' : 'conflict',
      row,
      pendingAgeMs: row === 'pending' ? 1_000 : null,
    });
    if (action !== 'send') return action;
    row = 'pending';
    customerTexts += 1;
    const adminOk = false;
    const claim = arrivalOpenPhoneClaim([true, adminOk]);
    row = claim === 'mark_sent' ? 'sent' : 'none';
    return claim;
  };

  assert.equal(arrive(), 'mark_sent');
  assert.equal(arrive(), 'duplicate');
  assert.equal(arrive(), 'duplicate');
  assert.equal(customerTexts, 1);
  assert.equal(releaseArrivalClaimAfterError(true), false);
  assert.equal(releaseArrivalClaimAfterError(false), true);
});

test('a failed mark-sent is retried and then stops', () => {
  assert.equal(ARRIVAL_MARK_SENT_ATTEMPTS, 4);
  assert.equal(nextMarkSentStep(0, false), 'done');
  assert.equal(nextMarkSentStep(0, true), 'retry');
  assert.equal(nextMarkSentStep(ARRIVAL_MARK_SENT_ATTEMPTS - 2, true), 'retry');
  assert.equal(nextMarkSentStep(ARRIVAL_MARK_SENT_ATTEMPTS - 1, true), 'give_up');
});

test('a stale release deletes only the pending row that caller inserted', () => {
  assert.equal(claimedArrivalRowId([{ id: 'claim-1' }]), 'claim-1');
  assert.equal(claimedArrivalRowId([]), null);
  assert.equal(claimedArrivalRowId(null), null);
  assert.equal(claimedArrivalRowId([{ id: '' }]), null);

  const rows = [
    { id: 'old', status: 'pending' },
    { id: 'live', status: 'pending' },
  ];
  const afterStaleRelease = rows.filter((row) => !arrivalReleaseMatchesClaim(row, 'old'));
  assert.deepEqual(afterStaleRelease.map((row) => row.id), ['live']);
  assert.equal(arrivalReleaseMatchesClaim({ id: 'old', status: 'sent' }, 'old'), false);
  assert.equal(arrivalReleaseMatchesClaim({ id: 'live', status: 'pending' }, ''), false);
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
