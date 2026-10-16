import { useState } from 'react';
import { CheckCircle, Loader2, MapPin } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { supabase } from '@/lib/supabase';
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

export function GpsCheckin({ bookingId, staffId, organizationId, type, onSuccess, disabled, disabledReason }: GpsCheckinProps) {
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  const handleCheckin = async () => {
    setLoading(true);
    try {
      // Clock-in records the time only. Device coordinates are collected
      // during On My Way and not on this button.
      const { error: checkinErr } = await (supabase.from('booking_checkins' as any) as any).insert({
        booking_id: bookingId,
        staff_id: staffId,
        organization_id: organizationId,
        checkin_type: type,
        latitude: null,
        longitude: null,
        address_match: null,
        distance_meters: null,
      });
      if (checkinErr) {
        console.error('[GpsCheckin] failed to save check-in:', checkinErr);
        toast.error('Could not save check-in. Please try again or notify your admin.');
        return;
      }
      toast.success(type === 'check_in' ? 'Checked in' : 'Checked out');
      setDone(true);
      onSuccess?.();
    } finally {
      setLoading(false);
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
        {loading ? 'Saving…' : type === 'check_in' ? 'Check in' : 'Check out'}
      </Button>
      {disabled && disabledReason && (
        <p className="text-[11px] text-muted-foreground">{disabledReason}</p>
      )}
    </div>
  );
}
