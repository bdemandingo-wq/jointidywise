export const MEDIA_PAGE_SIZE = 40;

export function mediaPageRange(page: number): [number, number] {
  const start = Math.max(0, Math.floor(page)) * MEDIA_PAGE_SIZE;
  return [start, start + MEDIA_PAGE_SIZE - 1];
}

export function hasMoreMedia(count: number): boolean {
  return count === MEDIA_PAGE_SIZE;
}

export function mergeMedia<T extends { id: string; created_at: string | null }>(pages: readonly (readonly T[])[]): T[] {
  const rows: Record<string, T> = {};
  for (const page of pages) for (const row of page) rows[row.id] ??= row;
  return Object.values(rows).sort((a, b) => {
    const time = (b.created_at ? Date.parse(b.created_at) : 0) - (a.created_at ? Date.parse(a.created_at) : 0);
    return time || b.id.localeCompare(a.id);
  });
}

export function adjacentMedia<T>(items: readonly T[], index: number, isVideo: (item: T) => boolean): T[] {
  if (index < 0 || index >= items.length) return [];
  return [items[index - 1], items[index + 1]].filter((item): item is T => item !== undefined && !isVideo(item));
}