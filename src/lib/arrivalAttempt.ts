import { shouldSendArrival } from './jobEventCopy.ts';

/** One error toast for a run of failed arrival sends. A later success clears it. */
export function nextArrivalErrorToast(streakActive: boolean): { show: boolean; streakActive: boolean } {
  if (streakActive) return { show: false, streakActive: true };
  return { show: true, streakActive: true };
}

export interface ArrivalStatusRead {
  status: string | null | undefined;
  failed: boolean;
}

export interface ArrivalSendResult {
  data: unknown;
  error: unknown;
}

function arrivalHttpStatus(error: unknown): number | null {
  if (!error || typeof error !== 'object') return null;
  const context = (error as { context?: { status?: number } }).context;
  if (typeof context?.status === 'number') return context.status;
  const status = (error as { status?: number }).status;
  return typeof status === 'number' ? status : null;
}

/**
 * 409 means another send already holds the reminder row. That is not a
 * failed text: the watch stays up and the failure toast stays quiet.
 */
export function isArrivalInFlight(result: ArrivalSendResult): boolean {
  const data = result.data as { inFlight?: boolean; error?: string } | null;
  if (data?.inFlight === true) return true;
  if (data?.error === 'Arrival send already in progress') return true;
  return arrivalHttpStatus(result.error) === 409;
}

/**
 * One arrival notice per job.
 * The claim is set before the status read, so two position updates that
 * arrive together share one send. A finished job keeps the claim and stops
 * the watch. On the send path the watch stays up until the notice succeeds,
 * so a failed send does not write arrived_at or end customer sharing.
 * A failed status read still sends; the server checks the booking status.
 */
export async function runArrivalAttempt(
  claim: { current: boolean },
  actions: {
    onClaimed: () => void;
    onReleased: () => void;
    onSendFailed: () => void;
    readStatus: () => Promise<ArrivalStatusRead>;
    /** False on a finished job. True only after the arrival notice succeeds. */
    stopWatch: (markArrivedAt: boolean) => Promise<void>;
    send: () => Promise<ArrivalSendResult>;
  },
): Promise<ArrivalSendResult> {
  if (claim.current) {
    return {
      data: { success: true, deduplicated: true, message: 'Arrival already recorded.' },
      error: null,
    };
  }
  claim.current = true;
  actions.onClaimed();

  let reading: ArrivalStatusRead;
  try {
    reading = await actions.readStatus();
  } catch {
    reading = { status: null, failed: true };
  }

  if (!reading.failed && !shouldSendArrival(reading.status)) {
    try {
      await actions.stopWatch(false);
    } catch {
      // The claim stays. A finished job must not keep the watch running.
    }
    return {
      data: {
        success: true,
        skipped: true,
        message: 'This job is already finished, so no arrival notice was sent.',
      },
      error: null,
    };
  }

  try {
    const result = await actions.send();
    const data = result.data as { success?: boolean } | null;
    if (isArrivalInFlight(result)) {
      claim.current = false;
      actions.onReleased();
      return result;
    }
    if (result.error || data?.success === false) {
      claim.current = false;
      actions.onReleased();
      actions.onSendFailed();
      return result;
    }
    try {
      await actions.stopWatch(true);
    } catch {
      // The notice went out. Stopping the watch must not look like a failed send.
    }
    return result;
  } catch (err) {
    claim.current = false;
    actions.onReleased();
    actions.onSendFailed();
    return { data: null, error: err };
  }
}
