/**
 * Signup creates the placeholder org ("Jane's Business", needs_onboarding)
 * through provision-trial-org. Two callers — the auth effect and the native
 * signup screen — both fire within the same second, and each used to pass
 * the "no membership yet" check before either insert committed.
 *
 * A partial unique index on organizations (owner_id) WHERE needs_onboarding
 * is the durable fix. Until that exists, one in-flight call per user plus a
 * re-check immediately before insert collapses the race we can see in code.
 */

export interface WorkspaceProbe {
  membershipOrgId?: string | null;
  ownedOrgId?: string | null;
}

/** The org this user already has, if either probe found one. */
export function workspaceToReuse(probe: WorkspaceProbe): string | null {
  const membership = normalizeId(probe.membershipOrgId);
  const owned = normalizeId(probe.ownedOrgId);
  return membership ?? owned;
}

export function shouldInsertTrialOrg(probe: WorkspaceProbe): boolean {
  return workspaceToReuse(probe) === null;
}

function normalizeId(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Concurrent calls for the same key share one promise. The map is set
 * before the task can yield, so a second caller in the same isolate waits
 * instead of inserting again.
 */
export function createInFlightGate<T>() {
  const flights = new Map<string, Promise<T>>();
  return {
    run(key: string, task: () => Promise<T>): Promise<T> {
      const existing = flights.get(key);
      if (existing) return existing;
      const pending = task();
      const flight = pending.finally(() => {
        if (flights.get(key) === flight) flights.delete(key);
      });
      flights.set(key, flight);
      return flight;
    },
  };
}
