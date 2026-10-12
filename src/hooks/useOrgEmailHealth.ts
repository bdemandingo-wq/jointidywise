import { useOrganization } from '@/contexts/OrganizationContext';
import { supabase } from '@/integrations/supabase/client';
import { useQuery } from '@tanstack/react-query';
import { isHardFailure } from '@/lib/emailFailureClassification';

export interface OrgEmailFailure {
  id: string;
  method: string;
  fell_back_to: string | null;
  recipient: string | null;
  subject: string | null;
  error_message: string | null;
  created_at: string;
}

const RECENT_DAYS = 7;
const RECENT_LIMIT = 50;

/**
 * Single source of truth for an org's email health, feeding both the
 * dashboard banner and the Settings → Emails delivery panel.
 * - notConfigured: proactive check (no sender identity set). Needed on its own
 *   because a brand-new org has no failure rows yet.
 * - recentFailures: actual send failures logged by sendOrgEmail (last 7 days).
 * - hardFailures: recentFailures that definitely did not deliver — either no
 *   fallback was attempted, or one was and it failed too.
 */
export function useOrgEmailHealth() {
  const { organization, isOwner, isAdmin } = useOrganization();
  const orgId = organization?.id;
  const enabled = !!orgId && (isOwner || isAdmin);

  const configuredQuery = useQuery({
    queryKey: ['org-email-configured', orgId],
    enabled,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      // Non-secret columns only — RLS revokes the API-key/password columns.
      const { data, error } = await supabase
        .from('organization_email_settings')
        .select('from_name, from_email')
        .eq('organization_id', orgId!)
        .maybeSingle();
      if (error) return true; // fail closed: never nag on a read error
      return !!data && !!data.from_name?.trim() && !!data.from_email?.trim();
    },
  });

  const failuresQuery = useQuery({
    queryKey: ['org-email-failures', orgId],
    enabled,
    staleTime: 60 * 1000,
    queryFn: async () => {
      const since = new Date(Date.now() - RECENT_DAYS * 86_400_000).toISOString();
      const { data, error } = await supabase
        .from('org_email_send_failures')
        .select('id, method, fell_back_to, recipient, subject, error_message, created_at')
        .eq('organization_id', orgId!)
        .gte('created_at', since)
        .order('created_at', { ascending: false })
        .limit(RECENT_LIMIT);
      if (error) throw error;
      return (data ?? []) as OrgEmailFailure[];
    },
  });

  const recentFailures = failuresQuery.data ?? [];
  return {
    canView: enabled,
    // data===false means "not configured"; undefined while loading → treated as configured (no flash).
    notConfigured: configuredQuery.data === false,
    recentFailures,
    // Hard non-deliveries only — excludes fell-back sends that likely delivered.
    // A fallback that ALSO failed delivered nothing, so it belongs here too.
    // See src/lib/emailFailureClassification.ts — `fell_back_to` records the
    // attempt, not the outcome, and filtering on it alone hid three real
    // non-deliveries.
    hardFailures: recentFailures.filter(isHardFailure),
    isLoading: configuredQuery.isLoading || failuresQuery.isLoading,
    isError: failuresQuery.isError,
  };
}
