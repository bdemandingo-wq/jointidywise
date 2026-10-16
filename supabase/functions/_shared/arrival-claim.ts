/** A pending claim older than this can be taken over. A live send finishes well inside it. */
export const ARRIVAL_CLAIM_STALE_MS = 90_000;

export type ArrivalClaimInsert = 'none' | 'conflict' | 'failed';
export type ArrivalClaimRow = 'none' | 'pending' | 'sent' | 'other';

/**
 * Insert the reminder row before any text goes out.
 * The winner sends. A row already marked sent is a duplicate.
 * A fresh pending row means another send is in flight.
 * A stale pending row is a crashed claim and can be deleted, then inserted again.
 */
export function nextArrivalClaimAction(input: {
  insertError: ArrivalClaimInsert;
  row: ArrivalClaimRow;
  pendingAgeMs: number | null;
}): 'send' | 'duplicate' | 'in_progress' | 'takeover' | 'refuse' {
  if (input.insertError === 'failed') return 'refuse';
  if (input.insertError === 'none') return 'send';
  if (input.row === 'sent' || input.row === 'other') return 'duplicate';
  if (input.row !== 'pending') return 'refuse';
  const age = input.pendingAgeMs;
  if (age == null || !Number.isFinite(age) || age < ARRIVAL_CLAIM_STALE_MS) return 'in_progress';
  return 'takeover';
}
