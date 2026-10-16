/**
 * useLifetimeCounter – returns the live state of the founding lifetime
 * offer (how many of LIFETIME_SPOT_CAP spots are claimed, sold-out flag).
 *
 * Source of truth: the `organizations` table. We count rows where
 * `plan_type = 'lifetime'` via the SECURITY DEFINER RPC
 * `get_lifetime_spots_remaining()` so anonymous visitors on the
 * landing/pricing page can read the live number without exposing the
 * organizations table publicly. The reconcile-checkout-session edge
 * function flips an org's `plan_type` to `'lifetime'` the moment a
 * Lifetime checkout completes, so the counter ticks down in real time.
 *
 * Cached via React Query with a 30s stale time so the same data isn't
 * re-fetched on every mount.
 */

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { LIFETIME_SPOT_CAP } from '@/lib/publicPlans';

export interface LifetimeState {
  total: number;
  sold: number;
  spotsLeft: number;
  soldOut: boolean;
  /** The count could not be read. Do not show a placeholder as if it were real. */
  unavailable: boolean;
  loading: boolean;
}

const DEFAULT: LifetimeState = {
  total: LIFETIME_SPOT_CAP,
  sold: 0,
  spotsLeft: LIFETIME_SPOT_CAP,
  soldOut: false,
  unavailable: false,
  loading: true,
};

async function fetchLifetimeState(): Promise<LifetimeState> {
  const { data, error } = await (supabase as unknown as {
    rpc: (fn: string) => Promise<{
      data: Array<{ total: number; sold: number; remaining: number; sold_out: boolean }> | null;
      error: unknown;
    }>;
  }).rpc('get_lifetime_spots_remaining');

  if (error || !data || data.length === 0) {
    return { ...DEFAULT, loading: false, unavailable: true };
  }

  const row = data[0];
  const total = row.total ?? LIFETIME_SPOT_CAP;
  const sold = row.sold ?? 0;
  const remaining = row.remaining ?? Math.max(0, total - sold);
  return {
    total,
    sold,
    spotsLeft: remaining,
    soldOut: row.sold_out || remaining <= 0,
    unavailable: false,
    loading: false,
  };
}

export function useLifetimeCounter(enabled = true): LifetimeState {
  const { data, isLoading } = useQuery({
    queryKey: ['lifetime-spots-remaining'],
    queryFn: fetchLifetimeState,
    enabled,
    staleTime: 30_000,
    placeholderData: DEFAULT,
  });
  if (isLoading || !data) return DEFAULT;
  return data;
}
