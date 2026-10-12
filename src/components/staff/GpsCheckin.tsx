import { useState } from 'react';
import { MapPin, Loader2, CheckCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { supabase } from '@/lib/supabase';
import { useOrgCountryCode } from '@/hooks/useDistanceUnit';
import { geoFailureCode, geoFailureLabel, getPositionWithFallback } from '@/lib/geo';
import { toast } from 'sonner';

interface GpsCheckinProps {
  bookingId: string;
  staffId: string;
  organizationId: string;
  bookingAddress: string | null;
  type: 'check_in' | 'check_out';
  onSuccess?: () => void;
  disabled?: boolean;
  disabledReason?: string;
}

const NEARBY_METERS = 500; // within 500m counts as "at property"

function toRad(deg: number) { return deg * (Math.PI / 180); }

function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function GpsCheckin({ bookingId, staffId, organizationId, bookingAddress, type, onSuccess, disabled, disabledReason }: GpsCheckinProps) {
  // Staff surfaces have no OrganizationContext, so pass the id explicitly.
  const orgCountry = useOrgCountryCode(organizationId);
  const [loading, setLoading] = useState(false);
  const [statusText, setStatusText] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const saveWithoutGps = async (code: ReturnType<typeof geoFailureCode>) => {
    const { error: fallbackErr } = await (supabase.from('booking_checkins' as any) as any).insert({
      booking_id: bookingId,
      staff_id: staffId,
      organization_id: organizationId,
      checkin_type: type,
      address_match: null,
      gps_error: code,
    });
    if (fallbackErr) {
      console.error('[GpsCheckin] failed to save no-GPS check-in:', fallbackErr);
      toast.error('Could not save check-in. Please try again or notify your admin.');
      return;
    }
    setDone(true);
    onSuccess?.();
    const verb = type === 'check_in' ? 'Checked in' : 'Checked out';
    toast.info(`${verb} without a location fix. ${geoFailureLabel(code)}`);
  };

  const handleCheckin = async () => {
    setLoading(true);
    setStatusText('Getting your location…');
    try {
      // Coarse fix first (works indoors), then GPS. Native iOS uses
      // @capacitor/geolocation rather than the WebView geolocation API.
      const pos = await getPositionWithFallback();
      setStatusText('Saving check-in…');

      const { latitude, longitude } = pos;
      let distanceMeters: number | null = null;
      let addressMatch: boolean | null = null;

      // Geocode the booking address to compare
      if (bookingAddress) {
        const { data: geocoded } = await supabase.functions.invoke('geocode-address', {
          body: { address: bookingAddress, ...(orgCountry ? { country: orgCountry } : {}) },
        });
        if (geocoded?.lat && geocoded?.lng) {
          distanceMeters = Math.round(haversineMeters(latitude, longitude, geocoded.lat, geocoded.lng));
          addressMatch = distanceMeters <= NEARBY_METERS;
        }
      }

      const { error: checkinErr } = await (supabase.from('booking_checkins' as any) as any).insert({
        booking_id: bookingId,
        staff_id: staffId,
        organization_id: organizationId,
        checkin_type: type,
        latitude,
        longitude,
        address_match: addressMatch,
        distance_meters: distanceMeters,
      });

      if (checkinErr) {
        // Don't show a false success — this used to insert-and-forget,
        // so a failed write looked identical to a working one.
        console.error('[GpsCheckin] failed to save check-in:', checkinErr);
        toast.error('Could not save check-in. Please try again or notify your admin.');
        return;
      }

      if (addressMatch === false && distanceMeters !== null) {
        toast.warning(`Checked in ${distanceMeters > 1000 ? `${(distanceMeters / 1000).toFixed(1)}km` : `${distanceMeters}m`} from the property address`, { duration: 5000 });
      } else {
        toast.success(type === 'check_in' ? 'Checked in at property' : 'Checked out from property');
      }

      setDone(true);
      onSuccess?.();
    } catch (e: unknown) {
      const code = geoFailureCode(e);
      if (code === 'denied') {
        toast.error(geoFailureLabel(code));
        return;
      }
      // Both the coarse and the GPS attempt failed. Record the check-in and
      // say why, instead of a bare "no GPS" after a silent 20s wait.
      await saveWithoutGps(code);
    } finally {
      setLoading(false);
      setStatusText(null);
    }
  };

  if (done) {
    return (
      <div className="flex items-center gap-1.5 text-xs text-emerald-600 font-medium">
        <CheckCircle className="w-3.5 h-3.5" />
        {type === 'check_in' ? 'Checked in' : 'Checked out'}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <Button
        size="sm"
        variant="outline"
        className="gap-1.5 text-xs"
        onClick={handleCheckin}
        disabled={loading || disabled}
        title={disabled ? disabledReason : undefined}
      >
        {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <MapPin className="w-3.5 h-3.5" />}
        {loading ? 'Getting location…' : type === 'check_in' ? 'GPS Check-In' : 'GPS Check-Out'}
      </Button>
      {loading && statusText && (
        <p className="text-[11px] text-muted-foreground">{statusText}</p>
      )}
      {disabled && disabledReason && (
        <p className="text-[11px] text-muted-foreground">{disabledReason}</p>
      )}
    </div>
  );
}
