import { shouldSendArrival } from './jobEventCopy.ts';

export interface ArrivalStatusRead {
  status: string | null | undefined;
  failed: boolean;
}

export interface ArrivalSendResult {
  data: unknown;
  error: unknown;
}

/**
 * One arrival notice per job.
 * The claim is set before the status read, so two position updates that
 * arrive together share one send. A finished job keeps the claim and stops
 * the watch. A failed send releases the claim so the button can try again.
 * A failed status read still sends; the server checks the booking status.
 */
export async function runArrivalAttempt(
  claim: { current: boolean },
  actions: {
    onClaimed: () => void;
    onReleased: () => void;
    readStatus: () => Promise<ArrivalStatusRead>;
    stopWatch: () => Promise<void>;
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
      await actions.stopWatch();
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
    await actions.stopWatch();
    const result = await actions.send();
    const data = result.data as { success?: boolean } | null;
    if (result.error || data?.success === false) {
      claim.current = false;
      actions.onReleased();
    }
    return result;
  } catch (err) {
    claim.current = false;
    actions.onReleased();
    return { data: null, error: err };
  }
}
