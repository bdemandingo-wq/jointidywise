import { AdminLayout } from '@/components/admin/AdminLayout';
import { ServiceDurationAccuracy } from '@/components/admin/ServiceDurationAccuracy';
import { PlanFeatureGate } from '@/components/admin/PlanFeatureGate';
import { StatCard } from '@/components/admin/StatCard';
import { useBookings, useServices, useStaff } from '@/hooks/useBookings';
import { bookingRevenue, sumBookingRevenue } from '@/lib/bookingRevenue';
import { DollarSign, TrendingUp, Users, Calendar, Loader2, Repeat, UserCheck, XCircle, Percent } from 'lucide-react';
import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  Tooltip,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
} from 'recharts';
import { useMemo, useState, useEffect, useRef } from 'react';
import { format, subMonths, isAfter, startOfYear, endOfMonth, isWithinInterval } from 'date-fns';
import { orgStartOfYear, orgEndOfMonth, orgStartOfDay, orgEndOfDay, orgYMD } from '@/lib/orgDateRange';
import { useOrgTimezone } from '@/hooks/useOrgTimezone';
import { formatInTimezone } from '@/lib/timezoneUtils';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ProfitMarginReport } from '@/components/admin/ProfitMarginReport';
import { CleanerPerformanceDashboard } from '@/components/admin/CleanerPerformanceDashboard';
import { ProfitByServiceChart } from '@/components/admin/ProfitByServiceChart';
import { CleanerAvailabilityDashboard } from '@/components/admin/CleanerAvailabilityDashboard';
import { CustomerLifetimeValue } from '@/components/admin/CustomerLifetimeValue';
import { StaffProductivityMetrics } from '@/components/admin/StaffProductivityMetrics';
import { RevenueForecasting } from '@/components/admin/RevenueForecasting';
import { PnLOverview } from '@/components/admin/PnLOverview';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar as DatePicker } from '@/components/ui/calendar';
import { CalendarIcon } from 'lucide-react';
import { Label } from '@/components/ui/label';
import { useOrgId } from '@/hooks/useOrgId';
import { SEOHead } from '@/components/SEOHead';
import { fmt } from '@/lib/activeCurrency';
import { QueryError } from '@/components/QueryError';
import { percentChange, trendDirection } from '@/lib/reportTrends';

// Helper to fetch data - uses any to break TS2589 type depth chain
// Includes pagination limits for performance
async function fetchOrgData(orgId: string, staffIds: string[]): Promise<{ whData: any[]; custData: any[]; recData: any[] }> {
  const client: any = supabase;
  // Filter working_hours directly by organization_id (column added in migration 20260413140000).
  // Falls back to staff-ID filtering if staffIds is provided and org column isn't yet available.
  let whData: any[] = [];
  if (orgId) {
    const whRes = await client.from('working_hours').select('*').eq('organization_id', orgId).limit(500);
    whData = whRes.data || [];
    // Fallback: if the column doesn't exist yet, filter by staff IDs
    if (whRes.error && staffIds.length > 0) {
      const fallback = await client.from('working_hours').select('*').in('staff_id', staffIds).limit(500);
      whData = fallback.data || [];
    }
  }
  // Customers: fetch most recent 1000 for reports (order by created_at desc)
  const custRes = await client.from('customers').select('id, first_name, last_name, email, created_at, is_recurring, address').eq('organization_id', orgId).order('created_at', { ascending: false }).limit(1000);
  // Recurring bookings: fetch all active + limit to 500
  // is_active only: the "Recurring Plans" stat counts live plans, and a paused
  // schedule is not one. Without this filter the card counted every row ever
  // created, so it read higher than the Recurring tab, which at least splits
  // active from paused.
  const recRes = await client.from('recurring_bookings').select('total_amount, frequency, is_active, customer_id').eq('organization_id', orgId).eq('is_active', true).limit(500);
  return {
    whData,
    custData: custRes.data || [],
    recData: recRes.data || [],
  };
}

// Default service colors
const defaultColors = [
  '#3b82f6', '#10b981', '#8b5cf6', '#f59e0b', '#ec4899', '#06b6d4', '#f97316'
];

/**
 * Compact money for chart axes and bar labels.
 *
 * Both used to be wrong, and differently. The axis was `$${v/1000}k` with no
 * rounding, producing "$1.234k" and "$0.5k". The bar label was
 * `${fmt(v/1000)}k` — fmt() is the CURRENCY formatter, so a $999 bar was
 * labelled "$1.00k", reading as $1,000, while its own tooltip said "$999.00".
 * One bar, two numbers, neither matching the axis.
 *
 * Now one function for both, so they cannot disagree again. Values under
 * $1,000 are shown whole rather than as a fraction of a thousand.
 */
const axisMoney = (v: number): string => {
  if (!Number.isFinite(v)) return '';
  // Sign in front of the currency symbol, not after it — "$-1.5k" is not how
  // anyone writes money. Revenue shouldn't go negative here, but a refund-heavy
  // month can, and the axis has to render it either way.
  const sign = v < 0 ? '-' : '';
  const abs = Math.abs(v);
  if (abs >= 1000) {
    const k = abs / 1000;
    // One decimal below 10k ($1.2k), none above ($12k) — keeps the axis narrow.
    return `${sign}$${k < 10 ? k.toFixed(1) : Math.round(k)}k`;
  }
  return `${sign}$${Math.round(abs)}`;
};

export default function ReportsPage() {
  const { organizationId } = useOrgId();
  const { data: bookings = [], isLoading: bookingsLoading } = useBookings();
  const { data: services = [], isLoading: servicesLoading } = useServices();
  const { data: staff = [], isLoading: staffLoading } = useStaff();
  const [workingHours, setWorkingHours] = useState<any[]>([]);
  const [customers, setCustomers] = useState<any[]>([]);
  const [recurringBookings, setRecurringBookings] = useState<any[]>([]);
  // Named "plans", not "clients": this holds a COUNT OF ROWS in
  // recurring_bookings (active only), and one customer can hold several. The
  // old name was recurringClients, which is how a row count ended up rendered
  // inside two P&L cards labelled "Recurring Clients". Dropped recurringCleans
  // and recurringRevenue with it — both were hardcoded 0 and read by nothing,
  // which is its own trap waiting for someone to believe them.
  const [recurringPlans, setRecurringPlans] = useState<number>(0);
  const [dateRange, setDateRange] = useState<{ from: Date; to: Date }>({
    // Placeholder; corrected below once the org's timezone resolves.
    /* eslint-disable-next-line local/no-device-local-dates -- provisional; the effect below re-sets both once the org zone resolves */
    from: startOfYear(new Date()),
    /* eslint-disable-next-line local/no-device-local-dates -- ditto */
    to: endOfMonth(new Date()),
  });
  /**
   * Re-derive the default range once the org's real timezone loads.
   *
   * useOrgTimezone returns its America/New_York fallback on the first render,
   * so the useState initialiser above can only ever see the fallback. Guarded
   * so a range the user has chosen is never snatched back.
   */
  const rangeTouchedRef = useRef(false);
  const appliedTzRef = useRef<string | null>(null);
  const { timezone: orgTimezone, error: tzError } = useOrgTimezone();
  useEffect(() => {
    if (rangeTouchedRef.current) return;
    if (appliedTzRef.current === orgTimezone) return;
    appliedTzRef.current = orgTimezone;
    const now = new Date();
    setDateRange({ from: orgStartOfYear(now, orgTimezone), to: orgEndOfMonth(now, orgTimezone) });
  }, [orgTimezone]);


  useEffect(() => {
    const loadData = async () => {
      if (!organizationId) return;
      const staffIds = (staff as any[]).map(s => s.id);
      const { whData, custData, recData } = await fetchOrgData(organizationId, staffIds);
      
      setWorkingHours(whData);
      setCustomers(custData);
      setRecurringBookings(recData);

      setRecurringPlans(recData.length);
    };
    loadData();
  }, [organizationId, staff]);

  const isLoading = bookingsLoading || servicesLoading || staffLoading;

  // Filter bookings by date range
  const filteredBookings = useMemo(() => {
    return bookings.filter(b => {
      const bookingDate = new Date(b.scheduled_at);
      // Org-day bounds. The picker hands back DEVICE midnights, so without
      // this the last day of the range was cut short (or extended) by the
      // offset — the commonest way a month's total quietly loses a job.
      return isWithinInterval(bookingDate, {
        start: orgStartOfDay(dateRange.from, orgTimezone),
        end: orgEndOfDay(dateRange.to, orgTimezone),
      });
    });
  }, [bookings, dateRange, orgTimezone]);

  const { serviceStats, serviceStatsAllTime, staffStats, monthlyData, totalStats, recurringCleansCount, recurringCleansRevenue } = useMemo(() => {
    // Build a set of recurring customer IDs for quick lookup
    const recurringCustomerIds = new Set<string>();
    customers.forEach((c: any) => {
      if (c.is_recurring) recurringCustomerIds.add(c.id);
    });
    recurringBookings.forEach((rb: any) => {
      if (rb.is_active && rb.customer_id) recurringCustomerIds.add(rb.customer_id);
    });

    // Service breakdown (date range)
    const serviceMap = new Map<string, { name: string; count: number; revenue: number; color: string }>();

    // Service breakdown (all time)
    const serviceAllTimeMap = new Map<string, { name: string; count: number; revenue: number; color: string }>();

    let recurringCleansCount = 0;
    let recurringCleansRevenue = 0;

    filteredBookings.forEach((booking, index) => {
      const serviceId = booking.service?.id || 'refund';
      const existing = serviceMap.get(serviceId) || {
        name: booking.service?.name || 'Refund',
        count: 0,
        revenue: 0,
        color: booking.service?.name ? defaultColors[index % defaultColors.length] : '#ef4444',
      };
      existing.count += 1;
      existing.revenue += bookingRevenue(booking);
      serviceMap.set(serviceId, existing);

      // Count recurring cleans - bookings from recurring customers
      const customerId = booking.customer?.id;
      if (customerId && recurringCustomerIds.has(customerId)) {
        recurringCleansCount += 1;
        recurringCleansRevenue += bookingRevenue(booking);
      }
    });

    // All-time revenue by service (completed only)
    const allTimeCompleted = bookings.filter((b: any) => b.status === 'completed');
    allTimeCompleted.forEach((booking: any, index: number) => {
      const serviceId = booking.service?.id || 'refund';
      const existing = serviceAllTimeMap.get(serviceId) || {
        name: booking.service?.name || 'Refund',
        count: 0,
        revenue: 0,
        color: booking.service?.name ? defaultColors[index % defaultColors.length] : '#ef4444',
      };
      existing.count += 1;
      existing.revenue += bookingRevenue(booking);
      serviceAllTimeMap.set(serviceId, existing);
    });

    const serviceStats = Array.from(serviceMap.values());
    const serviceStatsAllTime = Array.from(serviceAllTimeMap.values());

    // Staff performance - include ALL staff members and show upcoming cleans
    const now = new Date();
    const staffStatsData = staff.map((s, index) => {
      // Get all bookings for this staff member within date range
      const staffBookings = filteredBookings.filter(b => b.staff?.id === s.id);
      
      // Calculate total payment using cleaner_pay_expected (single source of truth)
      const totalPayment = staffBookings.reduce((sum, b) => {
        const bAny = b as any;
        return sum + Number(bAny.cleaner_pay_expected || bAny.cleaner_actual_payment || 0);
      }, 0);
      
      // Count upcoming cleans (scheduled_at > now and not cancelled/completed)
      const upcomingCleans = staffBookings.filter(b => {
        const scheduledDate = new Date(b.scheduled_at);
        return isAfter(scheduledDate, now) && 
               !['completed', 'cancelled', 'no_show'].includes(b.status);
      }).length;

      // Count completed bookings
      const completedBookings = staffBookings.filter(b => b.status === 'completed').length;

      return {
        name: s.name,
        bookings: completedBookings,
        upcomingCleans,
        payment: totalPayment,
      };
    });
    const staffStats = staffStatsData.sort((a, b) => b.payment - a.payment);

    // Monthly data - within date range
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const monthlyData = [];
    for (let i = 5; i >= 0; i--) {
      const monthDate = subMonths(new Date(), i);
      /* eslint-disable local/no-device-local-dates -- monthDate is a chart bucket label */
      const monthIndex = monthDate.getMonth();
      const year = monthDate.getFullYear();
      /* eslint-enable local/no-device-local-dates */
      
      const monthBookings = filteredBookings.filter(b => {
        // Cancelled work is not revenue. Without this the bar counted it,
        // which is why it read higher than Finance's Total Sales for the
        // same window. Matches the status handling in totalStats below.
        // Same definition as the Total Revenue card: completed work only.
        // Counting scheduled jobs drew a ~$90 bar on accounts with $0 revenue.
        if (b.status !== 'completed') return false;
        // bookingDate IS an instant, so the month it counts toward is the org's.
        const bm = orgYMD(new Date(b.scheduled_at), orgTimezone);
        return bm.m - 1 === monthIndex && bm.y === year;
      });
      if (monthBookings.length > 0 || i < 3) {
        monthlyData.push({
          month: months[monthIndex],
          revenue: sumBookingRevenue(monthBookings),
          bookings: monthBookings.length,
        });
      }
    }

    const completedInRange = filteredBookings.filter((b: any) => b.status === 'completed');
    const cancelledInRange = filteredBookings.filter((b: any) => b.status === 'cancelled');
    const totalRevenue = sumBookingRevenue(completedInRange);
    const completedBookings = completedInRange;
    const avgBookingValue = completedBookings.length > 0 ? totalRevenue / completedBookings.length : 0;
    const totalBookings = filteredBookings.length;
    const conversionRate = totalBookings > 0 ? Math.round((completedBookings.length / totalBookings) * 100) : 0;
    const cancellationRate = totalBookings > 0 ? Math.round((cancelledInRange.length / totalBookings) * 100) : 0;

    return {
      serviceStats,
      serviceStatsAllTime,
      staffStats,
      monthlyData,
      totalStats: {
        totalRevenue,
        completedBookings: completedBookings.length,
        avgBookingValue,
        conversionRate,
        totalBookings,
        cancelledCount: cancelledInRange.length,
        cancellationRate,
        cancelledList: cancelledInRange,
      },
      recurringCleansCount,
      recurringCleansRevenue,
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- bookings is the unfiltered source; filteredBookings already captures its content
  }, [filteredBookings, staff, customers, recurringBookings, orgTimezone]);

  const priorStats = useMemo(() => {
    const span = Math.max(0, dateRange.to.getTime() - dateRange.from.getTime());
    const end = new Date(dateRange.from.getTime() - 1);
    const start = new Date(end.getTime() - span);
    const inPrev = bookings.filter((b) => {
      const bookingDate = new Date(b.scheduled_at);
      return isWithinInterval(bookingDate, {
        start: orgStartOfDay(start, orgTimezone),
        end: orgEndOfDay(end, orgTimezone),
      });
    });
    const completed = inPrev.filter((b) => b.status === 'completed');
    const revenue = sumBookingRevenue(completed);
    return {
      revenue,
      bookings: inPrev.length,
      avg: completed.length > 0 ? revenue / completed.length : 0,
      conversion: inPrev.length > 0 ? Math.round((completed.length / inPrev.length) * 100) : 0,
    };
  }, [bookings, dateRange, orgTimezone]);

  const revenueChange = percentChange(totalStats.totalRevenue, priorStats.revenue);
  const bookingsChange = percentChange(totalStats.totalBookings, priorStats.bookings);
  const avgChange = percentChange(totalStats.avgBookingValue, priorStats.avg);
  const completionChange = percentChange(totalStats.conversionRate, priorStats.conversion);

  const [activeTab, setActiveTab] = useState('overview');

  if (tzError) {
    return (
      <AdminLayout title="Reports" subtitle="">
        <QueryError subject="timezone settings" />
      </AdminLayout>
    );
  }

  if (isLoading) {
    return (
      <AdminLayout title="Reports" subtitle="Loading...">
<div className="portal-v2 portal-v2-scroll">
      <SEOHead title="Reports | TidyWise" description="View business reports and analytics" noIndex />
        <div className="flex items-center justify-center h-64">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </div>
      </div>
</AdminLayout>
    );
  }

  return (
    <AdminLayout
      title="Reports"
      subtitle=""
      actions={
        <div className="flex items-center gap-2">
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" className="gap-2">
                <CalendarIcon className="w-4 h-4" />
                <span className="hidden md:inline">{format(dateRange.from, 'MMM d, yyyy')} - {format(dateRange.to, 'MMM d, yyyy')}</span>
                <span className="md:hidden">{format(dateRange.from, 'MMM d')} - {format(dateRange.to, 'MMM d')}</span>
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0 max-w-[calc(100vw-2rem)]" align="end">
              <div className="p-4 space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <Label className="text-xs text-muted-foreground">From</Label>
                    <DatePicker
                      mode="single"
                      selected={dateRange.from}
                      onSelect={(date) => date && (rangeTouchedRef.current = true) && setDateRange(prev => ({ ...prev, from: date }))}
                      className="rounded-md border"
                    />
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">To</Label>
                    <DatePicker
                      mode="single"
                      selected={dateRange.to}
                      onSelect={(date) => date && (rangeTouchedRef.current = true) && setDateRange(prev => ({ ...prev, to: date }))}
                      className="rounded-md border"
                    />
                  </div>
                </div>
              </div>
            </PopoverContent>
          </Popover>
        </div>
      }
    >
<div className="portal-v2 portal-v2-scroll">
      <PlanFeatureGate feature="reports">
      {/* Summary Stats - Uniform Card Size */}
      <div className="grid grid-cols-2 lg:grid-cols-6 gap-3 md:gap-4 mb-6">
        <StatCard
          title="Total Revenue"
          value={`${fmt(totalStats.totalRevenue)}`}
          change={revenueChange ?? undefined}
          changeLabel={revenueChange === null ? undefined : 'vs prior period'}
          trend={trendDirection(revenueChange)}
          icon={<DollarSign className="w-6 h-6" />}
        />
        <StatCard
          title="Total Bookings"
          value={totalStats.totalBookings}
          change={bookingsChange ?? undefined}
          changeLabel={bookingsChange === null ? undefined : 'vs prior period'}
          trend={trendDirection(bookingsChange)}
          icon={<Calendar className="w-6 h-6" />}
        />
        <StatCard
          title={`Recurring Cleans (${orgYMD(new Date(), orgTimezone).y})`}
          value={recurringCleansCount}
          changeLabel={`${fmt(recurringCleansRevenue)} revenue`}
          icon={<Repeat className="w-6 h-6" />}
        />
        <StatCard
          title="Recurring Plans"
          value={recurringPlans}
          icon={<UserCheck className="w-6 h-6" />}
        />
        <StatCard
          title="Avg Booking Value"
          value={`${fmt(totalStats.avgBookingValue)}`}
          change={avgChange ?? undefined}
          changeLabel={avgChange === null ? undefined : 'vs prior period'}
          trend={trendDirection(avgChange)}
          icon={<TrendingUp className="w-6 h-6" />}
        />
        <StatCard
          title="Completion Rate"
          value={`${totalStats.conversionRate}%`}
          change={completionChange ?? undefined}
          changeLabel={completionChange === null ? undefined : 'vs prior period'}
          trend={trendDirection(completionChange)}
          icon={<Users className="w-6 h-6" />}
        />
        <StatCard
          title="Cancellations"
          value={totalStats.cancelledCount}
          changeLabel="in date range"
          icon={<XCircle className="w-6 h-6" />}
        />
        <StatCard
          title="Cancellation Rate"
          value={`${totalStats.cancellationRate}%`}
          changeLabel="of total bookings"
          icon={<Percent className="w-6 h-6" />}
        />
      </div>

      {/* Tabs for different reports */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
        <TabsList className="bg-secondary/50 flex-wrap h-auto gap-1">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="pnl">P&L Overview</TabsTrigger>
          <TabsTrigger value="clv">Customer LTV</TabsTrigger>
          <TabsTrigger value="staff-productivity">Staff Productivity</TabsTrigger>
          <TabsTrigger value="forecasting">Revenue Forecast</TabsTrigger>
          <TabsTrigger value="profit-margin">Profit Margin</TabsTrigger>
          <TabsTrigger value="cleaner-performance">Cleaner Performance</TabsTrigger>
          <TabsTrigger value="cleaner-availability">Availability</TabsTrigger>
          <TabsTrigger value="service-duration">Service Duration</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-6">
          {/* Top Row - 2 Equal Charts */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Monthly Revenue Bar Chart */}
            <div className="bg-card rounded-xl border border-border shadow-sm p-4 h-[380px]">
              <h3 className="font-semibold mb-4">Monthly Revenue</h3>
              <div className="h-[300px]">
                {monthlyData.every((m) => !m.revenue) ? (
                  /* Matches the donut's empty state. Without this the chart drew
                     bare axes, which reads as broken rather than as "no data". */
                  <div className="flex items-center justify-center h-full text-muted-foreground">
                    No revenue in this period
                  </div>
                ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={monthlyData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="month" axisLine={false} tickLine={false} />
                    <YAxis axisLine={false} tickLine={false} tickFormatter={axisMoney} />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: 'hsl(var(--popover))',
                        border: '1px solid hsl(var(--border))',
                        borderRadius: '8px',
                      }}
                      formatter={(value: number) => [`${fmt(value)}`, 'Revenue']}
                    />
                    <Bar
                      dataKey="revenue"
                      fill="hsl(var(--primary))"
                      radius={[4, 4, 0, 0]}
                      label={{
                        position: 'top',
                        formatter: (v: number) => (v > 0 ? axisMoney(v) : ''),
                        fontSize: 11,
                        fill: 'hsl(var(--foreground))',
                      }}
                    />
                  </BarChart>
                </ResponsiveContainer>
                )}
              </div>
            </div>

            {/* Revenue by Service Pie Chart */}
            <div className="bg-card rounded-xl border border-border shadow-sm p-4 h-[380px]">
              <h3 className="font-semibold mb-4">Revenue by Service (All time)</h3>
              <div className="h-[200px]">
                {serviceStatsAllTime.length === 0 ? (
                  <div className="flex items-center justify-center h-full text-muted-foreground">
                    No service data available
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                     <PieChart>
                      <Pie
                        data={serviceStatsAllTime.filter((s) => s.revenue > 0)}
                        cx="50%"
                        cy="50%"
                        innerRadius={32}
                        outerRadius={62}
                        dataKey="revenue"
                        nameKey="name"
                        label={({ name, percent }) => {
                          if (percent < 0.07) return '';
                          const short = name.length > 9 ? name.slice(0, 8) + '…' : name;
                          return `${short} (${(percent * 100).toFixed(0)}%)`;
                        }}
                        labelLine={true}
                        fontSize={10}
                      >
                        {serviceStatsAllTime.filter((s) => s.revenue > 0).map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={entry.color} />
                        ))}
                      </Pie>
                      <Tooltip formatter={(value: number) => [`${fmt(value)}`, 'Revenue']} />
                    </PieChart>
                  </ResponsiveContainer>
                )}
              </div>
              {/* Legend — lists every service incl. Refund (negative), which is
                  excluded from the donut geometry above but shown here with its
                  real amount. */}
              {serviceStatsAllTime.length > 0 && (
                <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                  {serviceStatsAllTime.map((s, i) => (
                    <div key={`svc-legend-${i}`} className="flex items-center gap-2 min-w-0">
                      <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: s.color }} />
                      <span className="flex-1 min-w-0 truncate text-muted-foreground">{s.name}</span>
                      <span className={`shrink-0 font-medium ${s.revenue < 0 ? 'text-destructive' : 'text-foreground'}`}>
                        {fmt(s.revenue)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Second Row - Profit by Service + Staff Performance */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Profit by Service */}
            <ProfitByServiceChart bookings={bookings} />

            {/* Staff Performance Table */}
            <div className="bg-card rounded-xl border border-border shadow-sm p-4 h-[420px] lg:h-full flex flex-col">
              <h3 className="font-semibold mb-4">Staff Performance</h3>
              {staffStats.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  No staff performance data available
                </div>
              ) : (
                <div className="flex-1 min-h-0 overflow-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="text-left border-b border-border">
                        <th className="pb-3 font-medium text-muted-foreground">Staff Member</th>
                        <th className="pb-3 font-medium text-muted-foreground text-right">Completed</th>
                        <th className="pb-3 font-medium text-muted-foreground text-right">Upcoming</th>
                        <th className="pb-3 font-medium text-muted-foreground text-right">Total Payment</th>
                        <th className="pb-3 font-medium text-muted-foreground text-right">Avg/Booking</th>
                      </tr>
                    </thead>
                    <tbody>
                      {staffStats.map((staffMember, index) => (
                        <tr key={staffMember.name} className="border-b border-border/50 last:border-0">
                          <td className="py-3">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-medium text-muted-foreground">#{index + 1}</span>
                              <span className="font-medium">{staffMember.name}</span>
                            </div>
                          </td>
                          <td className="py-3 text-right">{staffMember.bookings}</td>
                          <td className="py-3 text-right">
                            <span className="px-2 py-1 rounded-full text-xs bg-info/10 text-info">
                              {staffMember.upcomingCleans}
                            </span>
                          </td>
                          <td className="py-3 text-right font-semibold text-success">
                            {`${fmt(staffMember.payment)}`}
                          </td>
                          <td className="py-3 text-right">
                            {`$${staffMember.bookings > 0 ? (staffMember.payment / staffMember.bookings).toFixed(0) : 0}`}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>

          {/* Cancellations Breakdown */}
          <div className="bg-card rounded-xl border border-border shadow-sm p-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold flex items-center gap-2">
                <XCircle className="w-4 h-4 text-rose-500" />
                Cancellations Breakdown
              </h3>
              <span className="text-sm text-muted-foreground">
                {totalStats.cancelledCount} cancelled · excluded from revenue & cleaner pay
              </span>
            </div>
            {totalStats.cancelledList.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground text-sm">
                No cancellations in this date range.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left border-b border-border">
                      <th className="pb-3 font-medium text-muted-foreground">Date</th>
                      <th className="pb-3 font-medium text-muted-foreground">Client</th>
                      <th className="pb-3 font-medium text-muted-foreground">Cleaner</th>
                      <th className="pb-3 font-medium text-muted-foreground">Category</th>
                      <th className="pb-3 font-medium text-muted-foreground">Reason</th>
                    </tr>
                  </thead>
                  <tbody>
                    {totalStats.cancelledList.slice(0, 50).map((b: any) => (
                      <tr key={b.id} className="border-b border-border/50 last:border-0">
                        <td className="py-2.5 whitespace-nowrap">
                          {formatInTimezone(b.cancelled_at || b.scheduled_at, orgTimezone, { month: 'short', day: 'numeric', year: 'numeric' })}
                        </td>
                        <td className="py-2.5">
                          {`${b.customer?.first_name || ''} ${b.customer?.last_name || ''}`.trim() || 'Unknown'}
                        </td>
                        <td className="py-2.5">
                          {b.staff?.name ? b.staff.name : <span className="text-muted-foreground">Unassigned</span>}
                        </td>
                        <td className="py-2.5">
                          <span className="px-2 py-0.5 rounded-full text-xs bg-rose-500/10 text-rose-600">
                            {b.cancellation_category || 'Uncategorized'}
                          </span>
                        </td>
                        <td className="py-2.5 text-muted-foreground max-w-xs truncate">
                          {b.cancellation_reason || '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </TabsContent>

        <TabsContent value="pnl">
          {/* recurringStats deliberately NOT passed. Its recurringClients was a
              recurring_bookings ROW count, and it overrode PnLOverview's own
              deduplicated figure inside two cards labelled "Recurring Clients" —
              while the revenue rendered directly beneath came from that
              deduplicated population. The card's numerator and its subtitle came
              from different datasets. PnLOverview computes the right number
              itself; let it. */}
          <PnLOverview bookings={bookings} customers={customers} />
        </TabsContent>

        <TabsContent value="clv">
          <CustomerLifetimeValue bookings={bookings} customers={customers} />
        </TabsContent>

        <TabsContent value="staff-productivity">
          <StaffProductivityMetrics bookings={bookings} staff={staff} />
        </TabsContent>

        <TabsContent value="forecasting">
          <RevenueForecasting bookings={bookings} recurringBookings={recurringBookings} />
        </TabsContent>

        <TabsContent value="profit-margin">
          <ProfitMarginReport bookings={bookings} />
        </TabsContent>

        <TabsContent value="cleaner-performance">
          <CleanerPerformanceDashboard bookings={bookings} staff={staff} />
        </TabsContent>

        <TabsContent value="cleaner-availability">
          <CleanerAvailabilityDashboard 
            bookings={bookings} 
            staff={staff} 
            workingHours={workingHours}
          />
        </TabsContent>

        <TabsContent value="service-duration">
          <ServiceDurationAccuracy />
        </TabsContent>
      </Tabs>
      </PlanFeatureGate>
    </div>
</AdminLayout>
  );
}
