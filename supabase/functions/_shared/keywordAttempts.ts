/** A keyword that has been tried this many times stays failed. */
export const MAX_KEYWORD_ATTEMPTS = 5;

export function keywordAttemptCount(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.floor(n);
}

/** Failed and stuck rows under the cap may go back on the queue. */
export function canRetryKeyword(attempts: unknown): boolean {
  return keywordAttemptCount(attempts) < MAX_KEYWORD_ATTEMPTS;
}

/**
 * Count stored when a try is claimed. The failure write must store this
 * same number: adding one in the catch as well would double-count, and
 * skipping the claim increment lets a crash retry forever.
 */
export function attemptsAfterClaim(attempts: unknown): number {
  return keywordAttemptCount(attempts) + 1;
}
