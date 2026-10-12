/**
 * Booking-photo viewer navigation.
 *
 * The caller passes photos in the order already on screen. That includes a
 * before/after/other grouping when the grid is grouped that way. This helper
 * only steps through that list: it does not sort, and it does not wrap.
 */

export function groupBeforeAfter<T extends { photo_type?: string | null }>(items: readonly T[]) {
  return {
    before: items.filter((item) => item.photo_type === 'before'),
    after: items.filter((item) => item.photo_type === 'after'),
    other: items.filter((item) => item.photo_type !== 'before' && item.photo_type !== 'after'),
  };
}

/** On-screen order: every before, then every after, then everything else. */
export function inBeforeAfterOrder<T extends { photo_type?: string | null }>(items: readonly T[]): T[] {
  const groups = groupBeforeAfter(items);
  return [...groups.before, ...groups.after, ...groups.other];
}

export function stepGalleryIndex(index: number, length: number, delta: number): number {
  if (!Number.isFinite(length) || length <= 0) return 0;
  const current = Number.isFinite(index) ? index : 0;
  const clamped = Math.min(Math.max(current, 0), length - 1);
  const next = clamped + delta;
  if (next < 0 || next >= length) return clamped;
  return next;
}
