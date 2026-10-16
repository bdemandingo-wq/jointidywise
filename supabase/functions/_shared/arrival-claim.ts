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

/**
 * Release only when every OpenPhone call failed. One delivered text
 * (the customer, or any other recipient) keeps the claim so that number
 * is not texted again. No OpenPhone call is not a failed delivery.
 */
export function arrivalOpenPhoneClaim(sends: readonly boolean[]): 'mark_sent' | 'release' {
  if (sends.some((ok) => ok)) return 'mark_sent';
  if (sends.length === 0) return 'mark_sent';
  return 'release';
}

/** The catch path deletes the pending claim only when no text went out. */
export function releaseArrivalClaimAfterError(textDelivered: boolean): boolean {
  return !textDelivered;
}

/** The id returned by insert().select('id') or by the takeover delete. */
export function claimedArrivalRowId(rows: readonly { id?: string | null }[] | null | undefined): string | null {
  const id = rows?.[0]?.id;
  return typeof id === 'string' && id.length > 0 ? id : null;
}

/**
 * A release may delete only the pending row this caller inserted.
 * A takeover inserts a new id, so a late release of the old id does not match.
 */
export function arrivalReleaseMatchesClaim(
  row: { id: string; status: string },
  claimId: string,
): boolean {
  return claimId.length > 0 && row.id === claimId && row.status === 'pending';
}

/** A failed status=sent write is tried again so the row does not sit pending until the 90s takeover. */
export const ARRIVAL_MARK_SENT_ATTEMPTS = 4;

export function nextMarkSentStep(attempt: number, updateFailed: boolean): 'done' | 'retry' | 'give_up' {
  if (!updateFailed) return 'done';
  if (attempt + 1 < ARRIVAL_MARK_SENT_ATTEMPTS) return 'retry';
  return 'give_up';
}
