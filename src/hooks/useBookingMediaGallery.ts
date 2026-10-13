import { useEffect, useMemo } from 'react';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { hasMoreMedia, mediaPageRange, mergeMedia } from '@/lib/bookingMediaGallery';
import { isMissingColumn } from '@/lib/photoProofStamp';

export interface BookingPhoto {
  id: string;
  booking_id: string;
  staff_id: string | null;
  photo_url: string;
  stamped_photo_url?: string | null;
  photo_type: string | null;
  caption: string | null;
  created_at: string | null;
  captured_at?: string | null;
  timestamp_source?: string | null;
  proof_stamped?: boolean | null;
  capture_latitude?: number | null;
  capture_longitude?: number | null;
  media_type?: string;
  inspection_note?: string | null;
  issue_category?: string | null;
  booking?: {
    booking_number: number;
    scheduled_at: string;
    address?: string | null;
    apt_suite?: string | null;
    city?: string | null;
    state?: string | null;
    zip_code?: string | null;
    customer?: { first_name: string; last_name: string } | null;
  } | null;
  staff?: { name: string } | null;
}

export function isVideoMedia(item: BookingPhoto): boolean {
  return item.media_type === 'video' || /\.(mp4|mov|m4v)(?:\?|$)/i.test(item.photo_url);
}

const select = `id, booking_id, staff_id, photo_url, stamped_photo_url, photo_type, caption, created_at,
  captured_at, timestamp_source, proof_stamped, capture_latitude, capture_longitude,
  media_type, inspection_note, issue_category,
  booking:bookings!booking_photos_booking_id_fkey(booking_number, scheduled_at, address, apt_suite, city, state, zip_code,
    customer:customers!bookings_customer_id_fkey(first_name,last_name)),
  staff:staff!booking_photos_staff_id_fkey(name)`;

const selectWithoutStamped = select.replace('stamped_photo_url, ', '');

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
      const [from, to] = mediaPageRange(pageParam.page);
      const load = (columns: string) => {
        const scoped = legacy
          ? columns.replace('booking_photos_booking_id_fkey(', 'booking_photos_booking_id_fkey!inner(')
          : columns;
        let request = supabase.from('booking_photos').select(scoped);
        request = legacy
          ? request.is('organization_id', null).eq('booking.organization_id', orgId)
          : request.eq('organization_id', orgId);
        return request.order('created_at', { ascending: false, nullsFirst: false })
          .order('id', { ascending: false }).range(from, to).abortSignal(signal);
      };
      let result = await load(select);
      if (result.error && isMissingColumn(result.error, 'stamped_photo_url')) {
        result = await load(selectWithoutStamped);
      }
      const { data, error } = result;
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