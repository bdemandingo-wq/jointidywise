import { useEffect, useRef, useCallback, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { confirmDialog } from '@/components/AppDialogs';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';
import { useOrgCountryCode } from '@/hooks/useDistanceUnit';
import { calculateDistanceMiles, estimateDriveMinutes } from '@/lib/distanceUtils';
import { geoFailureCode, getPositionWithFallback } from '@/lib/geo';
import { nextArrivalErrorToast, runArrivalAttempt } from '@/lib/arrivalAttempt';
import { readLocationSharingAvailability } from '@/lib/readLocationSharingAvailability';
import { recordOsPermissionGrant } from '@/lib/recordLocationConsent';
import { readAlwaysLocationRequested, rememberAlwaysLocationRequested } from '@/lib/alwaysLocationPrompt';
import { SUPABASE_PUBLIC_ANON_KEY, SUPABASE_PUBLIC_URL } from '@/lib/supabasePublicEnv';
import {
  readTripLocationAuth,
  requestTripAlwaysAuthorization,
  startTripBackgroundUpdates,
  stopTripBackgroundUpdates,
} from '@/lib/tripBackgroundLocation';
import {
  ALWAYS_LOCATION_EXPLAINER_BODY,
  ALWAYS_LOCATION_EXPLAINER_HEADING,
  beginTripWatch,
  chooseTripWatch,
  endTripWatch,
  initialTripWatchSession,
  TRIP_MAX_DURATION_MS,
  tripTimedOut,
  type TripStopReason,
  type TripWatchMode,
} from '@/lib/tripLocationSession';
import {
  nextWebSharePhase,
  webShareShouldReadGeolocation,
  type WebSharePhase,
  type WebShareSignal,
} from '@/lib/webLocationSharing';

// ─── helpers ────────────────────────────────────────────────────────────────

function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// When In Use, via @capacitor/geolocation. Always is a separate step inside
// startTracking, and only on iOS, after the in-app explainer. Web uses the
// browser prompt. Clock-in and job photos do not call this.
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

function explainAlwaysLocation(): Promise<boolean> {
  // Continue is the only button. Apple 5.1.1(iv): the decline is the iOS prompt.
  return confirmDialog(ALWAYS_LOCATION_EXPLAINER_BODY, ALWAYS_LOCATION_EXPLAINER_HEADING, {
    confirmLabel: 'Continue',
    hideCancel: true,
    destructive: false,
  });
}

// ─── constants ───────────────────────────────────────────────────────────────

const ARRIVAL_THRESHOLD_METERS = 100;
const MIN_WRITE_INTERVAL_MS = 8_000; // throttle DB writes to ≤ 1 per 8 s

function trackingStartedAtMs(createdAt: unknown): number {
  if (typeof createdAt !== 'string') return Date.now();
  const parsed = Date.parse(createdAt);
  return Number.isFinite(parsed) ? parsed : Date.now();
}

export type TrackingStartResult =
  | {
      ok: true;
      trackingToken: string | null;
      etaMinutes: number | null;
      latitude: number;
      longitude: number;
    }
  | { ok: false; reason: 'consent' | 'disabled' | 'os_denied' | 'unavailable' };

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
  const arrivalErrorStreakRef = useRef(false);
  const wakeLockRef      = useRef<any>(null);
  const lastWriteRef     = useRef<number>(0);
  const watchIdRef       = useRef<string | null>(null);   // Capacitor watchId (string)
  const browserWatchRef  = useRef<number | null>(null);   // browser watchId (number)
  const stopTrackingRef = useRef<(reason?: TripStopReason) => Promise<void>>(async () => {});
  const haltWatchRef = useRef<(markArrivedAt: boolean, reason?: TripStopReason) => Promise<void>>(async () => {});
  const webSharePhaseRef = useRef<WebSharePhase>('idle');
  const sessionRef = useRef(initialTripWatchSession());
  const watchModeRef = useRef<TripWatchMode>('foreground');
  const backgroundTokenRef = useRef<number | null>(null);
  const tripStartedAtRef = useRef<number | null>(null);
  const tripTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const writePositionRef = useRef<(latitude: number, longitude: number) => Promise<void>>(async () => {});
  const [isTracking, setIsTracking] = useState(false);
  const [hasArrived, setHasArrived] = useState(false);
  const [backgroundSharing, setBackgroundSharing] = useState(false);

  // ── arrival firing (shared by geofence, resume-check, and manual button) ──

  const fireArrival = useCallback(async (source: string) => {
    // runArrivalAttempt sets arrivedRef before the status read. A second
    // position update that lands during that read is a duplicate, and a
    // finished job stops the watch instead of toasting "skipped" again.
    const result = await runArrivalAttempt(arrivedRef, {
      onClaimed: () => setHasArrived(true),
      onReleased: () => setHasArrived(false),
      onSendFailed: () => {
        if (source === 'manual') return;
        const next = nextArrivalErrorToast(arrivalErrorStreakRef.current);
        arrivalErrorStreakRef.current = next.streakActive;
        if (next.show) toast.error('Could not send the arrival notice. Location sharing is still on.');
      },
      readStatus: async () => {
        const { data: bookingRow, error: statusError } = await supabase
          .from('bookings')
          .select('status')
          .eq('id', bookingId)
          .maybeSingle();
        return { status: bookingRow?.status, failed: !!statusError };
      },
      stopWatch: (markArrivedAt) => haltWatchRef.current(markArrivedAt),
      send: async () => {
        console.log(`[GPS] Arrival fired (${source})`);
        return supabase.functions.invoke('send-arrival-sms', { body: { bookingId, staffId } });
      },
    });
    const payload = result.data as { success?: boolean; skipped?: boolean; deduplicated?: boolean } | null;
    if (!result.error && payload?.success !== false && !payload?.skipped && !payload?.deduplicated) {
      arrivalErrorStreakRef.current = false;
    }
    return result;
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
    if (arrivedRef.current) return;
    const startedAt = tripStartedAtRef.current;
    if (startedAt != null && tripTimedOut(startedAt, Date.now())) {
      void stopTrackingRef.current('timeout');
      return;
    }
    if (!trackingIdRef.current) return;
    if (Capacitor.getPlatform() === 'web' && !webShareShouldReadGeolocation(webSharePhaseRef.current)) return;
    // Arrival is not on the 8 second write throttle. A fix inside the
    // geofence stops the trip even when the last coordinate write was recent.
    void checkArrival(latitude, longitude);
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
      if (error.code === '42501') void stopTrackingRef.current('consent_revoked');
      return;
    }
  }, [checkArrival]);

  writePositionRef.current = writePosition;

  const releaseBackgroundWatcher = useCallback(async () => {
    const token = backgroundTokenRef.current;
    backgroundTokenRef.current = null;
    if (token == null) return;
    await stopTripBackgroundUpdates(token);
  }, []);

  // ── stop tracking ─────────────────────────────────────────────────────────

  const clearBrowserWatch = useCallback(() => {
    if (browserWatchRef.current !== null && typeof navigator !== 'undefined' && navigator.geolocation) {
      navigator.geolocation.clearWatch(browserWatchRef.current);
      browserWatchRef.current = null;
    }
  }, []);

  const haltWatch = useCallback(async (markArrivedAt: boolean, reason?: TripStopReason) => {
    if (tripTimeoutRef.current != null) {
      clearTimeout(tripTimeoutRef.current);
      tripTimeoutRef.current = null;
    }
    tripStartedAtRef.current = null;
    webSharePhaseRef.current = 'idle';
    const resolvedReason = reason ?? (markArrivedAt ? 'arrival' : 'job_finished');
    const transition = endTripWatch(sessionRef.current, resolvedReason);
    sessionRef.current = transition.session;
    setBackgroundSharing(false);
    if (transition.stopBackground) {
      try { await releaseBackgroundWatcher(); } catch (err) {
        console.warn('[GPS] background watch stop failed', err);
      }
    }
    if (watchIdRef.current !== null) {
      try {
        const { Geolocation } = await import('@capacitor/geolocation');
        await Geolocation.clearWatch({ id: watchIdRef.current });
      } catch {}
      watchIdRef.current = null;
    }
    clearBrowserWatch();
    if (wakeLockRef.current) {
      try { await wakeLockRef.current.release(); } catch {}
      wakeLockRef.current = null;
    }
    if (trackingIdRef.current) {
      const patch: { is_active: false; arrived_at?: string } = { is_active: false };
      if (markArrivedAt) patch.arrived_at = new Date().toISOString();
      await supabase
        .from('cleaner_location_tracking')
        .update(patch as any)
        .eq('id', trackingIdRef.current);
      trackingIdRef.current = null;
    }
    setIsTracking(false);
  }, [clearBrowserWatch, releaseBackgroundWatcher]);

  haltWatchRef.current = haltWatch;

  const stopTracking = useCallback(async (reason: TripStopReason = 'stop_tracking') => {
    await haltWatch(false, reason);
    arrivedRef.current = false;
    setHasArrived(false);
    console.log('[GPS] Tracking stopped', reason);
  }, [haltWatch]);

  stopTrackingRef.current = stopTracking;

  // ── resume check ──────────────────────────────────────────────────────────
  // While Using pauses when the phone locks. Coming back re-checks arrival.
  // Always keeps the background watcher running; this check is a second
  // look when the app returns. The arrival claim blocks a second notice.

  useEffect(() => {
    if (!isTracking || Capacitor.getPlatform() === 'web') return;

    const checkNow = async () => {
      if (arrivedRef.current) return;
      const startedAt = tripStartedAtRef.current;
      if (startedAt != null && tripTimedOut(startedAt, Date.now())) {
        void stopTrackingRef.current('timeout');
        return;
      }
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

  const startForegroundWatch = useCallback(async () => {
    if (Capacitor.isNativePlatform()) {
      try {
        const { Geolocation } = await import('@capacitor/geolocation');
        const id = await Geolocation.watchPosition(
          { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 },
          (pos, err) => {
            if (err) { console.warn('[GPS] watch error', err); return; }
            if (!pos) return;
            void writePositionRef.current(pos.coords.latitude, pos.coords.longitude);
          },
        );
        watchIdRef.current = id;
        console.log('[GPS] Capacitor watchPosition started, id:', id);
        return;
      } catch (e) {
        console.warn('[GPS] Capacitor watchPosition failed, falling back to browser', e);
      }
    }

    // Browser fallback (web/simulator). A hidden tab does not start a watch.
    if (Capacitor.getPlatform() === 'web' && document.visibilityState === 'hidden') {
      webSharePhaseRef.current = 'paused';
      return;
    }
    if (Capacitor.getPlatform() === 'web') webSharePhaseRef.current = 'sharing';
    if (navigator.geolocation?.watchPosition) {
      clearBrowserWatch();
      browserWatchRef.current = navigator.geolocation.watchPosition(
        (pos) => { void writePositionRef.current(pos.coords.latitude, pos.coords.longitude); },
        (err) => console.warn('[GPS] browser watch error', err?.code, err?.message),
        { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 },
      );
      console.log('[GPS] Browser watchPosition started');
    }
  }, [clearBrowserWatch]);

  const backgroundDurationSeconds = () => {
    const startedAt = tripStartedAtRef.current ?? Date.now();
    return Math.max(0, (TRIP_MAX_DURATION_MS - (Date.now() - startedAt)) / 1000);
  };

  const engageBackgroundWatcher = useCallback(async () => {
    const token = await startTripBackgroundUpdates((latitude, longitude) => {
      void writePositionRef.current(latitude, longitude);
    }, (auth) => {
      if (auth === 'always' || sessionRef.current.mode !== 'background') return;
      if (auth === 'denied' || auth === 'restricted') {
        void stopTrackingRef.current('consent_revoked');
        return;
      }
      const transition = beginTripWatch(sessionRef.current, 'foreground');
      sessionRef.current = transition.session;
      setBackgroundSharing(false);
      if (transition.stopBackground) {
        void releaseBackgroundWatcher().finally(() => { void startForegroundWatch(); });
      }
    }, (reason, sms) => {
      if (reason === 'arrived') {
        // Native already called send-arrival-sms. Retry from JS only when
        // that call failed. The function dedupes a second success.
        if (sms === 'failed') {
          void fireArrival('native');
          return;
        }
        arrivedRef.current = true;
        setHasArrived(true);
        void haltWatchRef.current(true, 'arrival');
        return;
      }
      if (reason === 'closed') {
        void stopTrackingRef.current('closed');
        return;
      }
      void stopTrackingRef.current('timeout');
    }, backgroundDurationSeconds(), {
      trackingId: trackingIdRef.current ?? '',
      supabaseUrl: SUPABASE_PUBLIC_URL,
      supabaseAnonKey: SUPABASE_PUBLIC_ANON_KEY,
      destinationLat: destCoordsRef.current?.lat,
      destinationLng: destCoordsRef.current?.lng,
      bookingId,
      staffId,
    });
    backgroundTokenRef.current = token;
  }, [bookingId, staffId, fireArrival, releaseBackgroundWatcher, startForegroundWatch]);

  const startWatch = useCallback(async () => {
    if (watchModeRef.current === 'background') {
      const transition = beginTripWatch(sessionRef.current, 'background');
      sessionRef.current = transition.session;
      if (transition.startBackground) {
        try {
          await engageBackgroundWatcher();
          setBackgroundSharing(true);
          console.log('[GPS] Background trip watch started');
          return;
        } catch (err) {
          console.warn('[GPS] Background watch failed, using foreground', err);
          try { await releaseBackgroundWatcher(); } catch { /* not running */ }
          sessionRef.current = beginTripWatch(initialTripWatchSession(), 'foreground').session;
          setBackgroundSharing(false);
        }
      } else {
        setBackgroundSharing(true);
        return;
      }
    } else {
      const transition = beginTripWatch(sessionRef.current, 'foreground');
      sessionRef.current = transition.session;
      if (transition.stopBackground) {
        try { await releaseBackgroundWatcher(); } catch { /* ignore */ }
      }
      setBackgroundSharing(false);
    }
    await startForegroundWatch();
  }, [engageBackgroundWatcher, releaseBackgroundWatcher, startForegroundWatch]);

  const startWatchRef = useRef(startWatch);
  startWatchRef.current = startWatch;

  const applyWebShareSignal = useCallback((signal: WebShareSignal) => {
    if (Capacitor.getPlatform() !== 'web') return;
    const prev = webSharePhaseRef.current;
    const next = nextWebSharePhase(prev, signal);
    webSharePhaseRef.current = next;
    if (next === 'paused') {
      clearBrowserWatch();
      return;
    }
    if (next === 'sharing' && prev === 'paused') void startWatchRef.current();
  }, [clearBrowserWatch]);

  useEffect(() => {
    if (!isTracking || Capacitor.getPlatform() !== 'web') return;

    const onVisibility = () => {
      const visibilityState = document.visibilityState;
      if (visibilityState === 'visible' || visibilityState === 'hidden' || visibilityState === 'prerender') {
        applyWebShareSignal({ type: 'visibility', visibilityState });
      }
    };
    const onPageHide = () => applyWebShareSignal({ type: 'pagehide' });
    const onUnload = () => applyWebShareSignal({ type: 'unload' });
    const onPageShow = () => {
      if (document.visibilityState === 'visible') {
        applyWebShareSignal({ type: 'visibility', visibilityState: 'visible' });
      }
    };
    if (document.visibilityState === 'hidden') onVisibility();

    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onPageHide);
    window.addEventListener('pageshow', onPageShow);
    window.addEventListener('unload', onUnload);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onPageHide);
      window.removeEventListener('pageshow', onPageShow);
      window.removeEventListener('unload', onUnload);
    };
  }, [isTracking, applyWebShareSignal]);

  // ── start tracking ────────────────────────────────────────────────────────

  const startTracking = useCallback(async (onStatus?: (message: string) => void): Promise<TrackingStartResult> => {
    console.log('[GPS] startTracking called for booking:', bookingId);

    const gate = await readLocationSharingAvailability();
    if (!gate.trackingEnabled) return { ok: false, reason: 'disabled' };

    try {
      onStatus?.('Waiting for location access…');
      const permitted = await requestLocationPermission();
      if (!permitted) return { ok: false, reason: 'os_denied' };

      if (Capacitor.getPlatform() === 'ios') {
        onStatus?.('Checking location access…');
        const mode = await chooseTripWatch({
          platform: 'ios',
          readAuth: readTripLocationAuth,
          explain: explainAlwaysLocation,
          requestAlways: requestTripAlwaysAuthorization,
          alwaysRequested: await readAlwaysLocationRequested(),
          rememberRequested: rememberAlwaysLocationRequested,
        });
        if (mode === 'none') return { ok: false, reason: 'os_denied' };
        watchModeRef.current = mode;
      } else {
        watchModeRef.current = 'foreground';
      }

      onStatus?.('Getting your location…');
      // Consent rows are looked up while the position fix is in flight.
      // A failed consent write does not cancel the fix. The tracking insert
      // still needs the row, and a 42501 from that insert is reported as consent.
      const consentWrite = gate.logConsent
        ? recordOsPermissionGrant(staffId).catch((err: unknown) => {
            console.error('[GPS] could not record location consent', err);
            toast.error('Location is on, but sharing could not be saved for this job.');
          })
        : Promise.resolve();
      const { latitude, longitude } = (await Promise.all([
        getPositionWithFallback(),
        consentWrite,
      ]))[0];
      console.log('[GPS] Initial position:', latitude, longitude);

      // Insert or resume tracking record
      let recordId: string;
      let trackingToken: string | null = null;
      let createdAt: unknown = null;

      const { data, error } = await supabase
        .from('cleaner_location_tracking')
        .insert({ booking_id: bookingId, staff_id: staffId, organization_id: organizationId, latitude, longitude } as any)
        .select('id, tracking_token, created_at')
        .single();

      if (error?.code === '23505') {
        // Already active — resume it
        const { data: existing } = await supabase
          .from('cleaner_location_tracking')
          .select('id, tracking_token, created_at')
          .eq('booking_id', bookingId)
          .eq('is_active', true)
          .single();
        if (!existing) return { ok: false, reason: 'unavailable' };
        recordId = existing.id;
        trackingToken = (existing as any).tracking_token;
        createdAt = existing.created_at;
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
        createdAt = data.created_at;
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

      const startedAtMs = trackingStartedAtMs(createdAt);
      const remainingMs = Math.min(
        TRIP_MAX_DURATION_MS,
        Math.max(0, TRIP_MAX_DURATION_MS - (Date.now() - startedAtMs)),
      );
      if (remainingMs === 0) {
        await stopTracking('timeout');
        toast.error('On My Way stopped after 3 hours.');
        return { ok: false, reason: 'unavailable' };
      }
      tripStartedAtRef.current = startedAtMs;
      if (tripTimeoutRef.current != null) clearTimeout(tripTimeoutRef.current);
      tripTimeoutRef.current = setTimeout(() => {
        void stopTrackingRef.current('timeout');
      }, remainingMs);
      await startWatch();
      void acquireWakeLock();
      setIsTracking(true);
      void checkArrival(latitude, longitude);

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
  }, [bookingId, staffId, organizationId, destinationAddress, destinationLat, destinationLng, orgCountry, checkArrival, startWatch, acquireWakeLock, stopTracking]);

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
    return () => { void stopTracking('unmount'); };
  }, [stopTracking]);

  return { startTracking, stopTracking, isTracking, hasArrived, markArrived, backgroundSharing };
}
