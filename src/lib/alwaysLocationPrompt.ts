import { Preferences } from '@capacitor/preferences';

/** Local only. Not now is remembered on the phone so the next trip does not ask. */
const DECLINED_KEY = 'tw-always-location-explainer-declined';

let memoryDeclined = false;

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
