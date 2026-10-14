import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { useOrganization } from '@/contexts/OrganizationContext';
import { Clock, MapPin, Loader2, ChevronDown, ChevronUp, ArrowLeft } from 'lucide-react';
import { TrackingFleetMap } from '@/components/admin/TrackingFleetMap';
import {
  finitePoint,
  type CompletedRoute,
  type EnRouteCleaner,
  type MapPoint,
  type TodayJobPin,
} from '@/components/admin/trackingFleetModel';
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
import { useOrgTimezone } from '@/hooks/useOrgTimezone';
import { formatTimestampWithZone } from '@/lib/timezoneUtils';
import { orgEndOfDay, orgStartOfDay } from '@/lib/orgDateRange';

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
    latitude?: number | null;
    longitude?: number | null;
    customer?: { first_name: string; last_name: string } | null;
    service?: { name: string } | null;
  } | null;
}

interface HistoricalTracking {
  id: string;
  created_at: string;
  recorded_at: string;
  booking_id: string;
  latitude: number | null;
  longitude: number | null;
  staff?: { name: string } | null;
  booking?: {
    booking_number: number;
    status?: string;
    address: string | null;
    city: string | null;
    state: string | null;
    latitude: number | null;
    longitude: number | null;
  } | null;
}

interface TodayBooking {
  id: string;
  booking_number: number;
  address: string | null;
  city: string | null;
  state: string | null;
  zip_code: string | null;
  latitude: number | null;
  longitude: number | null;
  status: string | null;
  is_draft: boolean | null;
  customer?: { first_name: string; last_name: string } | { first_name: string; last_name: string }[] | null;
}

interface RouteMeta {
  dest: MapPoint | null;
  destLabel: string;
  etaMinutes: number | null;
}

function one<T>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? (value[0] ?? null) : (value ?? null);
}

interface SmsSettings {
  notify_admin_on_the_way: boolean;
  notify_client_on_the_way: boolean;
  notify_client_distance_eta: boolean;
  notify_admin_arrived: boolean;
  notify_client_arrived: boolean;
}

function ActiveJobCard({
  tracking,
  selected,
  onSelect,
  onRoute,
}: {
  tracking: ActiveTracking;
  selected: boolean;
  onSelect: (id: string) => void;
  onRoute: (id: string, meta: RouteMeta) => void;
}) {
  const distanceUnit = useDistanceUnit(tracking.organization_id);
  const orgCountry = useOrgCountryCode(tracking.organization_id);
  const { timezone: orgTz } = useOrgTimezone(tracking.organization_id);
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
    if (booking?.latitude != null && booking?.longitude != null) {
      setDestCoords({ lat: booking.latitude, lng: booking.longitude });
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

  const onRouteRef = useRef(onRoute);
  onRouteRef.current = onRoute;
  useEffect(() => {
    onRouteRef.current(tracking.id, {
      dest: destCoords,
      destLabel: addr,
      etaMinutes: !isStale && eta ? eta.durationMinutes : null,
    });
  }, [tracking.id, destCoords, addr, eta, isStale]);

  return (
    <Card
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      onClick={() => onSelect(tracking.id)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onSelect(tracking.id);
        }
      }}
      className={`cursor-pointer transition-shadow ${selected ? 'ring-2 ring-primary' : 'hover:shadow-md'}`}
    >
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

        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <div className="flex items-center gap-1">
            <Clock className="h-3 w-3" />
            {/* Live tracking: "on the way since" is read against the wall clock
                of whoever is watching the map right now, which is what makes an
                elapsed time legible. Not a business-day boundary. */}
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
  const [todayBookings, setTodayBookings] = useState<TodayBooking[]>([]);
  const [office, setOffice] = useState<MapPoint | null>(null);
  const [routes, setRoutes] = useState<Record<string, RouteMeta>>({});
  const [focusId, setFocusId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeError, setActiveError] = useState<string | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [smsSettings, setSmsSettings] = useState<SmsSettings>({ notify_admin_on_the_way: true, notify_client_on_the_way: true, notify_client_distance_eta: true, notify_admin_arrived: true, notify_client_arrived: true });
  const [savingToggle, setSavingToggle] = useState(false);

  const fetchActive = useCallback(async () => {
    if (!orgId) return;
    const { data, error } = await supabase
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

    if (error) {
      setActiveError('Could not load live tracking.');
      setLoading(false);
      return;
    }
    setActiveError(null);
    setActiveJobs((data ?? []) as ActiveTracking[]);
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
    const { data, error } = await supabase
      .from('cleaner_location_tracking')
      .select(`
        id, created_at, recorded_at, booking_id, is_active, latitude, longitude,
        staff:staff_id(name),
        booking:booking_id(booking_number, status, address, city, state, latitude, longitude)
      `)
      .eq('organization_id', orgId)
      .gte('recorded_at', todayStart.toISOString())
      .order('recorded_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(100);

    if (error) {
      setHistoryError('Could not load completed routes.');
      return;
    }
    setHistoryError(null);
    if (data) {
      const activeIds = new Set(activeJobs.map((j) => j.id));
      const completed: HistoricalTracking[] = data.flatMap((row) => {
        if (activeIds.has(row.id)) return [];
        const staff = one(row.staff);
        const booking = one(row.booking);
        const bookingStatus = booking?.status;
        // Treat as completed if tracking marked inactive OR the booking itself is completed/cancelled.
        if (!(row.is_active === false || bookingStatus === 'completed' || bookingStatus === 'cancelled')) return [];
        return [{
          id: row.id,
          created_at: row.created_at,
          recorded_at: row.recorded_at,
          booking_id: row.booking_id,
          latitude: row.latitude,
          longitude: row.longitude,
          staff: staff ? { name: staff.name } : null,
          booking: booking ? {
            booking_number: booking.booking_number,
            status: booking.status ?? undefined,
            address: booking.address,
            city: booking.city,
            state: booking.state,
            latitude: booking.latitude,
            longitude: booking.longitude,
          } : null,
        }];
      });
      setHistoricalJobs(completed);
    }
  }, [orgId, activeJobs, orgTz]);

  const fetchToday = useCallback(async () => {
    if (!orgId) return;
    const todayStart = orgStartOfDay(new Date(), orgTz);
    const todayEnd = orgEndOfDay(new Date(), orgTz);
    const { data, error } = await supabase
      .from('bookings')
      .select('id, booking_number, address, city, state, zip_code, latitude, longitude, status, is_draft, customer:customer_id(first_name, last_name)')
      .eq('organization_id', orgId)
      .gte('scheduled_at', todayStart.toISOString())
      .lte('scheduled_at', todayEnd.toISOString())
      .order('scheduled_at', { ascending: true })
      .order('id', { ascending: true });
    if (error) {
      toast.error("Could not load today's job locations");
      return;
    }
    setTodayBookings((data ?? []) as TodayBooking[]);
  }, [orgId, orgTz]);

  const fetchOffice = useCallback(async () => {
    if (!orgId) return;
    const { data, error } = await supabase
      .from('business_settings')
      .select('company_address, company_city, company_state, company_zip')
      .eq('organization_id', orgId)
      .maybeSingle();
    if (error) {
      toast.error('Could not load the business address');
      return;
    }
    const address = [data?.company_address, data?.company_city, data?.company_state, data?.company_zip]
      .filter(Boolean)
      .join(', ');
    if (!address) {
      setOffice(null);
      return;
    }
    const { data: geo } = await supabase.functions.invoke('geocode-address', { body: { address } });
    const point = finitePoint(geo?.lat, geo?.lng);
    setOffice(point);
  }, [orgId]);

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
        notify_client_distance_eta: data.notify_client_distance_eta ?? true,
        notify_admin_arrived: data.notify_admin_arrived ?? true,
        notify_client_arrived: data.notify_client_arrived ?? true,
      });
    }
  }, [orgId]);

  useEffect(() => {
    fetchActive();
    fetchToday();
    fetchOffice();
    fetchSettings();
  }, [fetchActive, fetchToday, fetchOffice, fetchSettings]);

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if (focusId && !activeJobs.some((job) => job.id === focusId)) {
      setFocusId(null);
    }
  }, [activeJobs, focusId]);

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

  const handleRoute = useCallback((id: string, meta: RouteMeta) => {
    setRoutes((prev) => {
      const current = prev[id];
      if (
        current
        && current.dest?.lat === meta.dest?.lat
        && current.dest?.lng === meta.dest?.lng
        && current.destLabel === meta.destLabel
        && current.etaMinutes === meta.etaMinutes
      ) return prev;
      return { ...prev, [id]: meta };
    });
  }, []);

  const handleSelect = useCallback((id: string) => {
    setFocusId((current) => (current === id ? null : id));
  }, []);

  const cleaners: EnRouteCleaner[] = useMemo(() => activeJobs.flatMap((job) => {
    const here = finitePoint(job.latitude, job.longitude);
    if (!here) return [];
    const staff = one(job.staff);
    const meta = routes[job.id];
    const ageSec = (now - new Date(job.recorded_at).getTime()) / 1000;
    return [{
      id: job.id,
      name: staff?.name || 'Cleaner',
      lat: here.lat,
      lng: here.lng,
      dest: meta?.dest ?? null,
      destLabel: meta?.destLabel ?? '',
      etaMinutes: meta?.etaMinutes ?? null,
      stale: ageSec > 90,
    }];
  }), [activeJobs, routes, now]);

  const todayPins: TodayJobPin[] = useMemo(() => todayBookings.flatMap((booking) => {
    if (booking.is_draft || booking.status === 'cancelled') return [];
    const point = finitePoint(booking.latitude, booking.longitude);
    if (!point) return [];
    const customer = one(booking.customer);
    const who = customer ? `${customer.first_name} ${customer.last_name}` : '';
    const where = [booking.address, booking.city].filter(Boolean).join(', ');
    return [{
      id: booking.id,
      lat: point.lat,
      lng: point.lng,
      label: [`#${booking.booking_number}`, who, where].filter(Boolean).join(' · '),
    }];
  }), [todayBookings]);

  const completedRoutes: CompletedRoute[] = useMemo(() => historicalJobs.flatMap((job) => {
    const staff = one(job.staff);
    const booking = one(job.booking);
    const last = finitePoint(job.latitude, job.longitude);
    const dest = finitePoint(booking?.latitude, booking?.longitude);
    if (!last && !dest) return [];
    const where = [booking?.address, booking?.city, booking?.state].filter(Boolean).join(', ');
    return [{
      id: job.id,
      name: staff?.name || 'Cleaner',
      label: [`#${booking?.booking_number ?? '?'}`, where].filter(Boolean).join(' · '),
      last,
      dest,
    }];
  }), [historicalJobs]);

  const handleToggle = async (field: keyof SmsSettings, value: boolean) => {
    setSavingToggle(true);
    const updated = { ...smsSettings, [field]: value };
    setSmsSettings(updated);

    const { error } = await supabase
      .from('organization_sms_settings')
      .upsert(
        { organization_id: orgId!, ...updated },
        { onConflict: 'organization_id' },
      );

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

      <TrackingFleetMap
        ready={!loading && !activeError}
        cleaners={cleaners}
        todayPins={todayPins}
        completedRoutes={completedRoutes}
        showCompleted={historyOpen}
        office={office}
        focusId={focusId}
        onClearFocus={() => setFocusId(null)}
      />

      {activeError && (
        <p className="text-sm text-destructive">{activeError}</p>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-6">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : activeJobs.length > 0 ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {activeJobs.map(job => (
            <ActiveJobCard
              key={job.id}
              tracking={job}
              selected={focusId === job.id}
              onSelect={handleSelect}
              onRoute={handleRoute}
            />
          ))}
        </div>
      ) : null}

      {/* Historical Log */}
      <Separator />
      <Collapsible open={historyOpen} onOpenChange={(open) => { setHistoryOpen(open); if (open) fetchHistory(); }}>
        <CollapsibleTrigger className="flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors w-full">
          {historyOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          Today's Completed Routes
        </CollapsibleTrigger>
        <CollapsibleContent className="mt-3">
          <p className="text-xs text-muted-foreground pb-2">
            Dashed lines connect each cleaner&apos;s last recorded position to the job. The tracker stores the current point, not a GPS trail.
          </p>
          {historyError ? (
            <p className="text-sm text-destructive py-4">{historyError}</p>
          ) : historicalJobs.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4">No completed routes today.</p>
          ) : (
            <div className="space-y-2">
              {historicalJobs.map(job => {
                const staff = one(job.staff);
                const booking = one(job.booking);
                return (
                  <div key={job.id} className="flex items-center justify-between p-3 rounded-lg border bg-card text-sm">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center text-xs font-medium">
                        {staff?.name?.charAt(0)?.toUpperCase() || '?'}
                      </div>
                      <div>
                        <p className="font-medium">{staff?.name || 'Unknown'}</p>
                        <p className="text-xs text-muted-foreground">
                          Booking #{booking?.booking_number || '?'}
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
