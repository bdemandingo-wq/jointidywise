import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import {
  DEFAULT_HOURS_ABSOLUTE_CEILING,
  DEFAULT_HOURS_OVERAGE_CAP_RATIO,
  type HourCaps,
} from '@/lib/wageCalculation';

const DEFAULT_CAPS: HourCaps = {
  overageCapRatio: DEFAULT_HOURS_OVERAGE_CAP_RATIO,
  absoluteCeiling: DEFAULT_HOURS_ABSOLUTE_CEILING,
};

/**
 * The org's hours floor/cap for cleaner pay. Missing row uses the same
 * defaults as complete_assigned_booking (1.25× scheduled, 12h ceiling).
 * A failed read throws so the caller can tell "defaults" from "couldn't load".
 */
export function useHourCaps(organizationId: string | null | undefined) {
  const query = useQuery({
    queryKey: ['hour-caps', organizationId],
    enabled: !!organizationId,
    staleTime: 1000 * 60 * 5,
    queryFn: async (): Promise<HourCaps> => {
      const { data, error } = await supabase
        .from('payroll_settings')
        .select('hours_overage_cap_ratio, hours_absolute_ceiling')
        .eq('organization_id', organizationId!)
        .maybeSingle();
      if (error) throw error;
      return {
        overageCapRatio: data?.hours_overage_cap_ratio ?? DEFAULT_HOURS_OVERAGE_CAP_RATIO,
        absoluteCeiling: data?.hours_absolute_ceiling ?? DEFAULT_HOURS_ABSOLUTE_CEILING,
      };
    },
  });

  const caps: HourCaps = query.data ?? DEFAULT_CAPS;

  return { caps, error: query.error, isLoading: query.isLoading };
}
