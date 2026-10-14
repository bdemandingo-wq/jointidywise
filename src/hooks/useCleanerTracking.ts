import { useEffect, useRef, useCallback, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';
import { useOrgCountryCode } from '@/hooks/useDistanceUnit';
import { calculateDistanceMiles, estimateDriveMinutes } from '@/lib/distanceUtils';
import { geoFailureCode, getPositionWithFallback } from '@/lib/geo';
import { consentAllowsTracking, parseConsentDecision } from '@/lib/locationConsent';

// ─── helpers ────────────────────────────────────────────────────────────────

function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Request When-In-Use location. @capacitor/geolocation does not prompt for
// Always, and the Info.plist does not declare the location background mode
// (removed for App Store guideline 2.5.4). Live updates run while the app
// is open; coming back to the app re-checks arrival.
async function requestLocationPermission(): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) return true; // browser handles its own prompt
  try {
    const { Geolocation } = await import('@capacitor/geolocation');
    const status = await Geolocation.checkPermissions();

    if (status.location === 'granted') return true;

    // Denied — can't recover without sending user to Settings
    if (status.location === 'denied') {
      toast.error('Location permission denied. Enable it in Settings → TidyWise → Location → While Using the App.');
      return false;
    }

    // Prompt
    const requested = await Geolocation.requestPermissions({ permissions: ['location'] });
    if (requested.location === 'denied') {
      toast.error('Location access is needed to track your route to the job.');
      return false;
    }
    return true;
  } catch (e) {
    console.warn('[GPS] Permission request error', e);
    return true; // don't block — let watchPosition surface the real error
  }
}

// ─── constants ───────────────────────────────────────────────────────────────

const ARRIVAL_THRESHOLD_METERS = 100;
const MIN_WRITE_INTERVAL_MS = 8_000; // throttle DB writes to ≤ 1 per 8 s

export type TrackingStartResult =
  | {
      ok: true;
      trackingToken: string | null;
      etaMinutes: number | null;
      latitude: number;
      longitude: number;
    }
  | { ok: false; reason: 'consent' | 'os_denied' | 'unavailable' };

async function latestConsentAllowsTracking(staffId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('cleaner_location_consents')
    .select('decision')
    .eq('staff_id', staffId)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(1);
  if (error) throw error;
  return consentAllowsTracking(parseConsentDecision(data?.[0]?.decision));
}

// ─── types ───────────────────────────────────────────────────────────────────

interface UseCleanerTrackingOptions {
  bookingId: string;
  staffId: string;
  organizationId: string;
  destinationAddress?: string;
  /** Places coordinates stored on the booking, when it has them. */
  destinationLat?: number | null;
  destinationLng?: number | null;
}

// ─── hook ────────────────────────────────────────────────────────────────────

export function useCleanerTracking({ bookingId, staffId, organizationId, destinationAddress, destinationLat, destinationLng }: UseCleanerTrackingOptions) {
  // Staff surfaces have no OrganizationContext, so pass the id explicitly.
  const orgCountry = useOrgCountryCode(organizationId);
  const trackingIdRef    = useRef<string | null>(null);
  const destCoordsRef    = useRef<{ lat: number; lng: number } | null>(null);
  const arrivedRef       = useRef<boolean>(false);
  const wakeLockRef      = useRef<any>(null);
  const lastWriteRef     = useRef<number>(0);
  const watchIdRef       = useRef<string | null>(null);   // Capacitor watchId (string)
  const browserWatchRef  = useRef<number | null>(null);   // browser watchId (number)
  const stopTrackingRef  = useRef<() => Promise<void>>(async () => {});
  const [isTracking, setIsTracking] = useState(false);
  const [hasArrived, setHasArrived] = useState(false);

  // ── arrival firing (shared by geofence, resume-check, and manual button) ──

  const fireArrival = useCallback(async (source: string) => {
    if (arrivedRef.current) {
      return {
        data: { success: true, deduplicated: true, message: 'Arrival already recorded.' },
        error: null,
      };
    }
    arrivedRef.current = true;
    setHasArrived(true);
    console.log(`[GPS] Arrival fired (${source})`);
    try {
      if (trackingIdRef.current) {
        await supabase
          .from('cleaner_location_tracking')
          .update({ arrived_at: new Date().toISOString() } as any)
          .eq('id', trackingIdRef.current);
      }
      const result = await supabase.functions.invoke('send-arrival-sms', { body: { bookingId, staffId } });
      // A hard failure should leave the button usable. A success:true with
      // SMS skipped still notified the office, so the arrival sticks.
      if (result.error || result.data?.success === false) {
        arrivedRef.current = false;
        setHasArrived(false);
      }
      return result;
    } catch (err) {
      console.warn('[GPS] Arrival notification failed:', err);
      arrivedRef.current = false;
      setHasArrived(false);
      return { data: null, error: err };
    }
  }, [bookingId, staffId]);

  /** Manual "I've Arrived" — works even if GPS tracking never started.
   *  The send-arrival-sms function dedupes per staff+booking server-side.
   *  Returns the function payload so the toast can name what was actually sent. */
  const markArrived = useCallback(() => fireArrival('manual'), [fireArrival]);

  // ── wake lock ─────────────────────────────────────────────────────────────

  const acquireWakeLock = useCallback(async () => {
    try {
      if ('wakeLock' in navigator) {
        wakeLockRef.current = await (navigator as any).wakeLock.request('screen');
        console.log('[GPS] Wake lock acquired');
      }
    } catch (e) { console.warn('[GPS] wake lock failed', e); }
  }, []);

  // ── arrival check ─────────────────────────────────────────────────────────

  const checkArrival = useCallback(async (lat: number, lng: number) => {
    if (arrivedRef.current || !destCoordsRef.current) return;
    const meters = haversineMeters(lat, lng, destCoordsRef.current.lat, destCoordsRef.current.lng);
    if (meters > ARRIVAL_THRESHOLD_METERS) return;
    console.log('[GPS] Arrival detected —', Math.round(meters), 'm from destination');
    await fireArrival('geofence');
  }, [fireArrival]);

  // ── write position to DB ──────────────────────────────────────────────────

  const writePosition = useCallback(async (latitude: number, longitude: number) => {
    if (!trackingIdRef.current) return;
    const now = Date.now();
    if (now - lastWriteRef.current < MIN_WRITE_INTERVAL_MS) return;
    lastWriteRef.current = now;

    const { error } = await supabase
      .from('cleaner_location_tracking')
      .update({ latitude, longitude, recorded_at: new Date().toISOString() } as any)
      .eq('id', trackingIdRef.current);
    if (error) {
      console.error('[GPS] position write failed', error);
      // Consent was revoked. Stop the watch so it does not keep writing.
      if (error.code === '42501') void stopTrackingRef.current();
      return;
    }

    void checkArrival(latitude, longitude);
  }, [checkArrival]);

  // ── stop tracking ─────────────────────────────────────────────────────────

  const stopTracking = useCallback(async () => {
    // Clear Capacitor watch
    if (watchIdRef.current !== null) {
      try {
        const { Geolocation } = await import('@capacitor/geolocation');
        await Geolocation.clearWatch({ id: watchIdRef.current });
      } catch {}
      watchIdRef.current = null;
    }
    // Clear browser watch
    if (browserWatchRef.current !== null) {
      navigator.geolocation.clearWatch(browserWatchRef.current);
      browserWatchRef.current = null;
    }
    // Release wake lock
    if (wakeLockRef.current) {
      try { await wakeLockRef.current.release(); } catch {}
      wakeLockRef.current = null;
    }
    // Mark tracking record inactive
    if (trackingIdRef.current) {
      await supabase
        .from('cleaner_location_tracking')
        .update({ is_active: false } as any)
        .eq('id', trackingIdRef.current);
      trackingIdRef.current = null;
    }
    arrivedRef.current = false;
    setHasArrived(false);
    setIsTracking(false);
    console.log('[GPS] Tracking stopped');
  }, []);

  stopTrackingRef.current = stopTracking;

  // ── resume check ──────────────────────────────────────────────────────────
  // Without background location (removed for App Store 2.5.4), tracking
  // suspends the moment the cleaner switches to Maps or locks the phone.
  // When they come back, immediately grab a position and re-run the
  // arrival check so the "arrived" texts still fire automatically.

  useEffect(() => {
    if (!isTracking) return;

    const checkNow = async () => {
      if (arrivedRef.current) return;
      try {
        const { latitude, longitude } = await getPositionWithFallback();
        void checkArrival(latitude, longitude);
      } catch { /* position unavailable — geofence watch will retry */ }
    };

    const onVisibility = () => {
      if (document.visibilityState === 'visible') void checkNow();
    };
    document.addEventListener('visibilitychange', onVisibility);

    let appSub: { remove: () => void } | undefined;
    if (Capacitor.isNativePlatform()) {
      import('@capacitor/app').then(({ App }) => {
        App.addListener('appStateChange', (state) => {
          if (state.isActive) void checkNow();
        }).then((h) => { appSub = h; });
      }).catch(() => {});
    }

    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      appSub?.remove();
    };
  }, [isTracking, checkArrival]);

  // ── start position watch ──────────────────────────────────────────────────

  const startWatch = useCallback(async () => {
    if (Capacitor.isNativePlatform()) {
      // @capacitor/geolocation wraps CLLocationManager. It does not keep a
      // background location session (no UIBackgroundModes location — that
      // was removed for App Store 2.5.4). Updates flow while the app is in
      // the foreground. The resume effect above catches up on return.
      try {
        const { Geolocation } = await import('@capacitor/geolocation');
        const id = await Geolocation.watchPosition(
          { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 },
          (pos, err) => {
            if (err) { console.warn('[GPS] watch error', err); return; }
            if (!pos) return;
            void writePosition(pos.coords.latitude, pos.coords.longitude);
          },
        );
        watchIdRef.current = id;
        console.log('[GPS] Capacitor watchPosition started, id:', id);
        return;
      } catch (e) {
        console.warn('[GPS] Capacitor watchPosition failed, falling back to browser', e);
      }
    }

    // Browser fallback (web/simulator)
    if (navigator.geolocation?.watchPosition) {
      browserWatchRef.current = navigator.geolocation.watchPosition(
        (pos) => { void writePosition(pos.coords.latitude, pos.coords.longitude); },
        (err) => console.warn('[GPS] browser watch error', err?.code, err?.message),
        { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 },
      );
      console.log('[GPS] Browser watchPosition started');
    }
  }, [writePosition]);

  // ── start tracking ────────────────────────────────────────────────────────

  const startTracking = useCallback(async (onStatus?: (message: string) => void): Promise<TrackingStartResult> => {
    console.log('[GPS] startTracking called for booking:', bookingId);

    let allowed = false;
    try {
      allowed = await latestConsentAllowsTracking(staffId);
    } catch (err) {
      console.error('[GPS] consent check failed', err);
      return { ok: false, reason: 'unavailable' };
    }
    if (!allowed) return { ok: false, reason: 'consent' };

    try {
      onStatus?.('Waiting for location access…');
      const permitted = await requestLocationPermission();
      if (!permitted) return { ok: false, reason: 'os_denied' };

      onStatus?.('Getting your location…');
      const { latitude, longitude } = await getPositionWithFallback();
      console.log('[GPS] Initial position:', latitude, longitude);

      // Insert or resume tracking record
      let recordId: string;
      let trackingToken: string | null = null;

      const { data, error } = await supabase
        .from('cleaner_location_tracking')
        .insert({ booking_id: bookingId, staff_id: staffId, organization_id: organizationId, latitude, longitude } as any)
        .select('id, tracking_token')
        .single();

      if (error?.code === '23505') {
        // Already active — resume it
        const { data: existing } = await supabase
          .from('cleaner_location_tracking')
          .select('id, tracking_token')
          .eq('booking_id', bookingId)
          .eq('is_active', true)
          .single();
        if (!existing) return { ok: false, reason: 'unavailable' };
        recordId = existing.id;
        trackingToken = (existing as any).tracking_token;
        const { error: resumeError } = await supabase
          .from('cleaner_location_tracking')
          .update({ latitude, longitude, recorded_at: new Date().toISOString() } as any)
          .eq('id', recordId);
        if (resumeError) {
          console.error('[GPS] Resume update error:', resumeError);
          if (resumeError.code === '42501') return { ok: false, reason: 'consent' };
          return { ok: false, reason: 'unavailable' };
        }
      } else if (error) {
        console.error('[GPS] Insert error:', error);
        if (error.code === '42501') return { ok: false, reason: 'consent' };
        return { ok: false, reason: 'unavailable' };
      } else {
        recordId = data.id;
        trackingToken = (data as any).tracking_token;
      }

      trackingIdRef.current = recordId;

      // Resolve destination for ETA + arrival detection.
      let etaMinutes: number | null = null;
      if (destinationLat != null && destinationLng != null) {
        // Stored Places coordinates — exact, international, no round-trip.
        destCoordsRef.current = { lat: destinationLat, lng: destinationLng };
        const dist = calculateDistanceMiles(latitude, longitude, destinationLat, destinationLng);
        etaMinutes = estimateDriveMinutes(dist);
      } else if (destinationAddress) {
        // Legacy fallback. geocode-address is still US-only, so this
        // silently yields no ETA for non-US addresses without coordinates.
        try {
          const res = await supabase.functions.invoke('geocode-address', {
            body: { address: destinationAddress, ...(orgCountry ? { country: orgCountry } : {}) },
          });
          if (res.data?.lat && res.data?.lng) {
            destCoordsRef.current = { lat: res.data.lat, lng: res.data.lng };
            const dist = calculateDistanceMiles(latitude, longitude, res.data.lat, res.data.lng);
            etaMinutes = estimateDriveMinutes(dist);
          }
        } catch { /* non-critical */ }
      }

      void checkArrival(latitude, longitude);
      await startWatch();
      void acquireWakeLock();
      setIsTracking(true);

      return { ok: true, trackingToken, etaMinutes, latitude, longitude };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : '';
      console.error('[GPS] startTracking failed:', message, err);
      const code = geoFailureCode(err);
      if (code === 'denied') {
        toast.error('Location access denied. Go to Settings → TidyWise → Location → While Using the App.');
        return { ok: false, reason: 'os_denied' };
      }
      if (code === 'timeout') {
        toast.error('Location timed out. The on-the-way notice will still send.');
      } else {
        toast.error('Unable to get your location. The on-the-way notice will still send.');
      }
      return { ok: false, reason: 'unavailable' };
    }
  }, [bookingId, staffId, organizationId, destinationAddress, destinationLat, destinationLng, orgCountry, checkArrival, startWatch, acquireWakeLock]);

  // Re-acquire wake lock when app comes back to foreground
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === 'visible' && isTracking) void acquireWakeLock();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [isTracking, acquireWakeLock]);

  // Cleanup on unmount
  useEffect(() => {
    return () => { void stopTracking(); };
  }, [stopTracking]);

  return { startTracking, stopTracking, isTracking, hasArrived, markArrived };
}
