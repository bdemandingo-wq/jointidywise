import { useEffect, useState, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { Navigation, Clock, MapPin, Car, Info } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { calculateDistanceMiles, formatDistance } from '@/lib/distanceUtils';
import { useDistanceUnit, useOrgCountryCode } from '@/hooks/useDistanceUnit';
import { useOrgTimezone } from '@/hooks/useOrgTimezone';
import { formatInTimezone } from '@/lib/timezoneUtils';

interface TrackingInfo {
  latitude: number;
  longitude: number;
  is_active: boolean;
  recorded_at: string;
  created_at: string;
}

interface OnTheWayInfo {
  sent_at: string;
}

interface DrivingETA {
  durationMinutes: number;
  distanceMiles: number;
  source: string;
}

function MiniMap({ lat, lng, destLat, destLng }: { lat: number; lng: number; destLat?: number; destLng?: number }) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<any>(null);
  const markerRef = useRef<any>(null);

  useEffect(() => {
    const init = async () => {
      const L = await import('leaflet');
      await import('leaflet/dist/leaflet.css');

      if (!mapRef.current || mapInstanceRef.current) return;

      const map = L.map(mapRef.current).setView([lat, lng], 13);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OSM',
      }).addTo(map);

      const cleanerIcon = L.divIcon({
        html: '<div style="background:#3b82f6;width:12px;height:12px;border-radius:50%;border:2px solid white;box-shadow:0 1px 4px rgba(0,0,0,0.3)"></div>',
        iconSize: [12, 12], iconAnchor: [6, 6], className: '',
      });
      markerRef.current = L.marker([lat, lng], { icon: cleanerIcon }).addTo(map);

      if (destLat && destLng) {
        const destIcon = L.divIcon({
          html: '<div style="background:#ef4444;width:12px;height:12px;border-radius:50%;border:2px solid white;box-shadow:0 1px 4px rgba(0,0,0,0.3)"></div>',
          iconSize: [12, 12], iconAnchor: [6, 6], className: '',
        });
        L.marker([destLat, destLng], { icon: destIcon }).addTo(map);
        map.fitBounds(L.latLngBounds([[lat, lng], [destLat, destLng]]), { padding: [30, 30] });
      }

      mapInstanceRef.current = map;
    };
    init();
    return () => {
      if (mapInstanceRef.current) { mapInstanceRef.current.remove(); mapInstanceRef.current = null; }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- map initialises once on mount; lat/lng/dest are handled by the next effect
  }, []);

  useEffect(() => {
    if (markerRef.current) markerRef.current.setLatLng([lat, lng]);
  }, [lat, lng]);

  return <div ref={mapRef} style={{ width: '100%', height: '200px', borderRadius: '8px' }} />;
}

export function AdminLiveTracking({
  bookingId,
  address,
  bookingStatus,
  destLat,
  destLng,
}: {
  bookingId: string;
  address?: string;
  bookingStatus?: string;
  /** Places coordinates stored on the booking, when it has them. */
  destLat?: number | null;
  destLng?: number | null;
}) {
  const distanceUnit = useDistanceUnit();
  const orgCountry = useOrgCountryCode();
  const [tracking, setTracking] = useState<TrackingInfo | null>(null);
  const [onTheWay, setOnTheWay] = useState<OnTheWayInfo | null>(null);
  const [destCoords, setDestCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [drivingEta, setDrivingEta] = useState<DrivingETA | null>(null);
  const [, setTick] = useState(0);
  const { timezone: orgTimezone } = useOrgTimezone();

  // Tick every 30s so "X min ago" / stale state updates without new GPS.
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 30000);
    return () => clearInterval(id);
  }, []);


  const isCompleted = bookingStatus === 'completed';

  useEffect(() => {
    if (isCompleted) return;
    const fetchData = async () => {
      const { data: trackingData } = await supabase
        .from('cleaner_location_tracking')
        .select('latitude, longitude, is_active, recorded_at, created_at')
        .eq('booking_id', bookingId)
        .eq('is_active', true)
        .maybeSingle();

      if (trackingData) {
        setTracking(trackingData as any);
        return;
      }

      const { data: reminderData } = await supabase
        .from('booking_reminder_log')
        .select('sent_at')
        .eq('booking_id', bookingId)
        .eq('reminder_type', 'on_the_way')
        .order('sent_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (reminderData) {
        setOnTheWay(reminderData as OnTheWayInfo);
      }
    };
    fetchData();

    const channel = supabase
      .channel(`admin-tracking-${bookingId}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'cleaner_location_tracking',
        filter: `booking_id=eq.${bookingId}`,
      }, (payload) => {
        const d = payload.new as any;
        if (d.is_active) {
          setTracking(d);
        } else {
          setTracking(null);
        }
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- isCompleted is checked inside the effect; re-subscribing on status change is unnecessary
  }, [bookingId]);

  // Resolve destination coordinates
  useEffect(() => {
    if (destCoords || !tracking) return;
    // Prefer what the booking already stores — Places gave us these at
    // entry time and they work internationally. geocode-address is the
    // legacy fallback and is still hard-locked to the US.
    if (destLat != null && destLng != null) {
      setDestCoords({ lat: destLat, lng: destLng });
      return;
    }
    if (!address) return;
    supabase.functions.invoke('geocode-address', {
      body: { address, ...(orgCountry ? { country: orgCountry } : {}) },
    })
      .then(res => {
        if (res.data?.lat && res.data?.lng) setDestCoords(res.data);
      })
      .catch(() => {});
  }, [address, tracking, destCoords, destLat, destLng, orgCountry]);

  // Fetch real driving ETA from Google Maps
  useEffect(() => {
    if (!tracking || !destCoords) return;

    const fetchEta = async () => {
      try {
        const { data, error } = await supabase.functions.invoke('get-driving-eta', {
          body: {
            originLat: tracking.latitude,
            originLng: tracking.longitude,
            destLat: destCoords.lat,
            destLng: destCoords.lng,
          },
        });

        if (!error && data && !data.fallback) {
          setDrivingEta(data);
        } else {
          // Fallback: Haversine × 1.4 road factor
          const straightDist = calculateDistanceMiles(tracking.latitude, tracking.longitude, destCoords.lat, destCoords.lng);
          const roadDist = straightDist * 1.4;
          const avgSpeedMph = 25;
          setDrivingEta({
            durationMinutes: Math.round((roadDist / avgSpeedMph) * 60),
            distanceMiles: Math.round(roadDist * 10) / 10,
            source: 'estimate',
          });
        }
      } catch {
        // Fallback
        const straightDist = calculateDistanceMiles(tracking.latitude, tracking.longitude, destCoords.lat, destCoords.lng);
        const roadDist = straightDist * 1.4;
        setDrivingEta({
          durationMinutes: Math.round((roadDist / 25) * 60),
          distanceMiles: Math.round(roadDist * 10) / 10,
          source: 'estimate',
        });
      }
    };

    fetchEta();
    // Refresh ETA every 60s
    const interval = setInterval(fetchEta, 60000);
    return () => clearInterval(interval);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- tracking object ref changes on every GPS update; we only care about lat/lng values
  }, [tracking?.latitude, tracking?.longitude, destCoords]);

  // Don't render for completed bookings
  if (isCompleted) return null;

  // GPS-based live tracking with map
  if (tracking) {
    const ageSec = (Date.now() - new Date(tracking.recorded_at).getTime()) / 1000;
    const isStale = ageSec > 90;
    const timeAgo = Math.round(ageSec / 60);
    const startedAtLabel = formatInTimezone(tracking.created_at, orgTimezone, { hour: 'numeric', minute: '2-digit', hour12: true, timeZoneName: 'short' });

    return (
      <div className="rounded-lg border bg-card p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Navigation className="h-4 w-4 text-primary" />
            <span className="text-sm font-medium">Live Tracking</span>
          </div>
          {isStale ? (
            <Badge variant="outline" className="text-xs border-amber-500 text-amber-700 bg-amber-50 dark:bg-amber-950/30">
              Paused
            </Badge>
          ) : (
            <Badge variant="default" className="text-xs">
              <div className="w-2 h-2 bg-primary-foreground rounded-full animate-pulse mr-1" />
              En Route
            </Badge>
          )}
        </div>

        <MiniMap
          lat={tracking.latitude}
          lng={tracking.longitude}
          destLat={destCoords?.lat}
          destLng={destCoords?.lng}
        />

        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <div className="flex items-center gap-1">
            <Clock className="h-3 w-3" />
            <span>On the way since {startedAtLabel}</span>
          </div>
          {drivingEta && !isStale && (
            <div className="flex items-center gap-1">
              <MapPin className="h-3 w-3" />
              <span className="font-medium text-primary">
                {formatDistance(drivingEta.distanceMiles, distanceUnit)} · ETA ~{drivingEta.durationMinutes} min (driving)
              </span>
            </div>
          )}
        </div>

        {isStale ? (
          <p className="text-xs text-amber-700 dark:text-amber-400">
            Last seen {timeAgo < 1 ? 'less than a min' : `${timeAgo} min`} ago. Cleaner's app may be in the background.
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">
            Updated {timeAgo < 1 ? 'just now' : `${timeAgo} min ago`}
          </p>
        )}
      </div>
    );
  }


  // Fallback: "on the way" status from SMS log (no GPS)
  if (onTheWay) {
    const sentTime = new Date(onTheWay.sent_at);
    const minutesAgo = Math.round((Date.now() - sentTime.getTime()) / 60000);
    const sentTimeLabel = formatInTimezone(onTheWay.sent_at, orgTimezone, { hour: 'numeric', minute: '2-digit', hour12: true, timeZoneName: 'short' });

    if (minutesAgo > 120) return null;

    return (
      <div className="rounded-lg border bg-card p-4 space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Car className="h-4 w-4 text-primary" />
            <span className="text-sm font-medium">Cleaner En Route</span>
          </div>
          <div className="flex items-center gap-1">
            <Badge variant="default" className="text-xs">
              <div className="w-2 h-2 bg-primary-foreground rounded-full animate-pulse mr-1" />
              On The Way
            </Badge>
            <Tooltip>
              <TooltipTrigger asChild>
                <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-[220px] text-xs">
                The cleaner needs to allow location access in their browser or app for live tracking to work.
              </TooltipContent>
            </Tooltip>
          </div>
        </div>

        <div className="text-xs text-muted-foreground space-y-1">
          <div className="flex items-center gap-1">
            <Clock className="h-3 w-3" />
            <span>
              On My Way sent at {sentTimeLabel}
              {minutesAgo > 0 && ` (${minutesAgo} min ago)`}
            </span>
          </div>
          <p className="text-muted-foreground/70 italic">
            GPS unavailable — cleaner hasn't granted location permission
          </p>
        </div>
      </div>
    );
  }

  return null;
}
