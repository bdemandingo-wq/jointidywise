import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  getActualHours,
  resolveCleanerPay,
  type WageBooking,
  type WageStaff,
} from './wageCalculation.ts';

const booking = (overrides: Partial<WageBooking> = {}): WageBooking => ({
  cleaner_actual_payment: null,
  cleaner_pay_expected: null,
  cleaner_wage: null,
  cleaner_wage_type: 'hourly',
  cleaner_checkin_at: null,
  cleaner_checkout_at: null,
  cleaner_override_hours: null,
  duration: 120,
  total_amount: 200,
  ...overrides,
});

const staff = (overrides: Partial<WageStaff> = {}): WageStaff => ({
  base_wage: 20,
  hourly_rate: 25,
  default_hours: 5,
  ...overrides,
});

describe('payable hours', () => {
  it('pays a 120-minute job clocked for 18 seconds as 2.0h at the staff rate', () => {
    const result = resolveCleanerPay(
      booking({
        cleaner_pay_expected: 0.05,
        cleaner_checkin_at: '2026-10-12T15:00:00.000Z',
        cleaner_checkout_at: '2026-10-12T15:00:18.000Z',
      }),
      staff(),
      0.05,
      1,
    );
    assert.equal(result.wageRate, 25);
    assert.ok(Math.abs(result.hoursWorked - 2) < 0.001);
    assert.equal(result.calculatedPay, 50);
  });

  it('caps a 3.6h clock on a 2h job at 2.5h under the default 1.25 overage', () => {
    const result = resolveCleanerPay(
      booking({
        cleaner_pay_expected: 50,
        cleaner_checkin_at: '2026-10-12T15:00:00.000Z',
        cleaner_checkout_at: '2026-10-12T18:36:00.000Z',
      }),
      staff(),
      50,
      1,
    );
    assert.equal(result.wageRate, 25);
    assert.ok(Math.abs(result.hoursWorked - 2.5) < 0.001);
    assert.equal(result.calculatedPay, 62.5);
  });

  it('uses a saved per-booking rate instead of the staff rate', () => {
    const result = resolveCleanerPay(
      booking({ cleaner_wage: 20 }),
      staff(),
      null,
      1,
    );
    assert.equal(result.wageRate, 20);
    assert.equal(result.calculatedPay, 40);
  });

  it('does not let base_wage hide the staff hourly rate', () => {
    const hours = getActualHours(booking(), staff());
    assert.equal(hours, 2);
    const result = resolveCleanerPay(booking(), staff(), null, 1);
    assert.equal(result.wageRate, 25);
    assert.equal(result.calculatedPay, 50);
  });

  it('honors a team pay share', () => {
    const result = resolveCleanerPay(booking({ cleaner_wage: 25 }), staff(), 30, 2);
    assert.equal(result.calculatedPay, 30);
    assert.equal(result.source, 'pay_share');
  });
});
