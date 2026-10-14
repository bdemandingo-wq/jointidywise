/**
 * Dashboard queries keep the previous result only while the org id in the
 * query key stays the same (a date-range change). An org switch must not
 * paint the previous company's rows; the page shows its skeleton instead.
 */
export function placeholderForSameOrg<T>(organizationId: string | undefined) {
  return (
    previousData: T | undefined,
    previousQuery: { queryKey: readonly unknown[] } | undefined,
  ): T | undefined => {
    if (previousData === undefined || !organizationId || !previousQuery) return undefined;
    if (!previousQuery.queryKey.includes(organizationId)) return undefined;
    return previousData;
  };
}

/** Placeholder rows from another org are not data. Same-org placeholders stay. */
export function rowsForCurrentOrg<T>(
  rows: T[] | undefined,
  organizationId: string | undefined,
  isPlaceholderData: boolean,
): { rows: T[]; blocked: boolean } {
  const list = rows ?? [];
  if (!isPlaceholderData) return { rows: list, blocked: false };
  if (!organizationId) return { rows: [], blocked: true };
  const foreign = list.some((row) => {
    const id = (row as { organization_id?: string | null }).organization_id;
    return typeof id === "string" && id.length > 0 && id !== organizationId;
  });
  return foreign ? { rows: [], blocked: true } : { rows: list, blocked: false };
}
