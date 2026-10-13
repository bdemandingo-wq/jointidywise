import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  REOPEN_CLEANER_PAID,
  REOPEN_CUSTOMER_PAID,
  REOPEN_PAYROLL_LOCKED,
  REOPEN_WINDOW,
  calendarDateKey,
  decideReopen,
} from './reopenBooking.ts';

const now = new Date('2026-10-13T18:00:00.000Z');
const zone = 'America/New_York';

function base(overrides: Partial<Parameters<typeof decideReopen>[0]> = {}) {
  return decideReopen({
    role: 'cleaner',
    status: 'completed',
    paymentStatus: 'pending',
    payrollLockedWeek: null,
    cleanerActualPayment: null,
    completedAt: '2026-10-13T16:00:00.000Z',
    now,
    timeZone: zone,
    ...overrides,
  });
}

test('same business day is the cleaner window, not the phone timezone', () => {
  assert.equal(calendarDateKey(new Date('2026-10-14T02:30:00.000Z'), zone), '2026-10-13');
  assert.equal(base().ok, true);
});

test('a cleaner cannot undo after the business day', () => {
  const decision = base({ completedAt: '2026-10-12T15:00:00.000Z' });
  assert.equal(decision.ok, false);
  if (!decision.ok) assert.equal(decision.reason, REOPEN_WINDOW);
});

test('an owner can reopen after that day, and still cannot reopen a sealed payout', () => {
  assert.equal(base({ role: 'admin', completedAt: '2026-10-01T15:00:00.000Z' }).ok, true);
  assert.equal(base({ role: 'admin', paymentStatus: 'paid' }).ok, true);
  const locked = base({ role: 'admin', payrollLockedWeek: '2026-10-12' });
  assert.equal(locked.ok, false);
  if (!locked.ok) assert.equal(locked.reason, REOPEN_PAYROLL_LOCKED);
  const paidOut = base({ role: 'admin', cleanerActualPayment: 80 });
  assert.equal(paidOut.ok, false);
  if (!paidOut.ok) assert.equal(paidOut.reason, REOPEN_CLEANER_PAID);
});

test('a cleaner cannot undo once the customer was charged or refunded', () => {
  const paid = base({ paymentStatus: 'paid' });
  assert.equal(paid.ok, false);
  if (!paid.ok) assert.equal(paid.reason, REOPEN_CUSTOMER_PAID);
  assert.equal(base({ paymentStatus: 'partial' }).ok, true);
});
