/**
 * Saving an APNs device token must succeed when the row already exists.
 *
 * The iPhone can register with Apple and then lose the HTTP response, hit a
 * duplicate-key insert, or call before the session has finished refreshing.
 * The previous client treated every one of those as a hard failure and told
 * the person to pull to refresh — on every cold start — even when
 * device_push_tokens already held the token and a later push was accepted.
 */

export const PUSH_TOKEN_SAVE_BACKOFF_MS = [0, 1000, 2500, 5000];

export const PUSH_TOKEN_SAVE_FAILED_MESSAGE =
  "TidyWise couldn't save this iPhone for notifications.";

const PUSH_SAVE_TOAST_KEY = "tw-push-save-failure-toasted";

export interface PushSaveResult {
  ok: boolean;
  errorMessage?: string | null;
}

export interface PersistPushTokenResult {
  ok: boolean;
  attempts: number;
  /** The write failed, but this exact token was already stored for the user. */
  alreadyStored: boolean;
}

export async function persistDevicePushToken(args: {
  save: () => Promise<PushSaveResult>;
  /** Last resort: the row is already there, so the phone can receive pushes. */
  confirmStored?: () => Promise<boolean>;
  backoffMs?: number[];
  sleep?: (ms: number) => Promise<void>;
}): Promise<PersistPushTokenResult> {
  const backoff = args.backoffMs ?? PUSH_TOKEN_SAVE_BACKOFF_MS;
  const sleep = args.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  let attempts = 0;

  for (let i = 0; i < backoff.length; i++) {
    if (backoff[i] > 0) await sleep(backoff[i]);
    attempts += 1;
    try {
      const result = await args.save();
      if (result.ok) return { ok: true, attempts, alreadyStored: false };
    } catch {
      // A thrown client error is retryable. The next attempt asks again.
    }
  }

  if (args.confirmStored) {
    try {
      if (await args.confirmStored()) return { ok: true, attempts, alreadyStored: true };
    } catch {
      // Confirming is best-effort. A failed read is not proof the row is missing.
    }
  }

  return { ok: false, attempts, alreadyStored: false };
}

type ToastStorage = {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
};

/**
 * Automatic registration runs on every launch. Toast the save failure once,
 * until a later save succeeds, so a cold start does not stack the same error.
 * An explicit Try again tap does not consult this.
 */
export function claimPushSaveFailureToast(storage: Pick<ToastStorage, "getItem" | "setItem">): boolean {
  try {
    if (storage.getItem(PUSH_SAVE_TOAST_KEY) === "1") return false;
    storage.setItem(PUSH_SAVE_TOAST_KEY, "1");
    return true;
  } catch {
    return true;
  }
}

export function clearPushSaveFailureToast(storage: Pick<ToastStorage, "removeItem">): void {
  try {
    storage.removeItem(PUSH_SAVE_TOAST_KEY);
  } catch {
    // Storage can be unavailable in a private webview. The in-memory flag is
    // not worth a second copy; the next launch may toast once more.
  }
}
