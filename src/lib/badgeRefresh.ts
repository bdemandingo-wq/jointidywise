import type { QueryClient } from '@tanstack/react-query';

/**
 * Page-level counts that drive a visible badge but are NOT part of the
 * `sb-*` sidebar badge family (tab badges, review lists, compliance grid).
 */
const BADGE_COUNT_KEYS = [
  'staff-docs-pending-count',
  'time-off-pending-count',
  'staff-compliance',
  'admin-pending-documents',
  'admin-staff-documents',
  'staff-event-notifications',
  'admin-notifications',
  'client-booking-requests',
  'client-feedback',
  'inventory',
];

/**
 * Refresh every badge-driving count after an action that can clear one.
 *
 * Badge counts live in queries separate from the list a user just acted on
 * (`sb-staff`, `staff-docs-pending-count`, ...), so approving a document
 * emptied the review list while the tab badge kept showing the stale number.
 * Realtime invalidation covers this eventually, but not reliably fast enough
 * to feel like the badge cleared "on click" — so actions call this directly.
 *
 * Invalidating by predicate (rather than listing exact keys) means badge keys
 * carrying extra scope segments — `['sb-staff', orgId, payoutRequired]` — are
 * matched without every caller having to know their shape.
 */
export function refreshBadges(queryClient: QueryClient) {
  queryClient.invalidateQueries({
    predicate: (query) => {
      const key = query.queryKey?.[0];
      return typeof key === 'string' && (key.startsWith('sb-') || BADGE_COUNT_KEYS.includes(key));
    },
  });
}
