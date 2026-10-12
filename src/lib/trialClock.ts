/**
 * Card-free trial clock.
 *
 * New accounts get profiles.trial_ends_at = signup + 14 days (handle_new_user)
 * and organizations.plan_type = 'trial'. check-subscription grants access
 * until that timestamp and returns subscribed=false after it. This module
 * only turns those timestamps into "days left" and "which reminder is due".
 * It never moves a trial end.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

export function trialDaysLeft(
  trialEndIso: string | null | undefined,
  now = Date.now(),
): number | null {
  if (!trialEndIso) return null;
  const end = Date.parse(trialEndIso);
  if (!Number.isFinite(end) || end <= now) return null;
  return Math.max(1, Math.ceil((end - now) / DAY_MS));
}

/**
 * Day 10 and day 13 of the trial the profile was actually given.
 * A 7-day trial (older signups) ends before day 10, so it is never due.
 * A missed cron day still sends the later reminder once, not both.
 */
export function dueTrialReminder(opts: {
  createdAt: string;
  trialEndsAt: string;
  alreadySent: readonly number[];
  now?: number;
}): 10 | 13 | null {
  const now = opts.now ?? Date.now();
  const start = Date.parse(opts.createdAt);
  const end = Date.parse(opts.trialEndsAt);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= now) return null;

  const day = Math.floor((now - start) / DAY_MS) + 1;
  const sent = new Set(opts.alreadySent);
  const reaches = (reminderDay: number) => end > start + (reminderDay - 1) * DAY_MS;

  if (day >= 13 && !sent.has(13) && reaches(13)) return 13;
  if (day >= 10 && day < 13 && !sent.has(10) && reaches(10)) return 10;
  return null;
}
