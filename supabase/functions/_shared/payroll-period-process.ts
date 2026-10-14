// Shared per-org processor for the payroll-period-report flow.
// Imported by both the cron-driven `payroll-period-report` function and the
// admin-triggered `admin-trigger-payroll-report` function so the report logic
// has exactly one source of truth.

import * as React from "npm:react@18.3.1";
import { renderAsync } from "https://esm.sh/@react-email/components@0.0.22?deps=react@18.3.1";
import { sendResendSdkEmail } from "./send-resend.ts";
import { isDemoSendBlocked } from "./demo-org.ts";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

import {
  type PayrollPeriodConfig,
  DEFAULT_PAYROLL_CONFIG,
  calendarDateInTz,
  getEndDay,
  getPeriodEnd,
  getPeriodStart,
  getPreviousPeriod,
  isPeriodEndDay,
  formatPeriodLabel,
  toDateString,
} from "./payroll-period.ts";
import {
  getOrgEmailSettings,
  getReplyTo,
} from "./get-org-email-settings.ts";
import {
  resolveSender,
  PLATFORM_SENDER_FROM,
} from "./email-sender-resolution.ts";
import {
  PayrollPeriodReport,
  type CleanerRow,
} from "./email-templates/payroll-period-report.tsx";

const TEMPLATE_NAME = "payroll-period-report";
const APP_URL =
  Deno.env.get("APP_URL") ?? "https://app.jointidywise.com";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface OrgRow {
  id: string;
  name: string;
  owner_id: string;
}

export interface ProcessOrgOptions {
  /** Bypass the "today is the period-end day" check. Used by the admin trigger. */
  force?: boolean;
  /** Render the email but don't actually send or log. Used for preview. */
  dryRun?: boolean;
  /**
   * Override the period being reported on. Required when `force` is true and
   * today isn't an actual period-end day (otherwise we send for the in-progress
   * period, which is misleading).
   */
  periodOverride?: { start: Date; end: Date };
}

export type ProcessSkippedReason =
  | "email_disabled"
  | "not_period_end_day"
  | "no_owner_email"
  | "no_email_settings"
  | "already_sent"
  | "no_completed_bookings"
  | "opted_out";

export interface ProcessOrgResult {
  organizationId: string;
  success: boolean;
  skipped?: ProcessSkippedReason;
  error?: string;
  recipients?: string[];
  periodStart?: string; // YYYY-MM-DD
  periodEnd?: string;
  periodLabel?: string;
  subject?: string;
  html?: string;
  text?: string;
  totals?: {
    revenue: number;
    payroll: number;
    profit: number;
    laborPct: number;
    jobs: number;
    cleanersWorked: number;
  };
}

// ---------------------------------------------------------------------------
// Per-booking calc — MIRRORS the dashboard exactly so the email matches the
// Payroll page's "Current Pay Period" widget. See:
//   - src/lib/wageCalculation.ts (calculateBookingWage, getActualHours)
//   - src/pages/admin/PayrollPage.tsx (calcWeekForecast, getStaffPayEntries)
// Any drift here = email and dashboard disagree. Don't drift.
// ---------------------------------------------------------------------------

interface WageBooking {
  id: string;
  status: string;
  staff_id: string | null;
  scheduled_at: string;
  duration: number | null;
  total_amount: number | null;
  subtotal: number | null;
  discount_amount: number | null;
  cleaner_checkin_at: string | null;
  cleaner_checkout_at: string | null;
  cleaner_override_hours: number | null;
  cleaner_pay_expected: number | null;
  cleaner_actual_payment: number | null;
  cleaner_wage_type: string | null;
  cleaner_wage: number | null;
  pay_locked?: boolean | null;
}

interface HourCaps {
  overageCapRatio: number;
  absoluteCeiling: number;
}

const DEFAULT_HOUR_CAPS: HourCaps = {
  overageCapRatio: 1.25,
  absoluteCeiling: 12,
};

/** Mirrors src/lib/wageCalculation.ts:clampClockHours. */
function clampClockHours(clockHours: number, scheduledHours: number | null, caps: HourCaps): number {
  if (scheduledHours != null && scheduledHours > 0) {
    const upper = Math.min(scheduledHours * caps.overageCapRatio, caps.absoluteCeiling);
    const floor = Math.min(scheduledHours, upper);
    return Math.min(Math.max(clockHours, floor), upper);
  }
  return Math.min(Math.max(clockHours, 0), caps.absoluteCeiling);
}

interface WageStaff {
  id: string;
  name: string;
  base_wage: number | null;
  hourly_rate: number | null;
  default_hours: number | null;
  percentage_rate: number | null;
}

interface TeamAssignment {
  booking_id: string;
  staff_id: string;
  pay_share: number | null;
  is_primary: boolean | null;
}

/** Mirrors src/lib/wageCalculation.ts:getActualHours. */
function getActualHours(b: WageBooking, staff: WageStaff | null, caps: HourCaps): number {
  const durationHours = Number(b.duration) > 0 ? Number(b.duration) / 60 : null;
  const fallback = b.cleaner_override_hours != null
    ? Number(b.cleaner_override_hours)
    : durationHours != null
    ? durationHours
    : staff?.default_hours != null
    ? Number(staff.default_hours)
    : 0;

  if (b.cleaner_checkin_at && b.cleaner_checkout_at) {
    const checkin = new Date(b.cleaner_checkin_at).getTime();
    const checkout = new Date(b.cleaner_checkout_at).getTime();
    if (!Number.isFinite(checkin) || !Number.isFinite(checkout) || checkout <= checkin) {
      return fallback;
    }
    return clampClockHours((checkout - checkin) / 3_600_000, durationHours, caps);
  }
  return fallback;
}

/** Net revenue for a booking — the price actually charged. */
function bookingNetRevenue(b: WageBooking): number {
  // subtotal is PRE-discount; total_amount is POST-discount. The old form,
  // `(subtotal ?? total_amount) - discount_amount`, only held when subtotal
  // was populated — and nothing in the app ever populates it. BookingStepper
  // writes total_amount = finalPrice, which is already
  // `baseAmount - discountAmount`, and omits subtotal entirely, so the
  // fallback subtracted the discount a second time and underpaid percentage
  // cleaners by exactly (wageRate / 100) * discount_amount.
  //
  // Must stay identical to bookingNetRevenue in src/lib/wageCalculation.ts.
  if (b.subtotal != null) {
    return Number(b.subtotal) - Number(b.discount_amount ?? 0);
  }
  return Number(b.total_amount ?? 0);
}

/** Mirrors src/lib/wageCalculation.ts:calculateBookingWage. */
function calculateBookingWage(
  b: WageBooking,
  staff: WageStaff | null,
  teamSize?: number,
  caps: HourCaps = DEFAULT_HOUR_CAPS,
): number {
  const wageType = (b.cleaner_wage_type || "hourly").toLowerCase();
  const trustSnapshot = wageType !== "hourly" || b.pay_locked === true;
  // Hourly (unlocked) is rate × payable hours. A stored snapshot from the
  // old clock/5h rules must not be what payroll pays.
  if (trustSnapshot && b.cleaner_pay_expected != null) return Number(b.cleaner_pay_expected);
  if (b.cleaner_actual_payment != null) return Number(b.cleaner_actual_payment);
  if (!trustSnapshot) {
    const wageRate = Number(b.cleaner_wage ?? staff?.hourly_rate ?? staff?.base_wage ?? 0);
    return wageRate * getActualHours(b, staff, caps);
  }

  // 2b. Percentage-only rescue. SOLO ONLY.
  //
  // The chain below is `cleaner_wage ?? base_wage ?? hourly_rate ?? 0`, and
  // percentage_rate was never in it — this function SELECTs the column (see
  // the staff query) and then never reads it. A cleaner configured with a
  // percentage and no hourly rate therefore resolved to a rate of 0 and was
  // PAID $0.00 by this engine. One of five staff on the live org is
  // configured exactly that way.
  //
  // Solo only, and that restriction is the whole safety of this change.
  // BookingStepper writes pay_share as
  // `(jobTotal * percentage_rate / 100) / teamSize` — it DIVIDES by the team.
  // Applying a percentage here without knowing the team size would give every
  // member of a three-person team the full percentage and pay out 300% of the
  // booking. Failing to pay is bad; overpaying threefold is worse, and silent.
  //
  // `teamSize === 1` is the only value that opts in: undefined means the
  // caller does not know, and an unknown team is treated as a team.
  //
  // Percentage of NET REVENUE via bookingNetRevenue — not a new base. That
  // helper already carries the ruling that pay is on the discounted amount
  // actually charged, and already backs the "percentage" branch below.
  //
  // Must stay identical to computePayFromDefaults in
  // src/lib/wageCalculation.ts.
  const noExplicitRate =
    b.cleaner_wage == null &&
    staff?.base_wage == null &&
    staff?.hourly_rate == null;
  const pct = staff?.percentage_rate;
  if (teamSize === 1 && noExplicitRate && pct != null && Number(pct) > 0) {
    return (Number(pct) / 100) * bookingNetRevenue(b);
  }

  // 3. Fallback: compute from rate/type. Note percentage uses NET revenue.
  const wageRate = Number(
    b.cleaner_wage ?? staff?.hourly_rate ?? staff?.base_wage ?? 0,
  );
  if (wageType === "flat") return wageRate;
  if (wageType === "percentage") {
    return (wageRate / 100) * bookingNetRevenue(b);
  }
  // hourly
  return wageRate * getActualHours(b, staff, caps);
}

/** Mirrors PayrollPage.tsx:calcWage — pay_share takes priority for team assignments. */
function calcWage(
  b: WageBooking,
  staff: WageStaff | null,
  payShareOverride: number | null,
  teamSize?: number,
  caps: HourCaps = DEFAULT_HOUR_CAPS,
): number {
  const hourly = (b.cleaner_wage_type || "hourly").toLowerCase() === "hourly";
  const soloHourly = hourly && teamSize === 1 && b.pay_locked !== true;
  if (payShareOverride != null && payShareOverride > 0 && !soloHourly) return payShareOverride;
  return calculateBookingWage(b, staff, teamSize, caps);
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export async function processOrg(
  org: OrgRow,
  supabase: SupabaseClient,
  opts: ProcessOrgOptions = {},
): Promise<ProcessOrgResult> {
  const result: ProcessOrgResult = {
    organizationId: org.id,
    success: false,
  };

  // --- 1. Load business_settings (config + tz + report controls) -----------
  const { data: bs } = await supabase
    .from("business_settings")
    .select(
      "timezone, payroll_frequency, payroll_start_day, payroll_custom_days, " +
        "payroll_report_email_enabled, payroll_report_recipients, " +
        "payroll_report_send_day, " +
        "company_name",
    )
    .eq("organization_id", org.id)
    .maybeSingle();

  const tz = (bs?.timezone as string) || "America/New_York";
  const config: PayrollPeriodConfig = {
    payroll_frequency: (bs?.payroll_frequency as "weekly" | "biweekly") ||
      DEFAULT_PAYROLL_CONFIG.payroll_frequency,
    payroll_start_day:
      (bs?.payroll_start_day as number | null) ??
        DEFAULT_PAYROLL_CONFIG.payroll_start_day,
    payroll_custom_days: (bs?.payroll_custom_days as number[] | null) ?? null,
  };
  const emailEnabled = bs?.payroll_report_email_enabled ?? true;
  const extraRecipients = (bs?.payroll_report_recipients as string[]) ?? [];
  const companyName = (bs?.company_name as string) || org.name;
  const customSendDay = (bs?.payroll_report_send_day as number | null) ?? null;

  if (!opts.force && !emailEnabled) {
    return { ...result, skipped: "email_disabled", success: true };
  }

  // --- 2. Decide which period this run reports on ---------------------------
  const today = calendarDateInTz(new Date(), tz);
  let periodStart: Date;
  let periodEnd: Date;

  if (opts.periodOverride) {
    periodStart = opts.periodOverride.start;
    periodEnd = opts.periodOverride.end;
  } else if (opts.force) {
    // Admin trigger: report on the CURRENT in-progress pay period.
    periodStart = getPeriodStart(today, config);
    periodEnd = getPeriodEnd(periodStart, config);
  } else if (customSendDay !== null) {
    // Custom send day: fire when today's day-of-week matches. Report on the
    // most recently CLOSED period (end date strictly before today, or today
    // if the send day happens to coincide with the period end day).
    if (today.getUTCDay() !== customSendDay) {
      return { ...result, skipped: "not_period_end_day", success: true };
    }
    // Walk back day-by-day (max 14) to find the most recent period end <= today.
    let cursor = today;
    let found: Date | null = null;
    for (let i = 0; i < 14; i++) {
      if (isPeriodEndDay(cursor, config)) {
        found = cursor;
        break;
      }
      cursor = new Date(cursor.getTime() - 86_400_000);
    }
    if (!found) {
      return { ...result, skipped: "not_period_end_day", success: true };
    }
    periodEnd = found;
    periodStart = getPeriodStart(periodEnd, config);
  } else if (isPeriodEndDay(today, config)) {
    periodStart = getPeriodStart(today, config);
    periodEnd = getPeriodEnd(periodStart, config);
  } else {
    return { ...result, skipped: "not_period_end_day", success: true };
  }


  result.periodStart = toDateString(periodStart);
  result.periodEnd = toDateString(periodEnd);
  result.periodLabel = formatPeriodLabel(periodStart, periodEnd);

  // --- 3. Pre-send dedupe check --------------------------------------------
  // The cron path must be idempotent — a second daily run for the same period
  // should be a safe no-op. Admin-triggered (force=true) sends are explicit
  // user actions, so they bypass dedupe and produce a fresh send + log row.
  // org_id + period_end live inside metadata (the email_send_log table only
  // has id/message_id/template_name/recipient_email/status/error_message/
  // metadata/created_at), so we filter via jsonb operators.
  if (!opts.dryRun && !opts.force) {
    const { data: existing } = await supabase
      .from("email_send_log")
      .select("id")
      .eq("template_name", TEMPLATE_NAME)
      .eq("status", "sent")
      .eq("metadata->>organization_id", org.id)
      .eq("metadata->>period_end", result.periodEnd)
      .limit(1);
    if (existing && existing.length > 0) {
      return { ...result, skipped: "already_sent", success: true };
    }
  }

  // --- 4. Resolve owner email + extra recipients ----------------------------
  const { data: ownerProfile } = await supabase
    .from("profiles")
    .select("email")
    .eq("id", org.owner_id)
    .maybeSingle();
  const ownerEmail = (ownerProfile?.email as string | null) ?? null;

  const recipients = Array.from(
    new Set(
      [ownerEmail, ...extraRecipients]
        .filter((e): e is string => !!e && /\S+@\S+\.\S+/.test(e)),
    ),
  );
  if (recipients.length === 0) {
    return { ...result, skipped: "no_owner_email", success: true };
  }
  result.recipients = recipients;

  // --- 5. Pull bookings for current + 3 prior periods (for warnings) -------
  const span = config.payroll_frequency === "biweekly" ? 14 : 7;
  const lookbackStart = new Date(
    periodStart.getTime() - 3 * span * 86_400_000,
  );

  // Mirror the dashboard's calcWeekForecast exactly:
  //   - status != 'cancelled' (booked / confirmed / in_progress / completed all count)
  //   - revenue uses subtotal || total_amount minus discount_amount
  //   - hours sourced from check-in/out timestamps when present
  // Custom-work-week filter is intentionally NOT applied here — the dashboard
  // doesn't apply it to its "Current Pay Period" widget either.
  const { data: rawBookings } = await supabase
    .from("bookings")
    .select(
      "id, staff_id, status, scheduled_at, duration, total_amount, subtotal, " +
        "discount_amount, cleaner_checkin_at, cleaner_checkout_at, " +
        "cleaner_override_hours, cleaner_pay_expected, cleaner_actual_payment, " +
        "cleaner_wage_type, cleaner_wage, pay_locked",
    )
    .eq("organization_id", org.id)
    .neq("status", "cancelled")
    .gte("scheduled_at", lookbackStart.toISOString())
    .lte("scheduled_at", new Date(periodEnd.getTime() + 86_400_000).toISOString());

  const bookings = (rawBookings ?? []) as unknown as WageBooking[];
  const bookingIds = bookings.map((b) => b.id);

  // --- 6. Pull staff + team assignments + payout accounts ------------------
  const { data: staffData } = await supabase
    .from("staff")
    .select("id, name, base_wage, hourly_rate, default_hours, percentage_rate")
    .eq("organization_id", org.id);

  const { data: paySettings } = await supabase
    .from("payroll_settings")
    .select("hours_overage_cap_ratio, hours_absolute_ceiling")
    .eq("organization_id", org.id)
    .maybeSingle();
  const hourCaps: HourCaps = {
    overageCapRatio: Number(paySettings?.hours_overage_cap_ratio) > 0
      ? Number(paySettings?.hours_overage_cap_ratio)
      : DEFAULT_HOUR_CAPS.overageCapRatio,
    absoluteCeiling: Number(paySettings?.hours_absolute_ceiling) > 0
      ? Number(paySettings?.hours_absolute_ceiling)
      : DEFAULT_HOUR_CAPS.absoluteCeiling,
  };

  const staffMap = new Map<string, WageStaff>();
  for (const s of (staffData ?? []) as WageStaff[]) {
    staffMap.set(s.id, s);
  }

  // Multi-cleaner bookings: payouts go through booking_team_assignments.
  // Without this lookup, every team-only booking is invisible to the email.
  let teamAssignments: TeamAssignment[] = [];
  if (bookingIds.length > 0) {
    const { data: rawAssignments } = await supabase
      .from("booking_team_assignments")
      .select("booking_id, staff_id, pay_share, is_primary")
      .eq("organization_id", org.id)
      .in("booking_id", bookingIds);
    teamAssignments = (rawAssignments ?? []) as TeamAssignment[];
  }
  const assignmentsByBookingId = new Map<string, TeamAssignment[]>();
  for (const a of teamAssignments) {
    const list = assignmentsByBookingId.get(a.booking_id) ?? [];
    list.push(a);
    assignmentsByBookingId.set(a.booking_id, list);
  }

  const { data: payoutAccts } = await supabase
    .from("staff_payout_accounts")
    .select("staff_id, payouts_enabled")
    .eq("organization_id", org.id);
  const payoutsEnabledFor = new Set(
    ((payoutAccts ?? []) as Array<{ staff_id: string; payouts_enabled: boolean }>)
      .filter((p) => p.payouts_enabled)
      .map((p) => p.staff_id),
  );

  // --- 7. Bucket bookings by period -----------------------------------------
  const inPeriod = (b: { scheduled_at: string }, start: Date, end: Date) => {
    const t = new Date(b.scheduled_at).getTime();
    return t >= start.getTime() &&
      t < end.getTime() + 86_400_000;
  };

  const prev1 = getPreviousPeriod(periodStart, config);
  const prev2 = getPreviousPeriod(prev1.start, config);

  const currentBookings = bookings.filter((b) =>
    inPeriod(b, periodStart, periodEnd)
  );
  const prev1Bookings = bookings.filter((b) => inPeriod(b, prev1.start, prev1.end));
  const prev2Bookings = bookings.filter((b) => inPeriod(b, prev2.start, prev2.end));

  // --- 8. Period-level totals — mirrors PayrollPage:calcWeekForecast --------
  // For each booking: revenue counts once. Payroll = sum of team-assignment
  // payouts if any exist, else the primary staff_id's calcWage. Bookings with
  // neither contribute revenue but no payroll (and don't count toward "jobs").
  interface PeriodTotals {
    revenue: number;
    payroll: number;
    profit: number;
    laborPct: number;
    jobs: number;
    cleanersWorked: number;
    zeroPayBookings: number;
    negativeMarginBookings: number;
    cleanerIdsWithJobs: Set<string>;
  }

  const computeTotals = (list: WageBooking[]): PeriodTotals => {
    let revenue = 0;
    let payroll = 0;
    let jobs = 0;
    let zeroPay = 0;
    let negMargin = 0;
    const cleanerIds = new Set<string>();

    for (const b of list) {
      const rev = bookingNetRevenue(b);
      revenue += rev;

      const assignments = assignmentsByBookingId.get(b.id) ?? [];
      let bookingPayrollSum = 0;
      let hasAssignment = false;

      if (assignments.length > 0) {
        hasAssignment = true;
        for (const a of assignments) {
          const member = staffMap.get(a.staff_id) ?? null;
          const ps = a.pay_share != null ? Number(a.pay_share) : null;
          bookingPayrollSum += calcWage(b, member, ps, assignments.length, hourCaps);
          cleanerIds.add(a.staff_id);
        }
      } else if (b.staff_id) {
        hasAssignment = true;
        const sm = staffMap.get(b.staff_id) ?? null;
        /* No assignment rows means one cleaner, staffed via staff_id — the
           shape 45 of 47 live bookings have. That is solo, so the percentage
           rescue is allowed to apply. */
        bookingPayrollSum += calcWage(b, sm, null, 1, hourCaps);
        cleanerIds.add(b.staff_id);
      }

      if (hasAssignment) {
        jobs += 1;
        payroll += bookingPayrollSum;
        if (bookingPayrollSum === 0) zeroPay += 1;
        if (bookingPayrollSum > rev) negMargin += 1;
      }
    }

    return {
      revenue,
      payroll,
      profit: revenue - payroll,
      laborPct: revenue > 0 ? (payroll / revenue) * 100 : 0,
      jobs,
      cleanersWorked: cleanerIds.size,
      zeroPayBookings: zeroPay,
      negativeMarginBookings: negMargin,
      cleanerIdsWithJobs: cleanerIds,
    };
  };

  const currentTotals = computeTotals(currentBookings);
  const prev1Totals = computeTotals(prev1Bookings);
  const prev2Totals = computeTotals(prev2Bookings);

  const totals = {
    revenue: currentTotals.revenue,
    payroll: currentTotals.payroll,
    profit: currentTotals.profit,
    laborPct: currentTotals.laborPct,
    jobs: currentTotals.jobs,
    cleanersWorked: currentTotals.cleanersWorked,
  };
  result.totals = totals;

  if (!opts.force && currentTotals.jobs === 0) {
    return { ...result, skipped: "no_completed_bookings", success: true };
  }

  const pctChange = (curr: number, prev: number) => {
    if (prev === 0) return curr === 0 ? 0 : 100;
    return ((curr - prev) / prev) * 100;
  };
  const hadPrev = prev1Totals.jobs > 0;
  const changeVsPrevious = hadPrev
    ? {
      revenuePct: pctChange(currentTotals.revenue, prev1Totals.revenue),
      payrollPct: pctChange(currentTotals.payroll, prev1Totals.payroll),
      jobsPct: pctChange(currentTotals.jobs, prev1Totals.jobs),
    }
    : null;

  // --- 9. Per-cleaner aggregation — mirrors PayrollPage:getStaffPayEntries --
  // For each cleaner: count every booking where they're the primary
  // (bookings.staff_id) OR they have a team assignment. pay_share wins over
  // calcWage when set. Revenue is attributed only when they're the primary
  // (or single staff) so we don't multi-count revenue across team members.
  interface CleanerAgg {
    name: string;
    jobs: number;
    revenue: number;
    payout: number;
    hours: number;
  }
  const aggregateByCleaner = (
    list: WageBooking[],
  ): Map<string, CleanerAgg> => {
    const agg = new Map<string, CleanerAgg>();
    const ensure = (sid: string): CleanerAgg => {
      let row = agg.get(sid);
      if (!row) {
        row = {
          name: staffMap.get(sid)?.name ?? "Unknown",
          jobs: 0,
          revenue: 0,
          payout: 0,
          hours: 0,
        };
        agg.set(sid, row);
      }
      return row;
    };

    for (const b of list) {
      const assignments = assignmentsByBookingId.get(b.id) ?? [];
      const seenForBooking = new Set<string>();

      // Primary staff_id path (with potentially-overriding team assignment)
      if (b.staff_id) {
        const sm = staffMap.get(b.staff_id) ?? null;
        const a = assignments.find((a) => a.staff_id === b.staff_id);
        const ps = a?.pay_share != null ? Number(a.pay_share) : null;
        // Solo (no assignment rows) opts into the percentage-only rescue with
        // teamSize 1; anything with assignments passes the real team size.
        const pay = calcWage(b, sm, ps, assignments.length > 0 ? assignments.length : 1, hourCaps);
        const hours = getActualHours(b, sm);
        const row = ensure(b.staff_id);
        row.jobs += 1;
        row.revenue += bookingNetRevenue(b);
        row.payout += pay;
        row.hours += hours;
        seenForBooking.add(b.staff_id);
      }

      // Team assignments where the cleaner isn't the primary
      for (const a of assignments) {
        if (seenForBooking.has(a.staff_id)) continue;
        const member = staffMap.get(a.staff_id) ?? null;
        const ps = a.pay_share != null ? Number(a.pay_share) : null;
        const pay = calcWage(b, member, ps, assignments.length, hourCaps);
        const hours = getActualHours(b, member);

        const row = ensure(a.staff_id);
        row.jobs += 1;
        row.payout += pay;
        row.hours += hours;
        // No revenue attribution for non-primary team members.
        seenForBooking.add(a.staff_id);
      }
    }

    return agg;
  };

  const aggCurrent = aggregateByCleaner(currentBookings);
  const aggPrev1 = aggregateByCleaner(prev1Bookings);

  // --- 10. Build the cleaner rows + standouts -------------------------------
  const cleaners: CleanerRow[] = Array.from(aggCurrent.values())
    .map((c) => {
      const staffId = [...aggCurrent.entries()].find(([, v]) => v === c)?.[0];
      const prev = staffId ? aggPrev1.get(staffId) : undefined;
      const payoutChangePct = prev && prev.payout > 0
        ? ((c.payout - prev.payout) / prev.payout) * 100
        : null;
      return {
        name: c.name,
        jobs: c.jobs,
        revenue: c.revenue,
        payout: c.payout,
        hours: c.hours,
        payoutChangePct,
      };
    })
    .sort((a, b) => b.payout - a.payout);

  const topEarner = cleaners[0]
    ? { name: cleaners[0].name, payout: cleaners[0].payout }
    : undefined;
  const mostJobsRow = [...cleaners].sort((a, b) => b.jobs - a.jobs)[0];
  const mostJobs = mostJobsRow
    ? { name: mostJobsRow.name, jobs: mostJobsRow.jobs }
    : undefined;
  const highestAvgRow = [...cleaners]
    .filter((c) => c.jobs > 0)
    .sort((a, b) => b.payout / b.jobs - a.payout / a.jobs)[0];
  const highestAvg = highestAvgRow
    ? {
      name: highestAvgRow.name,
      avgPayout: highestAvgRow.payout / highestAvgRow.jobs,
    }
    : undefined;

  const standouts = topEarner || mostJobs || highestAvg
    ? { topEarner, mostJobs, highestAvg }
    : null;

  // --- 11. Warnings ---------------------------------------------------------
  // Idle: jobs in EITHER prior 2 periods (any role) AND zero current. Uses the
  // team-aware sets built by computeTotals so team-only cleaners aren't missed.
  const inCurrent = currentTotals.cleanerIdsWithJobs;
  const idleStaffIds: string[] = [];
  for (const sid of new Set([
    ...prev1Totals.cleanerIdsWithJobs,
    ...prev2Totals.cleanerIdsWithJobs,
  ])) {
    if (!inCurrent.has(sid)) idleStaffIds.push(sid);
  }
  const idleCleaners = idleStaffIds
    .map((sid) => staffMap.get(sid)?.name)
    .filter((n): n is string => !!n)
    .sort();

  // No-Stripe: cleaners who actually worked this period without payouts_enabled.
  const noStripeCleaners = Array.from(inCurrent)
    .filter((sid) => !payoutsEnabledFor.has(sid))
    .map((sid) => staffMap.get(sid)?.name)
    .filter((n): n is string => !!n)
    .sort();

  const warnings = {
    idleCleaners,
    noStripeCleaners,
    negativeMarginBookings: currentTotals.negativeMarginBookings,
    zeroPayBookings: currentTotals.zeroPayBookings,
  };

  // --- 12. Org email settings — missing is a fallback trigger, not a blocker ---
  // These are internal reports to the owner about their own payroll. Blocking on a
  // missing customer-facing sender identity is what left 29 of 30 orgs with no
  // report at all.
  const emailSettingsResult = await getOrgEmailSettings(org.id);
  const orgEmailSettings = emailSettingsResult.success ? emailSettingsResult.settings ?? null : null;

  // --- 13. Render React Email -----------------------------------------------
  const subject = `📊 Payroll report — ${result.periodLabel} · ${
    totals.payroll.toLocaleString("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 0,
    })
  }`;

  const props = {
    orgName: companyName,
    periodLabel: result.periodLabel!,
    totals,
    changeVsPrevious,
    cleaners,
    standouts,
    warnings,
    ctaUrl: `${APP_URL}/dashboard/payroll`,
  };
  const html = await renderAsync(React.createElement(PayrollPeriodReport, props));
  const text = await renderAsync(
    React.createElement(PayrollPeriodReport, props),
    { plainText: true },
  );
  result.html = html;
  result.text = text;
  result.subject = subject;

  if (opts.dryRun) {
    return { ...result, success: true };
  }

  // --- 14. Send via Resend (retry once) -------------------------------------
  const platformKey = Deno.env.get("RESEND_API_KEY") ?? null;

  const resolved = resolveSender({
    settings: orgEmailSettings,
    platformFrom: PLATFORM_SENDER_FROM,
    platformKeyPresent: !!platformKey,
    allowPlatformFallback: true, // owner-facing internal report
  });

  if (!resolved.ok) {
    // Nothing can send. Keep the existing failed-log shape so reporting is unchanged.
    if (!opts.dryRun) {
      await supabase.from("email_send_log").insert({
        template_name: TEMPLATE_NAME,
        recipient_email: recipients[0],
        status: "failed",
        error_message: resolved.error,
        metadata: {
          reason: "no_email_settings",
          organization_id: org.id,
          period_start: result.periodStart,
          period_end: result.periodEnd,
        },
      });
    }
    return { ...result, skipped: "no_email_settings", success: false, error: resolved.error };
  }

  const senderKey = resolved.sender.keySource === "org"
    ? (orgEmailSettings?.resend_api_key as string)
    : (platformKey as string);

  let apiKey = senderKey;
  const messageId = crypto.randomUUID();
  let fromHeader = resolved.sender.from;
  const replyTo = orgEmailSettings ? getReplyTo(orgEmailSettings) : PLATFORM_SENDER_FROM;

  // The fallback must never be silent. org_email_send_failures already has method
  // and fell_back_to columns; fell_back_to = 'platform' keeps the row queryable by
  // org while the owner-facing health banner (which counts fell_back_to IS NULL)
  // correctly does not alarm anyone about mail that arrived.
  //
  // Split in two deliberately. The console line describes what is being ATTEMPTED,
  // so it is safe to emit straight away — and it is the only trace left if the send
  // then fails. The database row ASSERTS a delivery: its own text reads "sent via
  // platform sender". So it is written only after one has actually happened.
  // Writing it up front meant a row could claim a delivery that never occurred,
  // which is the inverse of the problem this fallback exists to solve.
  const warnPlatformSender = (reason: string) => {
    console.warn(
      `[payroll-period-report] org ${org.id}: sending from the platform sender ` +
      `(${reason}). The org's own email identity is not usable.`,
    );
  };

  const logPlatformFallback = async (reason: string) => {
    try {
      await supabase.rpc("log_org_email_send_failure", {
        _organization_id: org.id,
        _method: "resend",
        _fell_back_to: "platform",
        _recipient: recipients[0],
        _subject: subject,
        _error_message: `payroll report sent via platform sender: ${reason}`,
      });
    } catch (e) {
      console.error("[payroll-period-report] fallback log failed", e);
    }
  };

  // Non-null when a platform fallback is in play. Written to the database only
  // after a successful send, at the bottom of this function. Reassigned if the
  // retry escalates to the platform identity.
  let pendingFallbackReason: string | null = null;

  if (resolved.sender.usedFallback) {
    pendingFallbackReason = String(resolved.sender.fallbackReason);
    warnPlatformSender(pendingFallbackReason);
  }


  // Insert pending row first so we have a record even on crash.
  await supabase.from("email_send_log").insert({
    message_id: messageId,
    template_name: TEMPLATE_NAME,
    recipient_email: recipients[0],
    status: "pending",
    metadata: {
      recipients,
      period_label: result.periodLabel,
      totals,
      organization_id: org.id,
      period_start: result.periodStart,
      period_end: result.periodEnd,
    },
  });

  const sendOnce = () =>
    sendResendSdkEmail(apiKey, {
      from: fromHeader,
      to: recipients,
      reply_to: replyTo,
      subject,
      html,
      text,
      headers: { "X-Message-ID": messageId },
    }, { organizationId: org.id });

  let sendError: unknown = null;
  try {
    const r = await sendOnce();
    if ((r as any)?.error) sendError = (r as any).error;
  } catch (e) {
    sendError = e;
  }
  if (sendError) {
    const firstError = sendError instanceof Error ? sendError.message : JSON.stringify(sendError);
    const escalated = resolveSender({
      settings: orgEmailSettings,
      platformFrom: PLATFORM_SENDER_FROM,
      platformKeyPresent: !!platformKey,
      allowPlatformFallback: true,
      priorFailure: firstError,
    });

    // Retry from the platform identity when the first attempt used the org's, since
    // an unverified From is rejected whichever API key sent it — changing only the
    // key would not help.
    if (escalated.ok && escalated.sender.usedFallback && !resolved.sender.usedFallback) {
      console.warn(
        `[payroll-period-report] org ${org.id}: org identity failed (${firstError}); ` +
        `retrying from the platform sender immediately.`,
      );
      apiKey = platformKey as string;
      fromHeader = escalated.sender.from;
      pendingFallbackReason = String(escalated.sender.fallbackReason);
      // NO WAIT ON THIS PATH, deliberately. The identity itself has just changed,
      // and the failure it is working around — an unverified From address, or a
      // rejected API key — is a permanent validation error from Resend, not a
      // transient one. Thirty seconds cannot change that outcome. Only the swap
      // two lines above can, and it has already happened.
      //
      // The cost is not theoretical: payroll-period-report/index.ts:63 runs a
      // single serial `for` loop over every organisation in one invocation, so
      // every needless sleep is 30 seconds added to one shared wall clock, and the
      // orgs that hit this path are precisely the misconfigured ones.
    } else {
      // Identity unchanged, so the only thing that could differ on a second
      // attempt is a genuinely transient failure — which is what a backoff is for.
      // Original behaviour, preserved for this case only.
      await new Promise((resolve) => setTimeout(resolve, 30_000));
    }
    try {
      const r = await sendOnce();
      if ((r as any)?.error) sendError = (r as any).error;
      else sendError = null;
    } catch (e) {
      sendError = e;
    }
  }

  if (isDemoSendBlocked(sendError)) {
    await supabase
      .from("email_send_log")
      .update({ status: "skipped", error_message: "Disabled in demo mode" })
      .eq("message_id", messageId);
    return { ...result, success: false, error: "Disabled in demo mode" };
  }

  if (sendError) {
    const errorMessage =
      sendError instanceof Error ? sendError.message : JSON.stringify(sendError);
    await supabase
      .from("email_send_log")
      .update({
        status: "failed",
        error_message: errorMessage,
      })
      .eq("message_id", messageId);
    return { ...result, success: false, error: errorMessage };
  }

  await supabase
    .from("email_send_log")
    .update({ status: "sent" })
    .eq("message_id", messageId);

  // Only now. The send has succeeded, so the row's own wording — "payroll report
  // sent via platform sender" — is true when it is written. This is the single
  // place the fallback is recorded; both the first-attempt case and the escalated
  // retry funnel into it via pendingFallbackReason.
  if (pendingFallbackReason) {
    await logPlatformFallback(pendingFallbackReason);
  }

  return { ...result, success: true };
}
