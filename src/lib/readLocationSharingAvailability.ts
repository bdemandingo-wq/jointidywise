import { Capacitor } from '@capacitor/core';
import { supabase } from '@/lib/supabase';
import {
  LOCATION_TRACKING_SWITCH_KEY,
  locationSharingAvailability,
  remoteTrackingEnabled,
  type LocationSharingAvailability,
} from '@/lib/locationConsent';

/** Reads the remote switch and, on iOS, App.getInfo().build. Does not prompt. */
export async function readLocationSharingAvailability(): Promise<LocationSharingAvailability> {
  let remoteEnabled = false;
  try {
    const { data, error } = await supabase
      .from('platform_settings')
      .select('value')
      .eq('key', LOCATION_TRACKING_SWITCH_KEY)
      .maybeSingle();
    if (error) throw error;
    remoteEnabled = remoteTrackingEnabled(data?.value);
  } catch (err) {
    console.error('[location-consent] could not read tracking switch', err);
    remoteEnabled = false;
  }

  const platform = Capacitor.getPlatform();
  let build: string | null = null;
  if (platform === 'ios') {
    try {
      const { App } = await import('@capacitor/app');
      build = (await App.getInfo()).build;
    } catch (err) {
      console.error('[location-consent] could not read native build', err);
      build = null;
    }
  }

  return locationSharingAvailability({ platform, build, remoteEnabled });
}
