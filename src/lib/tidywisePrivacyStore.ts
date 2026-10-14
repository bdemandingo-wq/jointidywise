import {
  readPrivacyChoice,
  writePrivacyChoice,
  type PrivacyChoice,
  type PrivacyStorage,
} from './tidywiseSitePrivacy';

const listeners = new Set<() => void>();

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
  return readPrivacyChoice(safeLocalStorage());
}

export function persistPrivacyChoice(choice: PrivacyChoice): void {
  const storage = safeLocalStorage();
  if (storage) {
    try {
      writePrivacyChoice(storage, choice);
    } catch {
      // Private mode can reject the write. The in-memory listeners still
      // update this tab so the banner closes for the rest of the visit.
    }
  }
  for (const listener of listeners) listener();
}
