import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useOrganization } from '@/contexts/OrganizationContext';
import { fetchOrgBookings, fetchOrgCustomers } from '@/hooks/useBookings';

/**
 * Starts the bookings and customers reads as soon as the org id is known,
 * overlapping AdminRoute's subscription check instead of waiting for the
 * page to mount after it.
 */
export function WarmListQueries() {
  const { organization } = useOrganization();
  const queryClient = useQueryClient();
  const orgId = organization?.id;

  useEffect(() => {
    if (!orgId) return;
    void queryClient.prefetchQuery({
      queryKey: ['bookings', orgId],
      queryFn: () => fetchOrgBookings(orgId),
      staleTime: 1000 * 60 * 2,
    });
    void queryClient.prefetchQuery({
      queryKey: ['customers', orgId],
      queryFn: () => fetchOrgCustomers(orgId),
      staleTime: 1000 * 60 * 5,
    });
  }, [orgId, queryClient]);

  return null;
}
