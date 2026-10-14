import {
  readPrivacyChoice,
  writePrivacyChoice,
  type PrivacyChoice,
  type PrivacyStorage,
} from './tidywiseSitePrivacy';

const listeners = new Set<() => void>();

/**
 * Safari private mode can throw on localStorage. The choice then lives in
 * this module for the rest of the tab. A reload forgets it, which is why
 * opt-out does not reload when the write failed.
 */
let memoryChoice: PrivacyChoice | null = null;
let memoryOnly = false;

export function subscribePrivacyChoice(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function safeLocalStorage(): PrivacyStorage | null {
  try {
    if (typeof window === 'undefined') return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

export function loadPrivacyChoice(): PrivacyChoice | null {
  if (memoryOnly) return memoryChoice;
  const storage = safeLocalStorage();
  if (!storage) return memoryChoice;
  try {
    const stored = readPrivacyChoice(storage);
    if (stored) {
      memoryChoice = stored;
      return stored;
    }
  } catch {
    memoryOnly = true;
    return memoryChoice;
  }
  return memoryChoice;
}

/** Returns true when the choice was written to storage, false when only memory holds it. */
export function persistPrivacyChoice(choice: PrivacyChoice): boolean {
  memoryChoice = choice;
  let stored = false;
  const storage = safeLocalStorage();
  if (storage) {
    try {
      writePrivacyChoice(storage, choice);
      stored = true;
      memoryOnly = false;
    } catch {
      memoryOnly = true;
    }
  } else {
    memoryOnly = true;
  }
  for (const listener of listeners) listener();
  return stored;
}

export function privacyChoiceIsMemoryOnly(): boolean {
  return memoryOnly;
}
