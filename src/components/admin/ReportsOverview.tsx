import { useMemo, useState } from 'react';
import { MetricChart } from './MetricChart';
import { BookingWithDetails } from '@/hooks/useBookings';
import { 
  format, 
  subWeeks, 
  subYears, 
  startOfMonth, 
  startOfQuarter, 
  startOfYear,
  eachDayOfInterval,
  eachWeekOfInterval,
  eachMonthOfInterval,
  startOfDay,
  endOfDay
} from 'date-fns';
import {
  isSameOrgDay,
  orgDateKey,
  orgEndOfDay,
  orgStartOfDay,
  orgStartOfMonth,
  orgStartOfQuarter,
  orgStartOfWeek,
  orgStartOfYear,
  orgYMD,
} from '@/lib/orgDateRange';
import { sumBookingRevenue } from '@/lib/bookingRevenue';
import { useOrgTimezone } from '@/hooks/useOrgTimezone';
import { useTestMode } from '@/contexts/TestModeContext';
import { QueryError } from '@/components/QueryError';

type TimePeriod = '1W' | '4W' | '1Y' | 'MTD' | 'QTD' | 'YTD' | 'ALL';

interface ReportsOverviewProps {
  bookings: BookingWithDetails[];
  customers: { id: string; created_at: string }[];
}

export function ReportsOverview({ bookings, customers }: ReportsOverviewProps) {
  const { timezone: orgTimezone, error: tzError } = useOrgTimezone();
  const [period, setPeriod] = useState<TimePeriod>('ALL');
  const { isTestMode } = useTestMode();

  const periods: TimePeriod[] = ['1W', '4W', '1Y', 'MTD', 'QTD', 'YTD', 'ALL'];

  const dateRange = useMemo(() => {
    // Every boundary here is an ORG day edge. These are the preset buttons on
    // the reports header — 1W, MTD, YTD and so on — so a viewer in another
    // timezone was silently comparing a different window than the office.
    const now = new Date();
    let start: Date;
    const end = orgEndOfDay(now, orgTimezone);

    switch (period) {
      case '1W':
        start = orgStartOfDay(subWeeks(now, 1), orgTimezone);
        break;
      case '4W':
        start = orgStartOfDay(subWeeks(now, 4), orgTimezone);
        break;
      case '1Y':
        start = orgStartOfDay(subYears(now, 1), orgTimezone);
        break;
      case 'MTD':
        start = orgStartOfMonth(now, orgTimezone);
        break;
      case 'QTD':
        // Was orgStartOfDay(startOfQuarter(now), orgTimezone) — the quarter
        // boundary chosen on the DEVICE, then snapped to the org's midnight.
        // MTD and YTD either side of this were already fully org-resolved.
        start = orgStartOfQuarter(now, orgTimezone);
        break;
      case 'YTD':
        start = orgStartOfYear(now, orgTimezone);
        break;
      case 'ALL':
      default: {
        const dates = [
          ...bookings.map(b => new Date(b.scheduled_at)),
          ...customers.map(c => new Date(c.created_at))
        ];
        start = dates.length > 0
          ? orgStartOfDay(new Date(Math.min(...dates.map(d => d.getTime()))), orgTimezone)
          : orgStartOfDay(subYears(now, 2), orgTimezone);
        break;
      }
    }

    return { start, end };
  }, [period, bookings, customers, orgTimezone]);

  const dateRangeLabel = useMemo(() => {
    return `${format(dateRange.start, 'MMM yyyy')} – ${format(dateRange.end, 'MMM yyyy')}`;
  }, [dateRange]);

  const filteredBookings = useMemo(() => {
    return bookings.filter(b => {
      const bookingDate = new Date(b.scheduled_at);
      return bookingDate >= dateRange.start &&
             bookingDate <= dateRange.end &&
             b.status === 'completed';
    });
  }, [bookings, dateRange]);

  const filteredCustomers = useMemo(() => {
    return customers.filter(c => {
      const customerDate = new Date(c.created_at);
      return customerDate >= dateRange.start && customerDate <= dateRange.end;
    });
  }, [customers, dateRange]);

  const chartData = useMemo(() => {
    const { start, end } = dateRange;
    const daysDiff = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
    
    let intervals: Date[];
    let matchFn: (bookingDate: Date, intervalDate: Date) => boolean;
    let labelFn: (intervalDate: Date) => string;

    // Which bucket a booking counts toward is decided in the ORG's zone, not
    // the device's. The previous isSameDay/isSameWeek/isSameMonth compared two
    // instants on the viewer's calendar, and the old suppression below excused
    // it as "only deciding which column a point lands in" — but for the month
    // branch, which column a point lands in IS the month it is attributed to.
    // Viewed from Asia/Manila (UTC+8) against an America/New_York org (UTC-4),
    // a job scheduled after noon on the last day of a month fell into the next
    // one: July 2026 for TIDYWISE read $10,797 here against $11,255 on the
    // Reports page, from two bookings worth $458 landing in August.
    /* eslint-disable local/no-device-local-dates -- eachXOfInterval only
       enumerates the columns across an already org-resolved window. Both the
       bucket a point falls in and the bucket's label are resolved in the org's
       zone immediately below. */
    if (daysDiff <= 14) {
      intervals = eachDayOfInterval({ start, end });
      matchFn = (bookingDate, intervalDate) => isSameOrgDay(bookingDate, intervalDate, orgTimezone);
      labelFn = (intervalDate) => orgDateKey(intervalDate, orgTimezone);
    } else if (daysDiff <= 90) {
      intervals = eachWeekOfInterval({ start, end });
      matchFn = (bookingDate, intervalDate) =>
        orgDateKey(orgStartOfWeek(bookingDate, orgTimezone), orgTimezone) ===
        orgDateKey(orgStartOfWeek(intervalDate, orgTimezone), orgTimezone);
      labelFn = (intervalDate) => orgDateKey(orgStartOfWeek(intervalDate, orgTimezone), orgTimezone);
    } else {
      intervals = eachMonthOfInterval({ start, end });
      matchFn = (bookingDate, intervalDate) => {
        const b = orgYMD(bookingDate, orgTimezone);
        const i = orgYMD(intervalDate, orgTimezone);
        return b.y === i.y && b.m === i.m;
      };
      labelFn = (intervalDate) => {
        const { y, m } = orgYMD(intervalDate, orgTimezone);
        return `${y}-${String(m).padStart(2, '0')}`;
      };
    }
    /* eslint-enable local/no-device-local-dates */

    const grossVolume = intervals.map(date => {
      const intervalBookings = filteredBookings.filter(b => 
        matchFn(new Date(b.scheduled_at), date)
      );
      
      return {
        date: labelFn(date),
        value: sumBookingRevenue(intervalBookings)
      };
    });

    const netVolume = grossVolume.map(d => ({
      ...d,
      value: Math.round(d.value * 0.97 * 100) / 100 // ~3% Stripe fees
    }));

    const newCustomers = intervals.map(date => {
      const intervalCustomers = filteredCustomers.filter(c => 
        matchFn(new Date(c.created_at), date)
      );
      
      return {
        date: labelFn(date),
        value: intervalCustomers.length
      };
    });

    const successfulPayments = intervals.map(date => {
      const intervalBookings = filteredBookings.filter(b => 
        matchFn(new Date(b.scheduled_at), date) && b.payment_status === 'paid'
      );
      
      return {
        date: labelFn(date),
        value: intervalBookings.length
      };
    });

    const spendPerCustomer = intervals.map(date => {
      const intervalBookings = filteredBookings.filter(b => 
        matchFn(new Date(b.scheduled_at), date)
      );
      
      const uniqueCustomers = new Set(intervalBookings.map(b => b.customer?.id).filter(Boolean));
      const totalRevenue = sumBookingRevenue(intervalBookings);
      
      return {
        date: labelFn(date),
        value: uniqueCustomers.size > 0 ? Math.round((totalRevenue / uniqueCustomers.size) * 100) / 100 : 0
      };
    });

    return { grossVolume, netVolume, newCustomers, successfulPayments, spendPerCustomer };
    // orgTimezone belongs here now that bucketing resolves in it: useOrgTimezone
    // returns a fallback on first render and the real zone once settings load,
    // so without it the chart would keep the buckets computed from the fallback.
  }, [filteredBookings, filteredCustomers, dateRange, orgTimezone]);

  const totals = useMemo(() => {
    const grossVolume = sumBookingRevenue(filteredBookings);
    const netVolume = Math.round(grossVolume * 0.97 * 100) / 100; // ~3% Stripe fees
    const newCustomersCount = filteredCustomers.length;
    const successfulPayments = filteredBookings.filter(b => b.payment_status === 'paid').length;
    const uniqueCustomers = new Set(filteredBookings.map(b => b.customer?.id).filter(Boolean));
    const spendPerCustomer = uniqueCustomers.size > 0 
      ? Math.round((grossVolume / uniqueCustomers.size) * 100) / 100 
      : 0;

    return { grossVolume, netVolume, newCustomersCount, successfulPayments, spendPerCustomer };
  }, [filteredBookings, filteredCustomers]);

  if (tzError) {
    return <QueryError subject="timezone settings" />;
  }

  return (
    <div className="min-w-0 overflow-hidden bg-card border border-border rounded-xl p-3 shadow-sm md:p-4">
      <div className="flex min-w-0 items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-foreground">Reports overview</h3>
      </div>
      
      {/* Time period tabs. The right inset keeps the last chip clear of the Tidy button. */}
      <div className="mb-4 pr-[72px]">
      <div className="no-scrollbar -mx-1 flex max-w-full items-center gap-1 overflow-x-auto px-1 pb-2">
        {periods.map((p) => (
          <button
            key={p}
            onClick={() => setPeriod(p)}
            className={`min-h-10 px-3 py-1.5 rounded-full text-sm font-medium transition-colors whitespace-nowrap ${
              period === p
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:bg-muted'
            }`}
          >
            {p}
          </button>
        ))}
      </div>
      </div>

      {/* Metric charts */}
      <div className="min-w-0 space-y-2">
        <MetricChart
          title="Gross volume"
          value={isTestMode ? 'X.XK' : totals.grossVolume}
          data={chartData.grossVolume}
          dateRange={dateRangeLabel}
          isCurrency={!isTestMode}
        />
        
        <MetricChart
          title="Net volume from sales"
          value={isTestMode ? 'X.XK' : totals.netVolume}
          data={chartData.netVolume}
          dateRange={dateRangeLabel}
          isCurrency={!isTestMode}
        />
        
        <MetricChart
          title="New customers"
          value={isTestMode ? 'XX' : totals.newCustomersCount}
          data={chartData.newCustomers}
          dateRange={dateRangeLabel}
        />
        
        <MetricChart
          title="Successful payments"
          value={isTestMode ? 'XX' : totals.successfulPayments}
          data={chartData.successfulPayments}
          dateRange={dateRangeLabel}
        />
        
        <MetricChart
          title="Spend per customer"
          value={isTestMode ? 'XXX' : totals.spendPerCustomer}
          data={chartData.spendPerCustomer}
          dateRange={dateRangeLabel}
          isCurrency={!isTestMode}
        />
      </div>
    </div>
  );
}
