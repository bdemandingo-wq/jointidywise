/**
 * Month-over-month style change for report cards.
 *
 * Returns null when there is no honest comparison: a prior period of zero
 * cannot produce a percentage, and inventing one is how a $0 account showed
 * "+18%". Callers should hide the trend in that case.
 */
export function percentChange(current: number, previous: number): number | null {
  if (!Number.isFinite(current) || !Number.isFinite(previous)) return null;
  if (previous === 0) return null;
  return Math.round(((current - previous) / Math.abs(previous)) * 100);
}

export function trendDirection(change: number | null): "up" | "down" | "neutral" {
  if (change === null || change === 0) return "neutral";
  return change > 0 ? "up" : "down";
}
