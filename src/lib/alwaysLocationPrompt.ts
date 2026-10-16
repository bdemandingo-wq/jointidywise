import { Preferences } from '@capacitor/preferences';

/** Local only. Not now is remembered on the phone so the next trip does not ask. */
const DECLINED_KEY = 'tw-always-location-explainer-declined';
/** Local only. Once Always has been requested, later trips skip the explainer. */
const REQUESTED_KEY = 'tw-always-location-requested';

let memoryDeclined = false;
let memoryRequested = false;

export async function readAlwaysExplainerDeclined(): Promise<boolean> {
  if (memoryDeclined) return true;
  try {
    const { value } = await Preferences.get({ key: DECLINED_KEY });
    memoryDeclined = value === '1';
    return memoryDeclined;
  } catch {
    return memoryDeclined;
  }
}

export async function rememberAlwaysExplainerDeclined(): Promise<void> {
  memoryDeclined = true;
  try {
    await Preferences.set({ key: DECLINED_KEY, value: '1' });
  } catch {
    // The memory flag still skips the explainer until the app process ends.
  }
}

export async function readAlwaysLocationRequested(): Promise<boolean> {
  if (memoryRequested) return true;
  try {
    const { value } = await Preferences.get({ key: REQUESTED_KEY });
    memoryRequested = value === '1';
    return memoryRequested;
  } catch {
    return memoryRequested;
  }
}

export async function rememberAlwaysLocationRequested(): Promise<void> {
  memoryRequested = true;
  try {
    await Preferences.set({ key: REQUESTED_KEY, value: '1' });
  } catch {
    // The memory flag still skips the explainer until the app process ends.
  }
}
