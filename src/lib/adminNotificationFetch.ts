/**
 * Opening the bell loads only while this org has no stored list.
 *
 * A stored list includes Clear all's empty array and realtime-only rows
 * (a booking update, or a new booking marked unread locally) that a fresh
 * database read would drop. The deferred mount load, realtime handlers,
 * and pull-to-refresh own later refreshes.
 *
 * A cold open still calls the shared loader with force=false, so it joins
 * the in-flight mount batch instead of starting a second one.
 */
export function shouldFetchBellOnOpen(hasCachedList: boolean): boolean {
  return !hasCachedList;
}
