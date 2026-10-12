import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useOrganization } from '@/contexts/OrganizationContext';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/lib/supabase';
import {
  fetchRecentOrgBookings,
  fetchOrgCustomers,
  bookingsRecentKey,
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
    // Leave the first second to the dashboard's own small read. These two
    // lists are what Bookings and Customers render, so they are in flight
    // before those routes mount.
    const timer = window.setTimeout(() => {
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
    }, 1000);
    return () => window.clearTimeout(timer);
  }, [orgId, queryClient]);

  return null;
}
