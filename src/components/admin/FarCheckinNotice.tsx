import { useQuery } from '@tanstack/react-query';
import { MapPin } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { formatUsDistance, isFarFromProperty } from '@/lib/usDistance';

/**
 * Owner-facing warning when the latest GPS check-in was over about 0.25 miles
 * from the property. The check-in itself is still saved.
 */
export function FarCheckinNotice({ bookingId }: { bookingId: string }) {
  const { data, error } = useQuery({
    queryKey: ['booking-far-checkin', bookingId],
    queryFn: async () => {
      const { data: rows, error: queryError } = await supabase
        .from('booking_checkins')
        .select('id, distance_meters, created_at')
        .eq('booking_id', bookingId)
        .eq('checkin_type', 'check_in')
        .not('distance_meters', 'is', null)
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .limit(10);
      if (queryError) throw queryError;
      return (
        (rows ?? []).find(
          (row) => row.distance_meters != null && isFarFromProperty(row.distance_meters),
        ) ?? null
      );
    },
  });

  if (error) {
    return (
      <p className="text-xs text-destructive">Couldn't load the check-in location.</p>
    );
  }

  if (!data?.distance_meters) return null;

  return (
    <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-900 dark:text-amber-100">
      <MapPin className="mt-0.5 h-4 w-4 shrink-0" />
      <p>Check-in far from property ({formatUsDistance(data.distance_meters)})</p>
    </div>
  );
}
