import { useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import {
  buildConsentLogRow,
  consentSnapshot,
  type ConsentSnapshot,
  type LocationConsentDecision,
  type LocationConsentSource,
} from '@/lib/locationConsent';

export const LOCATION_CONSENT_QUERY_KEY = 'cleaner-location-consent';

const EMPTY_SNAPSHOT: ConsentSnapshot = { hasDecision: false, decision: null };

async function fetchConsentSnapshot(staffId: string): Promise<ConsentSnapshot> {
  const { data, error } = await supabase
    .from('cleaner_location_consents')
    .select('decision')
    .eq('staff_id', staffId)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(1);
  if (error) throw error;
  const row = data?.[0];
  return consentSnapshot(!!row, row?.decision);
}

export function useLocationConsent(staffId: string | undefined) {
  const queryClient = useQueryClient();
  const queryKey = [LOCATION_CONSENT_QUERY_KEY, staffId] as const;

  const query = useQuery({
    queryKey,
    enabled: !!staffId,
    // A stale "no row" would show the first-run sheet again. Always re-read.
    staleTime: 0,
    queryFn: () => fetchConsentSnapshot(staffId!),
  });

  const loadLatest = useCallback(async (): Promise<ConsentSnapshot> => {
    if (!staffId) return EMPTY_SNAPSHOT;
    return queryClient.fetchQuery({
      queryKey: [LOCATION_CONSENT_QUERY_KEY, staffId],
      staleTime: 0,
      queryFn: () => fetchConsentSnapshot(staffId),
    });
  }, [queryClient, staffId]);

  const logDecision = useCallback(async (input: {
    staffId: string;
    organizationId: string;
    decision: LocationConsentDecision;
    source: LocationConsentSource;
  }) => {
    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError) throw userError;
    const userId = userData.user?.id;
    if (!userId) throw new Error('Not signed in');
    const row = buildConsentLogRow({ ...input, userId });
    const { error } = await supabase.from('cleaner_location_consents').insert(row);
    if (error) throw error;
    await queryClient.invalidateQueries({ queryKey: [LOCATION_CONSENT_QUERY_KEY, input.staffId] });
  }, [queryClient]);

  return {
    hasDecision: query.data?.hasDecision ?? false,
    decision: query.data?.decision ?? null,
    isLoading: !!staffId && query.isLoading,
    isError: query.isError,
    error: query.error,
    loadLatest,
    logDecision,
  };
}
