import { supabase } from '@/lib/supabase';
import type { WorkspaceProbe } from '../../supabase/functions/_shared/provision-trial-org.ts';

/** Membership or an org this user already owns. An error must not look like "none". */
export async function lookupTrialWorkspace(userId: string): Promise<{ probe: WorkspaceProbe; error: unknown }> {
  const [membershipResult, ownedResult] = await Promise.all([
    supabase.from('org_memberships').select('organization_id').eq('user_id', userId).limit(1),
    supabase.from('organizations').select('id').eq('owner_id', userId).limit(1),
  ]);
  return {
    error: membershipResult.error ?? ownedResult.error ?? null,
    probe: {
      membershipOrgId: membershipResult.data?.[0]?.organization_id ?? null,
      ownedOrgId: ownedResult.data?.[0]?.id ?? null,
    },
  };
}
