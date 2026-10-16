import { useMemo, useEffect, useCallback, lazy, Suspense } from 'react';
import { isOrgToday } from '@/lib/orgDateRange';
import { useOrgTimezone } from '@/hooks/useOrgTimezone';
import { useSearchParams } from 'react-router-dom';
import { AdminLayout } from '@/components/admin/AdminLayout';
import { TodayStats } from '@/components/admin/TodayStats';
import { UpcomingBookings } from '@/components/admin/UpcomingBookings';
import { OnboardingChecklist } from '@/components/admin/OnboardingChecklist';
import {
  useDashboardUpcoming,
  useDashboardChart,
  useDashboardCustomers,
  BookingWithDetails,
} from '@/hooks/useBookings';
import { QueryError } from '@/components/QueryError';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { useQueryClient } from '@tanstack/react-query';
import { BookingCardSkeleton } from '@/components/ui/page-skeleton';
import { useOrganization } from '@/contexts/OrganizationContext';
import { useTidyWiseTrialStarted } from '@/hooks/useTidyWiseTrialStarted';
import { SEOHead } from '@/components/SEOHead';
import { usePullToRefresh } from '@/hooks/usePullToRefresh';
import { PullToRefreshIndicator } from '@/components/admin/PullToRefreshIndicator';
import { requestAdminNotificationRefresh } from '@/lib/adminNotificationRefresh';
import { usePublicGrowth } from '@/hooks/usePublicGrowth';
import { ActivityFeedCard } from '@/components/growth/ActivityFeedCard';
import { rowsForCurrentOrg } from '@/lib/sameOrgPlaceholder';
import { DASHBOARD_ACTIVITY_FEED_ENABLED } from '@/lib/dashboardActivityFeed';
import { dashboardSideReads } from '@/lib/dashboardLoad';


// Lazy load the heavy ReportsOverview component
const ReportsOverview = lazy(() => import('@/components/admin/ReportsOverview').then(m => ({ default: m.ReportsOverview })));

function ReportsOverviewSkeleton() {
  return (
    <div className="min-w-0 overflow-hidden rounded-xl border border-border bg-card p-3 shadow-sm md:p-4" aria-busy="true" aria-label="Loading reports overview">
      <div className="mb-4 h-6 w-40 rounded bg-muted" />
      <div className="mb-4 flex gap-2 overflow-hidden">
        {Array.from({ length: 7 }, (_, index) => (
          <div key={index} className="h-8 w-12 shrink-0 rounded-full bg-muted" />
        ))}
      </div>
      <div className="space-y-2">
        {Array.from({ length: 5 }, (_, index) => (
          <div key={index} className="border-t border-border py-5">
            <div className="h-4 w-28 rounded bg-muted" />
            <div className="mt-2 h-8 w-24 rounded bg-muted" />
            <div className="mt-2 h-3 w-32 rounded bg-muted" />
            <div className="mt-4 h-36 rounded-lg border border-border/60 bg-muted/40" />
          </div>
        ))}
      </div>
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
      <div className="xl:col-span-2 space-y-6">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4" data-tour-id="today-stats">
          {[1, 2, 3].map((i) => (
            <div key={i} className="bg-card rounded-xl p-4 border border-border shadow-sm animate-pulse">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 rounded-xl bg-primary/10" />
                <div className="h-4 w-20 bg-muted rounded" />
              </div>
              <div className="h-8 w-24 bg-muted rounded" />
            </div>
          ))}
        </div>
        <div className="bg-card rounded-xl p-4 border border-border shadow-sm animate-pulse">
          <div className="h-5 w-32 bg-muted rounded mb-4" />
          <div className="h-64 bg-muted/50 rounded-xl" />
        </div>
      </div>
      <div className="space-y-4">
        <div className="h-5 w-40 bg-muted rounded animate-pulse" />
        {[1, 2, 3].map((i) => (
          <BookingCardSkeleton key={i} />
        ))}
      </div>
    </div>
  );
}

function getGreeting() {
  // "Good morning" is about the VIEWER's time of day, not the business's. A
  // person opening this at 9am in Manila should be greeted accordingly even
  // if the org is in New York — this is one of the few places where the
  // device clock is the correct source.
  /* eslint-disable-next-line local/no-device-local-dates -- greeting reflects the viewer's local time of day, deliberately */
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

export default function AdminDashboard() {
  const { organization } = useOrganization();
  const orgId = organization?.id;
  useTidyWiseTrialStarted(organization);
  const upcoming = useDashboardUpcoming();
  // isPlaceholderData is the previous query. Keep it only when its org id
  // matches. A switch to another org clears the rows and shows the skeleton.
  const upcomingView = rowsForCurrentOrg(upcoming.data, orgId, upcoming.isPlaceholderData);
  const bookings = upcomingView.rows;
  const bookingsLoading = upcoming.isLoading || upcomingView.blocked;
  const upcomingReady = !bookingsLoading;
  const chart = useDashboardChart(upcomingReady);
  const dashboardCustomers = useDashboardCustomers(upcomingReady);
  const chartView = rowsForCurrentOrg(chart.data, orgId, chart.isPlaceholderData);
  const customerView = rowsForCurrentOrg(dashboardCustomers.data, orgId, dashboardCustomers.isPlaceholderData);
  const chartBookings = chartView.blocked ? undefined : chart.data;
  const customers = useMemo(() => customerView.rows, [customerView.rows]);
  const chartsReady = !chartView.blocked
    && !customerView.blocked
    && chart.data != null
    && (dashboardCustomers.data != null || dashboardCustomers.isError);
  const queryClient = useQueryClient();
  // The plan box moved to Settings. Lifetime spots are read there, so this
  // page does not show the upgrade card. public-growth still waits until the
  // jobs list is ready, and it stays off while the activity feed is off.
  const sideReads = dashboardSideReads({
    upcomingReady,
    showUpgrade: false,
    feedEnabled: DASHBOARD_ACTIVITY_FEED_ENABLED,
  });
  const growth = usePublicGrowth(sideReads.growth);
  const [searchParams, setSearchParams] = useSearchParams();

  // Handle return from Stripe Checkout
  useEffect(() => {
    if (searchParams.get('subscription') === 'success') {
      toast.success('Subscription activated! You now have full access.');
      searchParams.delete('subscription');
      setSearchParams(searchParams, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  useEffect(() => {
    if (!orgId) return;
    // Imports and recurring generation emit a change per row. Invalidating
    // on each one refetches the 1,500-row chart once per row. One refetch
    // after the burst settles shows the same rows.
    let bookingsTimer = 0;
    let customersTimer = 0;
    const schedule = (which: 'bookings' | 'customers') => {
      if (which === 'bookings') {
        window.clearTimeout(bookingsTimer);
        bookingsTimer = window.setTimeout(() => {
          void queryClient.invalidateQueries({ queryKey: ['bookings'] });
        }, 400);
      } else {
        window.clearTimeout(customersTimer);
        customersTimer = window.setTimeout(() => {
          void queryClient.invalidateQueries({ queryKey: ['customers'] });
        }, 400);
      }
    };
    const channel = supabase
      .channel(`dashboard-realtime-${orgId}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'bookings',
        filter: `organization_id=eq.${orgId}`,
      }, () => {
        schedule('bookings');
      })
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'customers',
        filter: `organization_id=eq.${orgId}`,
      }, () => {
        schedule('customers');
      })
      .subscribe();

    return () => {
      window.clearTimeout(bookingsTimer);
      window.clearTimeout(customersTimer);
      void supabase.removeChannel(channel);
    };
  }, [orgId, queryClient]);
  const { timezone: orgTimezone } = useOrgTimezone();

  const handlePullRefresh = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['bookings'] }),
      queryClient.invalidateQueries({ queryKey: ['customers'] }),
      queryClient.invalidateQueries({ queryKey: ['onboarding-checklist'] }),
    ]);
    requestAdminNotificationRefresh();
  }, [queryClient]);
  const { refreshing, pullDistance, handlers: pullHandlers } = usePullToRefresh(handlePullRefresh);


  const todayStats = useMemo(() => {
    // isOrgToday, not date-fns isToday. isToday compares against the BROWSER's
    // calendar day, which is why this card read $888 in Miami and $616 on a
    // phone in Manila on 2026-07-31: the phone's "today" ran from noon on the
    // 31st to noon on the 1st in Miami terms, a band matching neither day.
    // See docs/bugs/2026-07-31-device-clock-date-windows.md.
    const todayBookings = bookings.filter(
      b => isOrgToday(new Date(b.scheduled_at), orgTimezone) && b.status !== 'cancelled',
    );
    const grossVolume = todayBookings.reduce((sum, b) => sum + Number(b.total_amount || 0), 0);
    const payments = todayBookings.filter(b => b.payment_status === 'paid').length;
    const todayCustomers = customers.filter(
      c => isOrgToday(new Date(c.created_at), orgTimezone),
    ).length;
    return { grossVolume, payments, customers: todayCustomers };
  }, [bookings, customers, orgTimezone]);

  if (bookingsLoading && bookings.length === 0) {
    return (
      <AdminLayout title="Dashboard" subtitle="Loading your data...">
      <SEOHead title="Dashboard | TidyWise" description="Manage your cleaning business from one dashboard" noIndex />
        <DashboardSkeleton />
      </AdminLayout>
    );
  }

  // Desktop / web layout (used on all platforms)
  return (
    <AdminLayout
      title="Dashboard"
      subtitle="Welcome back! Here's what's happening."
    >
      <div className="portal-v2" {...pullHandlers}>
      <PullToRefreshIndicator pullDistance={pullDistance} refreshing={refreshing} />
      <div data-tour-id="dashboard-home">
      <OnboardingChecklist />
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 animate-fade-in">
        <div className="xl:col-span-2 space-y-6">
          <TodayStats 
            grossVolume={todayStats.grossVolume}
            payments={todayStats.payments}
            customers={todayStats.customers}
          />
          
          {chart.isError ? (
            <QueryError subject="reports overview" onRetry={() => { void chart.refetch(); }} />
          ) : !chartsReady ? (
            <ReportsOverviewSkeleton />
          ) : (
          <Suspense fallback={<ReportsOverviewSkeleton />}>
            <ReportsOverview
              bookings={chartBookings as BookingWithDetails[]}
              customers={(dashboardCustomers.data ?? []).map(c => ({ id: c.id, created_at: c.created_at }))}
            />
          </Suspense>
          )}
        </div>
        
        <div>
          {/* Same card on web and iOS. Hidden while DASHBOARD_ACTIVITY_FEED_ENABLED is false. */}
          <ActivityFeedCard events={growth.events} />
          <UpcomingBookings bookings={bookings as BookingWithDetails[]} />
        </div>
      </div>
      </div>
      </div>
    </AdminLayout>
  );
}
