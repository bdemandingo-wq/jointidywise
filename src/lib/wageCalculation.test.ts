// @ts-ignore - vitest types available at test runtime
import { describe, it, expect } from 'vitest';
import {
  calculateBookingWage,
  getActualHours,
  resolveCleanerPay,
  type WageBooking,
  type WageStaff,
} from '@/lib/wageCalculation';

const makeBooking = (overrides: Partial<WageBooking> = {}): WageBooking => ({
  cleaner_actual_payment: null,
  cleaner_pay_expected: null,
  cleaner_wage: null,
  cleaner_wage_type: null,
  cleaner_checkin_at: null,
  cleaner_checkout_at: null,
  cleaner_override_hours: null,
  duration: 120, // 2 hours in minutes
  total_amount: 200,
  ...overrides,
});

const makeStaff = (overrides: Partial<WageStaff> = {}): WageStaff => ({
  base_wage: null,
  hourly_rate: 25,
  default_hours: null,
  ...overrides,
});

describe('getActualHours', () => {
  it('floors a long clock at the booking and caps it at the overage multiplier', () => {
    const booking = makeBooking({
      cleaner_checkin_at: '2026-02-10T09:00:00Z',
      cleaner_checkout_at: '2026-02-10T12:30:00Z',
      duration: 120,
    });
    // 3.5h clock, 2h booked, default cap 1.25 → 2.5h
    expect(getActualHours(booking)).toBeCloseTo(2.5);
  });

  it('uses the raw clock when the booking has no duration', () => {
    const booking = makeBooking({
      cleaner_checkin_at: '2026-02-10T09:00:00Z',
      cleaner_checkout_at: '2026-02-10T12:30:00Z',
      duration: 0,
    });
    expect(getActualHours(booking)).toBeCloseTo(3.5);
  });

  it('falls back to override hours', () => {
    const booking = makeBooking({ cleaner_override_hours: 4 });
    expect(getActualHours(booking)).toBe(4);
  });

  it('uses booking duration before the staff profile default of 5h', () => {
    const booking = makeBooking({ duration: 120 });
    const staff = makeStaff({ default_hours: 5 });
    expect(getActualHours(booking, staff)).toBe(2);
  });

  it('falls back to staff default_hours when the booking has no duration', () => {
    const booking = makeBooking({ duration: 0 });
    const staff = makeStaff({ default_hours: 6 });
    expect(getActualHours(booking, staff)).toBe(6);
  });

  it('falls back to duration in hours', () => {
    const booking = makeBooking({ duration: 180 });
    expect(getActualHours(booking)).toBe(3);
  });

  it('a short clock is floored at the booked length, not the override', () => {
    const booking = makeBooking({
      cleaner_checkin_at: '2026-02-10T08:00:00Z',
      cleaner_checkout_at: '2026-02-10T09:30:00Z',
      cleaner_override_hours: 5,
      duration: 240,
    });
    const staff = makeStaff({ default_hours: 8 });
    // 1.5h clock on a 4h booking → 4h. Cap would allow 5h, but the clock is under the floor.
    expect(getActualHours(booking, staff)).toBeCloseTo(4);
  });

  it('an 18-second clock on a 120-minute booking pays 2.0h', () => {
    const booking = makeBooking({
      cleaner_checkin_at: '2026-02-10T08:00:00Z',
      cleaner_checkout_at: '2026-02-10T08:00:18Z',
      duration: 120,
    });
    expect(getActualHours(booking)).toBeCloseTo(2);
  });
});

describe('calculateBookingWage', () => {
  it('uses explicit actual_payment when set', () => {
    const booking = makeBooking({ cleaner_actual_payment: 100 });
    const result = calculateBookingWage(booking, makeStaff());
    expect(result.calculatedPay).toBe(100);
    expect(result.wageType).toBe('actual');
  });

  it('respects actual_payment of 0 as explicit override', () => {
    const booking = makeBooking({ cleaner_actual_payment: 0, cleaner_wage: 30, cleaner_wage_type: 'hourly' });
    const result = calculateBookingWage(booking);
    // $0 is a valid explicit admin override — should be respected
    expect(result.calculatedPay).toBe(0);
    expect(result.wageType).toBe('actual');
  });

  it('recomputes hourly pay instead of trusting a stale snapshot', () => {
    const booking = makeBooking({ cleaner_pay_expected: 0.05, cleaner_wage: 25, cleaner_wage_type: 'hourly', duration: 120 });
    const result = calculateBookingWage(booking, makeStaff());
    expect(result.calculatedPay).toBe(50);
    expect(result.hoursWorked).toBeCloseTo(2);
    expect(result.wageRate).toBe(25);
    expect(result.isMissingPay).toBe(false);
  });

  it('keeps a locked hourly snapshot', () => {
    const booking = makeBooking({
      cleaner_pay_expected: 150,
      cleaner_wage: 30,
      cleaner_wage_type: 'hourly',
      pay_locked: true,
    });
    const result = calculateBookingWage(booking, makeStaff());
    expect(result.calculatedPay).toBe(150);
    expect(result.wageRate).toBe(30);
  });

  it('does not flag missing pay when the staff hourly rate can price the job', () => {
    const booking = makeBooking({ cleaner_wage: null, cleaner_pay_expected: null });
    const result = calculateBookingWage(booking, makeStaff());
    expect(result.calculatedPay).toBe(50);
    expect(result.isMissingPay).toBe(false);
  });

  it('calculates hourly pay from timestamps', () => {
    const booking = makeBooking({
      cleaner_checkin_at: '2026-02-10T09:00:00Z',
      cleaner_checkout_at: '2026-02-10T11:00:00Z', // 2 hours
      cleaner_wage: 50,
      cleaner_wage_type: 'hourly',
    });
    const result = calculateBookingWage(booking);
    expect(result.calculatedPay).toBe(100); // 2h × $50
    expect(result.hoursWorked).toBeCloseTo(2);
  });

  it('calculates flat rate pay', () => {
    const booking = makeBooking({ cleaner_wage: 150, cleaner_wage_type: 'flat' });
    const result = calculateBookingWage(booking);
    expect(result.calculatedPay).toBe(150);
  });

  it('calculates percentage pay', () => {
    const booking = makeBooking({
      cleaner_wage: 50, // 50%
      cleaner_wage_type: 'percentage',
      total_amount: 200,
    });
    const result = calculateBookingWage(booking);
    expect(result.calculatedPay).toBe(100); // 50% of $200
  });

  it('falls back to staff hourly_rate when booking wage is null', () => {
    const booking = makeBooking({
      cleaner_checkin_at: '2026-02-10T09:00:00Z',
      cleaner_checkout_at: '2026-02-10T11:00:00Z',
    });
    const staff = makeStaff({ hourly_rate: 30 });
    const result = calculateBookingWage(booking, staff);
    expect(result.calculatedPay).toBe(60); // 2h × $30
  });

  it('returns 0 when no wage info exists', () => {
    const booking = makeBooking();
    const staff = makeStaff({ hourly_rate: null, base_wage: null });
    const result = calculateBookingWage(booking, staff);
    expect(result.calculatedPay).toBe(0);
  });

  it('portal and payroll get identical results for same inputs', () => {
    const booking = makeBooking({
      cleaner_checkin_at: '2026-02-10T08:00:00Z',
      cleaner_checkout_at: '2026-02-10T11:30:00Z',
      cleaner_wage: 25,
      cleaner_wage_type: 'hourly',
    });
    const staff = makeStaff({ hourly_rate: 25 });

    // Simulate portal call
    const portalResult = calculateBookingWage(booking, staff);
    // Simulate payroll call (exact same function now)
    const payrollResult = calculateBookingWage(booking, staff);

    expect(portalResult.calculatedPay).toBe(payrollResult.calculatedPay);
    expect(portalResult.hoursWorked).toBe(payrollResult.hoursWorked);
  });

  // These lock calculateBookingWage to payroll-period-process.ts, the engine
  // that actually pays cleaners. If one changes, change both.
  describe('parity with the payout engine', () => {
    it('treats an explicit wage of 0 as 0, not "unset"', () => {
      // Engine uses `??`, so cleaner_wage=0 must NOT fall through to base_wage.
      const booking = makeBooking({ cleaner_wage: 0, cleaner_wage_type: 'flat' });
      const staff = makeStaff({ base_wage: 80, hourly_rate: 25 });
      expect(calculateBookingWage(booking, staff).calculatedPay).toBe(0);
    });

    it('matches wage types case-insensitively', () => {
      const booking = makeBooking({ cleaner_wage: 150, cleaner_wage_type: 'Flat' });
      expect(calculateBookingWage(booking).calculatedPay).toBe(150);
    });

    it('takes a percentage of net revenue, not the gross total', () => {
      const booking = makeBooking({
        cleaner_wage: 50,
        cleaner_wage_type: 'percentage',
        subtotal: 200,
        total_amount: 180,
        discount_amount: 20,
      });
      // 50% of (200 - 20)
      expect(calculateBookingWage(booking).calculatedPay).toBe(90);
    });

    it('does not subtract the discount twice when subtotal is null', () => {
      // The shape every booking this app creates actually has: BookingStepper
      // writes total_amount = finalPrice (already discounted) and never writes
      // subtotal. total_amount is therefore ALREADY net — subtracting
      // discount_amount again underpaid by (rate/100) * discount_amount.
      const booking = makeBooking({
        cleaner_wage: 50,
        cleaner_wage_type: 'percentage',
        subtotal: null,
        total_amount: 180,
        discount_amount: 20,
      });
      // 50% of 180 — NOT 50% of (180 - 20) = 80.
      expect(calculateBookingWage(booking).calculatedPay).toBe(90);
    });

    it('honours an override of 0 hours instead of falling back to defaults', () => {
      const booking = makeBooking({ cleaner_override_hours: 0 });
      const staff = makeStaff({ default_hours: 6 });
      expect(getActualHours(booking, staff)).toBe(0);
    });

    it('prefers hourly_rate over base_wage as the staff rate', () => {
      const booking = makeBooking({ duration: 120 });
      const staff = makeStaff({ base_wage: 30, hourly_rate: 25 });
      expect(calculateBookingWage(booking, staff).calculatedPay).toBe(50); // 2h × $25
      expect(calculateBookingWage(booking, staff).wageRate).toBe(25);
    });

    it('ignores staff.percentage_rate, because the engine does', () => {
      // A percentage_rate cleaner with no other rate really is paid $0 by the
      // payout engine. The screens must not promise money payroll won't send.
      const booking = makeBooking();
      const staff = { ...makeStaff({ hourly_rate: null }), percentage_rate: 40 } as WageStaff;
      expect(calculateBookingWage(booking, staff).calculatedPay).toBe(0);
    });
  });
});

describe('resolveCleanerPay', () => {
  it('pay_share beats every booking-level value', () => {
    const booking = makeBooking({ cleaner_pay_expected: 120, cleaner_actual_payment: 200 });
    const result = resolveCleanerPay(booking, makeStaff(), 90);
    expect(result.calculatedPay).toBe(90);
    expect(result.source).toBe('pay_share');
    expect(result.isExact).toBe(true);
  });

  it('a non-primary team member sees their own share, not the primary\'s payment', () => {
    // The regression this resolver exists to prevent: BookingDialogs writes the
    // PRIMARY cleaner's pay to booking.cleaner_actual_payment, so reading that
    // first showed every team member a coworker's number.
    const booking = makeBooking({ cleaner_actual_payment: 300 }); // primary's pay
    expect(resolveCleanerPay(booking, makeStaff(), 75).calculatedPay).toBe(75);
  });

  it('ignores a pay_share of 0 or null as "not set for this cleaner"', () => {
    const booking = makeBooking({ cleaner_pay_expected: 120 });
    expect(resolveCleanerPay(booking, makeStaff(), 0).calculatedPay).toBe(120);
    expect(resolveCleanerPay(booking, makeStaff(), null).calculatedPay).toBe(120);
  });

  it('lets an explicit actual payment beat a stale hourly snapshot', () => {
    const booking = makeBooking({ cleaner_pay_expected: 120, cleaner_actual_payment: 200 });
    const result = resolveCleanerPay(booking, makeStaff());
    expect(result.calculatedPay).toBe(200);
    expect(result.source).toBe('actual_payment');
  });

  it('a solo hourly pay_share does not freeze the old snapshot', () => {
    const booking = makeBooking({
      cleaner_pay_expected: 0.05,
      cleaner_wage: null,
      cleaner_wage_type: 'hourly',
      duration: 120,
      cleaner_checkin_at: '2026-02-10T08:00:00.000Z',
      cleaner_checkout_at: '2026-02-10T08:00:18.000Z',
    });
    const staff = makeStaff({ hourly_rate: 25, base_wage: 20 });
    const result = resolveCleanerPay(booking, staff, 0.05, 1);
    expect(result.wageRate).toBe(25);
    expect(result.hoursWorked).toBeCloseTo(2);
    expect(result.calculatedPay).toBe(50);
    expect(result.source).toBe('computed');
  });

  it('a 3.6h clock on a 2h booking pays 2.5h at the staff rate', () => {
    const booking = makeBooking({
      cleaner_pay_expected: 50,
      cleaner_wage_type: 'hourly',
      duration: 120,
      cleaner_checkin_at: '2026-02-10T08:00:00.000Z',
      cleaner_checkout_at: '2026-02-10T11:36:00.000Z',
    });
    const staff = makeStaff({ hourly_rate: 25, base_wage: 20 });
    const result = resolveCleanerPay(booking, staff, 50, 1);
    expect(result.hoursWorked).toBeCloseTo(2.5);
    expect(result.calculatedPay).toBe(62.5);
    expect(result.wageRate).toBe(25);
  });

  it('respects an actual_payment of $0 and reports it as exact', () => {
    const booking = makeBooking({ cleaner_actual_payment: 0, cleaner_wage: 30, cleaner_wage_type: 'hourly' });
    const result = resolveCleanerPay(booking, makeStaff());
    expect(result.calculatedPay).toBe(0);
    expect(result.source).toBe('actual_payment');
    expect(result.isExact).toBe(true);
  });

  it('flags a computed amount as an estimate', () => {
    const booking = makeBooking({ cleaner_wage: 25, cleaner_wage_type: 'hourly', duration: 120 });
    const result = resolveCleanerPay(booking, makeStaff());
    expect(result.calculatedPay).toBe(50);
    expect(result.source).toBe('computed');
    expect(result.isExact).toBe(false);
  });

  it('job card, earnings page and payroll agree on the same booking', () => {
    const booking = makeBooking({ cleaner_pay_expected: 137.5, cleaner_wage: 25, cleaner_wage_type: 'hourly' });
    const staff = makeStaff({ hourly_rate: 25, default_hours: 8 });
    const payShare = 137.5;

    const jobCard = resolveCleanerPay(booking, staff, payShare);
    const earnings = resolveCleanerPay(booking, staff, payShare);
    const payroll = resolveCleanerPay(booking, staff, payShare);

    expect(jobCard.calculatedPay).toBe(earnings.calculatedPay);
    expect(earnings.calculatedPay).toBe(payroll.calculatedPay);
    expect(jobCard.calculatedPay).toBe(137.5);
  });
});

describe('percentage-only rescue (solo bookings)', () => {
  /* A cleaner paid on percentage_rate with no hourly rate. Before this, the
     chain `cleaner_wage ?? base_wage ?? hourly_rate ?? 0` resolved them to a
     rate of 0 and a wage of $0.00 — and because the payout engine mirrors this
     file, that is what they would have been paid. */
  const percentOnly = makeStaff({
    base_wage: null,
    hourly_rate: null,
    percentage_rate: 50,
  });

  it('pays a percentage of net revenue on a solo booking', () => {
    const booking = makeBooking({ total_amount: 300 });
    const r = calculateBookingWage(booking, percentOnly, 1);
    expect(r.calculatedPay).toBe(150);
    expect(r.wageType).toBe('percentage');
    expect(r.wageRate).toBe(50);
  });

  it('still pays zero when the team size is unknown', () => {
    /* Omitting teamSize means the caller cannot vouch that this is solo, and
       an unknown team is treated as a team. Old behaviour, deliberately. */
    const booking = makeBooking({ total_amount: 300 });
    expect(calculateBookingWage(booking, percentOnly).calculatedPay).toBe(0);
  });

  it('does NOT apply on a team booking — the 300% guard', () => {
    /* BookingStepper divides the percentage by team size when it writes
       pay_share. Applying the full percentage per member here would pay out
       three times the booking. */
    const booking = makeBooking({ total_amount: 300 });
    expect(calculateBookingWage(booking, percentOnly, 3).calculatedPay).toBe(0);
  });

  it('never overrides an explicit rate', () => {
    const both = makeStaff({ hourly_rate: 25, percentage_rate: 50 });
    const booking = makeBooking({ total_amount: 300, duration: 120 });
    /* Hourly wins: 25 * 2h = 50, not 50% of 300. */
    expect(calculateBookingWage(booking, both, 1).calculatedPay).toBe(50);
  });

  it('never overrides a booking-level wage', () => {
    const booking = makeBooking({ total_amount: 300, cleaner_wage: 80, cleaner_wage_type: 'flat' });
    expect(calculateBookingWage(booking, percentOnly, 1).calculatedPay).toBe(80);
  });

  it('is still outranked by a pay_expected snapshot', () => {
    const booking = makeBooking({ total_amount: 300, cleaner_pay_expected: 99 });
    const r = resolveCleanerPay(booking, percentOnly, null, 1);
    expect(r.calculatedPay).toBe(99);
    expect(r.source).toBe('pay_expected');
    expect(r.isExact).toBe(true);
  });

  it('is outranked by pay_share, which is already team-divided', () => {
    const booking = makeBooking({ total_amount: 300 });
    const r = resolveCleanerPay(booking, percentOnly, 42, 1);
    expect(r.calculatedPay).toBe(42);
    expect(r.source).toBe('pay_share');
  });

  it('pays on the DISCOUNTED amount, not pre-discount', () => {
    /* bookingNetRevenue's existing ruling: pay is on the price actually
       charged. subtotal is pre-discount, total_amount is post. */
    const booking = makeBooking({ total_amount: 300, subtotal: 400, discount_amount: 100 });
    expect(calculateBookingWage(booking, percentOnly, 1).calculatedPay).toBe(150);
  });

  it('ignores a percentage_rate of 0', () => {
    const zero = makeStaff({ base_wage: null, hourly_rate: null, percentage_rate: 0 });
    expect(calculateBookingWage(makeBooking({ total_amount: 300 }), zero, 1).calculatedPay).toBe(0);
  });
});
