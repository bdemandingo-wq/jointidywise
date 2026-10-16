import { useEffect, useState } from 'react';
import { MapPin, AlertTriangle, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';
import { recordOsPermissionGrant } from '@/lib/recordLocationConsent';

interface Props {
  staffId: string;
  onResolved: () => void; // called when granted OR explicitly continuing past warning
}

type Status = 'checking' | 'prompt' | 'denied' | 'granted';

async function checkBrowserPermission(): Promise<PermissionState | null> {
  try {
    if (!('permissions' in navigator)) return null;
    const p = await (navigator as any).permissions.query({ name: 'geolocation' as PermissionName });
    return p.state as PermissionState;
  } catch {
    return null;
  }
}

async function requestLocation(): Promise<'granted' | 'denied'> {
  // Try Capacitor first if present
  try {
    const { Geolocation } = await import('@capacitor/geolocation');
    const cur = await Geolocation.checkPermissions();
    if (cur.location !== 'granted') {
      const requested = await Geolocation.requestPermissions();
      if (requested.location === 'granted') return 'granted';
    } else {
      return 'granted';
    }
  } catch {
    // not on native — fall through to browser API
  }

  return await new Promise((resolve) => {
    if (!navigator.geolocation) return resolve('denied');
    navigator.geolocation.getCurrentPosition(
      () => resolve('granted'),
      () => resolve('denied'),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    );
  });
}

async function recordPermission(staffId: string, status: 'granted' | 'denied') {
  try {
    await supabase
      .from('staff')
      .update({
        location_permission_status: status,
        location_permission_updated_at: new Date().toISOString(),
      } as any)
      .eq('id', staffId);
  } catch (err) {
    console.warn('[location-prompt] Failed to record status:', err);
  }
  if (status !== 'granted') return;
  try {
    await recordOsPermissionGrant(staffId);
  } catch (err) {
    console.error('[location-prompt] could not record consent', err);
    toast.error('Location is on, but sharing could not be saved. Try again.');
  }
}

const DISMISS_KEY = 'staff_location_prompt_dismissed';

export function StaffLocationPrompt({ staffId, onResolved }: Props) {
  const [status, setStatus] = useState<Status>('checking');
  const [requesting, setRequesting] = useState(false);

  useEffect(() => {
    (async () => {
      // Respect a per-session dismissal so the fullscreen blocker can't trap users.
      try {
        if (sessionStorage.getItem(DISMISS_KEY) === '1') {
          setStatus('granted');
          onResolved();
          return;
        }
      } catch { /* ignore */ }

      const browserState = await checkBrowserPermission();
      if (browserState === 'granted') {
        await recordPermission(staffId, 'granted');
        setStatus('granted');
        onResolved();
        return;
      }
      setStatus(browserState === 'denied' ? 'denied' : 'prompt');
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [staffId]);

  const handleEnable = async () => {
    setRequesting(true);
    const result = await requestLocation();
    await recordPermission(staffId, result);
    setRequesting(false);
    if (result === 'granted') {
      toast.success('Location enabled. Tracking is ready.');
      setStatus('granted');
      onResolved();
    } else {
      setStatus('denied');
    }
  };

  const handleSkip = () => {
    try { sessionStorage.setItem(DISMISS_KEY, '1'); } catch { /* ignore */ }
    setStatus('granted');
    onResolved();
  };

  if (status === 'checking' || status === 'granted') return null;

  return (
    <div className="fixed inset-0 z-[200] bg-background flex items-center justify-center p-6 overflow-y-auto">
      <div className="max-w-md w-full text-center space-y-6 my-auto">
        <div className="mx-auto w-20 h-20 rounded-full bg-primary/10 flex items-center justify-center">
          <MapPin className="h-10 w-10 text-primary" />
        </div>

        {status === 'denied' ? (
          <>
            <h1 className="text-2xl font-bold">Location access is recommended</h1>
            <div className="rounded-lg border border-destructive/50 bg-destructive/5 p-4 text-left text-sm space-y-2">
              <div className="flex items-start gap-2 text-destructive font-medium">
                <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                <span>Tracking features won't work without location access.</span>
              </div>
              <p className="text-muted-foreground">
                You won't be able to send "On My Way" notifications, GPS check-ins,
                or arrival alerts to clients. Enable location in your device or
                browser settings and try again — or continue without it for now.
              </p>
            </div>
            <div className="flex flex-col gap-2">
              <Button onClick={handleEnable} disabled={requesting} className="w-full" size="lg">
                {requesting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <MapPin className="h-4 w-4 mr-2" />}
                Try Again
              </Button>
              <Button onClick={handleSkip} variant="ghost" className="w-full" size="lg">
                Continue without location
              </Button>
              <p className="text-xs text-muted-foreground">
                You'll be asked again next time you sign in.
              </p>
            </div>
          </>
        ) : (
          <>
            <h1 className="text-2xl font-bold">Enable location services</h1>
            <p className="text-muted-foreground">
              We use your location to send "On My Way" alerts, automatically check
              you in when you arrive at a job, and share live ETA with clients.
              Your location is only tracked while you're en route to a job.
            </p>
            <div className="flex flex-col gap-2">
              <Button onClick={handleEnable} disabled={requesting} className="w-full" size="lg">
                {requesting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <MapPin className="h-4 w-4 mr-2" />}
                Enable Location Access
              </Button>
              <Button onClick={handleSkip} variant="ghost" className="w-full" size="lg">
                Not now
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
