/** Display-only label. Stored durations and all time/pay calculations stay in minutes. */
function trimNumber(value: number): string {
  return String(Number(value.toFixed(2)));
}

export function formatDuration(minutes: number | null | undefined): string {
  if (minutes == null || !Number.isFinite(minutes) || minutes < 0) return '—';
  const total = Number(minutes.toFixed(2));
  if (total < 60) return `${trimNumber(total)} min`;

  const hours = Math.floor(total / 60);
  const remainder = Number((total - hours * 60).toFixed(2));
  if (remainder === 0) return hours === 1 ? '1 hr' : `${hours} hrs`;
  if (remainder === 30) return `${hours + 0.5} hrs`;
  const hourLabel = hours === 1 ? '1 hr' : `${hours} hrs`;
  return `${hourLabel} ${trimNumber(remainder)} min`;
}
