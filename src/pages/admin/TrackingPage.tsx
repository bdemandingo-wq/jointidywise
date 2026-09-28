import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { useOrganization } from '@/contexts/OrganizationContext';
import { Navigation, Clock, MapPin, Car, User, Loader2, ChevronDown, ChevronUp, ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Separator } from '@/components/ui/separator';
import { toast } from 'sonner';
import { calculateDistanceMiles, formatDistance } from '@/lib/distanceUtils';
import { useDistanceUnit, useOrgCountryCode } from '@/hooks/useDistanceUnit';
import { format } from 'date-fns';
import { useOrgTimezone } from '@/hooks/useOrgTimezone';
import { formatInTimezone, formatTimestampWithZone } from '@/lib/timezoneUtils';
import { orgStartOfDay } from '@/lib/orgDateRange';

interface ActiveTracking {
  id: string;
  latitude: number;
  longitude: number;
  is_active: boolean;
  recorded_at: string;
  created_at: string;
  booking_id: string;
  staff_id: string;
  organization_id: string;
  staff?: { name: string } | null;
  booking?: {
    booking_number: number;
    address: string | null;
    city: string | null;
    state: string | null;
    zip_code: string | null;
    customer?: { first_name: string; last_name: string } | null;
    service?: { name: string } | null;
  } | null;
}

interface HistoricalTracking {
  id: string;
  created_at: string;
  recorded_at: string;
  booking_id: string;
  staff?: { name: string } | null;
  booking?: { booking_number: number } | null;
}

interface SmsSettings {
  notify_admin_on_the_way: boolean;
  notify_client_on_the_way: boolean;
  notify_client_distance_eta: boolean;
  notify_admin_arrived: boolean;
  notify_client_arrived: boolean;
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
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OSM' }).addTo(map);
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
    return () => { if (mapInstanceRef.current) { mapInstanceRef.current.remove(); mapInstanceRef.current = null; } };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- map initialises once on mount; lat/lng/dest are handled by the next effect
  }, []);

  useEffect(() => {
    if (markerRef.current) markerRef.current.setLatLng([lat, lng]);
  }, [lat, lng]);

  return <div ref={mapRef} style={{ width: '100%', height: '180px', borderRadius: '8px' }} />;
}

function ActiveJobCard({ tracking }: { tracking: ActiveTracking }) {
  const distanceUnit = useDistanceUnit(tracking.organization_id);
  const orgCountry = useOrgCountryCode(tracking.organization_id);
  const [destCoords, setDestCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [eta, setEta] = useState<{ durationMinutes: number; distanceMiles: number } | null>(null);
  const [, setTick] = useState(0);
  // Supabase joins surface as either an object or a 1-element array depending
  // on the relation type — the original code did `array[0]` but Array.isArray
  // is true for empty arrays too (e.g. left-joins with no match), so [0] was
  // undefined while the ternary thought it had a value.
  const booking = Array.isArray(tracking.booking) ? (tracking.booking[0] ?? null) : (tracking.booking ?? null);
  const staff = Array.isArray(tracking.staff) ? (tracking.staff[0] ?? null) : (tracking.staff ?? null);
  const customer = booking?.customer ? (Array.isArray(booking.customer) ? (booking.customer[0] ?? null) : booking.customer) : null;
  const service = booking?.service ? (Array.isArray(booking.service) ? (booking.service[0] ?? null) : booking.service) : null;

  const addr = booking ? [booking.address, booking.city, booking.state, booking.zip_code].filter(Boolean).join(', ') : '';
  const startedAt = new Date(tracking.created_at);
  const ageSec = (Date.now() - new Date(tracking.recorded_at).getTime()) / 1000;
  const isStale = ageSec > 90;
  const timeAgo = Math.round(ageSec / 60);

  // Tick every 30s so staleness / "X min ago" stays current.
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 30000);
    return () => clearInterval(id);
  }, []);


  // Geocode + ETA
  useEffect(() => {
    // Bookings created through address autocomplete carry exact Places
    // coordinates. Only fall back to geocode-address for legacy rows and
    // hand-typed addresses — that path is still US-only.
    const stored = booking as { latitude?: number | null; longitude?: number | null } | null;
    if (stored?.latitude != null && stored?.longitude != null) {
      setDestCoords({ lat: stored.latitude, lng: stored.longitude });
      return;
    }
    if (!addr) return;
    supabase.functions.invoke('geocode-address', {
      body: { address: addr, ...(orgCountry ? { country: orgCountry } : {}) },
    })
      .then(res => {
        if (res.data?.lat && res.data?.lng) setDestCoords(res.data);
      }).catch(() => {});
  }, [addr, booking, orgCountry]);

  useEffect(() => {
    if (!destCoords) return;
    const fetchEta = async () => {
      try {
        const { data, error } = await supabase.functions.invoke('get-driving-eta', {
          body: { originLat: tracking.latitude, originLng: tracking.longitude, destLat: destCoords.lat, destLng: destCoords.lng },
        });
        if (!error && data && !data.fallback) {
          setEta(data);
        } else {
          const dist = calculateDistanceMiles(tracking.latitude, tracking.longitude, destCoords.lat, destCoords.lng) * 1.4;
          setEta({ durationMinutes: Math.round((dist / 25) * 60), distanceMiles: Math.round(dist * 10) / 10 });
        }
      } catch {
        const dist = calculateDistanceMiles(tracking.latitude, tracking.longitude, destCoords.lat, destCoords.lng) * 1.4;
        setEta({ durationMinutes: Math.round((dist / 25) * 60), distanceMiles: Math.round(dist * 10) / 10 });
      }
    };
    fetchEta();
    const interval = setInterval(fetchEta, 60000);
    return () => clearInterval(interval);
  }, [tracking.latitude, tracking.longitude, destCoords]);

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary font-semibold text-sm">
              {staff?.name?.charAt(0)?.toUpperCase() || '?'}
            </div>
            <div>
              <p className="font-medium text-sm">{staff?.name || 'Unknown'}</p>
              <p className="text-xs text-muted-foreground">
                #{booking?.booking_number} · {customer ? `${customer.first_name} ${customer.last_name}` : 'N/A'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {eta && !isStale && (
              <Badge variant="secondary" className="text-xs">
                ~{eta.durationMinutes} min
              </Badge>
            )}
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

        </div>

        {service && (
          <p className="text-xs text-muted-foreground">{service.name}</p>
        )}

        {booking?.address && (
          <div className="flex items-start gap-1.5 text-xs text-muted-foreground">
            <MapPin className="h-3 w-3 mt-0.5 flex-shrink-0" />
            <span>{booking.address}{booking.city ? `, ${booking.city}` : ''}{booking.state ? ` ${booking.state}` : ''}</span>
          </div>
        )}

        <MiniMap
          lat={tracking.latitude}
          lng={tracking.longitude}
          destLat={destCoords?.lat}
          destLng={destCoords?.lng}
        />

        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <div className="flex items-center gap-1">
            <Clock className="h-3 w-3" />
            {/* Live tracking: "on the way since" is read against the wall clock
                of whoever is watching the map right now, which is what makes an
                elapsed time legible. Not a business-day boundary. */}
            {/* eslint-disable-next-line local/no-device-local-dates -- viewer-local elapsed time, deliberate */}
            <span>On the way since {formatTimestampWithZone(startedAt, orgTz)}</span>
          </div>
          {eta && !isStale && (
            <span className="font-medium text-primary">
              {formatDistance(eta.distanceMiles, distanceUnit)} · ETA ~{eta.durationMinutes} min (driving)
            </span>
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

      </CardContent>
    </Card>
  );
}

export default function TrackingPage() {
  const navigate = useNavigate();
  const { organization } = useOrganization();
  const orgId = organization?.id;
  const { timezone: orgTz } = useOrgTimezone();
  const [activeJobs, setActiveJobs] = useState<ActiveTracking[]>([]);
  const [historicalJobs, setHistoricalJobs] = useState<HistoricalTracking[]>([]);
  const [loading, setLoading] = useState(true);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [smsSettings, setSmsSettings] = useState<SmsSettings>({ notify_admin_on_the_way: true, notify_client_on_the_way: true, notify_client_distance_eta: true, notify_admin_arrived: true, notify_client_arrived: true });
  const [savingToggle, setSavingToggle] = useState(false);

  const fetchActive = useCallback(async () => {
    if (!orgId) return;
    const { data } = await supabase
      .from('cleaner_location_tracking')
      .select(`
        id, latitude, longitude, is_active, recorded_at, created_at, booking_id, staff_id, organization_id,
        staff:staff_id(name),
        booking:booking_id(booking_number, address, city, state, zip_code, latitude, longitude,
          customer:customer_id(first_name, last_name),
          service:service_id(name)
        )
      `)
      .eq('organization_id', orgId)
      .eq('is_active', true);

    if (data) setActiveJobs(data as any);
    setLoading(false);
  }, [orgId]);

  const fetchHistory = useCallback(async () => {
    if (!orgId) return;
    // "Today's routes" is the business's day.
    const todayStart = orgStartOfDay(new Date(), orgTz);

    // Include *all* tracking records from today, not just is_active=false.
    // Some rows never flip to inactive (native app in background never calls
    // stopTracking), so filtering purely on is_active hides completed routes.
    // Rows that are still en-route are already shown in `activeJobs`; we
    // filter them out client-side by id.
    const { data } = await supabase
      .from('cleaner_location_tracking')
      .select(`
        id, created_at, recorded_at, booking_id, is_active,
        staff:staff_id(name),
        booking:booking_id(booking_number, status)
      `)
      .eq('organization_id', orgId)
      .gte('recorded_at', todayStart.toISOString())
      .order('recorded_at', { ascending: false })
      .limit(100);

    if (data) {
      const activeIds = new Set(activeJobs.map((j) => j.id));
      const completed = data.filter((row: any) => {
        if (activeIds.has(row.id)) return false;
        // Treat as completed if tracking marked inactive OR the booking itself is completed/cancelled.
        const bookingStatus = Array.isArray(row.booking) ? row.booking[0]?.status : row.booking?.status;
        return row.is_active === false || bookingStatus === 'completed' || bookingStatus === 'cancelled';
      });
      setHistoricalJobs(completed as any);
    }
  }, [orgId, activeJobs, orgTz]);

  const fetchSettings = useCallback(async () => {
    if (!orgId) return;
    const { data } = await supabase
      .from('organization_sms_settings')
      .select('notify_admin_on_the_way, notify_client_on_the_way, notify_client_distance_eta, notify_admin_arrived, notify_client_arrived')
      .eq('organization_id', orgId)
      .maybeSingle();
    if (data) {
      setSmsSettings({
        notify_admin_on_the_way: data.notify_admin_on_the_way ?? true,
        notify_client_on_the_way: data.notify_client_on_the_way ?? true,
        notify_client_distance_eta: (data as any).notify_client_distance_eta ?? true,
        notify_admin_arrived: (data as any).notify_admin_arrived ?? true,
        notify_client_arrived: (data as any).notify_client_arrived ?? true,
      });
    }
  }, [orgId]);

  useEffect(() => {
    fetchActive();
    fetchHistory();
    fetchSettings();
  }, [fetchActive, fetchHistory, fetchSettings]);

  // Poll every 30s
  useEffect(() => {
    if (!orgId) return;
    const interval = setInterval(fetchActive, 30000);
    return () => clearInterval(interval);
  }, [fetchActive, orgId]);

  // Realtime
  useEffect(() => {
    if (!orgId) return;
    const channel = supabase
      .channel(`tracking-page-${orgId}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'cleaner_location_tracking',
        filter: `organization_id=eq.${orgId}`,
      }, () => { fetchActive(); })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [orgId, fetchActive]);

  const handleToggle = async (field: keyof SmsSettings, value: boolean) => {
    setSavingToggle(true);
    const updated = { ...smsSettings, [field]: value };
    setSmsSettings(updated);

    const { error } = await supabase
      .from('organization_sms_settings')
      .update({ [field]: value } as any)
      .eq('organization_id', orgId!);

    if (error) {
      toast.error('Failed to save setting');
      setSmsSettings(prev => ({ ...prev, [field]: !value }));
    }
    setSavingToggle(false);
  };

  return (
    <div className="space-y-6 pt-[env(safe-area-inset-top)]">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => navigate(-1)}
          className="min-h-[44px] min-w-[44px] shrink-0"
        >
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div>
          <h1 className="text-2xl font-bold">Live Tracking</h1>
          <p className="text-muted-foreground text-sm">Cleaners currently en route</p>
        </div>
      </div>

      {/* Settings Bar */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-wrap gap-6">
            <div className="flex items-center gap-3">
              <Switch
                id="notify-admin"
                checked={smsSettings.notify_admin_on_the_way}
                onCheckedChange={(v) => handleToggle('notify_admin_on_the_way', v)}
                disabled={savingToggle}
              />
              <Label htmlFor="notify-admin" className="text-sm cursor-pointer">
                Notify Admin when cleaner goes On My Way
              </Label>
            </div>
            <div className="flex items-center gap-3">
              <Switch
                id="notify-client"
                checked={smsSettings.notify_client_on_the_way}
                onCheckedChange={(v) => handleToggle('notify_client_on_the_way', v)}
                disabled={savingToggle}
              />
              <Label htmlFor="notify-client" className="text-sm cursor-pointer">
                Notify Client when cleaner goes On My Way
              </Label>
            </div>
            <div className="flex items-center gap-3">
              <Switch
                id="notify-client-eta"
                checked={smsSettings.notify_client_distance_eta}
                onCheckedChange={(v) => handleToggle('notify_client_distance_eta', v)}
                disabled={savingToggle}
              />
              <Label htmlFor="notify-client-eta" className="text-sm cursor-pointer">
                Include distance &amp; ETA in client SMS
              </Label>
            </div>
            <div className="flex items-center gap-3">
              <Switch
                id="notify-client-arrived"
                checked={smsSettings.notify_client_arrived}
                onCheckedChange={(v) => handleToggle('notify_client_arrived', v)}
                disabled={savingToggle}
              />
              <Label htmlFor="notify-client-arrived" className="text-sm cursor-pointer">
                Notify client when cleaner has arrived
              </Label>
            </div>
            <div className="flex items-center gap-3">
              <Switch
                id="notify-admin-arrived"
                checked={smsSettings.notify_admin_arrived}
                onCheckedChange={(v) => handleToggle('notify_admin_arrived', v)}
                disabled={savingToggle}
              />
              <Label htmlFor="notify-admin-arrived" className="text-sm cursor-pointer">
                Notify admin when cleaner has arrived
              </Label>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Active Jobs Board */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : activeJobs.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center">
            <div className="w-16 h-16 mx-auto bg-muted rounded-full flex items-center justify-center mb-4">
              <Car className="h-8 w-8 text-muted-foreground" />
            </div>
            <h3 className="font-medium text-lg mb-1">No cleaners currently en route</h3>
            <p className="text-muted-foreground text-sm">
              Active tracking will appear here when a cleaner presses "On My Way"
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {activeJobs.map(job => (
            <ActiveJobCard key={job.id} tracking={job} />
          ))}
        </div>
      )}

      {/* Historical Log */}
      <Separator />
      <Collapsible open={historyOpen} onOpenChange={(open) => { setHistoryOpen(open); if (open) fetchHistory(); }}>
        <CollapsibleTrigger className="flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors w-full">
          {historyOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          Today's Completed Routes
        </CollapsibleTrigger>
        <CollapsibleContent className="mt-3">
          {historicalJobs.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4">No completed routes today.</p>
          ) : (
            <div className="space-y-2">
              {historicalJobs.map(job => {
                const staff = Array.isArray(job.staff) ? job.staff[0] : job.staff;
                const booking = Array.isArray(job.booking) ? job.booking[0] : job.booking;
                return (
                  <div key={job.id} className="flex items-center justify-between p-3 rounded-lg border bg-card text-sm">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center text-xs font-medium">
                        {(staff as any)?.name?.charAt(0)?.toUpperCase() || '?'}
                      </div>
                      <div>
                        <p className="font-medium">{(staff as any)?.name || 'Unknown'}</p>
                        <p className="text-xs text-muted-foreground">
                          Booking #{(booking as any)?.booking_number || '?'}
                        </p>
                      </div>
                    </div>
                    <div className="text-xs text-muted-foreground text-right">
                      <p>En route at {formatTimestampWithZone(job.created_at, orgTz)}</p>
                      <p>Last update {formatTimestampWithZone(job.recorded_at, orgTz)}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
