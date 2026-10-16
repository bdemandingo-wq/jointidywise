import {
  createInFlightGate,
  shouldInsertTrialOrg,
  workspaceToReuse,
  type WorkspaceProbe,
} from '../../supabase/functions/_shared/provision-trial-org.ts';

export interface ProvisionLookup {
  organizationId: string | null;
  error: unknown;
}

export interface ProvisionTrialOrgResult {
  organizationId: string | null;
  /** True only when this call performed the insert. */
  created: boolean;
}

export interface ProvisionTrialOrgAttempt {
  userId: string;
  lookup: () => Promise<{ probe: WorkspaceProbe; error: unknown }>;
  invoke: () => Promise<ProvisionLookup>;
}

const provisionGate = createInFlightGate<ProvisionTrialOrgResult>();

/**
 * Signup and the signed-in auth effect both call this. The first call owns
 * the lookup and the insert; a second call for the same user waits on it.
 */
export function provisionTrialOrgIfMissing(
  attempt: ProvisionTrialOrgAttempt,
): Promise<ProvisionTrialOrgResult> {
  return provisionGate.run(attempt.userId, () => runProvision(attempt));
}

async function runProvision(attempt: ProvisionTrialOrgAttempt): Promise<ProvisionTrialOrgResult> {
  const lookedUp = await attempt.lookup();
  if (lookedUp.error) throw lookedUp.error;
  const existingId = workspaceToReuse(lookedUp.probe);
  if (!shouldInsertTrialOrg(lookedUp.probe)) {
    return { organizationId: existingId, created: false };
  }
  const invoked = await attempt.invoke();
  if (invoked.error) throw invoked.error;
  return { organizationId: invoked.organizationId, created: !!invoked.organizationId };
}
