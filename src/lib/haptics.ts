import { Capacitor } from '@capacitor/core';

/**
 * Light / medium / heavy tap on the iOS app. The website never vibrates:
 * navigator.vibrate is not called, and the Capacitor plugin is not loaded.
 */
export function hapticImpact(style: 'light' | 'medium' | 'heavy' = 'light') {
  if (Capacitor.getPlatform() !== 'ios') return;
  void import('@capacitor/haptics')
    .then(({ Haptics, ImpactStyle }) => {
      const impact =
        style === 'heavy' ? ImpactStyle.Heavy : style === 'medium' ? ImpactStyle.Medium : ImpactStyle.Light;
      return Haptics.impact({ style: impact });
    })
    .catch(() => {
      // Haptics are optional. A missing plugin must not break the tap.
    });
}
