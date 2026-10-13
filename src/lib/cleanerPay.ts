import { supabase } from '@/lib/supabase';

/**
 * The single source of truth for computing a booking's cleaner_pay_expected
 * (the payroll pay snapshot) from wage inputs. Every write site that sets
 * cleaner pay must use this so the value can never diverge between paths.
 *
 * - flat:       the wage IS the dollar amount
 * - percentage: wage% of the charged base (finalPrice / total)
 * - hourly:     wage × hours (override hours, else serviceDuration/60)
 *
 * Returns null when no wage is configured (0 / empty), which lets payroll
 * fall back to cleaner_actual_payment or the computed default.
 */
export function computeExpectedPay(
  wageType: string,
  wage: string,
  overrideHours: string,
  serviceDuration: number,
  baseAmount: number,
): number | null {
  const w = wage ? parseFloat(wage) : null;
  if (w == null || w === 0 || isNaN(w)) return null;
  if (wageType === 'flat') return w;
  if (wageType === 'percentage') return Math.round((w / 100) * baseAmount * 100) / 100;
  // hourly
  const hours = overrideHours ? parseFloat(overrideHours) : (serviceDuration / 60);
  return Math.round(w * hours * 100) / 100;
}

/**
 * Keep booking_team_assignments.pay_share in sync with a booking-level cleaner
 * pay change. Payroll (PayrollPage.calcWage, payroll-period-process) reads
 * pay_share FIRST and as a dollar amount, so a stale value silently shows the
 * wrong pay.
 *
 * Only single-cleaner bookings are touched: if the booking has 0 assignments
 * (payroll then uses cleaner_pay_expected) or 2+ (a real team, whose pay_share
 * is per-member) we leave it alone rather than clobbering it with a
 * booking-level value.
 *
 * @param staffId who the booking now belongs to (bookings.staff_id), when the
 *   caller is in a position to change it.
 *   - omitted   → pay only; the caller isn't touching the assignment's owner.
 *   - a staffId → the lone assignment is MOVED to them if it belongs to someone
 *     else. A booking whose staff_id has no assignment row still gets paid out
 *     of the booking-level snapshot, on top of the assignment holders, so the
 *     two must be reassigned together.
 *   - null (booking unassigned) → nothing is written. The pay computed for a
 *     booking with no cleaner must not land on a previous cleaner's row.
 */
export async function syncCleanerPayShare(
  bookingId: string,
  organizationId: string | null | undefined,
  expectedPay: number | null,
  staffId?: string | null,
): Promise<void> {
  // One claimed spot on an open team job is not a solo assignment. Copying
  // the booking-level snapshot onto it freezes hourly pay and overwrites the
  // flat per-cleaner amount. Missing column (migration not applied yet) keeps
  // the previous behavior instead of failing every pay save.
  const { data: teamRow, error: teamRowError } = await supabase
    .from('bookings')
    .select('cleaners_needed')
    .eq('id', bookingId)
    .maybeSingle();
  if (!teamRowError && Number(teamRow?.cleaners_needed ?? 1) > 1) return;

  let sel = supabase
    .from('booking_team_assignments')
    .select('id, staff_id')
    .eq('booking_id', bookingId);
  if (organizationId) sel = sel.eq('organization_id', organizationId);
  const { data, error } = await sel;
  if (error || !data || data.length !== 1) return; // no row, or a team → leave alone

  // Booking was unassigned: leave the existing row's owner and pay untouched
  // rather than overwriting a real cleaner's pay with a booking-level figure.
  if (staffId === null) return;

  const assignment = data[0] as { id: string; staff_id: string };
  const isReassignment = staffId != null && assignment.staff_id !== staffId;

  let upd = supabase
    .from('booking_team_assignments')
    .update(isReassignment ? { staff_id: staffId, pay_share: expectedPay } : { pay_share: expectedPay })
    // Target the row by id — the booking has exactly one, and this keeps the
    // update from depending on a staff_id that may be changing in the same call.
    .eq('id', assignment.id);
  if (organizationId) upd = upd.eq('organization_id', organizationId);
  await upd;
}
