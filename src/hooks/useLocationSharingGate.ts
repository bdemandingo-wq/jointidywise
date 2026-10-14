import { useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  LOCATION_SHARING_CLOSED,
  LOCATION_TRACKING_SWITCH_KEY,
} from '@/lib/locationConsent';
import { readLocationSharingAvailability } from '@/lib/readLocationSharingAvailability';

export function useLocationSharingGate() {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: [LOCATION_TRACKING_SWITCH_KEY],
    staleTime: 0,
    queryFn: readLocationSharingAvailability,
  });

  const load = useCallback(
    () => queryClient.fetchQuery({
      queryKey: [LOCATION_TRACKING_SWITCH_KEY],
      staleTime: 0,
      queryFn: readLocationSharingAvailability,
    }),
    [queryClient],
  );

  const availability = query.data ?? LOCATION_SHARING_CLOSED;
  return {
    ...availability,
    pending: query.isLoading,
    isError: query.isError,
    load,
  };
}
