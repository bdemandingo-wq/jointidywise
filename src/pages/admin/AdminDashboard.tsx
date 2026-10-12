import { useMemo, useEffect, useCallback, lazy, Suspense } from 'react';
import { isOrgToday } from '@/lib/orgDateRange';
import { useOrgTimezone } from '@/hooks/useOrgTimezone';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { AdminLayout } from '@/components/admin/AdminLayout';
import { TodayStats } from '@/components/admin/TodayStats';
import { UpcomingBookings } from '@/components/admin/UpcomingBookings';
import { OnboardingChecklist } from '@/components/admin/OnboardingChecklist';
import { useBookings, useCustomers, BookingWithDetails } from '@/hooks/useBookings';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { isToday } from 'date-fns';
import { supabase } from '@/lib/supabase';
import { useQueryClient } from '@tanstack/react-query';
import { PageSkeleton, BookingCardSkeleton } from '@/components/ui/page-skeleton';
import { useOrganization } from '@/contexts/OrganizationContext';
import { SEOHead } from '@/components/SEOHead';
import { usePullToRefresh } from '@/hooks/usePullToRefresh';
import { PullToRefreshIndicator } from '@/components/admin/PullToRefreshIndicator';
import { requestAdminNotificationRefresh } from '@/lib/adminNotificationRefresh';


// Lazy load the heavy ReportsOverview component
const ReportsOverview = lazy(() => import('@/components/admin/ReportsOverview').then(m => ({ default: m.ReportsOverview })));

function DashboardSkeleton() {
  return (
    <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
      <div className="xl:col-span-2 space-y-6">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
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
  const { data: bookings = [], isLoading: bookingsLoading } = useBookings();
  const { data: customers = [], isLoading: customersLoading } = useCustomers();
  const queryClient = useQueryClient();
  const { organization } = useOrganization();
  const navigate = useNavigate();
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
    const channel = supabase
      .channel('dashboard-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bookings' }, () => {
        queryClient.invalidateQueries({ queryKey: ['bookings'] });
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'customers' }, () => {
        queryClient.invalidateQueries({ queryKey: ['customers'] });
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [queryClient]);
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

  const isLoading = bookingsLoading || customersLoading;

  if (isLoading) {
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
      <OnboardingChecklist />
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 animate-fade-in">
        <div className="xl:col-span-2 space-y-6">
          <TodayStats 
            grossVolume={todayStats.grossVolume}
            payments={todayStats.payments}
            customers={todayStats.customers}
          />
          
          <Suspense fallback={
            <div className="bg-card rounded-xl p-4 border border-border shadow-sm animate-pulse">
              <div className="h-5 w-32 bg-muted rounded mb-4" />
              <div className="h-64 bg-muted/50 rounded-xl flex items-center justify-center">
                <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
              </div>
            </div>
          }>
            <ReportsOverview
              bookings={bookings as BookingWithDetails[]} 
              customers={customers.map(c => ({ id: c.id, created_at: c.created_at }))}
            />
          </Suspense>
        </div>
        
        <div>
          <UpcomingBookings bookings={bookings as BookingWithDetails[]} />
        </div>
      </div>
      </div>
    </AdminLayout>
  );
}
