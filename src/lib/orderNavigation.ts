/** Apply a saved href order without waiting for an effect. Unknown hrefs are dropped; new items are appended. */
export function orderBySavedHrefs<T extends { href: string }>(items: readonly T[], saved: unknown): T[] {
  if (!Array.isArray(saved) || saved.some((href) => typeof href !== "string")) return [...items];
  const reordered = saved
    .map((href) => items.find((item) => item.href === href))
    .filter((item): item is T => item != null);
  for (const item of items) {
    if (!reordered.some((row) => row.href === item.href)) reordered.push(item);
  }
  return reordered;
}
