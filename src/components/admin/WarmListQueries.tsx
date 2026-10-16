import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useOrganization } from '@/contexts/OrganizationContext';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/lib/supabase';
import {
  fetchRecentOrgBookings,
  fetchOrgCustomers,
  fetchDashboardUpcoming,
  bookingsRecentKey,
  dashboardUpcomingKey,
} from '@/hooks/useBookings';
import {
  readStartupSection,
  STARTUP_PROFILE_STALE_MS,
  startupProfileKey,
  writeStartupSection,
} from '@/lib/startupCache';

/**
 * Starts the bookings and customers reads as soon as the org id is known,
 * overlapping the subscription check instead of waiting for the page that
 * displays them. The profile read runs beside the org read.
 */
export function WarmListQueries() {
  const { organization } = useOrganization();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const orgId = organization?.id;
  const userId = user?.id ?? null;
  const cachedProfile = userId ? readStartupSection<unknown>(userId, 'profile') : null;

  useQuery({
    queryKey: userId ? startupProfileKey(userId) : ['startup-profile', 'signed-out'],
    enabled: !!userId,
    staleTime: STARTUP_PROFILE_STALE_MS,
    gcTime: 1000 * 60 * 60 * 24,
    ...(cachedProfile ? { initialData: cachedProfile.value, initialDataUpdatedAt: cachedProfile.at } : {}),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, full_name, phone, email, trial_ends_at, avatar_url')
        .eq('id', userId as string)
        .maybeSingle();
      if (error) throw error;
      writeStartupSection(userId as string, 'profile', data);
      return data;
    },
  });

  useEffect(() => {
    if (!orgId) return;
    // The dashboard skeleton waits on this small window. Start it as soon as
    // the org id exists so it overlaps the subscription check.
    void queryClient.prefetchQuery({
      queryKey: dashboardUpcomingKey(orgId),
      queryFn: () => fetchDashboardUpcoming(orgId),
      staleTime: 60_000,
    });
  }, [orgId, queryClient]);

  useEffect(() => {
    if (!orgId) return;
    // The full booking and customer lists are what those pages render. They
    // wait until the upcoming window has landed so they do not compete with
    // the query the first paint is blocked on.
    const upcomingKey = dashboardUpcomingKey(orgId);
    const chartKey = ['bookings', 'dashboard-chart', orgId] as const;
    let started = false;
    let timer = 0;
    const startHeavy = (force = false) => {
      if (started) return;
      // The chart is up to 1,500 booking rows. The full booking and customer
      // lists are for the next page, so they wait until that read is idle.
      // The 12s fallback still starts them if the chart never runs.
      if (!force && queryClient.getQueryState(chartKey)?.fetchStatus === 'fetching') {
        timer = window.setTimeout(() => startHeavy(false), 500);
        return;
      }
      started = true;
      void queryClient.prefetchQuery({
        queryKey: bookingsRecentKey(orgId),
        queryFn: () => fetchRecentOrgBookings(orgId),
        staleTime: 1000 * 60 * 2,
      });
      void queryClient.prefetchQuery({
        queryKey: ['customers', orgId],
        queryFn: () => fetchOrgCustomers(orgId),
        staleTime: 1000 * 60 * 5,
      });
    };
    const upcoming = queryClient.getQueryState(upcomingKey);
    if (upcoming?.status === 'success') {
      timer = window.setTimeout(startHeavy, 1500);
    }
    const unsubscribe = queryClient.getQueryCache().subscribe((event) => {
      const key = event?.query?.queryKey;
      if (!key || key[0] !== upcomingKey[0] || key[1] !== upcomingKey[1] || key[2] !== upcomingKey[2]) return;
      if (event.query.state.status === 'success') {
        window.clearTimeout(timer);
        timer = window.setTimeout(startHeavy, 1500);
      }
    });
    const fallback = window.setTimeout(() => startHeavy(true), 12_000);
    return () => {
      window.clearTimeout(timer);
      window.clearTimeout(fallback);
      unsubscribe();
    };
  }, [orgId, queryClient]);

  return null;
}
