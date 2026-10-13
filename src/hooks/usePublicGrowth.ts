/**
 * Lifetime spots, weekly signups, and the anonymous activity feed.
 * Both numbers and events come from the public snapshot. A failed read
 * hides the widget. Nothing here is filled in with a sample event.
 */

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import {
  parseActivityFeed,
  parseGrowthCounters,
  type PublicActivityEvent,
  type PublicGrowthCounters,
} from '@/lib/publicActivity';

export interface PublicGrowthState {
  counters: PublicGrowthCounters | null;
  events: PublicActivityEvent[];
  loading: boolean;
}

const EMPTY: PublicGrowthState = { counters: null, events: [], loading: false };

async function fetchViaRpc(): Promise<PublicGrowthState> {
  const client = supabase as unknown as {
    rpc: (fn: string) => Promise<{ data: unknown; error: { message?: string } | null }>;
  };
  const [counters, feed] = await Promise.all([
    client.rpc('get_public_growth_counters'),
    client.rpc('get_public_activity_feed'),
  ]);
  if (counters.error || feed.error) return EMPTY;
  return {
    counters: parseGrowthCounters(counters.data),
    events: parseActivityFeed(feed.data),
    loading: false,
  };
}

async function fetchPublicGrowth(): Promise<PublicGrowthState> {
  try {
    const { data, error } = await supabase.functions.invoke('public-growth', { body: {} });
    const message = error?.message ?? '';
    const status = (error as { context?: { status?: number } } | null)?.context?.status;
    const rateLimited = status === 429 || data?.error === 'rate_limited' || message.includes('rate_limited');
    if (rateLimited) return EMPTY;
    if (!error && data && !data.error) {
      return {
        counters: parseGrowthCounters(data.counters),
        events: parseActivityFeed(data.feed),
        loading: false,
      };
    }
    return await fetchViaRpc();
  } catch {
    return EMPTY;
  }
}

export function usePublicGrowth(): PublicGrowthState {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['public-growth'],
    queryFn: fetchPublicGrowth,
    staleTime: 45_000,
    gcTime: 5 * 60_000,
    retry: 1,
  });
  if (isLoading) return { ...EMPTY, loading: true };
  if (isError || !data) return EMPTY;
  return data;
}
