import { useState, useMemo, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { AdminLayout } from '@/components/admin/AdminLayout';
import { PlanFeatureGate } from '@/components/admin/PlanFeatureGate';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { supabase } from '@/lib/supabase';
import { readEdgeFunctionError } from '@/lib/edgeFunctionError';
import { saveBlob } from '@/lib/fileActions';
import { matrixToCsv } from '@/lib/orgDataExport';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useOrgQuery } from '@/hooks/useOrgQuery';
import { useOrgRecord } from '@/hooks/useOrgRecord';
import { format, startOfMonth, endOfMonth, startOfYear, startOfWeek, addDays } from 'date-fns';
import { CalendarIcon, Download, AlertTriangle, DollarSign, Clock, Calculator, Briefcase, Check, TrendingUp, TrendingDown, Percent, BarChart3, CreditCard, Banknote, Loader2, CheckCircle2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTestMode } from '@/contexts/TestModeContext';
import { useOrgId } from '@/hooks/useOrgId';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';
import { resolveCleanerPay } from '@/lib/wageCalculation';
import { usePayrollPeriodConfig } from '@/hooks/usePayrollPeriodConfig';
import { getCurrentPeriod, getNextPeriod, getPeriodStart, getPeriodEnd, getPeriodTitle, formatPeriodLabel } from '@/lib/payrollPeriod';
import { addDays as addDaysFn } from 'date-fns';
import { useOrgTimezone } from '@/hooks/useOrgTimezone';
import {
  orgStartOfMonth, orgEndOfMonth, orgStartOfWeek, orgStartOfYear, orgDateKey, orgAddDays, orgEndOfDay,
  parseWeekStartDay, type WeekStartDay,
} from '@/lib/orgDateRange';
import { formatInTimezone, getDateInTimezone } from '@/lib/timezoneUtils';
import { PayrollPeriodSettings } from '@/components/admin/PayrollPeriodSettings';
import { PayrollCostSettings } from '@/components/admin/PayrollCostSettings';
import { SEOHead } from '@/components/SEOHead';
import { QueryError } from '@/components/QueryError';
import { fmt } from '@/lib/activeCurrency';
import { mustAffectRows } from '@/lib/mustAffectRows';
import { STAFF_SELECTABLE_COLUMNS } from '@/lib/staffColumns';
import { useOrgStaffWages } from '@/hooks/useOrgStaffWages';

interface StaffWithPayroll {
  id: string;
  name: string;
  email: string;
  tax_classification: string | null;
  base_wage: number | null;
  hourly_rate: number | null;
  totalHours: number;
  totalPay: number;
  ytdEarnings: number;
  requiresTaxFiling: boolean;
  upcomingBookings: number;
  assignedCleans: number;
  avgPayPerClean: number;
  revenueAttributed: number;
  profitAttributed: number;
  laborPercent: number;
  /** Deactivated cleaner, on the roster only because they worked this period. */
  isInactive: boolean;
}




interface BookingPayrollDetail {

  id: string;
  /** The booking this row belongs to. A multi-cleaner booking has one row per
   *  cleaner, so anything counting BOOKINGS must dedupe on this, not on rows. */
  booking_id: string;
  booking_number: number;
  customer_name: string;
  scheduled_at: string;
  /** Date payroll attributes this job to — the scheduled clean date. */
  payroll_date: string;
  duration: number;
  hours_worked: number;
  wage_type: string;
  wage_rate: number;
  calculated_pay: number;
  actual_pay: number | null;
  staff_id: string;
  staff_name: string;
  /** This cleaner's slice of the booking's net revenue, split by pay. Sums to
   *  the booking's revenue across its rows, so totals never double-count. */
  revenue_net: number;
  /** True when revenue_net is a proportional share of a multi-cleaner booking
   *  rather than a real invoiced amount — surfaced in the UI so nobody
   *  reconciles a single row against a client invoice. */
  revenue_is_share: boolean;
  labor_cost: number;
  labor_percent: number;
  profit: number;
  margin_percent: number;
  isMissingPay: boolean;
  /**
   * Why this row's pay is $0, when it is.
   *
   *   'deactivated'  — the cleaner's staff record was excluded from wage
   *                    resolution because they are deactivated, so their
   *                    base_wage/hourly_rate was never read. The pay IS
   *                    configured; we chose not to look at it.
   *   'unconfigured' — no wage on the booking and none on the staff record.
   *
   * These were reported identically as "$0 cleaner pay configured", which is
   * false for the first case and sends an admin to check a booking that has
   * nothing wrong with it.
   */
  payGapReason: 'deactivated' | 'unconfigured' | null;
  /** Actual worked hours exceeded the cap, so pay was limited to hours_capped_at.
   *  Surfaced here rather than queued for approval — the exception is visible
   *  next to the numbers it affects. */
  isHoursCapped: boolean;
  /** Worked hours from the clock, when a valid check-in/out pair existed. */
  actualHours: number | null;
  /** The capped hours figure that was actually paid. */
  cappedHours: number | null;
}

interface PayrollSettings {
  processing_fee_mode: string;
  processing_fee_percent: number;
  /** Fixed component per transaction — the "+ 30c" half of 2.9% + 30c. */
  processing_fee_flat: number;
  vendor_cost_mode: string;
  vendor_cost_flat: number;
  vendor_cost_percent: number;
  labor_percent_warning_threshold: number;
  margin_percent_good_threshold: number;
}

const DEFAULT_SETTINGS: PayrollSettings = {
  processing_fee_mode: 'percent',
  processing_fee_percent: 2.9,
  processing_fee_flat: 0.30,
  vendor_cost_mode: 'none',
  vendor_cost_flat: 0,
  vendor_cost_percent: 0,
  labor_percent_warning_threshold: 60,
  margin_percent_good_threshold: 30,
};

// Financial calculation helpers
/**
 * Card processing cost for one booking.
 *
 * TWO THINGS THIS GETS RIGHT THAT IT USED TO GET WRONG, both in the same
 * direction (profit read HIGH):
 *
 *  1. Real card pricing is percent + fixed — Stripe US standard is 2.9% + 30c.
 *     Modelling only the percent understated the fee on EVERY transaction by
 *     the fixed component, which matters most on small tickets, which is most
 *     cleans.
 *  2. The fee was applied to every booking, including cash, cheque and bank
 *     transfer jobs that never touched Stripe. `payment_intent_id` is only set
 *     when a Stripe payment actually happened, so it is the honest gate.
 *
 * Fixing only (1) would have left (2) as the dominant error while looking like
 * a correction, so they ship together.
 */
function calcProcessingFee(
  booking: { payment_intent_id?: string | null },
  revenueGross: number,
  settings: PayrollSettings,
): number {
  // No Stripe payment intent → no card fee. Cash and cheque jobs cost nothing
  // to process.
  if (!booking.payment_intent_id) return 0;
  if (settings.processing_fee_mode !== 'percent') return 0;
  return revenueGross * (settings.processing_fee_percent / 100) + settings.processing_fee_flat;
}

function calcVendorCost(revenueNet: number, settings: PayrollSettings): number {
  if (settings.vendor_cost_mode === 'flat') return settings.vendor_cost_flat;
  if (settings.vendor_cost_mode === 'percent') return revenueNet * (settings.vendor_cost_percent / 100);
  return 0;
}

function calcBookingFinancials(booking: any, laborCost: number, settings: PayrollSettings) {
  const revenueGross = Number(booking.total_amount) || 0;
  const discountAmount = Number(booking.discount_amount) || 0;
  const subtotal = Number(booking.subtotal) || revenueGross;
  const revenueNet = subtotal - discountAmount;
  const processingFee = calcProcessingFee(booking, revenueGross, settings);
  const vendorCost = calcVendorCost(revenueNet, settings);
  const profit = revenueNet - laborCost - vendorCost - processingFee;
  const laborPercent = revenueNet > 0 ? (laborCost / revenueNet) * 100 : 0;
  const marginPercent = revenueNet > 0 ? (profit / revenueNet) * 100 : 0;
  return { revenueNet, revenueGross, processingFee, vendorCost, profit, laborPercent, marginPercent };
}

export default function PayrollPage() {
  const navigate = useNavigate();
  const [dateRange, setDateRange] = useState<{ from: Date; to: Date }>({
    // Placeholder only. useOrgTimezone returns its fallback on the first
    // render, so the real month bounds are set by the effect below once the
    // org's zone has actually loaded — see the note there.
    /* eslint-disable-next-line local/no-device-local-dates -- provisional; the effect below replaces both once useOrgTimezone resolves */
    from: startOfMonth(new Date()),
    /* eslint-disable-next-line local/no-device-local-dates -- ditto */
    to: endOfMonth(new Date()),
  });
  const [payPeriodSelected, setPayPeriodSelected] = useState(false);

  const [staffFilterId, setStaffFilterId] = useState<string>('all');
  const [profitFilter, setProfitFilter] = useState<string>('all');
  const { isTestMode, maskName, maskEmail } = useTestMode();
  const { organizationId } = useOrgId();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { timezone: orgTimezone, error: tzError } = useOrgTimezone();

  /**
   * When this business's payroll week begins.
   *
   * payroll_settings.payroll_week_start_day existed and was read by NOTHING —
   * PayrollPage hardcoded Monday. This is the one place it has a home. Defaults
   * to Monday via parseWeekStartDay, so behaviour is unchanged for every org
   * that never set it.
   */
  // The old version swallowed a read failure into null and fell back to
  // Monday, reasoning that an unreadable preference must not take the page
  // down. The fallback was right; being silent about it was not — on this page
  // a wrong week start means the wrong bookings are in the pay period, and
  // nobody sees a default being applied. Now it still falls back, and also
  // reports, via the banner below.
  const weekStartRecord = useOrgRecord<string | null>({
    key: ['payroll-week-start'],
    staleTime: 1000 * 60 * 10,
    query: async (organizationId) => {
      const { data, error } = await supabase
        .from('payroll_settings')
        .select('payroll_week_start_day')
        .eq('organization_id', organizationId)
        .maybeSingle();
      if (error) throw error;   // throw, never return null — see useOrgRecord
      return data?.payroll_week_start_day ?? null;
    },
  });
  const weekStartSetting = weekStartRecord.row;
  const weekStartsOn: WeekStartDay = parseWeekStartDay(weekStartSetting);

  /**
   * Re-derive the default month once the org's real timezone arrives.
   *
   * useOrgTimezone returns its America/New_York fallback on the first render
   * and the real value a moment later, so the useState initialiser above can
   * only ever see the fallback. Without this, an org in another zone would open
   * on a month computed for New York — the same class of error this whole
   * change exists to remove, one layer up.
   *
   * Guarded so it only ever fires while the range is still the untouched
   * default: an admin who has picked a custom range must not have it snatched
   * back when the timezone query resolves.
   */
  const rangeTouchedRef = useRef(false);
  const appliedTzRef = useRef<string | null>(null);
  useEffect(() => {
    if (rangeTouchedRef.current) return;
    if (appliedTzRef.current === orgTimezone) return;
    appliedTzRef.current = orgTimezone;
    const now = new Date();
    setDateRange({
      from: orgStartOfMonth(now, orgTimezone),
      to: orgEndOfMonth(now, orgTimezone),
    });
  }, [orgTimezone]);

  /**
   * The key payroll_payments rows are read and written under — grep
   * `week_start` in this file rather than trusting a line number here, which
   * has already gone stale once.
   *
   * This used to be `format(startOfWeek(...), 'yyyy-MM-dd')` — both date-fns
   * calls run in BROWSER-LOCAL time, so an admin working from a different
   * timezone derived a different key for the same payroll week and filed
   * payments under it. This is the only value in the file that reaches the
   * database, so it is the one that had to move first.
   */
  const weekStart = orgDateKey(
    orgStartOfWeek(dateRange.from, orgTimezone, weekStartsOn),
    orgTimezone,
  );

  // Fetch payroll settings
  const payrollSettingsRecord = useOrgRecord<typeof DEFAULT_SETTINGS>({
    key: ['payroll-settings'],
    query: async (organizationId) => {
      const { data, error } = await supabase
        .from('payroll_settings')
        .select('*')
        .eq('organization_id', organizationId)
        .maybeSingle();
      if (error) throw error;
      // null, not DEFAULT_SETTINGS. Returning the defaults here would make a
      // genuine miss indistinguishable from a configured row that happens to
      // match them, and would hide the miss from isMissing entirely.
      if (!data) return null;
      return {
        processing_fee_mode: data.processing_fee_mode,
        processing_fee_percent: Number(data.processing_fee_percent),
        // Tolerates the column not existing yet, so this behaves correctly if
        // it ships ahead of the migration (same pattern as StaffPortal's inline settings fallback).
        processing_fee_flat: Number(
          (data as Record<string, unknown>).processing_fee_flat ?? DEFAULT_SETTINGS.processing_fee_flat,
        ),
        vendor_cost_mode: data.vendor_cost_mode,
        vendor_cost_flat: Number(data.vendor_cost_flat),
        vendor_cost_percent: Number(data.vendor_cost_percent),
        labor_percent_warning_threshold: Number(data.labor_percent_warning_threshold),
        margin_percent_good_threshold: Number(data.margin_percent_good_threshold),
      } as PayrollSettings;
    },
  });
  // Defaults applied ONLY on a genuine miss. A failed read leaves
  // isMissing false, so it surfaces in the banner instead of quietly
  // becoming "no settings configured".
  const payrollSettings = payrollSettingsRecord.isMissing
    ? DEFAULT_SETTINGS
    : payrollSettingsRecord.row;

  const settings = payrollSettings || DEFAULT_SETTINGS;

  // Fetch paid staff for current period
  const { rows: paidPayments, error: paidPaymentsError } = useOrgQuery({
    key: ['payroll-payments', weekStart],
    query: async (organizationId) => {
      const { data, error } = await supabase
        .from('payroll_payments')
        .select('staff_id, payment_method, stripe_transfer_id, amount, paid_at')
        .eq('organization_id', organizationId)
        .eq('week_start', weekStart);
      if (error) throw error;
      return data;
    },
  });

  const paidStaffMap = useMemo(() => {
    const map = new Map<string, { payment_method: string; stripe_transfer_id: string | null; amount: number | null; paid_at: string }>();
    for (const p of paidPayments) {
      map.set(p.staff_id, p);
    }
    return map;
  }, [paidPayments]);

  const paidStaffIds = new Set(paidPayments.map(p => p.staff_id));

  // Fetch staff payout accounts to know who has Stripe set up
  const { rows: payoutAccounts, error: payoutAccountsError } = useOrgQuery({
    key: ['staff-payout-accounts'],
    query: async (organizationId) => {
      const { data, error } = await supabase
        .from('staff_payout_accounts')
        .select('staff_id, account_status, payouts_enabled, stripe_account_id')
        .eq('organization_id', organizationId);
      if (error) throw error;
      return data;
    },
  });

  const payoutAccountMap = useMemo(() => {
    const map = new Map<string, { account_status: string; payouts_enabled: boolean | null; stripe_account_id: string | null }>();
    for (const a of payoutAccounts) {
      map.set(a.staff_id, a);
    }
    return map;
  }, [payoutAccounts]);

  // Payout dialog state
  const [payoutDialog, setPayoutDialog] = useState<{
    open: boolean;
    staffId: string;
    staffName: string;
    amount: number;
  }>({ open: false, staffId: '', staffName: '', amount: 0 });
  const [payoutNotes, setPayoutNotes] = useState('');

  // Process payout mutation
  const payoutMutation = useMutation({
    mutationFn: async ({ staffId, amount, payment_method, notes }: { staffId: string; amount: number; payment_method: string; notes: string }) => {
      if (!organizationId) throw new Error('Missing organization');
      const { data, error } = await supabase.functions.invoke('process-staff-payout', {
        body: {
          staff_id: staffId,
          organization_id: organizationId,
          amount,
          week_start: weekStart,
          payment_method,
          notes,
        },
      });
      // Resolved here, inside the async mutationFn, so the sync onError
      // callback below needs no change — by the time it runs, message is real.
      if (error) throw new Error(await readEdgeFunctionError(error, 'Failed to process payout'));
      if (data?.error) throw new Error(data.error);
      return { ...data, payment_method };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['payroll-payments'] });
      setPayoutDialog({ open: false, staffId: '', staffName: '', amount: 0 });
      setPayoutNotes('');
      if (data.payment_method === 'stripe_transfer') {
        toast.success('Payout sent via Stripe! Funds will arrive in the cleaner\'s bank account.');
      } else {
        toast.success('Payment recorded as paid externally.');
      }
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to process payout');
    },
  });

  // Undo payment mutation
  const undoPaymentMutation = useMutation({
    mutationFn: async ({ staffId, staffName }: { staffId: string; staffName: string }) => {
      if (!organizationId || !user) throw new Error('Missing context');
      await mustAffectRows(
        supabase
          .from('payroll_payments')
          .delete()
          .eq('organization_id', organizationId)
          .eq('staff_id', staffId)
          .eq('week_start', weekStart),
        'Payment not undone. No payroll payment row was removed.',
        { table: 'payroll_payments' },
      );
      return { staffName };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['payroll-payments'] });
      toast.info(`${data.staffName} marked as unpaid`);
    },
    onError: () => toast.error('Failed to undo payment'),
  });

  const openPayoutDialog = (staffId: string, staffName: string, amount: number) => {
    setPayoutDialog({ open: true, staffId, staffName, amount });
    setPayoutNotes('');
  };

  // #13 fix: track which button was pressed so only that one shows a spinner
  const [payingMethod, setPayingMethod] = useState<'stripe_transfer' | 'external' | null>(null);
  const handlePayout = (method: 'stripe_transfer' | 'external') => {
    setPayingMethod(method);
    payoutMutation.mutate({
      staffId: payoutDialog.staffId,
      amount: payoutDialog.amount,
      payment_method: method,
      notes: payoutNotes,
    });
  };

  // Every cleaner in the org, deactivated included. Two views are derived from
  // it — keep them straight, they answer different questions:
  //
  //   `staff`         — active only. Drives WAGE RESOLUTION. calcWage must keep
  //                     receiving undefined for a deactivated cleaner, or the
  //                     computed fallback starts using their rates and pay
  //                     changes. That is a money decision, not this one.
  //   `payrollRoster` — active, PLUS anyone with work in the selected period.
  //                     Drives who gets a Staff Summary row.
  const { rows: allStaffBase, error: allStaffError } = useOrgQuery({
    key: ['staff-payroll'],
    query: async (organizationId) => {
      const { data, error } = await supabase
        .from('staff')
        .select(STAFF_SELECTABLE_COLUMNS)
        .eq('organization_id', organizationId);
      if (error) throw error;
      return data;
    },
  });

  // base_wage is not selectable from `staff` by `authenticated` (managers are
  // the same database role as owners). Owners read it through the owner-only
  // RPC and it is merged back in here so every pay calculation below is
  // unchanged. A manager reaching this page gets no base_wage, which is the
  // point — but this page is owner-only anyway (FinancialRoute).
  const { wagesById } = useOrgStaffWages();

  const allStaff = useMemo(
    () => (allStaffBase as any[]).map((s) => ({ ...s, base_wage: wagesById.get(s.id)?.base_wage ?? null })),
    [allStaffBase, wagesById],
  );

  const staff = useMemo(() => (allStaff as any[]).filter((s) => s.is_active), [allStaff]);

  // Who was excluded from `staff` above. Used to explain a $0 row honestly:
  // a deactivated cleaner's wage is configured, it just wasn't consulted.
  const deactivatedStaffIds = useMemo(
    () => new Set(
      (allStaff as { id: string; is_active: boolean }[])
        .filter((s) => !s.is_active)
        .map((s) => s.id),
    ),
    [allStaff],
  );

  // Display names for anyone, active or not, so a historical row can name the
  // person who actually did the job.
  const staffNameById = useMemo(
    () => new Map<string, string>((allStaff as { id: string; name: string }[]).map((s) => [s.id, s.name])),
    [allStaff],
  );

  // Fetch bookings for selected date range
  const { rows: bookings, error: bookingsError } = useOrgQuery({
    // 'v2-clean-date' busts the persisted (24h) offline cache: rows cached
    // under the old payroll_date window would otherwise keep showing the
    // wrong week's jobs for a day after this fix shipped.
    key: ['bookings-payroll', 'v2-clean-date', dateRange],
    query: async (organizationId) => {
      // dateRange.to is already the org's end-of-month instant. setHours(23,59)
      // re-anchored it to the DEVICE's end of day, which for an admin west of
      // the org pushes the bound hours PAST the period and pulls the next
      // period's bookings into this payroll run.
      const toEndOfDay = orgEndOfDay(dateRange.to, orgTimezone);
      const { data, error } = await supabase
        .from('bookings')
        .select(`*, customer:customers(*), staff:staff(id, user_id, organization_id, name, email, phone, avatar_url, bio, is_active, hourly_rate, percentage_rate, default_hours, tax_classification, calendar_color, home_address, home_latitude, home_longitude, location_permission_status, location_permission_updated_at, created_at, updated_at)`)
        .eq('organization_id', organizationId)
        // Attribute a job to the DAY IT WAS CLEANED, not the day someone got
        // round to ticking it complete. payroll_date (= COALESCE(completed_at,
        // scheduled_at)) pulled last week's jobs into this week whenever they
        // were marked complete late, so the same clean looked like it was being
        // paid twice and the listed dates never matched the schedule. The
        // emailed payroll report already windows on scheduled_at — this brings
        // the page in line with it.
        .gte('scheduled_at', dateRange.from.toISOString())
        .lte('scheduled_at', toEndOfDay.toISOString())
        .order('scheduled_at', { ascending: false })
        .order('id');           // unique tiebreaker — see rule 3
      if (error) throw error;
      return data;
    },
  });

  // Fetch team assignments
  const { rows: teamAssignments, error: teamAssignmentsError } = useOrgQuery({
    key: ['team-assignments-payroll', dateRange],
    query: async (organizationId) => {
      // dateRange.to is already the org's end-of-month instant. setHours(23,59)
      // re-anchored it to the DEVICE's end of day, which for an admin west of
      // the org pushes the bound hours PAST the period and pulls the next
      // period's bookings into this payroll run.
      const toEndOfDay = orgEndOfDay(dateRange.to, orgTimezone);
      const { data: bookingIds } = await supabase
        .from('bookings')
        .select('id')
        .eq('organization_id', organizationId)
        .neq('status', 'cancelled')
        // Same clean-date window as the bookings query above.
        .gte('scheduled_at', dateRange.from.toISOString())
        .lte('scheduled_at', toEndOfDay.toISOString());
      if (!bookingIds?.length) return [];
      const ids = bookingIds.map((b: any) => b.id);
      const { data, error } = await supabase
        .from('booking_team_assignments')
        .select('*')
        .eq('organization_id', organizationId)
        .in('booking_id', ids);
      if (error) throw error;
      return data || [];
    },
  });






  // Refetch payroll data when bookings change (deletions, updates, etc.)
  useEffect(() => {
    if (!organizationId) return;
    const channel = supabase
      .channel(`payroll-bookings-${organizationId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'bookings', filter: `organization_id=eq.${organizationId}` },
        () => {
          queryClient.invalidateQueries({ queryKey: ['bookings-payroll'] });
          queryClient.invalidateQueries({ queryKey: ['team-assignments-payroll'] });
          queryClient.invalidateQueries({ queryKey: ['staff-payroll'] });
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [organizationId, queryClient]);

  // Payroll period config — anchor "today" in the org timezone so the period
  // boundaries don't drift when admin and org are in different timezones.
  const { config: periodConfig, error: periodConfigError } = usePayrollPeriodConfig();
  const currentPeriod = useMemo(() => {
    // Pass the raw instant. getPeriodStart already resolves it in the org's
    // zone. Routing it through getLocalDateInTimezone first rebuilt the date
    // from DEVICE-local components (noon local), so a viewer far enough east —
    // measured from China, UTC+8 — turned "today in the org's zone" into the
    // PREVIOUS org day, shifting the whole pay period back a day and dragging
    // an extra job's pay into the total. That is the 610-vs-790 split between
    // the laptop and the phone.
    const start = getPeriodStart(new Date(), periodConfig, orgTimezone);
    return { start, end: getPeriodEnd(start, periodConfig, orgTimezone) };
  }, [periodConfig, orgTimezone]);
  const nextPeriod = useMemo(() => {
    // Calendar day, not +86400000ms — across DST the latter lands on the wrong
    // date and the next period starts a day early or late.
    const nextStart = orgAddDays(currentPeriod.end, 1, orgTimezone);
    return { start: nextStart, end: getPeriodEnd(nextStart, periodConfig, orgTimezone) };
  }, [currentPeriod, periodConfig, orgTimezone]);

  const currentWeekStart = currentPeriod.start;
  const currentWeekEnd = currentPeriod.end;
  const nextWeekStart = nextPeriod.start;
  const nextWeekEnd = nextPeriod.end;

  const { rows: forecastBookings, error: forecastBookingsError } = useOrgQuery({
    key: ['forecast-bookings', currentWeekStart.toISOString(), nextWeekEnd.toISOString()],
    query: async (organizationId) => {
      // Same as above: nextWeekEnd is org-derived, so its end of day is too.
      const nwEnd = orgEndOfDay(nextWeekEnd, orgTimezone);
      const { data, error } = await supabase
        .from('bookings')
        .select(`*, customer:customers(*), staff:staff(id, user_id, organization_id, name, email, phone, avatar_url, bio, is_active, hourly_rate, percentage_rate, default_hours, tax_classification, calendar_color, home_address, home_latitude, home_longitude, location_permission_status, location_permission_updated_at, created_at, updated_at)`)
        .eq('organization_id', organizationId)
        .neq('status', 'cancelled')
        .gte('scheduled_at', currentWeekStart.toISOString())
        .lte('scheduled_at', nwEnd.toISOString())
        // Sanity cap — the date range is already 2 weeks but a high-volume
        // org (1000+ bookings/week) without this would silently hit
        // supabase-js's 1000-row default and forecast totals would underreport.
        .limit(2000);
      if (error) throw error;
      return data || [];
    },
  });

  const { rows: forecastTeamAssignments, error: forecastTeamAssignmentsError } = useOrgQuery({
    key: ['forecast-team-assignments'],
    enabled: forecastBookings.length > 0,
    query: async (organizationId) => {
      if (!organizationId || !forecastBookings.length) return [];
      const ids = forecastBookings.map((b: any) => b.id);
      const { data, error } = await supabase
        .from('booking_team_assignments')
        .select('*')
        .eq('organization_id', organizationId)
        .in('booking_id', ids);
      if (error) throw error;
      return data || [];
    },
  });

  // Fetch YTD bookings for 1099
  const { rows: ytdBookings, error: ytdBookingsError } = useOrgQuery({
    key: ['bookings-ytd'],
    query: async (organizationId) => {
      const { data, error } = await supabase
        .from('bookings')
        .select('*')
        .eq('organization_id', organizationId)
        .eq('status', 'completed')
        .gte('scheduled_at', orgStartOfYear(new Date(), orgTimezone).toISOString());
      if (error) throw error;
      return data;
    },
  });

  const { rows: ytdTeamAssignments, error: ytdTeamAssignmentsError } = useOrgQuery({
    key: ['team-assignments-ytd'],
    query: async (organizationId) => {
      const { data: bookingIds } = await supabase
        .from('bookings')
        .select('id')
        .eq('organization_id', organizationId)
        .eq('status', 'completed')
        .gte('scheduled_at', orgStartOfYear(new Date(), orgTimezone).toISOString());
      if (!bookingIds?.length) return [];
      const { data, error } = await supabase
        .from('booking_team_assignments')
        .select('*')
        .eq('organization_id', organizationId)
        .in('booking_id', bookingIds.map((b: any) => b.id));
      if (error) throw error;
      return data || [];
    },
  });

  /**
   * Payroll is the one page where a partially-failed load is worse than a
   * failed one. Every figure here is derived by joining these queries together,
   * so if `bookings` fails while `allStaff` succeeds the page still renders a
   * total — just a smaller one, with no indication anything is missing. An
   * understated payroll total is a number someone pays.
   *
   * So the failures are collected rather than handled one by one, and the
   * banner says which loads are incomplete instead of quietly showing less.
   */
  const loadFailures = [
    ['Payments', paidPaymentsError],
    ['Payout accounts', payoutAccountsError],
    ['Staff', allStaffError],
    ['Bookings', bookingsError],
    ['Team assignments', teamAssignmentsError],
    
    ['Forecast bookings', forecastBookingsError],
    ['Forecast assignments', forecastTeamAssignmentsError],
    ['Year-to-date bookings', ytdBookingsError],
    ['Year-to-date assignments', ytdTeamAssignmentsError],
    // Settings failures belong here too. Both fall back to defaults so the page
    // still renders — but a defaulted pay week silently changes which bookings
    // land in the period, which is the kind of wrong that gets paid.
    ['Pay week setting', weekStartRecord.error],
    ['Payroll settings', payrollSettingsRecord.error],
  ].filter(([, e]) => e) as [string, Error][];


  // Thin adapter over the one shared resolver (lib/wageCalculation.ts), which
  // mirrors the payout engine. The only thing added here is `actualPay` — the
  // "confirmed vs estimated" column this page renders. Never reorder the
  // priorities here; change the resolver so every surface moves together.
  const calcWage = (booking: any, staffMember: any, payShareOverride?: number | null) => {
    const r = resolveCleanerPay(booking, staffMember, payShareOverride);
    return {
      calculatedPay: r.calculatedPay,
      actualPay: r.isExact ? r.calculatedPay : null,
      wageType: r.source === 'pay_share' ? 'actual' : r.wageType,
      wageRate: r.source === 'pay_share' ? r.calculatedPay : r.wageRate,
      hoursWorked: r.hoursWorked,
      isMissingPay: r.isMissingPay,
    };
  };

  const getStaffPayEntries = (staffId: string, bookingList: any[], assignmentList: any[]) => {
    const entries: { booking: any; pay: number; hours: number }[] = [];
    const staffMember = staff.find((s) => s.id === staffId);
    const primaryBookings = bookingList.filter((b: any) => b.staff_id === staffId && b.status !== 'cancelled');
    for (const b of primaryBookings) {
      const assignment = assignmentList.find((a: any) => a.booking_id === b.id && a.staff_id === staffId);
      const payShareOverride = assignment?.pay_share != null ? Number(assignment.pay_share) : null;
      const wageInfo = calcWage(b, staffMember, payShareOverride);
      entries.push({ booking: b, pay: wageInfo.calculatedPay, hours: wageInfo.hoursWorked });
    }
    const teamEntries = assignmentList.filter((a: any) => a.staff_id === staffId && !primaryBookings.find((b: any) => b.id === a.booking_id));
    for (const a of teamEntries) {
      const booking = bookingList.find((b: any) => b.id === a.booking_id && b.status !== 'cancelled');
      if (!booking) continue;
      const payShareOverride = a.pay_share != null ? Number(a.pay_share) : null;
      const wageInfo = calcWage(booking, staffMember, payShareOverride);
      entries.push({ booking, pay: wageInfo.calculatedPay, hours: wageInfo.hoursWorked });
    }
    return entries;
  };

  // Booking payroll details with financial columns
  const bookingPayrollDetails: BookingPayrollDetail[] = useMemo(() => {
    const details: BookingPayrollDetail[] = [];
    // Include bookings with a primary staff_id OR any team assignment
    // (team-only bookings have null staff_id but still need to appear for assigned team members)
    const bookingIdsWithTeam = new Set(teamAssignments.map((a: any) => a.booking_id));
    const assignedBookings = bookings.filter((b: any) => b.status !== 'cancelled' && (b.staff_id || bookingIdsWithTeam.has(b.id)));

    for (const b of assignedBookings) {
      // Re-cleans (no service, $0 total) should show $0 across all financial columns
      const isReclean = !b.service_id && Number(b.total_amount) === 0;
      const assignments = teamAssignments.filter((a: any) => a.booking_id === b.id);

      // Membership is the UNION of the team assignments and the primary
      // staff_id — the rule the rest of the codebase already follows
      // (useCleanerConflicts, send-booking-reminder, getStaffPayEntries, the
      // payout engine, bookingEconomics below). This table used to show ONLY
      // the assignments once any existed, which made it the one place a
      // staff_id-without-an-assignment could hide: Staff Summary would still
      // pay that cleaner — and its total is what pre-fills the Stripe payout —
      // while this itemised view showed no line explaining the money.
      const members: { staffId: string; payShare: number | null; rowId: string }[] =
        assignments.map((a: any) => ({
          staffId: a.staff_id,
          payShare: a.pay_share != null ? Number(a.pay_share) : null,
          rowId: `${b.id}-${a.staff_id}`,
        }));
      if (b.staff_id && !members.some((m) => m.staffId === b.staff_id)) {
        members.push({
          staffId: b.staff_id,
          payShare: null,
          // Keep the bare booking id as the row key in the common
          // no-assignments case so this row's identity doesn't change.
          rowId: assignments.length === 0 ? b.id : `${b.id}-${b.staff_id}`,
        });
      }
      if (members.length === 0) continue;

      let totalBookingLabor = 0;
      const memberDetails: any[] = [];
      for (const m of members) {
        const member = staff.find((s) => s.id === m.staffId);
        const wageInfo = isReclean
          ? { calculatedPay: 0, actualPay: 0, wageType: 'reclean', wageRate: 0, hoursWorked: 0, isMissingPay: false }
          : calcWage(b, member, m.payShare);
        totalBookingLabor += wageInfo.calculatedPay;
        memberDetails.push({ m, member, wageInfo });
      }

      const financials = calcBookingFinancials(b, totalBookingLabor, settings);

      // Each cleaner's slice of the booking, weighted by pay — the same split
      // the profit column has always used, now applied to revenue too. Rows of
      // one booking therefore sum to that booking's revenue exactly once, so
      // no total downstream needs a dedupe pass. Falls back to an even split
      // when nobody on the booking has any pay (0/0).
      const shareOf = (pay: number) =>
        totalBookingLabor > 0 ? pay / totalBookingLabor : 1 / members.length;
      const isShared = members.length > 1;

      for (const { m, member, wageInfo } of memberDetails) {
        const share = shareOf(wageInfo.calculatedPay);
        details.push({
          id: m.rowId,
          booking_id: b.id,
          booking_number: b.booking_number,
          customer_name: b.customer ? `${b.customer.first_name} ${b.customer.last_name}` : 'Unknown',
          scheduled_at: b.scheduled_at,
          // The clean date. Showing completed_at here meant a job cleaned on
          // the 14th but ticked off on the 16th was listed as the 16th.
          payroll_date: b.scheduled_at,
          duration: b.duration,
          hours_worked: wageInfo.hoursWorked,
          wage_type: wageInfo.wageType,
          wage_rate: wageInfo.wageRate,
          calculated_pay: wageInfo.calculatedPay,
          actual_pay: wageInfo.actualPay,
          staff_id: m.staffId,
          // Falls back to the all-staff name map so a cleaner deactivated since
          // the job still appears under their own name on a historical row.
          // Never falls back to the booking's PRIMARY cleaner, which is what
          // this did originally — that put a payroll row under the wrong person.
          staff_name: member?.name || staffNameById.get(m.staffId) || 'Unassigned',
          revenue_net: financials.revenueNet * share,
          revenue_is_share: isShared,
          labor_cost: wageInfo.calculatedPay,
          // Labor % is a property of the JOB, not of one person: the whole
          // booking's labor against its whole revenue. (Dividing this
          // cleaner's pay by their revenue share gives the identical figure —
          // the split cancels — but the booking-level form is the honest one,
          // and it's what makes the warning threshold fire on team bookings.)
          labor_percent: financials.laborPercent,
          profit: financials.profit * share,
          margin_percent: financials.marginPercent,
          isMissingPay: wageInfo.isMissingPay,
          payGapReason:
            wageInfo.calculatedPay !== 0
              ? null
              : deactivatedStaffIds.has(m.staffId)
                ? 'deactivated'
                : 'unconfigured',
          // Both columns are nullable and absent on rows predating the
          // hours-reconciliation migration, hence the != null guards rather
          // than a plain Number() — Number(null) is 0, which would read as a
          // real "0 hours worked" and silently zero someone's pay basis.
          isHoursCapped: b.hours_capped_at != null,
          actualHours: b.actual_hours_worked != null ? Number(b.actual_hours_worked) : null,
          cappedHours: b.hours_capped_at != null ? Number(b.hours_capped_at) : null,
        });
      }
    }
    return details;
  // eslint-disable-next-line react-hooks/exhaustive-deps -- deactivatedStaffIds is derived from staff and would cause unnecessary recomputation
  }, [bookings, staff, staffNameById, teamAssignments, settings]);

  // Apply filters
  const filteredBookingPayrollDetails = useMemo(() => {
    let filtered = bookingPayrollDetails;
    if (staffFilterId !== 'all') filtered = filtered.filter((d) => d.staff_id === staffFilterId);
    if (profitFilter === 'negative') filtered = filtered.filter((d) => d.profit < 0);
    if (profitFilter === 'high_labor') filtered = filtered.filter((d) => d.labor_percent > settings.labor_percent_warning_threshold);
    if (profitFilter === 'low_margin') filtered = filtered.filter((d) => d.margin_percent < settings.margin_percent_good_threshold && d.profit >= 0);
    if (profitFilter === 'missing_pay') filtered = filtered.filter((d) => d.isMissingPay || d.calculated_pay === 0);
    if (profitFilter === 'hours_capped') filtered = filtered.filter((d) => d.isHoursCapped);
    return filtered;
  }, [bookingPayrollDetails, staffFilterId, profitFilter, settings]);

  // Who actually has work in the selected period. Taken from the unfiltered
  // detail rows, which already resolve booking membership by the union rule, so
  // this can't disagree with what the Booking Details table shows. Unfiltered on
  // purpose — applying a profit filter shouldn't shrink the roster.
  const staffIdsWithEntries = useMemo(
    () => new Set(bookingPayrollDetails.map((d) => d.staff_id).filter(Boolean)),
    [bookingPayrollDetails],
  );

  // The Staff Summary roster: everyone currently active, plus deactivated
  // cleaners who worked in this period. Without the second half, their pay was
  // itemised in Booking Details but silently missing from the Staff Summary
  // totals — the two tabs disagreed for any period containing a leaver. Gated on
  // having entries so the table doesn't fill with $0 rows for every past hire.
  const payrollRoster = useMemo(
    () => (allStaff as any[]).filter((s) => s.is_active || staffIdsWithEntries.has(s.id)),
    [allStaff, staffIdsWithEntries],
  );

  // One economic picture per booking, computed once, so the Staff Summary and
  // the Booking Details table split revenue and profit the same way and can't
  // report different figures for the same period.
  //
  // Membership deliberately matches getStaffPayEntries — every team assignment
  // PLUS the primary staff_id when it isn't already among them — because that
  // is who this page attributes pay to. Shares therefore always sum to 1 and a
  // booking's revenue is counted exactly once across its cleaners.
  const bookingEconomics = useMemo(() => {
    const map = new Map<string, { revenueNet: number; profit: number; totalLabor: number; memberCount: number }>();
    const bookingIdsWithTeam = new Set(teamAssignments.map((a: any) => a.booking_id));
    const assignedBookings = bookings.filter((b: any) => b.status !== 'cancelled' && (b.staff_id || bookingIdsWithTeam.has(b.id)));

    for (const b of assignedBookings) {
      const isReclean = !b.service_id && Number(b.total_amount) === 0;
      const assignments = teamAssignments.filter((a: any) => a.booking_id === b.id);
      const memberIds = new Set<string>(assignments.map((a: any) => a.staff_id));
      if (b.staff_id) memberIds.add(b.staff_id);

      let totalLabor = 0;
      if (!isReclean) {
        for (const id of memberIds) {
          const member = staff.find((s) => s.id === id);
          const a = assignments.find((x: any) => x.staff_id === id);
          const ps = a?.pay_share != null ? Number(a.pay_share) : null;
          totalLabor += calcWage(b, member, ps).calculatedPay;
        }
      }

      const financials = calcBookingFinancials(b, totalLabor, settings);
      map.set(b.id, {
        revenueNet: financials.revenueNet,
        profit: financials.profit,
        totalLabor,
        memberCount: memberIds.size,
      });
    }
    return map;
  }, [bookings, staff, teamAssignments, settings]);

  // Payroll data per staff with financial intelligence
  const payrollData: StaffWithPayroll[] = useMemo(() => {
    return payrollRoster.map((s) => {
      const entries = getStaffPayEntries(s.id, bookings, teamAssignments);
      const totalHours = entries.reduce((sum, e) => sum + e.hours, 0);
      const totalPay = entries.reduce((sum, e) => sum + e.pay, 0);

      // Revenue and profit attributed to this cleaner: their pay-weighted share
      // of each booking, NOT the whole booking. Crediting every cleaner on a
      // shared job with its full revenue made a $350 two-cleaner booking add
      // $700 to the company totals. Profit comes from calcBookingFinancials, so
      // it carries processing and vendor fees and agrees with Booking Details.
      let revenueAttributed = 0;
      let profitAttributed = 0;
      for (const e of entries) {
        const econ = bookingEconomics.get(e.booking.id);
        if (!econ) continue;
        const share = econ.totalLabor > 0
          ? e.pay / econ.totalLabor
          : (econ.memberCount > 0 ? 1 / econ.memberCount : 0);
        revenueAttributed += econ.revenueNet * share;
        profitAttributed += econ.profit * share;
      }
      const laborPercent = revenueAttributed > 0 ? (totalPay / revenueAttributed) * 100 : 0;

      const ytdEntries = getStaffPayEntries(s.id, ytdBookings, ytdTeamAssignments);
      const ytdEarnings = ytdEntries.reduce((sum, e) => sum + e.pay, 0);

      const upcomingPrimary = bookings.filter((b: any) => b.staff_id === s.id && !['completed', 'cancelled', 'no_show'].includes(b.status)).length;
      const upcomingTeam = teamAssignments.filter((a: any) => {
        if (a.staff_id !== s.id) return false;
        const b = bookings.find((bk: any) => bk.id === a.booking_id);
        return b && !['completed', 'cancelled', 'no_show'].includes(b.status);
      }).length;

      const assignedCleans = entries.length;
      return {
        id: s.id, name: s.name, email: s.email,
        tax_classification: s.tax_classification,
        base_wage: s.base_wage, hourly_rate: s.hourly_rate,
        // On the roster only because they have work in this period.
        isInactive: !s.is_active,
        totalHours: Math.round(totalHours * 100) / 100,
        totalPay: Math.round(totalPay * 100) / 100,
        ytdEarnings: Math.round(ytdEarnings * 100) / 100,
        requiresTaxFiling: s.tax_classification === '1099' && ytdEarnings >= 600,
        upcomingBookings: upcomingPrimary + upcomingTeam,
        assignedCleans,
        avgPayPerClean: assignedCleans > 0 ? Math.round((totalPay / assignedCleans) * 100) / 100 : 0,
        revenueAttributed: Math.round(revenueAttributed * 100) / 100,
        profitAttributed: Math.round(profitAttributed * 100) / 100,
        laborPercent: Math.round(laborPercent * 10) / 10,
      };
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps -- getStaffPayEntries is a stable function derived from already-listed deps
  }, [payrollRoster, staff, bookings, ytdBookings, teamAssignments, ytdTeamAssignments, bookingEconomics]);

  // Summary stats
  const effectivePayrollData = staffFilterId === 'all' ? payrollData : payrollData.filter((s) => s.id === staffFilterId);
  const totalPayroll = effectivePayrollData.reduce((sum, s) => sum + s.totalPay, 0);
  const totalHours = effectivePayrollData.reduce((sum, s) => sum + s.totalHours, 0);
  const totalCleans = effectivePayrollData.reduce((sum, s) => sum + s.assignedCleans, 0);
  // Each cleaner's revenueAttributed is now their share of a booking, so these
  // sum each booking exactly once. Profit is summed rather than derived as
  // revenue - payroll, because the per-booking figure already nets off
  // processing and vendor fees; deriving it here silently dropped them and made
  // this card disagree with the Booking Details profit for the same period.
  const totalRevenue = effectivePayrollData.reduce((sum, s) => sum + s.revenueAttributed, 0);
  const totalProfit = effectivePayrollData.reduce((sum, s) => sum + s.profitAttributed, 0);
  const avgLaborPct = totalRevenue > 0 ? (totalPayroll / totalRevenue) * 100 : 0;
  const contractorsNeedingFiling = payrollData.filter((s) => s.requiresTaxFiling).length;
  const avgPayPerClean = totalCleans > 0 ? totalPayroll / totalCleans : 0;
  const negativeMarginCount = bookingPayrollDetails.filter(d => d.profit < 0).length;
  const missingPayCount = bookingPayrollDetails.filter(d => d.isMissingPay || (d.calculated_pay === 0 && d.staff_id)).length;
  // Split by cause. Reporting these together as "$0 configured" was wrong for
  // the deactivated half and left the admin with no next step.
  const deactivatedPayCount = bookingPayrollDetails.filter(d => d.payGapReason === 'deactivated').length;
  const unconfiguredPayCount = bookingPayrollDetails.filter(d => d.payGapReason === 'unconfigured').length;
  const deactivatedPayNames = Array.from(new Set(
    bookingPayrollDetails.filter(d => d.payGapReason === 'deactivated')
      .map(d => staffNameById.get(d.staff_id as string) ?? 'Unknown'),
  ));
  // Dedupe on booking_id: a multi-cleaner job produces one row per cleaner,
  // and the cap is a property of the JOB, so counting rows would double it.
  const hoursCappedCount = new Set(
    bookingPayrollDetails.filter(d => d.isHoursCapped).map(d => d.booking_id)
  ).size;

  // Filtered totals. revenue_net and profit are per-cleaner shares, so summing
  // rows counts each booking once — no dedupe needed here or in anything added
  // later. The booking COUNT is the exception: rows are per cleaner, so it has
  // to dedupe on booking_id or a two-cleaner job reads as two bookings.
  const filteredTotalHours = filteredBookingPayrollDetails.reduce((sum, b) => sum + b.hours_worked, 0);
  const filteredTotalPay = filteredBookingPayrollDetails.reduce((sum, b) => sum + b.calculated_pay, 0);
  const filteredTotalRevenue = filteredBookingPayrollDetails.reduce((sum, b) => sum + b.revenue_net, 0);
  const filteredTotalProfit = filteredBookingPayrollDetails.reduce((sum, b) => sum + b.profit, 0);
  const filteredBookingCount = new Set(filteredBookingPayrollDetails.map((b) => b.booking_id)).size;

  // Weekly forecast helper
  const calcWeekForecast = (weekBookings: any[], weekTeam: any[]) => {
    let revenueNet = 0;
    let laborTotal = 0;
    let bookingCount = 0;
    let missingPay = 0;
    const seen = new Set<string>();

    for (const b of weekBookings) {
      if (b.status === 'cancelled' || seen.has(b.id)) continue;
      seen.add(b.id);
      bookingCount++;
      const rev = Number(b.subtotal || b.total_amount) - Number(b.discount_amount || 0);
      revenueNet += rev;

      const assignments = weekTeam.filter((a: any) => a.booking_id === b.id);
      if (assignments.length > 0) {
        for (const a of assignments) {
          const member = staff.find((s) => s.id === a.staff_id);
          const ps = a.pay_share != null ? Number(a.pay_share) : null;
          const w = calcWage(b, member, ps);
          laborTotal += w.calculatedPay;
          if (w.calculatedPay === 0) missingPay++;
        }
      } else if (b.staff_id) {
        const sm = staff.find((s) => s.id === b.staff_id);
        const w = calcWage(b, sm);
        laborTotal += w.calculatedPay;
        if (w.calculatedPay === 0) missingPay++;
      }
    }

    const profit = revenueNet - laborTotal;
    const laborPct = revenueNet > 0 ? (laborTotal / revenueNet) * 100 : 0;
    return { revenueNet, laborTotal, profit, laborPct, bookingCount, missingPay };
  };

  // Bucket bookings into weeks using the booking's calendar date *in the org timezone*,
  // not the admin's browser local — otherwise a Sunday-night booking can fall into
  // the wrong week when admin and org are in different timezones.
  // This said format(d, 'yyyy-MM-dd') — the DEVICE's day — directly under a
  // comment promising the org's. The bookings side (getDateInTimezone below)
  // was already org-resolved, so the two ends of the comparison disagreed: an
  // org period ending Sunday 23:59 EDT reads as MONDAY in Manila, so Monday's
  // bookings counted in this week's forecast and next week's both.
  const toDayStr = (d: Date) => orgDateKey(d, orgTimezone);
  const currentWeekStartStr = toDayStr(currentWeekStart);
  const currentWeekEndStr = toDayStr(currentWeekEnd);
  const nextWeekStartStr = toDayStr(nextWeekStart);
  const nextWeekEndStr = toDayStr(nextWeekEnd);
  const currentWeekBookings = forecastBookings.filter((b: any) => {
    const day = getDateInTimezone(b.scheduled_at, orgTimezone);
    return day >= currentWeekStartStr && day <= currentWeekEndStr;
  });
  const nextWeekBookings = forecastBookings.filter((b: any) => {
    const day = getDateInTimezone(b.scheduled_at, orgTimezone);
    return day >= nextWeekStartStr && day <= nextWeekEndStr;
  });

  // eslint-disable-next-line react-hooks/exhaustive-deps -- calcWeekForecast is a stable function; staff is already captured in the bookings data
  const currentWeekForecast = useMemo(() => calcWeekForecast(currentWeekBookings, forecastTeamAssignments), [currentWeekBookings, forecastTeamAssignments, staff]);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- calcWeekForecast is a stable function; staff is already captured in the bookings data
  const nextWeekForecast = useMemo(() => calcWeekForecast(nextWeekBookings, forecastTeamAssignments), [nextWeekBookings, forecastTeamAssignments, staff]);

  const exportCSV = async () => {
    const headers = ['Name', 'Email', 'Tax Classification', 'Base Wage', 'Hours', 'Assigned Cleans', 'Period Pay', 'Revenue', 'Profit', 'Labor %', 'Avg Pay/Clean', 'YTD Earnings'];
    const rows = payrollData.map((s) => [
      s.name, s.email,
      s.tax_classification === 'w2' ? 'W-2 Employee' : '1099 Contractor',
      s.base_wage || s.hourly_rate || 0,
      s.totalHours, s.assignedCleans, s.totalPay,
      s.revenueAttributed, s.profitAttributed, `${s.laborPercent}%`,
      s.avgPayPerClean, s.ytdEarnings,
    ]);
    const csv = matrixToCsv([headers, ...rows]);
    const blob = new Blob([csv], { type: 'text/csv' });
    await saveBlob(blob, `payroll-report-${orgDateKey(dateRange.from, orgTimezone)}-to-${orgDateKey(dateRange.to, orgTimezone)}.csv`);
  };

  const exportDetailedCSV = async () => {
    // Revenue Basis is its own column rather than a suffix on the number, so
    // the revenue column stays parseable in a spreadsheet while still saying
    // when the figure is a split rather than an invoiced amount.
    const headers = ['Date', 'Booking #', 'Staff', 'Customer', 'Hours', 'Wage Type', 'Rate', 'Payment', 'Revenue (Net)', 'Revenue Basis', 'Labor %', 'Profit', 'Margin %'];
    const rows = filteredBookingPayrollDetails.map((b) => [
      getDateInTimezone(b.payroll_date, orgTimezone),
      `#${b.booking_number}`, b.staff_name, b.customer_name,
      b.hours_worked.toFixed(2), b.wage_type,
      b.wage_type === 'percentage' ? `${b.wage_rate}%` : `$${b.wage_rate}`,
      b.calculated_pay.toFixed(2), b.revenue_net.toFixed(2),
      b.revenue_is_share ? 'share of booking' : 'full booking',
      `${b.labor_percent.toFixed(1)}%`, b.profit.toFixed(2), `${b.margin_percent.toFixed(1)}%`,
    ]);
    const csv = matrixToCsv([headers, ...rows]);
    const blob = new Blob([csv], { type: 'text/csv' });
    await saveBlob(blob, `payroll-details-${orgDateKey(dateRange.from, orgTimezone)}-to-${orgDateKey(dateRange.to, orgTimezone)}.csv`);
  };

  const exportCleanerCSV = async () => {
    const headers = ['Date', 'Booking #', 'Staff', 'Customer', 'Hours', 'Pay'];
    const rows = filteredBookingPayrollDetails.map((b) => [
      getDateInTimezone(b.payroll_date, orgTimezone),
      `#${b.booking_number}`, b.staff_name, b.customer_name,
      b.hours_worked.toFixed(2),
      `${fmt(b.calculated_pay)}`,
    ]);
    const totalHours = filteredBookingPayrollDetails.reduce((s, b) => s + b.hours_worked, 0);
    const totalPay = filteredBookingPayrollDetails.reduce((s, b) => s + b.calculated_pay, 0);
    rows.push(['', '', '', `Totals (${filteredBookingPayrollDetails.length} bookings)`, totalHours.toFixed(2), `${fmt(totalPay)}`]);
    const csv = [headers, ...rows].map((row) => row.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const staffSuffix = staffFilterId !== 'all' ? `-${(staff.find((s: any) => s.id === staffFilterId)?.name || 'cleaner').replace(/\s+/g, '_')}` : '';
    await saveBlob(blob, `cleaner-payroll${staffSuffix}-${orgDateKey(dateRange.from, orgTimezone)}-to-${orgDateKey(dateRange.to, orgTimezone)}.csv`);
  };

  const getRowHighlight = (detail: BookingPayrollDetail) => {
    if (detail.profit < 0) return 'bg-destructive/5';
    if (detail.labor_percent > settings.labor_percent_warning_threshold) return 'bg-warning/5';
    if (detail.margin_percent > settings.margin_percent_good_threshold) return 'bg-success/5';
    return '';
  };

  const ForecastCard = ({ title, forecast, weekLabel }: { title: string; forecast: ReturnType<typeof calcWeekForecast>; weekLabel: string }) => (
    <Card>
      <CardHeader className="pb-2">
        <CardDescription>{title}</CardDescription>
        <CardTitle className="text-base">{weekLabel}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="grid grid-cols-2 gap-2 text-sm">
          <div>
            <p className="text-muted-foreground">Revenue (Net)</p>
            <p className="font-semibold">{isTestMode ? '$X,XXX' : `${fmt(forecast.revenueNet)}`}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Payroll</p>
            <p className="font-semibold">{isTestMode ? '$X,XXX' : `${fmt(forecast.laborTotal)}`}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Profit</p>
            <p className={cn("font-semibold", forecast.profit < 0 ? "text-destructive" : "text-success")}>
              {isTestMode ? '$XXX' : `${fmt(forecast.profit)}`}
            </p>
          </div>
          <div>
            <p className="text-muted-foreground">Labor %</p>
            <p className={cn("font-semibold", forecast.laborPct > settings.labor_percent_warning_threshold ? "text-warning" : "")}>
              {isTestMode ? 'XX%' : `${forecast.laborPct.toFixed(1)}%`}
            </p>
          </div>
          <div>
            <p className="text-muted-foreground">Bookings</p>
            <p className="font-semibold">{isTestMode ? 'X' : forecast.bookingCount}</p>
          </div>
          {forecast.missingPay > 0 && (
            <div>
              <p className="text-muted-foreground">Missing Pay</p>
              <p className="font-semibold text-destructive">{forecast.missingPay}</p>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );

  if (tzError || periodConfigError) {
    return (
      <AdminLayout title="Payroll Report" subtitle="Staff wages, profitability, and forecasting">
        <QueryError subject={tzError ? "timezone settings" : "payroll period config"} />
      </AdminLayout>
    );
  }

  return (
    <AdminLayout
      title="Payroll Report"
      subtitle="Staff wages, profitability, and forecasting"
      actions={
        <Button onClick={exportCSV} className="gap-2">
      <SEOHead title="Payroll | TidyWise" description="Manage staff payroll and wages" noIndex />
          <Download className="w-4 h-4" />
          Export CSV
        </Button>
      }
    >
<div className="portal-v2 portal-v2-scroll">
      {loadFailures.length > 0 && (
        <div className="mb-4 rounded-lg border border-destructive/40 bg-destructive/5 p-3">
          <p className="text-sm font-medium text-destructive">
            These figures are incomplete — {loadFailures.length === 1 ? 'one source' : `${loadFailures.length} sources`} failed to load.
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            Do not pay from these totals until they load. Failed: {loadFailures.map(([label]) => label).join(', ')}.
            {(weekStartRecord.error || payrollSettingsRecord.error) &&
              ' Settings could not be read, so defaults are in use. The pay period may be wrong.'}
          </p>
          <p className="text-xs text-muted-foreground mt-1">{loadFailures[0][1].message}</p>
        </div>
      )}
      <PlanFeatureGate feature="payroll">
      {/* Date Range Selector */}
      <div className="flex items-center gap-4 mb-6">
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" className="gap-2">
              <CalendarIcon className="w-4 h-4" />
              {format(dateRange.from, 'MMM d, yyyy')} - {format(dateRange.to, 'MMM d, yyyy')}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0 pointer-events-auto" align="start">
            <Calendar
              mode="range"
              selected={{ from: dateRange.from, to: dateRange.to }}
              onSelect={(range) => {
                if (range?.from) {
                  rangeTouchedRef.current = true;
                  setDateRange({ from: range.from, to: range.to || range.from });
                  setPayPeriodSelected(true);
                }
              }}
              numberOfMonths={2}
              className="pointer-events-auto"
            />
          </PopoverContent>
        </Popover>

        <Button
          variant="secondary"
          className="gap-2"
          onClick={() => {
            const period = getCurrentPeriod(periodConfig, orgTimezone);
            rangeTouchedRef.current = true;
            setDateRange({ from: period.start, to: period.end });
            setPayPeriodSelected(true);
          }}
        >
          <Briefcase className="w-4 h-4" />
          {getPeriodTitle(periodConfig, 'current')}
        </Button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4 mb-6">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-primary/10">
                <DollarSign className="w-5 h-5 text-primary" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Total Payroll</p>
                <p className="text-xl font-bold">{isTestMode ? '$X,XXX' : `${fmt(totalPayroll)}`}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-info/10">
                <TrendingUp className="w-5 h-5 text-info" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Revenue (Net)</p>
                <p className="text-xl font-bold">{isTestMode ? '$X,XXX' : `${fmt(totalRevenue)}`}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className={cn("p-2 rounded-lg", totalProfit >= 0 ? "bg-success/10" : "bg-destructive/10")}>
                {totalProfit >= 0 ? <TrendingUp className="w-5 h-5 text-success" /> : <TrendingDown className="w-5 h-5 text-destructive" />}
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Profit</p>
                <p className={cn("text-xl font-bold", totalProfit < 0 ? "text-destructive" : "text-success")}>
                  {isTestMode ? '$XXX' : `${fmt(totalProfit)}`}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className={cn("p-2 rounded-lg", avgLaborPct > settings.labor_percent_warning_threshold ? "bg-warning/10" : "bg-muted")}>
                <Percent className={cn("w-5 h-5", avgLaborPct > settings.labor_percent_warning_threshold ? "text-warning" : "text-muted-foreground")} />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Avg Labor %</p>
                <p className="text-xl font-bold">{isTestMode ? 'XX%' : `${avgLaborPct.toFixed(1)}%`}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-success/10">
                <Briefcase className="w-5 h-5 text-success" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Assigned Cleans</p>
                <p className="text-xl font-bold">{isTestMode ? 'XX' : totalCleans}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-info/10">
                <Clock className="w-5 h-5 text-info" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Total Hours</p>
                <p className="text-xl font-bold">{isTestMode ? 'XX.X' : totalHours.toFixed(1)}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className={cn("p-2 rounded-lg", contractorsNeedingFiling > 0 ? "bg-warning/10" : "bg-muted")}>
                <AlertTriangle className={cn("w-5 h-5", contractorsNeedingFiling > 0 ? "text-warning" : "text-muted-foreground")} />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">1099 Filing</p>
                <p className="text-xl font-bold">{isTestMode ? 'X' : contractorsNeedingFiling}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Alert Banners */}




      {negativeMarginCount > 0 && (
        <Card className="mb-4 border-destructive/50 bg-destructive/5">
          <CardContent className="p-4">
            <div className="flex items-start gap-3">
              <TrendingDown className="w-5 h-5 text-destructive mt-0.5" />
              <div>
                <h3 className="font-semibold text-destructive">Negative Margin Alert</h3>
                <p className="text-sm text-muted-foreground mt-1">
                  {negativeMarginCount} booking(s) have negative profit — labor cost exceeds revenue.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {missingPayCount > 0 && (
        <Card className="border-amber-500/40 bg-amber-500/5">
          <CardContent className="pt-6">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
              <div className="min-w-0 space-y-2">
                <h3 className="font-semibold">Some cleans show $0 pay</h3>

                {/*
                  Two different causes, stated separately. They used to be one
                  line reading "$0 cleaner pay configured", which is untrue for a
                  deactivated cleaner — their wage IS set, it just isn't read
                  while they're inactive — and it sent an admin to inspect a
                  booking with nothing wrong with it.
                */}
                {deactivatedPayCount > 0 && (
                  <div className="text-sm">
                    <p>
                      <strong>{deactivatedPayCount} clean(s):</strong> cleaner deactivated, wage not applied
                      {deactivatedPayNames.length > 0 && (
                        <span className="text-muted-foreground"> ({deactivatedPayNames.join(', ')})</span>
                      )}
                      .
                    </p>
                    <p className="text-muted-foreground mt-0.5">
                      Their hourly or base wage is still on file. It isn&apos;t used for these cleans
                      because they&apos;re no longer active, so the pay shows as $0 and they can&apos;t be
                      paid from this page. To pay them, record the amount against each clean:{' '}
                      <button
                        type="button"
                        className="underline hover:text-foreground"
                        onClick={() => navigate('/dashboard/bookings')}
                      >
                        set it on the Bookings page
                      </button>{' '}
                      using Bulk edit cleaner wages, which saves the figure onto the clean itself.
                    </p>
                  </div>
                )}

                {unconfiguredPayCount > 0 && (
                  <div className="text-sm">
                    <p><strong>{unconfiguredPayCount} clean(s):</strong> no wage set.</p>
                    <p className="text-muted-foreground mt-0.5">
                      Nothing on the clean and nothing on the cleaner&apos;s staff record. Set a base
                      wage or hourly rate on the cleaner, or a wage on the clean itself.
                    </p>
                  </div>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {hoursCappedCount > 0 && (
        <Card className="mb-4 border-warning/30 bg-warning/5">
          <CardContent className="p-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-warning mt-0.5" />
              <div>
                <h3 className="font-semibold text-warning">Hours Capped</h3>
                <p className="text-sm text-warning mt-1">
                  {hoursCappedCount} booking(s) ran over their scheduled duration by
                  more than the allowed margin. Pay was capped — filter to
                  &ldquo;Hours capped&rdquo; below to review, and raise the booking&rsquo;s
                  pay manually if the extra time was justified.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {contractorsNeedingFiling > 0 && (
        <Card className="mb-6 border-warning/30 bg-warning/5">
          <CardContent className="p-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-warning mt-0.5" />
              <div>
                <h3 className="font-semibold text-warning">1099 Tax Filing Required</h3>
                <p className="text-sm text-warning mt-1">
                  {contractorsNeedingFiling} contractor(s) have earned $600 or more this year and require 1099-NEC filing.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Period Forecast */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        <ForecastCard
          title={getPeriodTitle(periodConfig, 'current')}
          forecast={currentWeekForecast}
          weekLabel={formatPeriodLabel(currentWeekStart, currentWeekEnd, orgTimezone)}
        />
        <ForecastCard
          title={getPeriodTitle(periodConfig, 'next')}
          forecast={nextWeekForecast}
          weekLabel={formatPeriodLabel(nextWeekStart, nextWeekEnd, orgTimezone)}
        />
      </div>

      {/* Tabs */}
      <Tabs defaultValue="summary" className="space-y-4">
        <TabsList>
          <TabsTrigger value="summary">Staff Summary</TabsTrigger>
          <TabsTrigger value="details">Booking Details</TabsTrigger>
          <TabsTrigger value="settings">Payroll Settings</TabsTrigger>
        </TabsList>

        <TabsContent value="summary">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>Staff Payroll Summary</CardTitle>
              <Button variant="outline" size="sm" onClick={exportCSV} className="gap-2">
                <Download className="w-4 h-4" />
                Export Summary
              </Button>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Tax Status</TableHead>
                    <TableHead className="text-right">Cleans</TableHead>
                    <TableHead className="text-right">Hours</TableHead>
                    <TableHead className="text-right">Period Pay</TableHead>
                    <TableHead className="text-right" title="Revenue from the jobs this cleaner worked. On a job shared with other cleaners, only this cleaner's share is counted, so the column sums to real company revenue.">Revenue</TableHead>
                    <TableHead className="text-right" title="This cleaner's share of job profit, after labor, processing and vendor fees.">Profit</TableHead>
                    <TableHead className="text-right">Labor %</TableHead>
                    <TableHead className="text-right">YTD</TableHead>
                     <TableHead>Status</TableHead>
                     <TableHead className="text-center">Actions</TableHead>
                   </TableRow>
                 </TableHeader>
                 <TableBody>
                   {payrollData.map((s) => {
                     const isPaid = paidStaffIds.has(s.id);
                     const paymentInfo = paidStaffMap.get(s.id);
                     const payoutAccount = payoutAccountMap.get(s.id);
                     const hasStripeSetup = payoutAccount?.account_status === 'active' && payoutAccount?.payouts_enabled;

                     return (
                     <TableRow key={s.id}>
                       <TableCell>
                         <div>
                           <p className="font-medium">{maskName(s.name)}</p>
                           <p className="text-xs text-muted-foreground">{maskEmail(s.email)}</p>
                         </div>
                       </TableCell>
                       <TableCell>
                         <Badge variant={s.tax_classification === 'w2' ? 'default' : 'secondary'}>
                           {s.tax_classification === 'w2' ? 'W-2' : '1099'}
                         </Badge>
                       </TableCell>
                       <TableCell className="text-right">{isTestMode ? 'X' : s.assignedCleans}</TableCell>
                       <TableCell className="text-right">{isTestMode ? 'X.X' : s.totalHours}</TableCell>
                       <TableCell className="text-right font-medium text-success">
                         {isTestMode ? '$XXX' : `${fmt(s.totalPay)}`}
                       </TableCell>
                       <TableCell className="text-right">
                         {isTestMode ? '$XXX' : `${fmt(s.revenueAttributed)}`}
                       </TableCell>
                       <TableCell className={cn("text-right font-medium", s.profitAttributed < 0 ? "text-destructive" : "text-success")}>
                         {isTestMode ? '$XXX' : `${fmt(s.profitAttributed)}`}
                       </TableCell>
                       <TableCell className={cn("text-right", s.laborPercent > settings.labor_percent_warning_threshold ? "text-warning font-medium" : "")}>
                         {isTestMode ? 'XX%' : `${s.laborPercent.toFixed(1)}%`}
                       </TableCell>
                       <TableCell className="text-right">
                         {isTestMode ? '$X,XXX' : `${fmt(s.ytdEarnings)}`}
                       </TableCell>
                       <TableCell>
                         <div className="flex items-center gap-2">
                           {s.isInactive && (
                             // Say why a deactivated cleaner is on the list at
                             // all: they have work in this period and still need
                             // paying, but they aren't on the current roster.
                             <Badge variant="outline" className="text-muted-foreground" title="Deactivated cleaner: shown because they have work in this period">
                               Inactive
                             </Badge>
                           )}
                           {s.requiresTaxFiling && (
                             <Badge variant="outline" className="border-warning text-warning">
                               <AlertTriangle className="w-3 h-3 mr-1" />1099
                             </Badge>
                           )}
                           {isPaid && (
                             <Badge variant="default" className="bg-success">
                               <CheckCircle2 className="w-3 h-3 mr-1" />
                               {paymentInfo?.payment_method === 'stripe_transfer' ? 'Paid (Stripe)' : 'Paid (External)'}
                             </Badge>
                           )}
                         </div>
                       </TableCell>
                       <TableCell className="text-center">
                         {isPaid ? (
                           <Button
                             variant="ghost"
                             size="sm"
                             onClick={() => undoPaymentMutation.mutate({ staffId: s.id, staffName: s.name })}
                             disabled={undoPaymentMutation.isPending}
                             className="text-xs text-muted-foreground"
                           >
                             Undo
                           </Button>
                          ) : s.totalPay > 0 && payPeriodSelected ? (
                            <Button
                              size="sm"
                              onClick={() => openPayoutDialog(s.id, s.name, s.totalPay)}
                              className="gap-1"
                            >
                              <DollarSign className="w-3 h-3" />
                              Pay ${s.totalPay.toFixed(2)}
                            </Button>
                          ) : (
                            <span className="text-xs text-muted-foreground">
                              {isTestMode ? '$XXX' : `${fmt(s.totalPay)}`}
                            </span>
                         )}
                       </TableCell>
                     </TableRow>
                   );})}
                   {payrollData.length === 0 && (
                     <TableRow>
                       <TableCell colSpan={11} className="text-center py-8 text-muted-foreground">
                         No staff members found
                       </TableCell>
                     </TableRow>
                   )}
                </TableBody>
              </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="details">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>Booking Payroll Details</CardTitle>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={exportCleanerCSV} className="gap-2">
                  <Download className="w-4 h-4" />
                  Export for Cleaner
                </Button>
                <Button variant="outline" size="sm" onClick={exportDetailedCSV} className="gap-2">
                  <Download className="w-4 h-4" />
                  Export Details
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap items-center gap-2 pb-3">
                <Select value={staffFilterId} onValueChange={setStaffFilterId}>
                  <SelectTrigger className="w-[220px]">
                    <SelectValue placeholder="Filter by cleaner" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All cleaners</SelectItem>
                    {/* Same roster as the Staff Summary — a deactivated cleaner
                        with rows in this period must be filterable to, or you
                        can see their line but not isolate it. */}
                    {[...payrollRoster].sort((a: any, b: any) => (a.name || '').localeCompare(b.name || '')).map((s: any) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name}{s.is_active ? '' : ' (inactive)'}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={profitFilter} onValueChange={setProfitFilter}>
                  <SelectTrigger className="w-[200px]">
                    <SelectValue placeholder="Filter by profitability" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All bookings</SelectItem>
                    <SelectItem value="negative">🔴 Negative profit</SelectItem>
                    <SelectItem value="high_labor">🟡 High labor %</SelectItem>
                    <SelectItem value="low_margin">Low margin</SelectItem>
                    <SelectItem value="missing_pay">Missing pay</SelectItem>
                    <SelectItem value="hours_capped">⏱ Hours capped</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Booking #</TableHead>
                    <TableHead>Staff</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead className="text-right">Hours</TableHead>
                    <TableHead className="text-right">Payment</TableHead>
                    <TableHead className="text-right">Revenue</TableHead>
                    <TableHead className="text-right">Labor %</TableHead>
                    <TableHead className="text-right">Profit</TableHead>
                    <TableHead className="text-right">Margin %</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredBookingPayrollDetails.map((b) => (
                    <TableRow key={b.id} className={getRowHighlight(b)}>
                      <TableCell className="whitespace-nowrap">
                        {formatInTimezone(b.payroll_date, orgTimezone, { month: 'short', day: 'numeric', year: 'numeric' })}
                      </TableCell>
                      <TableCell>#{b.booking_number}</TableCell>
                      <TableCell className="font-medium">{maskName(b.staff_name)}</TableCell>
                      <TableCell>{maskName(b.customer_name)}</TableCell>
                      <TableCell className="text-right">
                        {isTestMode ? 'X.XX' : b.hours_worked.toFixed(2)}
                        {/* Show both figures so a capped row is legible without
                            opening the booking — otherwise the hours column
                            silently reads as if the job took that long. */}
                        {!isTestMode && b.isHoursCapped && b.actualHours != null && (
                          <div className="text-[10px] text-warning whitespace-nowrap">
                            ⏱ {b.actualHours.toFixed(2)}h actual · capped
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="text-right font-medium text-success">
                        <div className="flex items-center justify-end gap-1.5">
                          {isTestMode ? '$XXX' : `${fmt(b.calculated_pay)}`}
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        {isTestMode ? '$XXX' : b.revenue_is_share ? (
                          // Shared booking: this is a split, not an invoiced
                          // amount. Say so on the row, or someone reconciles it
                          // against a client invoice and finds nothing.
                          <span title={`This cleaner's share of booking #${b.booking_number}, split by pay. The client was invoiced the full booking amount.`}>
                            {fmt(b.revenue_net)}
                            <span className="ml-1 text-xs text-muted-foreground">(share)</span>
                          </span>
                        ) : `${fmt(b.revenue_net)}`}
                      </TableCell>
                      <TableCell className={cn("text-right", b.labor_percent > settings.labor_percent_warning_threshold ? "text-warning font-medium" : "")}>
                        {isTestMode ? 'XX%' : `${b.labor_percent.toFixed(1)}%`}
                      </TableCell>
                      <TableCell className={cn("text-right font-medium", b.profit < 0 ? "text-destructive" : "text-success")}>
                        {isTestMode ? '$XXX' : `${fmt(b.profit)}`}
                      </TableCell>
                      <TableCell className={cn("text-right", b.margin_percent < 0 ? "text-destructive" : b.margin_percent > settings.margin_percent_good_threshold ? "text-success" : "")}>
                        {isTestMode ? 'XX%' : `${b.margin_percent.toFixed(1)}%`}
                      </TableCell>
                    </TableRow>
                  ))}
                  {filteredBookingPayrollDetails.length > 0 && (
                    <TableRow className="bg-muted/50 font-semibold border-t-2">
                      <TableCell colSpan={4} className="text-right">
                        Totals ({filteredBookingCount} booking{filteredBookingCount !== 1 ? 's' : ''})
                      </TableCell>
                      <TableCell className="text-right">{isTestMode ? 'X.XX' : filteredTotalHours.toFixed(2)}</TableCell>
                      <TableCell className="text-right text-success">
                        {isTestMode ? '$XXX' : `${fmt(filteredTotalPay)}`}
                      </TableCell>
                      <TableCell className="text-right">
                        {isTestMode ? '$XXX' : `${fmt(filteredTotalRevenue)}`}
                      </TableCell>
                      <TableCell className={cn("text-right", filteredTotalRevenue > 0 && (filteredTotalPay / filteredTotalRevenue) * 100 > settings.labor_percent_warning_threshold ? "text-warning" : "")}>
                        {isTestMode ? 'XX%' : filteredTotalRevenue > 0 ? `${((filteredTotalPay / filteredTotalRevenue) * 100).toFixed(1)}%` : '—'}
                      </TableCell>
                      <TableCell className={cn("text-right", filteredTotalProfit < 0 ? "text-destructive" : "text-success")}>
                        {isTestMode ? '$XXX' : `${fmt(filteredTotalProfit)}`}
                      </TableCell>
                      <TableCell className="text-right">
                        {isTestMode ? 'XX%' : filteredTotalRevenue > 0 ? `${((filteredTotalProfit / filteredTotalRevenue) * 100).toFixed(1)}%` : '—'}
                      </TableCell>
                    </TableRow>
                  )}
                  {bookingPayrollDetails.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={10} className="text-center py-8 text-muted-foreground">
                        No bookings with assigned staff for this period
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="settings" className="space-y-4">
          <PayrollPeriodSettings />
          <PayrollCostSettings />
        </TabsContent>
      </Tabs>
      </PlanFeatureGate>

      {/* Payout Dialog */}
      <Dialog open={payoutDialog.open} onOpenChange={(open) => setPayoutDialog(prev => ({ ...prev, open }))}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Pay {payoutDialog.staffName}</DialogTitle>
            <DialogDescription>
              Choose how to send ${payoutDialog.amount.toFixed(2)} for the period starting {weekStart}
            </DialogDescription>
          </DialogHeader>

          <div className="rounded-lg border border-border bg-muted/50 p-3 text-xs text-muted-foreground space-y-1">
            <p className="font-medium">💡 How payouts work:</p>
            <p><span className="font-medium">Pay via Stripe</span>: Transfers funds from your Stripe balance to the cleaner's bank account. Your Stripe account needs funds (from customer card payments) for this to work.</p>
            <p><span className="font-medium">Mark as Paid Externally</span> — Use this if you paid via cash, Zelle, Venmo, or check. This records the payment for your bookkeeping only.</p>
          </div>

          <div className="space-y-3">
            <Textarea
              placeholder="Optional notes (e.g., 'Includes bonus for extra shift')"
              value={payoutNotes}
              onChange={(e) => setPayoutNotes(e.target.value)}
              rows={2}
            />
          </div>

          <DialogFooter className="flex flex-col gap-2 sm:flex-col">
            {(() => {
              const acct = payoutAccountMap.get(payoutDialog.staffId);
              const hasStripe = acct?.account_status === 'active' && acct?.payouts_enabled;
              return (
                <>
                  <Button
                    onClick={() => handlePayout('stripe_transfer')}
                    disabled={!hasStripe || payoutMutation.isPending}
                    className="w-full gap-2"
                  >
                    {payoutMutation.isPending && payingMethod === 'stripe_transfer' ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <CreditCard className="w-4 h-4" />
                    )}
                    Pay via Stripe — ${payoutDialog.amount.toFixed(2)}
                  </Button>
                  {!hasStripe && (
                    <p className="text-xs text-muted-foreground text-center">
                      This cleaner hasn't set up Stripe payouts yet
                    </p>
                  )}
                  <div className="relative my-1">
                    <div className="absolute inset-0 flex items-center">
                      <span className="w-full border-t" />
                    </div>
                    <div className="relative flex justify-center text-xs uppercase">
                      <span className="bg-background px-2 text-muted-foreground">or</span>
                    </div>
                  </div>
                  <Button
                    variant="outline"
                    onClick={() => handlePayout('external')}
                    disabled={payoutMutation.isPending}
                    className="w-full gap-2"
                  >
                    {payoutMutation.isPending && payingMethod === 'external' ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Banknote className="w-4 h-4" />
                    )}
                    Mark as Paid Externally
                  </Button>
                  <p className="text-xs text-muted-foreground text-center">
                    Use this if you paid via cash, Zelle, Venmo, or check
                  </p>
                </>
              );
            })()}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
</AdminLayout>
  );
}
