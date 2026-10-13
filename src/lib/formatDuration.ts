/** Display-only estimate. Stored durations and all time/pay calculations stay in minutes. */
export function formatDuration(minutes: number | null | undefined): string {
  if (minutes == null || !Number.isFinite(minutes) || minutes < 0) return '—';
  if (minutes < 60) return `${Number(minutes.toFixed(2))} min`;
  const hours = minutes / 60;
  return `${Number(hours.toFixed(2))}–${Math.floor(hours) + 1} hrs`;
}