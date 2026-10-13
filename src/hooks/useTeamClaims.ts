import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

/** Names of cleaners who claimed a team booking (primary first). */
export function useTeamClaims(bookingId: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ['team-claims', bookingId],
    enabled: !!bookingId && enabled,
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('booking_team_assignments')
        .select('id, staff_id, is_primary, staff:staff(name)')
        .eq('booking_id', bookingId!)
        .order('is_primary', { ascending: false })
        .order('id');
      if (error) throw error;
      return (data ?? []).map((r) => ({
        staffId: r.staff_id as string,
        name: (r.staff as { name: string | null } | null)?.name || 'Cleaner',
      }));
    },
  });
}
