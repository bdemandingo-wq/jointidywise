import {
  workspaceToReuse,
  type WorkspaceProbe,
} from '../../supabase/functions/_shared/provision-trial-org.ts';

/**
 * Branch B of onboarding submit inserts a brand-new org. An owner who was
 * sent here by a false empty read already has a workspace; inserting again
 * is the duplicate. Creating another business is an explicit ?new=true
 * choice and is the one case that may proceed.
 */
export function blockOnboardingInsert(input: {
  allowAdditionalBusiness: boolean;
  probe: WorkspaceProbe;
}): boolean {
  if (input.allowAdditionalBusiness) return false;
  return workspaceToReuse(input.probe) !== null;
}

/** Double-tap on Create Business must not start two inserts. */
export function createSubmitGuard() {
  let active = false;
  return {
    enter(): boolean {
      if (active) return false;
      active = true;
      return true;
    },
    leave(): void {
      active = false;
    },
  };
}
