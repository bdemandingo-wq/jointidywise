import { useCallback, useEffect, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { recordOsPermissionGrant } from '@/lib/recordLocationConsent';
import {
  IOS_APP_SETTINGS_URL,
  classifyPermissionFailure,
  classifyPluginStatus,
  classifyWebPermission,
  type ClassifiedLocation,
  type LocationPlatform,
  type LocationStatusKind,
} from '@/lib/locationPermission';

export interface LocationPermissionState {
  kind: LocationStatusKind | 'checking';
  precise: boolean | null;
  platform: LocationPlatform;
  native: boolean;
  requesting: boolean;
  request: () => Promise<LocationStatusKind>;
  refresh: () => Promise<void>;
  openSettings: () => void;
}

function readPlatform(): { platform: LocationPlatform; native: boolean } {
  const native = Capacitor.isNativePlatform();
  const platform = Capacitor.getPlatform();
  if (platform === 'ios' || platform === 'android') return { platform, native };
  return { platform: 'web', native };
}

async function readWebPermission(): Promise<'granted' | 'denied' | 'prompt' | null> {
  try {
    if (!navigator.permissions?.query) return null;
    const status = await navigator.permissions.query({ name: 'geolocation' });
    if (status.state === 'granted' || status.state === 'denied' || status.state === 'prompt') {
      return status.state;
    }
    return null;
  } catch {
    return null;
  }
}

async function readLocation(): Promise<ClassifiedLocation> {
  if (Capacitor.isNativePlatform()) {
    try {
      const { Geolocation } = await import('@capacitor/geolocation');
      const status = await Geolocation.checkPermissions();
      return classifyPluginStatus(status);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err ?? '');
      return classifyPermissionFailure(message);
    }
  }

  return classifyWebPermission({
    hasGeolocation: typeof navigator !== 'undefined' && !!navigator.geolocation,
    permission: typeof navigator === 'undefined' ? null : await readWebPermission(),
  });
}

function positionErrorCode(err: unknown): number | null {
  const code = (err as { code?: unknown } | null)?.code;
  return typeof code === 'number' ? code : null;
}

async function requestLocation(): Promise<ClassifiedLocation> {
  if (Capacitor.isNativePlatform()) {
    try {
      const { Geolocation } = await import('@capacitor/geolocation');
      const current = await Geolocation.checkPermissions();
      const classified = classifyPluginStatus(current);
      if (classified.kind === 'on-while-using' || classified.kind === 'on-always' || classified.kind === 'off') {
        return classified;
      }
      const requested = await Geolocation.requestPermissions({ permissions: ['location'] });
      return classifyPluginStatus(requested);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err ?? '');
      return classifyPermissionFailure(message);
    }
  }

  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    return { kind: 'unavailable', precise: null };
  }

  try {
    await new Promise<void>((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(
        () => resolve(),
        (err) => reject(err),
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
      );
    });
    return { kind: 'on-while-using', precise: true };
  } catch (err) {
    if (positionErrorCode(err) === 1) return { kind: 'off', precise: false };
    const reread = await readLocation();
    if (reread.kind === 'on-while-using' || reread.kind === 'off' || reread.kind === 'unavailable') {
      return reread;
    }
    return { kind: 'error', precise: null };
  }
}

async function rememberPermission(staffId: string, kind: LocationStatusKind): Promise<void> {
  const stored =
    kind === 'on-always' || kind === 'on-while-using' ? 'granted' : kind === 'off' ? 'denied' : null;
  if (!stored) return;
  const { error } = await supabase
    .from('staff')
    .update({
      location_permission_status: stored,
      location_permission_updated_at: new Date().toISOString(),
    })
    .eq('id', staffId);
  if (error) console.warn('[location] could not save permission status', error);
}

function toastFor(kind: LocationStatusKind): void {
  if (kind === 'on-always' || kind === 'on-while-using') {
    toast.success('Location is on.');
    return;
  }
  if (kind === 'off') {
    toast('Location is still off. Follow the steps below.');
    return;
  }
  if (kind === 'unavailable') {
    toast('Location is not available in this browser.');
    return;
  }
  if (kind === 'error') {
    toast.error("Couldn't turn location on. Try again.");
  }
}

export function useLocationPermission(staffId?: string): LocationPermissionState {
  const [{ platform, native }] = useState(readPlatform);
  const [kind, setKind] = useState<LocationStatusKind | 'checking'>('checking');
  const [precise, setPrecise] = useState<boolean | null>(null);
  const [requesting, setRequesting] = useState(false);

  const apply = useCallback((next: ClassifiedLocation) => {
    setKind(next.kind);
    setPrecise(next.precise);
  }, []);

  const refresh = useCallback(async () => {
    apply(await readLocation());
  }, [apply]);

  useEffect(() => {
    let cancelled = false;
    void readLocation().then((next) => {
      if (!cancelled) apply(next);
    });
    return () => {
      cancelled = true;
    };
  }, [apply]);

  useEffect(() => {
    let remove: (() => void) | undefined;
    let cancelled = false;
    void import('@capacitor/app')
      .then(({ App }) => App.addListener('resume', () => {
        void refresh();
      }))
      .then((handle) => {
        if (cancelled) {
          void handle.remove();
          return;
        }
        remove = () => {
          void handle.remove();
        };
      })
      .catch(() => {
        // The app plugin is installed. A failed listener still leaves the
        // manual Check again button.
      });
    return () => {
      cancelled = true;
      remove?.();
    };
  }, [refresh]);

  useEffect(() => {
    if (native || typeof navigator === 'undefined' || !navigator.permissions?.query) return;
    let detach: (() => void) | undefined;
    let cancelled = false;
    void navigator.permissions.query({ name: 'geolocation' }).then((status) => {
      if (cancelled) return;
      const onChange = () => {
        void refresh();
      };
      status.addEventListener('change', onChange);
      detach = () => status.removeEventListener('change', onChange);
    }).catch(() => {
      // Permissions API missing or geolocation is not a queryable name.
    });
    return () => {
      cancelled = true;
      detach?.();
    };
  }, [native, refresh]);

  const request = useCallback(async (): Promise<LocationStatusKind> => {
    setRequesting(true);
    try {
      const next = await requestLocation();
      apply(next);
      toastFor(next.kind);
      if (staffId) await rememberPermission(staffId, next.kind);
      if (staffId && (next.kind === 'on-always' || next.kind === 'on-while-using')) {
        try {
          await recordOsPermissionGrant(staffId);
        } catch (err) {
          console.error('[location] could not record consent', err);
          toast.error('Location is on, but sharing could not be saved. Try again.');
        }
      }
      return next.kind;
    } finally {
      setRequesting(false);
    }
  }, [apply, staffId]);

  const openSettings = useCallback(() => {
    // Main-frame navigation to a non-app URL. Capacitor 8 cancels it and
    // calls UIApplication.shared.open, which opens this app's Settings page.
    // @capacitor/app has no settings method, and @capacitor/browser only
    // loads http(s). Android has no equivalent with the installed plugins.
    window.location.assign(IOS_APP_SETTINGS_URL);
  }, []);

  return { kind, precise, platform, native, requesting, request, refresh, openSettings };
}
