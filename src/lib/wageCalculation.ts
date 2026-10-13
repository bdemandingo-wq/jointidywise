import { teamCleanerPay } from './teamJobs.ts';
/**
 * Shared wage calculation — the READ side counterpart to lib/cleanerPay.ts.
 *
 * Every surface that DISPLAYS a cleaner's pay calls resolveCleanerPay():
 * - Admin Payroll page (PayrollPage.calcWage)
 * - Cleaner Portal Earnings (CleanerEarnings)
 * - Cleaner Portal job cards (MyJobCard, AvailableJobCard)
 *
 * RULE: this file mirrors the payout engine
 * (supabase/functions/_shared/payroll-period-process.ts) exactly — same
 * priority order, same computed fallback. That engine is what actually pays
 * cleaners, so anything shown to a cleaner or to payroll must be what it
 * would pay. There is deliberately no fourth answer.
 *
 * Priority (identical to payroll-period-process.ts:calcWage):
 *   1. booking_team_assignments.pay_share, when this is a real team (2+ cleaners)
 *   2. booking.cleaner_pay_expected for flat, percentage, or pay_locked rows
 *   3. booking.cleaner_actual_payment      (legacy admin override, incl. $0)
 *   4. hourly: staff/booking rate × payable hours (see getActualHours)
 *
 * Hourly pay is recomputed from the rate and payable hours even when an older
 * snapshot is stored. Those snapshots were written with a different hours
 * rule (raw clock, or a hardcoded 5h), which is why the same job showed
 * $0.05, $40, $50, $100 and $125 depending on the screen. A solo assignment's
 * pay_share is a copy of that snapshot, so it does not override hourly pay.
 * A team member's pay_share still does.
 *
 * The deviations from a naive clock reading are documented on getActualHours().
 *
 * NOTE: staff.percentage_rate is intentionally NOT read here. The payout
 * engine selects that column but never uses it in its wage math, so a
 * percentage_rate cleaner with no booking-level wage really is paid from
 * base_wage/hourly_rate (or $0). Adding it here would make the screens
 * promise money payroll does not pay. Fix the engine first if that's wrong.
 */

export interface WageBooking {
  cleaner_actual_payment: number | null;
  cleaner_pay_expected: number | null;
  cleaner_wage: number | null;
  cleaner_wage_type: string | null;
  cleaner_checkin_at: string | null;
  cleaner_checkout_at: string | null;
  cleaner_override_hours: number | null;
  duration: number;
  total_amount: number;
  subtotal?: number | null;
  discount_amount?: number | null;
  pay_locked?: boolean | null;
  /** Team jobs (see teamJobs.ts). Absent or 1 = single cleaner, unchanged. */
  cleaners_needed?: number | null;
  pay_per_cleaner?: number | string | null;
  pay_type?: string | null;
}

export interface WageStaff {
  base_wage: number | null;
  hourly_rate: number | null;
  default_hours: number | null;
  /**
   * A percentage of the booking, used ONLY as a last resort and ONLY for a
   * solo booking — see computePayFromDefaults. Added because a cleaner
   * configured with this and nothing else resolved to a wage of exactly zero.
   */
  percentage_rate?: number | null;
}

export interface WageResult {
  calculatedPay: number;
  hoursWorked: number;
  wageType: string;
  wageRate: number;
  isMissingPay: boolean;
}

/**
 * Org limits on how many hours one job can pay for.
 * Defaults match payroll_settings (hours_overage_cap_ratio 1.25,
 * hours_absolute_ceiling 12) and complete_assigned_booking.
 */
export interface HourCaps {
  overageCapRatio?: number | null;
  absoluteCeiling?: number | null;
}

export const DEFAULT_HOURS_OVERAGE_CAP_RATIO = 1.25;
export const DEFAULT_HOURS_ABSOLUTE_CEILING = 12;

export function hourCapsOrDefault(caps?: HourCaps | null): { overageCapRatio: number; absoluteCeiling: number } {
  const ratio = Number(caps?.overageCapRatio);
  const ceiling = Number(caps?.absoluteCeiling);
  return {
    overageCapRatio: Number.isFinite(ratio) && ratio > 0 ? ratio : DEFAULT_HOURS_OVERAGE_CAP_RATIO,
    absoluteCeiling: Number.isFinite(ceiling) && ceiling > 0 ? ceiling : DEFAULT_HOURS_ABSOLUTE_CEILING,
  };
}

/**
 * Clock hours bounded by the booking and the org's payroll settings.
 *
 * Floor at the scheduled length so a few seconds between clock-in and
 * clock-out still pays the job that was booked. Then apply the existing
 * overage multiplier (scheduled × ratio) and the absolute ceiling. A separate
 * "minimum hours" setting is unnecessary: the booking duration is the minimum,
 * and the two settings already on Payroll are the maximum.
 *
 * If the ceiling sits below the scheduled length, the ceiling wins.
 * No scheduled length (duration 0): pay the clock, capped by the ceiling only.
 */
export function clampClockHours(
  clockHours: number,
  scheduledHours: number | null,
  caps?: HourCaps | null,
): number {
  const { overageCapRatio, absoluteCeiling } = hourCapsOrDefault(caps);
  if (scheduledHours != null && scheduledHours > 0) {
    const upper = Math.min(scheduledHours * overageCapRatio, absoluteCeiling);
    const floor = Math.min(scheduledHours, upper);
    return Math.min(Math.max(clockHours, floor), upper);
  }
  return Math.min(Math.max(clockHours, 0), absoluteCeiling);
}

/** True when both timestamps parse and checkout is strictly after check-in. */
export function hasValidClock(booking: WageBooking): boolean {
  if (!booking.cleaner_checkin_at || !booking.cleaner_checkout_at) return false;
  const checkin = new Date(booking.cleaner_checkin_at).getTime();
  const checkout = new Date(booking.cleaner_checkout_at).getTime();
  return Number.isFinite(checkin) && Number.isFinite(checkout) && checkout > checkin;
}

/**
 * Hours this job pays for.
 *
 * 1. A valid clock, floored at the booking duration and capped by the org's
 *    overage multiplier and hours ceiling (clampClockHours).
 * 2. An explicit cleaner_override_hours, including 0, when there is no clock.
 * 3. The booking duration.
 * 4. staff.default_hours, only when the booking has no duration.
 *
 * Mirrors payroll-period-process.ts:getActualHours, including its `!= null`
 * fallback — an explicit override of 0 does not fall through to default_hours.
 *
 * staff.default_hours (often 5) used to beat a 120-minute booking, and a
 * clock of a few seconds used to pay a few cents. The booked length is the
 * minimum once someone has clocked; the org's overage cap and ceiling are
 * the maximum. default_hours is only the last resort.
 */
export function getActualHours(
  booking: WageBooking,
  staff?: WageStaff | null,
  caps?: HourCaps | null,
): number {
  const durationHours = Number(booking.duration) > 0 ? Number(booking.duration) / 60 : null;
  const fallback = booking.cleaner_override_hours != null
    ? Number(booking.cleaner_override_hours)
    : durationHours != null
      ? durationHours
      : staff?.default_hours != null
        ? Number(staff.default_hours)
        : 0;

  if (booking.cleaner_checkin_at && booking.cleaner_checkout_at) {
    const checkin = new Date(booking.cleaner_checkin_at).getTime();
    const checkout = new Date(booking.cleaner_checkout_at).getTime();

    if (!Number.isFinite(checkin) || !Number.isFinite(checkout) || checkout <= checkin) {
      console.warn(
        `[wageCalculation] Invalid check-in/out pair (checkin=${booking.cleaner_checkin_at}, ` +
        `checkout=${booking.cleaner_checkout_at}). Falling back to override/duration hours.`
      );
      return fallback;
    }

    const clockHours = (checkout - checkin) / (1000 * 60 * 60);
    return clampClockHours(clockHours, durationHours, caps);
  }
  return fallback;
}

/**
 * Hourly rate for a booking.
 *
 * A number saved on the booking (Cleaner Wages → Rate, or the booking form)
 * is a per-job override. Otherwise the staff record's hourly_rate — the
 * field Add/Edit Staff writes. base_wage is a legacy owner-only column and
 * must not hide hourly_rate; that split is what showed $20/hr on a job card
 * while Cleaner Wages used the cleaner's $25/hr.
 */
export function resolveWageRate(booking: WageBooking, staff?: WageStaff | null): number {
  if (booking.cleaner_wage != null) return Number(booking.cleaner_wage);
  if (staff?.hourly_rate != null) return Number(staff.hourly_rate);
  if (staff?.base_wage != null) return Number(staff.base_wage);
  return 0;
}

/**
 * Net revenue a percentage wage is taken from — the price actually charged.
 * Mirrors payroll-period-process.ts:bookingNetRevenue (nullish, not falsy —
 * a subtotal of 0 means 0, it does not fall through to total_amount).
 */
function bookingNetRevenue(booking: WageBooking): number {
  // subtotal is PRE-discount; total_amount is POST-discount. The old form,
  // `(subtotal ?? total_amount) - discount_amount`, only held when subtotal
  // was populated — and nothing in the app ever populates it. BookingStepper
  // writes total_amount = finalPrice, which is already
  // `baseAmount - discountAmount`, and omits subtotal entirely, so the
  // fallback subtracted the discount a second time and underpaid percentage
  // cleaners by exactly (wageRate / 100) * discount_amount.
  //
  // Pay is on the discounted amount — the price actually charged. That
  // matches the snapshot path, which is what nearly every booking uses:
  // BookingStepper computes cleaner_pay_expected from finalPrice. Paying
  // pre-discount here would have introduced a second convention for the
  // fallback path only.
  //
  // Must stay identical to bookingNetRevenue in
  // supabase/functions/_shared/payroll-period-process.ts — that copy is the
  // one that actually pays people.
  if (booking.subtotal != null) {
    return Number(booking.subtotal) - Number(booking.discount_amount ?? 0);
  }
  return Number(booking.total_amount ?? 0);
}

/**
 * Compute pay from rate/type (used ONLY as fallback when no snapshot exists).
 * Mirrors payroll-period-process.ts:calculateBookingWage step 3 — nullish
 * coalescing on the rate (an explicit wage of 0 means 0) and a case-insensitive
 * wage type, so 'Flat'/'Percentage' from older rows resolve the same way.
 */
function computePayFromDefaults(
  booking: WageBooking,
  staff?: WageStaff | null,
  teamSize?: number,
  caps?: HourCaps | null,
): { pay: number; wageType: string; wageRate: number } {
  const wageType = (booking.cleaner_wage_type || 'hourly').toLowerCase();
  const hoursWorked = getActualHours(booking, staff, caps);

  /**
   * The percentage-only rescue.
   *
   * The chain below is `cleaner_wage ?? base_wage ?? hourly_rate ?? 0`, and
   * percentage_rate was never in it. A cleaner configured with a percentage
   * and no hourly rate therefore resolved to a rate of 0 and a wage of $0.00
   * — and because this file is mirrored by the payout engine, that is what
   * they would actually have been paid. One of five staff on the live org is
   * configured exactly that way.
   *
   * SOLO ONLY, and that restriction is the whole safety of this change.
   * BookingStepper.tsx:1195 writes pay_share as
   * `(jobTotal * percentage_rate / 100) / teamSize` — it DIVIDES by the team.
   * This function has no team context of its own, so applying a percentage
   * here without knowing the team size would give every member of a
   * three-person team the full percentage and pay out 300% of the booking.
   * Failing to pay is bad; overpaying three times over is worse, and silent.
   *
   * So the caller must state that the booking is solo. `teamSize === 1` is
   * the only value that opts in: undefined means "caller does not know", and
   * an unknown team is treated as a team. Behaviour is unchanged for every
   * existing caller until it passes the argument.
   *
   * Percentage of NET REVENUE, via bookingNetRevenue — not a new base. That
   * helper already carries this project's ruling that pay is on the
   * discounted amount actually charged, and it already backs the
   * wageType === 'percentage' branch below. Introducing a second convention
   * for the rescue path is exactly the mistake that produced the
   * double-subtracted discount this file documents.
   */
  const isSolo = teamSize === 1;
  const noExplicitRate =
    booking.cleaner_wage == null &&
    staff?.base_wage == null &&
    staff?.hourly_rate == null;
  const pct = staff?.percentage_rate;
  const rescueByPercentage =
    isSolo && noExplicitRate && pct != null && Number(pct) > 0;

  if (rescueByPercentage) {
    return {
      pay: Math.round((Number(pct) / 100) * bookingNetRevenue(booking) * 100) / 100,
      /* Reported as 'percentage' so the caller can label the basis honestly —
         it is not an hourly wage that happened to work out. */
      wageType: 'percentage',
      wageRate: Number(pct),
    };
  }

  const wageRate = resolveWageRate(booking, staff);

  let pay = 0;
  if (wageType === 'flat') {
    pay = wageRate;
  } else if (wageType === 'percentage') {
    pay = (wageRate / 100) * bookingNetRevenue(booking);
  } else {
    // hourly
    pay = wageRate * hoursWorked;
  }

  // Rounded to cents for display. The engine leaves this unrounded and rounds
  // at the payout total, so this can differ from a payout line by <½¢.
  return { pay: Math.round(pay * 100) / 100, wageType, wageRate };
}

/**
 * Calculate the wage for a single booking.
 *
 * Hourly (not pay_locked): rate × payable hours. A stored snapshot is ignored
 * because older snapshots used a different hours rule.
 * Flat / percentage / pay_locked: cleaner_pay_expected, then
 * cleaner_actual_payment, then a fresh computation.
 * cleaner_actual_payment (including $0) also wins for hourly when it is set.
 */
export function calculateBookingWage(
  booking: WageBooking,
  staff?: WageStaff | null,
  teamSize?: number,
  caps?: HourCaps | null,
): WageResult {
  const hoursWorked = getActualHours(booking, staff, caps);
  const wageType = (booking.cleaner_wage_type || 'hourly').toLowerCase();
  const wageRate = resolveWageRate(booking, staff);
  // Hourly dollars are rate × payable hours. A stored cleaner_pay_expected
  // was often written by an older rule (raw seconds, or duration × a different
  // rate) and is what made Earnings, the job card, and Cleaner Wages disagree.
  // Flat, percentage, and pay_locked rows still trust the snapshot.
  const trustSnapshot = wageType !== 'hourly' || booking.pay_locked === true;

  if (trustSnapshot && booking.cleaner_pay_expected != null) {
    return {
      calculatedPay: Number(booking.cleaner_pay_expected),
      hoursWorked,
      wageType,
      wageRate,
      isMissingPay: false,
    };
  }

  // Explicit admin override, including $0. Beats a stale hourly snapshot.
  if (booking.cleaner_actual_payment != null) {
    return {
      calculatedPay: Number(booking.cleaner_actual_payment),
      hoursWorked,
      wageType: 'actual',
      wageRate: Number(booking.cleaner_actual_payment),
      isMissingPay: false,
    };
  }

  if (!trustSnapshot) {
    const pay = Math.round(wageRate * hoursWorked * 100) / 100;
    if (wageRate === 0 && pay === 0) {
      console.warn(
        "[wageCalculation] No wage configured — pay computed as $0. " +
        "Set cleaner_wage on the booking or hourly_rate on the staff record."
      );
    }
    return {
      calculatedPay: pay,
      hoursWorked,
      wageType,
      wageRate,
      isMissingPay: wageRate === 0 && pay === 0,
    };
  }

  // Flat / percentage with no snapshot: compute from defaults.
  const fallback = computePayFromDefaults(booking, staff, teamSize, caps);

  // If everything fell through to zero — no booking-level wage, no staff
  // default — surface a console warning so admin notices instead of just
  // seeing $0 next to the cleaner's name in payroll. Helps catch missing
  // staff config before it shows up as a complaint.
  if (fallback.wageRate === 0 && fallback.pay === 0) {
    console.warn(
      "[wageCalculation] No wage configured — pay computed as $0. " +
      "Set cleaner_wage on the booking or base_wage/hourly_rate on the staff record."
    );
  }

  return {
    calculatedPay: fallback.pay,
    hoursWorked,
    wageType: fallback.wageType,
    wageRate: fallback.wageRate,
    isMissingPay: true, // Flag: this booking has no saved pay snapshot
  };
}

/** Which input the resolved number came from. */
export type PaySource = 'pay_share' | 'pay_expected' | 'actual_payment' | 'computed';

export interface CleanerPayResult extends WageResult {
  /** Where the number came from — drives the label a cleaner sees. */
  source: PaySource;
  /**
   * True when the number is a stored snapshot rather than a live computation,
   * i.e. exactly what the payout engine will pay. Computed pay is an estimate
   * because the rate/hours behind it can still change before payroll runs.
   */
  isExact: boolean;
}

/**
 * THE read-side resolver. Every surface that shows a cleaner's pay calls this,
 * so a job card, the earnings page, and payroll can never disagree.
 *
 * Mirrors payroll-period-process.ts:calcWage. Team pay_share wins. Hourly
 * solo pay is rate × payable hours, not a stale snapshot or a copied share.
 *
 * @param payShare this cleaner's booking_team_assignments.pay_share, when the
 *   caller has it. Omit for surfaces with no assignment row (e.g. an
 *   unclaimed job), which is not the same as a pay_share of 0.
 * @param teamSize how many cleaners are on this booking. Pass 1 for solo.
 *   Omitting it keeps pay_share in force, because an unknown team is treated
 *   as a team.
 * @param caps org hours_overage_cap_ratio and hours_absolute_ceiling.
 *   Omitted values use the payroll_settings defaults (1.25 and 12).
 */
export function resolveCleanerPay(
  booking: WageBooking,
  staff?: WageStaff | null,
  payShare?: number | null,
  /**
   * How many cleaners are on this booking. Pass 1 for a solo booking to allow
   * the percentage-only rescue in computePayFromDefaults, and so a solo
   * pay_share (a copy of the booking snapshot) does not freeze an old hourly
   * amount. Omit it if you do not know, and an unknown team is treated as a
   * team: pay_share still wins.
   */
  teamSize?: number,
  caps?: HourCaps | null,
): CleanerPayResult {
  const base = calculateBookingWage(booking, staff, teamSize, caps);
  const wageType = (booking.cleaner_wage_type || 'hourly').toLowerCase();
  const hourly = wageType === 'hourly';
  // Solo pay_share is written as a copy of cleaner_pay_expected. Honoring it
  // for hourly kept the old $0.05 / $50 snapshot on screen after the hours
  // rule changed. A real team (2+) still pays each member their share.
  const soloHourly = hourly && teamSize === 1 && booking.pay_locked !== true;

  if (payShare != null && Number(payShare) > 0 && !soloHourly) {
    return { ...base, calculatedPay: Number(payShare), source: 'pay_share', isExact: true };
  }

  // Team job with owner-set per-cleaner pay: every assigned cleaner gets it
  // (flat) or rate × their own hours (hourly). Solo bookings skip this.
  const teamPay = teamCleanerPay(booking, base.hoursWorked);
  if (teamPay != null) {
    const teamHourly = booking.pay_type === 'hourly';
    return {
      ...base,
      calculatedPay: teamPay,
      wageType: teamHourly ? 'hourly' : 'flat',
      wageRate: Number(booking.pay_per_cleaner),
      isMissingPay: false,
      source: 'computed',
      isExact: teamHourly ? hasValidClock(booking) : true,
    };
  }

  if (booking.pay_locked === true && booking.cleaner_pay_expected != null) {
    return { ...base, source: 'pay_expected', isExact: true };
  }
  if (!hourly && booking.cleaner_pay_expected != null) {
    return { ...base, source: 'pay_expected', isExact: true };
  }
  if (booking.cleaner_actual_payment != null) {
    return { ...base, source: 'actual_payment', isExact: true };
  }

  // Hourly with a finished clock is the amount payroll will pay. Before
  // clock-out the same formula is an estimate (duration, until the clock
  // moves it up to the cap).
  return { ...base, source: 'computed', isExact: hasValidClock(booking) };
}

/**
 * Human-readable explanation of a resolved amount, for the cleaner portal.
 * Kept next to the resolver so the wording can't drift from the logic.
 */
export function describeCleanerPay(result: CleanerPayResult): string {
  switch (result.source) {
    case 'pay_share':
      return 'Assigned pay';
    case 'pay_expected':
    case 'actual_payment':
      return 'Confirmed';
    default:
      if (result.wageRate === 0) return 'TBD';
      if (result.wageType === 'flat') return 'Flat rate';
      if (result.wageType === 'percentage') return `${result.wageRate}% of job`;
      return `$${result.wageRate}/hr × ${result.hoursWorked.toFixed(1)}hrs`;
  }
}
