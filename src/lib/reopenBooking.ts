/**
 * Who may put a completed job back in progress.
 *
 * The database function reopen_assigned_booking is the enforcement. This
 * mirror decides whether the cleaner even sees Undo, and it is what the
 * tests lock. Keep the two in step.
 *
 * Reopening does not refund, charge, or send another completion text.
 * Loyalty already refuses a second credit for the same booking. Payroll
 * that has been sealed (payroll_locked_week or cleaner_actual_payment)
 * cannot be reopened by anyone — Postgres will not move that row.
 */

export type ReopenRole = 'cleaner' | 'admin';

export interface ReopenInput {
  role: ReopenRole;
  status: string;
  paymentStatus?: string | null;
  payrollLockedWeek?: string | null;
  cleanerActualPayment?: number | null;
  /** cleaner_checkout_at, else completed_at, else updated_at. */
  completedAt?: string | null;
  now: Date;
  timeZone: string;
}

export type ReopenDecision =
  | { ok: true }
  | { ok: false; reason: string };

export const REOPEN_NOT_COMPLETED = 'Only a completed job can be reopened.';
export const REOPEN_PAYROLL_LOCKED = 'This job is already in a paid payroll week. Undo that payout before reopening it.';
export const REOPEN_CLEANER_PAID = 'This job was already paid out to the cleaner. Undo that payout before reopening it.';
export const REOPEN_CUSTOMER_PAID = 'This job was already paid or refunded. Ask an owner or admin to reopen it.';
export const REOPEN_WINDOW = 'You can undo a completion until the end of the business day. Ask an owner or admin to reopen it after that.';

/** Calendar date in the business timezone, YYYY-MM-DD. */
export function calendarDateKey(instant: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timeZone || 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

export function decideReopen(input: ReopenInput): ReopenDecision {
  if (input.status !== 'completed') {
    return { ok: false, reason: REOPEN_NOT_COMPLETED };
  }
  if (input.payrollLockedWeek) {
    return { ok: false, reason: REOPEN_PAYROLL_LOCKED };
  }
  if (input.cleanerActualPayment != null && Number(input.cleanerActualPayment) > 0) {
    return { ok: false, reason: REOPEN_CLEANER_PAID };
  }
  if (input.role === 'admin') return { ok: true };

  const payment = (input.paymentStatus ?? '').toLowerCase();
  if (payment === 'paid' || payment === 'refunded') {
    return { ok: false, reason: REOPEN_CUSTOMER_PAID };
  }

  if (input.completedAt) {
    const completed = new Date(input.completedAt);
    if (!Number.isNaN(completed.getTime())) {
      const zone = input.timeZone || 'America/New_York';
      if (calendarDateKey(completed, zone) !== calendarDateKey(input.now, zone)) {
        return { ok: false, reason: REOPEN_WINDOW };
      }
    }
  }
  return { ok: true };
}
