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
 *   1. booking_team_assignments.pay_share  (per-cleaner, > 0)
 *   2. booking.cleaner_pay_expected        (booking-level snapshot)
 *   3. booking.cleaner_actual_payment      (legacy admin override, incl. $0)
 *   4. computed from wage type / rate / hours
 *
 * The ONE deliberate deviation is documented on getActualHours() below.
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
 * Get actual hours worked from check-in/out timestamps,
 * falling back to override → booking duration → default hours.
 *
 * Mirrors payroll-period-process.ts:getActualHours, including its `!= null`
 * fallback chain — an explicit override of 0 hours means zero, it does not
 * fall through to default_hours.
 *
 * DELIBERATE DEVIATION from the engine: the guard below. The engine happily
 * returns NaN or a negative number for an invalid or reversed check-in/out
 * pair, which cascades into negative pay. This only differs from the engine
 * on corrupt data, where the engine's answer is not a number anyone wants
 * paid. The engine should get the same guard — it lives in a Lovable-owned
 * file, so it has to be changed there.
 *
 * Second deviation: booking duration beats staff.default_hours. The profile
 * default is 5h, so a 120-minute job with no clock was displayed as 5.0h.
 * complete_assigned_booking pays from duration in that case and never reads
 * the profile default. An explicit override still wins. default_hours is
 * only used when the booking has no duration.
 */
export function getActualHours(booking: WageBooking, staff?: WageStaff | null): number {
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

    // Reject invalid Date.parse results (yields NaN) and reversed pairs
    // (checkout earlier than checkin — usually data-entry error or clock
    // drift on the staff app). Either would otherwise be silently turned
    // into negative or NaN pay.
    if (!Number.isFinite(checkin) || !Number.isFinite(checkout) || checkout <= checkin) {
      console.warn(
        `[wageCalculation] Invalid check-in/out pair (checkin=${booking.cleaner_checkin_at}, ` +
        `checkout=${booking.cleaner_checkout_at}). Falling back to override/default hours.`
      );
      return fallback;
    }

    return (checkout - checkin) / (1000 * 60 * 60);
  }
  return fallback;
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
): { pay: number; wageType: string; wageRate: number } {
  const wageType = (booking.cleaner_wage_type || 'hourly').toLowerCase();
  const hoursWorked = getActualHours(booking, staff);

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

  const wageRate = Number(booking.cleaner_wage ?? staff?.base_wage ?? staff?.hourly_rate ?? 0);

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
 * Priority:
 * 1. cleaner_pay_expected (SINGLE SOURCE OF TRUTH — if set, use it)
 * 2. cleaner_actual_payment (legacy override — treat as expected pay)
 * 3. Fallback: compute from wage type/rate/hours (only when no snapshot exists)
 */
export function calculateBookingWage(booking: WageBooking, staff?: WageStaff | null, teamSize?: number): WageResult {
  const hoursWorked = getActualHours(booking, staff);
  const wageType = (booking.cleaner_wage_type || 'hourly').toLowerCase();
  const wageRate = Number(booking.cleaner_wage ?? staff?.base_wage ?? staff?.hourly_rate ?? 0);

  // 1. cleaner_pay_expected is the single source of truth
  if (booking.cleaner_pay_expected != null) {
    return {
      calculatedPay: Number(booking.cleaner_pay_expected),
      hoursWorked,
      wageType,
      wageRate,
      isMissingPay: false,
    };
  }

  // 2. Legacy: cleaner_actual_payment (explicit admin override, including $0)
  if (booking.cleaner_actual_payment != null) {
    return {
      calculatedPay: Number(booking.cleaner_actual_payment),
      hoursWorked,
      wageType: 'actual',
      wageRate: Number(booking.cleaner_actual_payment),
      isMissingPay: false,
    };
  }

  // 3. Fallback: compute from defaults (no pay snapshot exists)
  const fallback = computePayFromDefaults(booking, staff, teamSize);

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
 * Mirrors payroll-period-process.ts:calcWage — pay_share wins, then
 * calculateBookingWage (pay_expected → actual_payment → computed).
 *
 * @param payShare this cleaner's booking_team_assignments.pay_share, when the
 *   caller has it. Omit for surfaces with no assignment row (e.g. an
 *   unclaimed job), which is not the same as a pay_share of 0.
 * @param teamSize how many cleaners are on this booking. Pass 1 for solo to
 *   allow the percentage-only rescue; omitting it keeps the old behaviour.
 */
export function resolveCleanerPay(
  booking: WageBooking,
  staff?: WageStaff | null,
  payShare?: number | null,
  /**
   * How many cleaners are on this booking. Pass 1 for a solo booking to allow
   * the percentage-only rescue in computePayFromDefaults; omit it if you do
   * not know, and an unknown team is treated as a team.
   */
  teamSize?: number,
): CleanerPayResult {
  const base = calculateBookingWage(booking, staff, teamSize);

  // 1. Per-cleaner pay share. Note `> 0`, matching the engine: a pay_share of
  //    0 or null means "not set for this cleaner", not "this cleaner earns $0".
  if (payShare != null && Number(payShare) > 0) {
    return { ...base, calculatedPay: Number(payShare), source: 'pay_share', isExact: true };
  }

  // 2/3. Booking-level snapshots, resolved by calculateBookingWage above.
  if (booking.cleaner_pay_expected != null) {
    return { ...base, source: 'pay_expected', isExact: true };
  }
  if (booking.cleaner_actual_payment != null) {
    return { ...base, source: 'actual_payment', isExact: true };
  }

  // 4. Computed from rate/hours — an estimate until a snapshot is written.
  return { ...base, source: 'computed', isExact: false };
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
