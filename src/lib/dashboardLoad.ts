/**
 * Side reads on the admin dashboard.
 *
 * The jobs list is the query the skeleton waits on. Growth numbers are
 * only painted on the upgrade card, and the activity feed is a separate
 * switch. A paid dashboard with the feed off must not call either.
 */
export function dashboardSideReads(opts: {
  upcomingReady: boolean;
  showUpgrade: boolean;
  feedEnabled: boolean;
}): { growth: boolean; lifetime: boolean } {
  if (!opts.upcomingReady) return { growth: false, lifetime: false };
  return {
    growth: opts.feedEnabled || opts.showUpgrade,
    lifetime: opts.showUpgrade,
  };
}
