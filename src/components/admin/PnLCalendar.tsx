import { useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Skeleton } from '@/components/ui/skeleton';
import { ChevronLeft, ChevronRight, CalendarIcon } from 'lucide-react';
import {
  format,
  startOfMonth,
  endOfMonth,
  isSameMonth,
  isToday,
  addMonths,
  subMonths,
  startOfWeek,
  endOfWeek,
  startOfYear,
  endOfYear,
} from 'date-fns';
import { cn } from '@/lib/utils';
import { useOrganization } from '@/contexts/OrganizationContext';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useOrgTimezone } from '@/hooks/useOrgTimezone';
import {
  orgStartOfMonth, orgEndOfMonth, orgStartOfWeek, orgEndOfWeek, isOrgToday, orgDateKey, orgYMD, orgAddDays,
  orgStartOfYear, orgSetTimeOnDay, formatInOrgTz,
} from '@/lib/orgDateRange';
import { fmt } from '@/lib/activeCurrency';
import { QueryError } from '@/components/QueryError';

interface DailyPnL {
  revenue: number;
  expenses: number;
  cleanerPay: number;
  fees: number;
  net: number;
}

const formatAmount = (amount: number, showSign = true): string => {
  const abs = Math.abs(amount);
  if (abs >= 1000) {
    return `${showSign ? (amount >= 0 ? '+' : '-') : (amount < 0 ? '-' : '')}${fmt((abs / 1000))}K`;
  }
  return `${showSign ? (amount >= 0 ? '+' : '-') : (amount < 0 ? '-' : '')}${fmt(abs)}`;
};

const WEEKDAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];

type MetricMode = 'revenue' | 'profit';

export function PnLCalendar() {
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [viewMode, setViewMode] = useState<'month' | 'year'>('month');
  const [metricMode, setMetricMode] = useState<MetricMode>('revenue');
  const { organization } = useOrganization();
  const organizationId = organization?.id;
  const { timezone, error: tzError } = useOrgTimezone();

  /*
    Month KEYS: which month is on screen, and the values of the month selector.

    Both halves resolve in the ORG's zone. This was device-local format(), and
    the selector's onValueChange parsed the key back with
    `new Date(v + '-01')` — a date-only ISO string, which JS parses as UTC
    midnight. For an org west of UTC that instant is the LAST day of the
    previous month there, so selecting July produced a currentMonth that was
    June 30 in the org's zone and the whole grid greyed out.

    Fixing only the parse would have left it half broken: the `value` prop and
    the option list were both formatted device-locally, so near a month
    boundary the dropdown could read August while the grid rendered July.
  */
  const monthKeyOf = (d: Date) => {
    const { y, m } = orgYMD(d, timezone);
    return `${y}-${String(m).padStart(2, '0')}`;
  };

  /** Inverse of monthKeyOf. Noon on the 1st in the org's zone — midday keeps
   *  the instant clear of any DST transition at either end of the day. */
  const monthKeyToInstant = (key: string) => {
    const [y, m] = key.split('-').map(Number);
    return orgSetTimeOnDay(y, m, 1, 12, 0, timezone);
  };

  // Determine the query date range based on view mode
  const queryRange = useMemo(() => {
    if (viewMode === 'year') {
      return {
        // The month branch below is org-resolved; this one was not, so the
        // YEAR view queried a window offset by the admin's zone while the month
        // view queried the right one — the same screen disagreeing with itself.
        from: orgStartOfYear(currentMonth, timezone).toISOString(),
        to: orgEndOfMonth(orgSetTimeOnDay(orgYMD(currentMonth, timezone).y, 12, 1, 12, 0, timezone), timezone).toISOString(),
      };
    }
    // For month view, fetch current month's full calendar range (includes overflow days)
    // ORG-time edges. This file was the documented half-converted case: it
    // bucketed each day in org time while computing the month's edges in
    // device time, so at the month boundary one screen disagreed with itself.
    // The query range is the half that matters most — a booking outside it is
    // never fetched, so no amount of correct bucketing can recover it.
    const monthStart = orgStartOfMonth(currentMonth, timezone);
    const monthEnd = orgEndOfMonth(currentMonth, timezone);
    const calStart = orgStartOfWeek(monthStart, timezone, 1);
    const calEnd = orgEndOfWeek(monthEnd, timezone, 1);
    return {
      from: calStart.toISOString(),
      to: calEnd.toISOString(),
    };
  }, [currentMonth, viewMode, timezone]);

  // Self-contained bookings query
  const { data: bookings = [], isLoading: bookingsLoading, error: bookingsError } = useQuery({
    queryKey: ['pnl-calendar-bookings', organizationId, queryRange.from, queryRange.to],
    queryFn: async () => {
      if (!organizationId) return [];
      const { data, error } = await supabase
        .from('bookings')
        .select('id, scheduled_at, total_amount, status, payment_status, cleaner_pay_expected, cleaner_actual_payment, cleaner_wage, cleaner_wage_type, cleaner_override_hours, duration')
        .eq('organization_id', organizationId)
        .gte('scheduled_at', queryRange.from)
        .lte('scheduled_at', queryRange.to)
        .neq('status', 'cancelled')
        // Drafts are not work that happened, so they are not P&L. This query is
        // self-contained rather than going through useBookings, and so had no
        // draft clause at all while every Reports surface excluded them — the
        // two disagreed by whatever drafts existed in the month. Same predicate
        // as useBookings, including the null case: is_draft is nullable, and
        // `.eq(false)` alone silently drops every row that predates the column.
        .or('is_draft.is.null,is_draft.eq.false');
      if (error) throw error;
      return data || [];
    },
    enabled: !!organizationId,
    staleTime: 2 * 60 * 1000,
  });

  // Fetch team pay
  const bookingIds = useMemo(() => bookings.map((b: any) => b.id), [bookings]);
  const { data: teamPaysByBooking = new Map<string, number>(), error: teamPayError } = useQuery({
    queryKey: ['pnl-calendar-team-pay', organizationId, bookingIds.join(',')],
    queryFn: async () => {
      if (!organizationId || bookingIds.length === 0) return new Map<string, number>();
      const { data, error } = await supabase
        .from('booking_team_assignments')
        .select('booking_id, pay_share')
        .eq('organization_id', organizationId)
        .in('booking_id', bookingIds);
      if (error) throw error;
      const map = new Map<string, number>();
      for (const row of data || []) {
        const bid = String((row as any).booking_id);
        const share = Number((row as any).pay_share);
        if (Number.isFinite(share) && share > 0) {
          map.set(bid, (map.get(bid) || 0) + share);
        }
      }
      return map;
    },
    enabled: !!organizationId && bookingIds.length > 0,
  });

  // Fetch expenses
  const { data: expenses = [], error: expensesError } = useQuery({
    queryKey: ['pnl-calendar-expenses', organizationId, queryRange.from, queryRange.to],
    queryFn: async () => {
      if (!organizationId) return [];
      const { data, error } = await supabase
        .from('expenses')
        .select('*')
        .eq('organization_id', organizationId)
        .gte('expense_date', queryRange.from.substring(0, 10))
        .lte('expense_date', queryRange.to.substring(0, 10));
      if (error) throw error;
      return data || [];
    },
    enabled: !!organizationId,
  });

  const queryError = bookingsError || teamPayError || expensesError || tzError;
  const isLoading = bookingsLoading;

  // Calculate daily P&L from bookings and expenses
  const dailyPnL = useMemo(() => {
    const map = new Map<string, DailyPnL>();
    const seenBookingIds = new Set<string>();

    bookings.forEach((b: any) => {
      // Refunded jobs stay in the calendar with zero revenue rather than
      // vanishing. The org refunded the customer but still paid the cleaner
      // and Stripe still kept the processing fee, so the day should show that
      // loss. Skipping the row made a refunded job look free — and made Gross
      // Profit read high by exactly the cleaner pay.
      const isRefunded = b.payment_status === 'refunded';
      if (!isRefunded && b.payment_status !== 'paid' && b.payment_status !== 'partial') return;
      if (seenBookingIds.has(b.id)) return;
      seenBookingIds.add(b.id);

      // Convert scheduled_at to org timezone for date grouping
      const scheduledDate = new Date(b.scheduled_at);
      let dateKey: string;
      try {
        dateKey = new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(scheduledDate);
      } catch {
        // Degraded path only: reached if Intl rejects the zone, in which case
        // the device's day is the best remaining answer.
        /* eslint-disable-next-line local/no-device-local-dates */
        dateKey = format(scheduledDate, 'yyyy-MM-dd');
      }

      const existing = map.get(dateKey) || { revenue: 0, expenses: 0, cleanerPay: 0, fees: 0, net: 0 };

      // `charged` is what the customer was originally billed; `gross` is what
      // the org kept. They differ only on a refund. Fees and cleaner pay are
      // both computed off `charged`: Stripe does not return its fee on a
      // refunded charge, and cleaners keep their pay on a refunded job.
      const charged = Number(b.total_amount) || 0;
      const gross = isRefunded ? 0 : charged;
      const fee = (charged * 0.029) + 0.30;

      let cleanerPay = 0;
      const teamPay = teamPaysByBooking.get(b.id);
      if (teamPay != null && teamPay > 0) {
        cleanerPay = teamPay;
      } else if (b.cleaner_pay_expected != null && Number(b.cleaner_pay_expected) > 0) {
        cleanerPay = Number(b.cleaner_pay_expected);
      } else if (b.cleaner_actual_payment != null && Number(b.cleaner_actual_payment) > 0) {
        cleanerPay = Number(b.cleaner_actual_payment);
      } else if (b.cleaner_wage) {
        const wage = Number(b.cleaner_wage);
        const wageType = b.cleaner_wage_type || 'hourly';
        if (wageType === 'flat') cleanerPay = wage;
        else if (wageType === 'percentage') cleanerPay = (charged * wage) / 100;
        else cleanerPay = wage * (b.cleaner_override_hours || (b.duration / 60));
      }

      existing.revenue += gross;
      existing.fees += fee;
      existing.cleanerPay += cleanerPay;
      existing.net = existing.revenue - existing.fees - existing.cleanerPay - existing.expenses;
      map.set(dateKey, existing);
    });

    expenses.forEach((e: any) => {
      const dateKey = e.expense_date;
      if (!dateKey) return;
      const existing = map.get(dateKey) || { revenue: 0, expenses: 0, cleanerPay: 0, fees: 0, net: 0 };
      existing.expenses += Number(e.amount) || 0;
      existing.net = existing.revenue - existing.fees - existing.cleanerPay - existing.expenses;
      map.set(dateKey, existing);
    });

    return map;
  }, [bookings, expenses, teamPaysByBooking, timezone]);

  // Helper: get the displayed value for a day based on metric mode
  const getDayValue = (pnl: DailyPnL | undefined): number => {
    if (!pnl) return 0;
    if (metricMode === 'revenue') return pnl.revenue;
    // Profit = Client Pay − Cleaner Pay (no fees, no expenses)
    return pnl.revenue - pnl.cleanerPay;
  };

  // Monthly totals for year view
  const monthlyTotals = useMemo(() => {
    const map = new Map<string, number>();
    dailyPnL.forEach((val, dateKey) => {
      const monthKey = dateKey.substring(0, 7);
      const dayValue = getDayValue(val);
      map.set(monthKey, (map.get(monthKey) || 0) + dayValue);
    });
    return map;
  // eslint-disable-next-line react-hooks/exhaustive-deps -- getDayValue is a stable pure function derived from metricMode which is already listed
  }, [dailyPnL, metricMode]);

  // Generate calendar days (Monday start)
  const calendarDays = useMemo(() => {
    // Must match the query range above exactly, or the grid renders cells for
    // days whose data was never fetched.
    const monthStart = orgStartOfMonth(currentMonth, timezone);
    const monthEnd = orgEndOfMonth(currentMonth, timezone);
    const calendarStart = orgStartOfWeek(monthStart, timezone, 1);
    const calendarEnd = orgEndOfWeek(monthEnd, timezone, 1);

    // Stepped in the ORG's days, not the device's.
    //
    // This was eachDayOfInterval(), which walks device-local midnights. Every
    // cell instant was then read back with orgDateKey/orgYMD in the org's zone,
    // so for a viewer far enough east the two disagreed by a full day: on a
    // UTC+8 device viewing a UTC-4 org, device midnight on Jul 1 is
    // 2026-06-30T16:00Z, which is still Jun 30 in New York. The whole grid
    // shifted back one day — July 1 greyed as out-of-month, August 1 shown as
    // in-month, and every cell's figures were the previous day's, because the
    // dailyPnL lookup key came from that same shifted instant.
    //
    // orgAddDays resolves each step to org-local midnight, so the instant a
    // cell carries is the day it claims to be.
    const days: Date[] = [];
    for (let d = calendarStart; d <= calendarEnd; d = orgAddDays(d, 1, timezone)) {
      days.push(d);
      // Guard against a malformed range spinning forever.
      if (days.length > 45) break;
    }
    return days;
  }, [currentMonth, timezone]);

  const navigateMonth = (dir: 'prev' | 'next') => {
    setCurrentMonth(prev => dir === 'prev' ? subMonths(prev, 1) : addMonths(prev, 1));
  };

  const goToToday = () => {
    setCurrentMonth(new Date());
    setViewMode('month');
  };

  // The org's year, not the device's — at a New Year boundary these differ.
  const currentYear = orgYMD(currentMonth, timezone).y;

  // Monthly total for header
  const monthTotal = useMemo(() => {
    let total = 0;
    const monthKey = monthKeyOf(currentMonth);
    dailyPnL.forEach((val, dateKey) => {
      if (dateKey.startsWith(monthKey)) total += getDayValue(val);
    });
    return total;
  // eslint-disable-next-line react-hooks/exhaustive-deps -- getDayValue and monthKeyOf are stable pure functions; their inputs (metricMode, currentMonth) are already listed
  }, [dailyPnL, currentMonth, metricMode]);

  const getValueColor = (value: number, hasData: boolean) => {
    if (!hasData) return 'text-muted-foreground/50';
    if (metricMode === 'revenue') return 'text-emerald-500';
    if (value < 0) return 'text-destructive';
    if (value === 0) return 'text-muted-foreground';
    return 'text-emerald-500';
  };

  const getCellBg = (value: number, hasData: boolean) => {
    if (!hasData) return 'border-transparent';
    if (metricMode === 'revenue') return 'bg-emerald-500/10 border-emerald-500/30';
    if (value < 0) return 'bg-destructive/10 border-destructive/30';
    if (value === 0) return 'border-border';
    return 'bg-emerald-500/10 border-emerald-500/30';
  };

  if (queryError) {
    return (
      <Card className="bg-[hsl(var(--card))] border-border">
        <CardHeader className="pb-3">
          <CardTitle className="text-lg font-bold">P&L Calendar</CardTitle>
        </CardHeader>
        <CardContent><QueryError subject="P&L data" /></CardContent>
      </Card>
    );
  }

  return (
    <Card className="bg-[hsl(var(--card))] border-border">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <CardTitle className="text-lg font-bold">P&L Calendar</CardTitle>
          <div className="flex items-center gap-2">
            {/* Today button */}
            <Button variant="outline" size="sm" className="min-h-[44px] text-xs gap-1" onClick={goToToday}>
              <CalendarIcon className="h-3 w-3" />
              Today
            </Button>

            {/* Revenue / Profit toggle */}
            <ToggleGroup
              type="single"
              value={metricMode}
              onValueChange={(v) => v && setMetricMode(v as MetricMode)}
              className="bg-muted rounded-lg p-0.5"
            >
              <ToggleGroupItem value="revenue" className="text-xs px-3 min-h-[44px] data-[state=on]:bg-background data-[state=on]:shadow-sm rounded-md">
                Revenue
              </ToggleGroupItem>
              <ToggleGroupItem value="profit" className="text-xs px-3 min-h-[44px] data-[state=on]:bg-background data-[state=on]:shadow-sm rounded-md">
                Gross Profit
              </ToggleGroupItem>
            </ToggleGroup>

            {/* Month / Year toggle */}
            <ToggleGroup
              type="single"
              value={viewMode}
              onValueChange={(v) => v && setViewMode(v as 'month' | 'year')}
              className="bg-muted rounded-lg p-0.5"
            >
              <ToggleGroupItem value="month" className="text-xs px-3 min-h-[44px] data-[state=on]:bg-background data-[state=on]:shadow-sm rounded-md">
                Month
              </ToggleGroupItem>
              <ToggleGroupItem value="year" className="text-xs px-3 min-h-[44px] data-[state=on]:bg-background data-[state=on]:shadow-sm rounded-md">
                Year
              </ToggleGroupItem>
            </ToggleGroup>

            <Select
              value={monthKeyOf(currentMonth)}
              onValueChange={(v) => setCurrentMonth(monthKeyToInstant(v))}
            >
              <SelectTrigger className="w-[120px] min-h-[44px] text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Array.from({ length: 12 }, (_, i) => {
                  // Built straight from (year, month) rather than round-tripping
                  // through a device-local Date — `new Date(y, i, 1)` is device
                  // midnight, which for a far-east viewer is the previous month
                  // in the org's zone, so monthKeyOf would have labelled it one
                  // month early.
                  const key = `${currentYear}-${String(i + 1).padStart(2, '0')}`;
                  return (
                    <SelectItem key={i} value={key}>
                      {formatInOrgTz(monthKeyToInstant(key), timezone, { month: 'short', year: 'numeric' })}
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Month navigation */}
        {viewMode === 'month' && (
          <div className="flex items-center justify-between mt-2">
            <Button variant="ghost" size="icon" className="h-10 w-10 min-h-[44px] min-w-[44px]" onClick={() => navigateMonth('prev')}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <div className="text-center">
              <span className="text-sm font-medium">{formatInOrgTz(currentMonth, timezone, { month: 'long', year: 'numeric' })}</span>
              {!isLoading && (
                <span className={cn(
                  "ml-2 text-sm font-bold",
                  getValueColor(monthTotal, monthTotal !== 0)
                )}>
                  {formatAmount(monthTotal, false)}
                </span>
              )}
              {isLoading && <Skeleton className="inline-block ml-2 h-4 w-16" />}
            </div>
            <Button variant="ghost" size="icon" className="h-10 w-10 min-h-[44px] min-w-[44px]" onClick={() => navigateMonth('next')}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        )}

        {/* getDayValue for 'profit' is revenue - cleanerPay. It deliberately
            omits fees and expenses, so it is NOT the same figure as the Net
            Profit card on /dashboard/finance. Say so rather than leaving it
            to be discovered from a mismatch. */}
        {metricMode === 'profit' && (
          <p className="mt-2 text-xs text-muted-foreground">
            Revenue minus cleaner pay only. Processing fees and expenses are not
            taken out here — the Net Profit card includes those.
          </p>
        )}
      </CardHeader>

      <CardContent className="pt-0">
        {viewMode === 'month' ? (
          <>
            {/* Weekday headers */}
            <div className="grid grid-cols-7 gap-1 mb-1">
              {WEEKDAYS.map((day) => (
                <div key={day} className="text-center text-[10px] font-semibold text-muted-foreground py-1">
                  {day}
                </div>
              ))}
            </div>

            {/* Calendar grid */}
            <div className="grid grid-cols-7 gap-1">
              {calendarDays.map((day) => {
                // Org-keyed, matching how dailyPnL is built (Intl 'en-CA' in the
                // org's zone). This was device-local format(), so for a viewer
                // in a different zone the lookup key was a day off from the
                // data key and every cell showed the wrong day's figures — or
                // none. That is the "disagrees with itself" failure this file
                // was singled out for; the query range was converted and the
                // lookup was not.
                const dateKey = orgDateKey(day, timezone);
                const pnl = dailyPnL.get(dateKey);
                // Year as well as month: comparing only .m made July 2025 and
                // July 2026 indistinguishable. Harmless in a six-week grid, but
                // the check is meant to say "this cell belongs to the displayed
                // month", and a month number alone does not say that.
                const cellYMD = orgYMD(day, timezone);
                const viewYMD = orgYMD(currentMonth, timezone);
                const inMonth = cellYMD.y === viewYMD.y && cellYMD.m === viewYMD.m;
                const today = isOrgToday(day, timezone);
                const dayValue = getDayValue(pnl);
                const hasData = pnl != null && pnl.revenue > 0;

                return (
                  <div
                    key={day.toISOString()}
                    className={cn(
                      'relative flex flex-col items-center justify-center rounded-md min-h-[52px] sm:min-h-[64px] border transition-colors cursor-pointer active:scale-95',
                      !inMonth && 'opacity-30',
                      today && 'ring-1 ring-primary',
                      getCellBg(dayValue, hasData)
                    )}
                  >
                    <span className={cn(
                      'text-xs font-medium',
                      today && 'text-primary font-bold',
                      !inMonth && 'text-muted-foreground'
                    )}>
                      {today ? 'Today' : cellYMD.d}
                    </span>
                    {isLoading && inMonth ? (
                      <Skeleton className="h-3 w-10 mt-0.5" />
                    ) : hasData ? (
                      <span className={cn(
                        "text-[11px] sm:text-xs font-bold mt-0.5",
                        getValueColor(dayValue, true)
                      )}>
                        {formatAmount(dayValue, false)}
                      </span>
                    ) : inMonth ? (
                      <span className="text-[10px] text-muted-foreground/50 mt-0.5">--</span>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </>
        ) : (
          /* Year view */
          <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
            {Array.from({ length: 12 }, (_, i) => {
              // Org-local, for the same reason as the month selector above:
              // clicking a month here calls setCurrentMonth(monthDate), and a
              // device-local midnight is the PREVIOUS month in the org's zone
              // for a far-east viewer — so tapping "Jul" landed the grid on
              // June. The key is built from (year, month) directly rather than
              // formatted off a Date, so it cannot drift from monthlyTotals,
              // which is keyed org-locally off dailyPnL.
              const monthKey = `${currentYear}-${String(i + 1).padStart(2, '0')}`;
              const monthDate = orgSetTimeOnDay(currentYear, i + 1, 1, 12, 0, timezone);
              const value = monthlyTotals.get(monthKey) || 0;
              const hasData = value !== 0;

              return (
                <button
                  key={i}
                  onClick={() => {
                    setCurrentMonth(monthDate);
                    setViewMode('month');
                  }}
                  className={cn(
                    'flex flex-col items-center justify-center rounded-lg p-3 border transition-all hover:shadow-sm',
                    getCellBg(value, hasData),
                    hasData && value > 0 && 'hover:bg-emerald-500/20',
                    !hasData && 'border-border hover:bg-muted/50'
                  )}
                >
                  <span className="text-sm font-medium">{formatInOrgTz(monthDate, timezone, { month: 'short' })}</span>
                  {isLoading ? (
                    <Skeleton className="h-4 w-12 mt-1" />
                  ) : (
                    <span className={cn(
                      'text-sm font-bold mt-1',
                      getValueColor(value, hasData)
                    )}>
                      {hasData ? formatAmount(value, false) : '--'}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
