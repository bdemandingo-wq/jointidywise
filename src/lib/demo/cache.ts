import type { QueryClient } from '@tanstack/react-query';

const KEEP = new Set(['startup-org', 'startup-subscription', 'startup-profile']);

/**
 * Drop cached lists when sample demo turns on or off.
 * The same query keys hold real rows and fixture rows, and the offline
 * persister would otherwise restore one into the other.
 */
export function purgeDemoQueries(queryClient: QueryClient) {
  queryClient.removeQueries({
    predicate: (query) => !KEEP.has(String(query.queryKey[0] ?? '')),
  });
  try {
    localStorage.removeItem('tw-offline-cache');
  } catch {
    /* ignore */
  }
}
