/**
 * Owner-only staff wage lookup.
 *
 * `base_wage` and `tax_document_url` are no longer selectable from `staff` by
 * `authenticated` (see src/lib/staffColumns.ts). Payroll, finance and the staff
 * roster read them through `get_org_staff_wages`, which raises `forbidden` for
 * anyone without has_org_financial_access (owner). Managers therefore get an
 * empty map rather than an error surface.
 */

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useOrgId } from '@/hooks/useOrgId';
import { useOrgRole } from '@/hooks/useOrgRole';

export interface StaffWageRow {
  id: string;
  base_wage: number | null;
  hourly_rate: number | null;
  percentage_rate: number | null;
  default_hours: number | null;
  tax_document_url: string | null;
}

export function useOrgStaffWages() {
  const { organizationId } = useOrgId();
  const { hasFinancialAccess } = useOrgRole();

  const query = useQuery({
    queryKey: ['org-staff-wages', organizationId],
    enabled: !!organizationId && hasFinancialAccess,
    staleTime: 1000 * 60 * 5,
    queryFn: async (): Promise<StaffWageRow[]> => {
      const { data, error } = await (supabase as unknown as {
        rpc: (n: string, a: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;
      }).rpc('get_org_staff_wages', { _org_id: organizationId });
      if (error) throw error;
      return (data as StaffWageRow[]) ?? [];
    },
  });

  const byId = new Map<string, StaffWageRow>((query.data ?? []).map((r) => [r.id, r]));

  return { wages: query.data ?? [], wagesById: byId, ...query };
}
