import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Car } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { SEOHead } from '@/components/SEOHead';
import { supabase } from '@/lib/supabase';

interface SharedPoint {
  latitude: number;
  longitude: number;
  recorded_at: string;
}

type LoadState =
  | { status: 'loading' }
  | { status: 'live'; point: SharedPoint }
  | { status: 'ended' }
  | { status: 'error'; message: string };

async function loadSharedPoint(token: string): Promise<LoadState> {
  const { data, error } = await (supabase as unknown as {
    rpc: (
      name: string,
      args: { p_token: string },
    ) => Promise<{ data: SharedPoint[] | null; error: { message: string } | null }>;
  }).rpc('customer_on_my_way_location', { p_token: token });
  if (error) return { status: 'error', message: error.message };
  const point = data?.[0];
  if (!point || point.latitude == null || point.longitude == null) return { status: 'ended' };
  return { status: 'live', point };
}

export default function TrackCleanerPage() {
  const { token = '' } = useParams();
  const [state, setState] = useState<LoadState>({ status: 'loading' });

  useEffect(() => {
    if (!token) {
      setState({ status: 'ended' });
      return;
    }
    let cancelled = false;
    const pull = () => {
      void loadSharedPoint(token).then((next) => {
        if (!cancelled) setState(next);
      });
    };
    pull();
    const timer = window.setInterval(pull, 15000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [token]);

  const mapHref = state.status === 'live'
    ? `https://www.openstreetmap.org/?mlat=${state.point.latitude}&mlon=${state.point.longitude}#map=16/${state.point.latitude}/${state.point.longitude}`
    : null;

  return (
    <>
      <SEOHead
        title="Your Cleaner Is On The Way | TidyWise"
        description="Live location shared during On My Way, until arrival or until the job is marked started."
        noIndex
      />
      <div className="portal-v2 portal-v2-scroll min-h-screen flex items-center justify-center bg-background p-4">
        <h1 className="sr-only">Tracking your cleaner's arrival</h1>
        <Card className="max-w-md w-full">
          <CardContent className="pt-6 text-center space-y-4">
            <div className="relative w-16 h-16 mx-auto">
              <div className="absolute inset-0 bg-primary/10 rounded-full animate-ping" />
              <div className="relative w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center">
                <Car className="h-8 w-8 text-primary animate-pulse" />
              </div>
            </div>
            {state.status === 'loading' && (
              <p className="text-muted-foreground text-sm">Loading the shared location…</p>
            )}
            {state.status === 'error' && (
              <p className="text-sm text-destructive">Couldn't load the shared location. {state.message}</p>
            )}
            {state.status === 'ended' && (
              <>
                <h2 className="text-lg font-semibold">Location sharing has ended</h2>
                <p className="text-muted-foreground text-sm">
                  Location is shared only during On My Way, until arrival or until the job is marked started.
                </p>
              </>
            )}
            {state.status === 'live' && (
              <>
                <h2 className="text-lg font-semibold">Your cleaner is on the way</h2>
                <p className="text-muted-foreground text-sm">
                  This location is shared with you and the business owner until arrival or until the job is marked started.
                </p>
                <p className="text-sm">
                  {state.point.latitude.toFixed(5)}, {state.point.longitude.toFixed(5)}
                </p>
                {mapHref && (
                  <a className="text-sm text-primary underline" href={mapHref} target="_blank" rel="noreferrer">
                    Open the live point on a map
                  </a>
                )}
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
