/**
 * Team jobs: one booking that needs several cleaners.
 * Pure helpers shared by the admin form, staff cards and payroll so the
 * numbers never disagree. A booking with cleaners_needed <= 1 is a normal
 * single-cleaner job and every helper here leaves it alone.
 */
export type TeamPayType = 'flat' | 'hourly';

export interface TeamFields {
  cleaners_needed?: number | null;
  pay_per_cleaner?: number | string | null;
  pay_type?: TeamPayType | string | null;
}

export const MIN_TEAM = 2;
export const MAX_TEAM = 6;

export function cleanersNeeded(b: TeamFields): number {
  const n = Math.floor(Number(b.cleaners_needed ?? 1));
  return Number.isFinite(n) && n > 1 ? n : 1;
}

export function isTeamJob(b: TeamFields): boolean {
  return cleanersNeeded(b) > 1;
}

/** Spots left. Never negative, even if data is over-full. */
export function remainingSpots(b: TeamFields, claimed: number): number {
  return Math.max(0, cleanersNeeded(b) - Math.max(0, Math.floor(claimed || 0)));
}

function money(v: number): string {
  return Number.isInteger(v) ? `$${v}` : `$${v.toFixed(2)}`;
}

/** "$100 each" / "$25/hr each", or null when no pay is set. */
export function teamPayEach(b: TeamFields): string | null {
  if (b.pay_per_cleaner == null || b.pay_per_cleaner === '') return null;
  const v = Number(b.pay_per_cleaner);
  if (!Number.isFinite(v)) return null;
  return b.pay_type === 'hourly' ? `${money(v)}/hr each` : `${money(v)} each`;
}

/** Admin form summary: "2 cleaners · $100 each (flat)". */
export function teamSummary(b: TeamFields): string {
  const n = cleanersNeeded(b);
  const pay = teamPayEach(b);
  const base = `${n} cleaner${n === 1 ? '' : 's'}`;
  if (!pay) return base;
  return `${base} · ${pay} (${b.pay_type === 'hourly' ? 'hourly' : 'flat'})`;
}

/** Staff card badge: "2 cleaners needed · $100 each potential pay". */
export function teamBadge(b: TeamFields, claimed: number): string {
  const left = remainingSpots(b, claimed);
  const lead =
    claimed > 0
      ? `${left} more cleaner${left === 1 ? '' : 's'} needed`
      : `${left} cleaner${left === 1 ? '' : 's'} needed`;
  const pay = teamPayEach(b);
  return pay ? `${lead} · ${pay} potential pay` : lead;
}

/** Admin detail: "1 of 2 claimed". */
export function claimedLabel(b: TeamFields, claimed: number): string {
  return `${Math.max(0, claimed)} of ${cleanersNeeded(b)} claimed`;
}

/**
 * Per-cleaner pay for a team job, or null to fall through to the normal pay
 * rules. Flat: the amount, for every cleaner. Hourly: rate × that cleaner's
 * payable hours. Single-cleaner bookings always return null.
 */
export function teamCleanerPay(b: TeamFields, hoursWorked: number): number | null {
  if (!isTeamJob(b) || b.pay_per_cleaner == null || b.pay_per_cleaner === '') return null;
  const v = Number(b.pay_per_cleaner);
  if (!Number.isFinite(v)) return null;
  if (b.pay_type === 'hourly') return Math.round(v * Math.max(0, hoursWorked || 0) * 100) / 100;
  if (b.pay_type === 'flat') return v;
  return null;
}

/**
 * Saving an open team job must not delete cleaners who already claimed it.
 * The schedule-step picker (admin-assigned names and per-person pay) still
 * rebuilds assignment rows, because that screen is the roster.
 */
export function shouldKeepClaimedCleaners(teamNeeded: boolean, adminAssignedTeam: boolean): boolean {
  return teamNeeded && !adminAssignedTeam;
}

/**
 * Wage stored on the booking. Team pay replaces the solo wage so server
 * payroll, which reads cleaner_wage, pays each cleaner the team rate.
 * An empty team amount leaves the solo wage alone.
 */
export function mirroredCleanerWage(
  teamNeeded: boolean,
  teamPay: string | number | null,
  teamPayType: TeamPayType,
  cleanerWage: string,
  cleanerWageType: string,
): { wage: string; wageType: string } {
  if (teamNeeded && teamPay !== '' && teamPay != null) {
    const amount = Number(teamPay);
    if (Number.isFinite(amount) && amount >= 0) {
      return { wage: String(amount), wageType: teamPayType };
    }
  }
  return { wage: cleanerWage, wageType: cleanerWageType };
}

/**
 * pay_share for a claimed team spot. Flat is the per-cleaner amount. Hourly
 * stays null so payroll uses rate × that cleaner's hours instead of a frozen
 * dollar snapshot.
 */
export function claimPayShare(
  payType: string | null | undefined,
  payPerCleaner: number | string | null | undefined,
): number | null {
  if (payType !== 'flat' || payPerCleaner == null || payPerCleaner === '') return null;
  const amount = Number(payPerCleaner);
  return Number.isFinite(amount) ? amount : null;
}

/** Fields to save from the admin form. Unchecked = solo, pay cleared. */
export function teamFieldsForSave(
  teamNeeded: boolean,
  count: number,
  pay: string | number | null,
  payType: TeamPayType,
): { cleaners_needed: number; pay_per_cleaner: number | null; pay_type: TeamPayType | null } {
  if (!teamNeeded) return { cleaners_needed: 1, pay_per_cleaner: null, pay_type: null };
  const n = Math.min(MAX_TEAM, Math.max(MIN_TEAM, Math.floor(Number(count) || MIN_TEAM)));
  const p = pay === '' || pay == null ? null : Number(pay);
  return {
    cleaners_needed: n,
    pay_per_cleaner: p != null && Number.isFinite(p) && p >= 0 ? p : null,
    pay_type: payType,
  };
}
