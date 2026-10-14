/** Sort key for the blog index. A real published_at wins. Month-year labels
 * ("February 2026") sort as the first of that month and do not invent a day
 * in the label itself. */
export function blogSortTime(input: {
  publishedAt?: string | null;
  dateLabel?: string | null;
}): number {
  if (input.publishedAt) {
    const exact = Date.parse(input.publishedAt);
    if (Number.isFinite(exact)) return exact;
  }
  const label = (input.dateLabel ?? "").trim();
  const monthYear = /^([A-Za-z]+)\s+(\d{4})$/.exec(label);
  if (monthYear) {
    const month = Date.parse(`${monthYear[1]} 1, ${monthYear[2]}`);
    if (Number.isFinite(month)) return month;
  }
  const parsed = Date.parse(label);
  return Number.isFinite(parsed) ? parsed : 0;
}
