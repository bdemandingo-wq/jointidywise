/**
 * Card-free trial clock.
 *
 * New accounts get profiles.trial_ends_at = signup + 30 days (handle_new_user)
 * and organizations.plan_type = 'trial'. check-subscription grants Pro access
 * until that timestamp and returns subscribed=false after it. This module
 * only turns those timestamps into "days left" and "which reminder is due".
 * It never moves a trial end. A profile that already has an end date keeps it,
 * so a 14-day trial does not become 30 days and is not emailed on day 25.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

export const TRIAL_REMINDER_DAYS = [25, 29] as const;
export type TrialReminderDay = (typeof TRIAL_REMINDER_DAYS)[number];

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
 * Day 25 and day 29 of the trial the profile was actually given.
 * A 14-day or 7-day trial ends before day 25, so it is never due.
 * A missed cron day still sends the later reminder once, not both.
 */
export function dueTrialReminder(opts: {
  createdAt: string;
  trialEndsAt: string;
  alreadySent: readonly number[];
  now?: number;
}): TrialReminderDay | null {
  const now = opts.now ?? Date.now();
  const start = Date.parse(opts.createdAt);
  const end = Date.parse(opts.trialEndsAt);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= now) return null;

  const day = Math.floor((now - start) / DAY_MS) + 1;
  const sent = new Set(opts.alreadySent);
  const reaches = (reminderDay: number) => end > start + (reminderDay - 1) * DAY_MS;

  if (day >= 29 && !sent.has(29) && reaches(29)) return 29;
  if (day >= 25 && day < 29 && !sent.has(25) && reaches(25)) return 25;
  return null;
}
