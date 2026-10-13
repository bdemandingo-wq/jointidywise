import { useEffect, useMemo } from 'react';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { hasMoreMedia, mediaPageRange, mergeMedia } from '@/lib/bookingMediaGallery';

export interface BookingPhoto {
  id: string;
  booking_id: string;
  staff_id: string | null;
  photo_url: string;
  photo_type: string | null;
  caption: string | null;
  created_at: string | null;
  captured_at?: string | null;
  timestamp_source?: string | null;
  proof_stamped?: boolean | null;
  media_type?: string;
  inspection_note?: string | null;
  issue_category?: string | null;
  booking?: { booking_number: number; scheduled_at: string; customer?: { first_name: string; last_name: string } | null } | null;
  staff?: { name: string } | null;
}

export function isVideoMedia(item: BookingPhoto): boolean {
  return item.media_type === 'video' || /\.(mp4|mov|m4v)(?:\?|$)/i.test(item.photo_url);
}

const select = `id, booking_id, staff_id, photo_url, photo_type, caption, created_at,
  captured_at, timestamp_source, proof_stamped, media_type, inspection_note, issue_category,
  booking:bookings!booking_photos_booking_id_fkey(booking_number, scheduled_at,
    customer:customers!bookings_customer_id_fkey(first_name,last_name)),
  staff:staff!booking_photos_staff_id_fkey(name)`;

export function useBookingMediaGallery(orgId: string | undefined) {
  const client = useQueryClient();
  const query = useInfiniteQuery({
    queryKey: ['booking-photos', orgId, 'paged-v1'],
    enabled: !!orgId,
    initialPageParam: { source: 'direct' as 'direct' | 'legacy', page: 0 },
    queryFn: async ({ pageParam, signal }) => {
      if (!orgId) throw new Error('Select a business to load photos');
      const legacy = pageParam.source === 'legacy';
      // Legacy rows without an organization are authorized through their booking.
      // The inner join keeps every page tenant-scoped, without a truncated ID list.
      let request = supabase.from('booking_photos').select(legacy ? select.replace('booking_photos_booking_id_fkey(', 'booking_photos_booking_id_fkey!inner(') : select);
      request = legacy
        ? request.is('organization_id', null).eq('booking.organization_id', orgId)
        : request.eq('organization_id', orgId);
      const [from, to] = mediaPageRange(pageParam.page);
      const { data, error } = await request.order('created_at', { ascending: false, nullsFirst: false })
        .order('id', { ascending: false }).range(from, to).abortSignal(signal);
      if (error) throw error;
      return { rows: (data ?? []) as unknown as BookingPhoto[], source: pageParam.source, page: pageParam.page };
    },
    getNextPageParam: (last) => hasMoreMedia(last.rows.length)
      ? { source: last.source, page: last.page + 1 }
      : last.source === 'direct' ? { source: 'legacy' as const, page: 0 } : undefined,
    staleTime: 5 * 60 * 1000,
    gcTime: 24 * 60 * 60 * 1000,
    retry: 1,
    refetchOnWindowFocus: false,
  });
  const { hasNextPage, isFetching, isFetchNextPageError, fetchNextPage } = query;
  // Complete the metadata index for exact existing full-library search/stats.
  // Image bytes are still requested only by mounted virtual tiles and the viewer.
  useEffect(() => {
    if (hasNextPage && !isFetching && !isFetchNextPageError) void fetchNextPage();
  }, [hasNextPage, isFetching, isFetchNextPageError, fetchNextPage]);
  useEffect(() => {
    if (!orgId) return;
    const channel = supabase.channel(`booking-media-gallery-${orgId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'booking_photos', filter: `organization_id=eq.${orgId}` },
        () => void client.invalidateQueries({ queryKey: ['booking-photos', orgId] })).subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [orgId, client]);
  const photos = useMemo(() => mergeMedia(query.data?.pages.map(page => page.rows) ?? []), [query.data]);
  return { ...query, photos, complete: !query.hasNextPage && !query.isPending };
}