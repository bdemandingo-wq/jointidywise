import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { Camera, Upload, Loader2, ImageIcon, Play, ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { SignedImage } from '@/components/ui/signed-image';
import { supabase } from '@/lib/supabase';
import { withStaffCustomers, withStaffCustomer, fetchStaffCustomers } from '@/lib/staffCustomers';
import { SELECTION_LIMIT_MESSAGE, takeSelection, VIDEO_MAX_BYTES } from '@/lib/bookingMediaErrors';
import { getUploadErrorMessage, isVideoFile } from '@/lib/bookingMediaUpload';
import { dismissQueuedPhoto, photoVisibleToOrg } from '@/lib/photoUploadQueue';
import { usePhotoUploadQueue } from '@/hooks/usePhotoUploadQueue';
import { PhotoUploadQueueList } from '@/components/staff/PhotoUploadQueueList';
import { inBeforeAfterOrder, stepGalleryIndex } from '@/lib/photoGallery';
import { isMissingColumn, isMissingProofColumn, proofOverlayLabel } from '@/lib/photoProofStamp';
import { displayPhotoPath } from '@/lib/photoDownload';
import { useGalleryNavigation } from '@/hooks/useGalleryNavigation';
import { useOrgTimezone } from '@/hooks/useOrgTimezone';
import { toast } from 'sonner';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { QueryError } from '@/components/QueryError';

interface StaffPhotosTabProps {
  staffId: string;
  organizationId: string;
}

interface BookingOption {
  id: string;
  booking_number: number;
  scheduled_at: string;
  customer: { first_name: string; last_name: string } | null;
  service: { name: string } | null;
}

interface PhotoRecord {
  id: string;
  booking_id: string;
  organization_id?: string | null;
  photo_url: string;
  stamped_photo_url?: string | null;
  photo_type: string | null;
  media_type: string;
  created_at: string | null;
  captured_at?: string | null;
  timestamp_source?: string | null;
  proof_stamped?: boolean | null;
  booking?: {
    organization_id?: string | null;
    booking_number: number;
    scheduled_at: string;
    customer: { first_name: string; last_name: string } | null;
  } | null;
}

const ALLOWED_PHOTO = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];
const ALLOWED_VIDEO = ['video/mp4', 'video/quicktime', 'video/x-m4v'];
const PICKER_INPUT_CLASS = 'absolute left-0 top-0 h-px w-px opacity-0 pointer-events-none';

function openPicker(input: HTMLInputElement | null) {
  if (!input) return;

  const pickerInput = input as HTMLInputElement & { showPicker?: () => void };

  try {
    if (typeof pickerInput.showPicker === 'function') {
      pickerInput.showPicker();
      return;
    }
  } catch (error) {
    console.warn('showPicker failed, falling back to click()', error);
  }

  pickerInput.click();
}

export function StaffPhotosTab({ staffId, organizationId }: StaffPhotosTabProps) {
  const queryClient = useQueryClient();
  const [selectedBookingId, setSelectedBookingId] = useState<string>('');
  // Inferred from the selected booking rather than hardcoded 'after'. Re-infers
  // whenever the booking changes, so an override on one job can't follow the
  // cleaner to the next — that stickiness is why photos piled into one column.
  const [photoType, setPhotoType] = useState<string>('before');
  const [typeInferred, setTypeInferred] = useState(true);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const queue = usePhotoUploadQueue({ staffId });
  const { timezone: orgTz } = useOrgTimezone(organizationId);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const libraryInputRef = useRef<HTMLInputElement>(null);

  // Auto-select the most recent booking so cleaners don't get stuck
  // wondering why "Upload All" is disabled when they only have one job.


  const { data: bookings = [], error: bookingsError, refetch: refetchBookings } = useQuery({
    queryKey: ['staff-photo-bookings', staffId, organizationId],
    queryFn: async () => {
      if (!staffId || !organizationId) return [];

      const { data, error } = await supabase
        .from('bookings')
        .select('id, booking_number, scheduled_at, status, cleaner_checkout_at, customer_id, service:services(name)')
        .eq('staff_id', staffId)
        .eq('organization_id', organizationId)
        .in('status', ['pending', 'confirmed', 'in_progress', 'completed'])
        .order('scheduled_at', { ascending: false })
        .limit(20);

      if (error) throw error;
      return (await withStaffCustomers(data)) as unknown as BookingOption[];
    },
    enabled: !!staffId && !!organizationId,
  });

  useEffect(() => {
    if (!selectedBookingId && bookings.length > 0) {
      setSelectedBookingId(bookings[0].id);
    }
  }, [bookings, selectedBookingId]);

  // Re-infer the stage whenever the selected booking changes.
  useEffect(() => {
    if (!selectedBookingId) return;
    const b = (bookings as any[]).find((x) => x.id === selectedBookingId);
    if (!b) return;
    setTypeInferred(true);
    setPhotoType(b.cleaner_checkout_at || b.status === 'completed' ? 'after' : 'before');
  }, [selectedBookingId, bookings]);


  const { data: photos = [], isLoading: loadingPhotos, error: photosError, refetch: refetchPhotos } = useQuery({
    queryKey: ['staff-uploaded-photos', staffId, organizationId],
    queryFn: async () => {
      if (!staffId || !organizationId) return [];

      const photoColumns: string = `
          id, booking_id, organization_id, photo_url, photo_type, media_type, created_at,
          booking:bookings!booking_photos_booking_id_fkey(
            organization_id,
            booking_number,
            scheduled_at,
            customer_id
          )
        `;
      // Proof columns are not in the generated types until the migration runs.
      // A plain string select keeps this compiling either way; a missing-column
      // error falls back to the columns that already exist.
      const withProof = photoColumns.replace(
        'created_at,',
        'created_at, captured_at, timestamp_source, proof_stamped,',
      );
      const withStamped = withProof.replace('photo_url,', 'photo_url, stamped_photo_url,');
      const load = (columns: string) => supabase
        .from('booking_photos')
        .select(columns)
        .eq('staff_id', staffId)
        .order('created_at', { ascending: false });

      let result = await load(withStamped);
      if (result.error && isMissingColumn(result.error, 'stamped_photo_url')) {
        result = await load(withProof);
      }
      if (result.error && isMissingProofColumn(result.error)) {
        result = await load(photoColumns);
      }
      if (result.error) throw result.error;

      const rows = (result.data || []) as unknown as (PhotoRecord & { booking: (PhotoRecord['booking'] & { customer_id?: string | null }) | null })[];
      const custMap = await fetchStaffCustomers(rows.map((r) => r.booking?.customer_id));
      for (const r of rows) {
        if (r.booking) (r.booking as { customer?: unknown }).customer = (r.booking.customer_id && custMap[r.booking.customer_id]) || null;
      }
      return (rows as PhotoRecord[]).filter((item) =>
        photoVisibleToOrg(item.organization_id, item.booking?.organization_id, organizationId),
      );
    },
    enabled: !!staffId && !!organizationId,
  });

  const groupedPhotos = photos.reduce<Record<string, { booking: PhotoRecord['booking']; items: PhotoRecord[] }>>((acc, photo) => {
    const key = photo.booking_id;
    if (!acc[key]) {
      acc[key] = { booking: photo.booking, items: [] };
    }
    acc[key].items.push(photo);
    return acc;
  }, {});

  // Same order as the cards below: within each job, before, then after, then other.
  const galleryItems = Object.values(groupedPhotos).flatMap((group) => inBeforeAfterOrder(group.items));
  const galleryRef = useRef(galleryItems);
  galleryRef.current = galleryItems;
  const previewIndex = galleryItems.findIndex((item) => item.id === previewId);
  const previewItem = previewIndex >= 0 ? galleryItems[previewIndex] : null;
  const showDelta = (delta: number) => {
    setPreviewId((current) => {
      const list = galleryRef.current;
      const index = list.findIndex((item) => item.id === current);
      if (index < 0) return current;
      return list[stepGalleryIndex(index, list.length, delta)]?.id ?? current;
    });
  };
  const galleryNav = useGalleryNavigation(previewIndex >= 0, showDelta, () => setPreviewId(null));
  const timestampOverlay = previewItem ? proofOverlayLabel(previewItem, orgTz) : null;
  const visibleIds = galleryItems.map((item) => item.id).join('\n');
  useEffect(() => {
    if (previewId && !galleryRef.current.some((item) => item.id === previewId)) setPreviewId(null);
  }, [previewId, visibleIds]);

  const handleFilesSelected = async (event: React.ChangeEvent<HTMLInputElement>, fromCamera: boolean) => {
    const files = Array.from(event.target.files || []);
    event.target.value = '';

    if (!files.length) return;
    if (!selectedBookingId) {
      toast.error('Pick a booking before adding photos.');
      return;
    }

    const { accepted, overLimit } = takeSelection(files);
    if (overLimit) toast.message(SELECTION_LIMIT_MESSAGE);

    for (const file of accepted) {
      const isVideo = isVideoFile(file);

      if (!isVideo && !ALLOWED_PHOTO.includes(file.type) && !/\.(heic|heif)$/i.test(file.name)) {
        toast.error(`${file.name}: Only JPG, PNG, WebP, and HEIC photos are supported.`);
        continue;
      }

      if (isVideo && !ALLOWED_VIDEO.includes(file.type) && !file.name.toLowerCase().endsWith('.mov')) {
        toast.error(`${file.name}: Please upload MP4 or MOV videos only.`);
        continue;
      }

      // Photos are measured after compression. A 12MB iPhone original is fine
      // once it is a ~1MB JPEG. Videos are not compressed, so they keep this cap.
      if (isVideo && file.size > VIDEO_MAX_BYTES) {
        toast.error(`${file.name}: Video must be under 100MB.`);
        continue;
      }

      try {
        await queue.enqueue({
          file,
          bookingId: selectedBookingId,
          staffId,
          organizationId,
          photoType,
          liveCapture: fromCamera && !isVideo,
        });
      } catch (error) {
        console.error('Could not save photo to the queue', error);
        toast.error(getUploadErrorMessage(error, isVideo), { duration: 6000 });
      }
    }
  };

  const visibleQueue = queue.items.filter((item) => (
    item.status !== 'done' || !photos.some((photo) => photo.photo_url === item.remotePath)
  ));
  const doneCount = queue.items.filter((item) => item.status === 'done').length;
  const landedIds = queue.items
    .filter((item) => item.status === 'done' && !!item.remotePath && photos.some((photo) => photo.photo_url === item.remotePath))
    .map((item) => item.id)
    .join(',');
  const prevDoneCount = useRef(0);

  useEffect(() => {
    if (doneCount > prevDoneCount.current) {
      void queryClient.invalidateQueries({ queryKey: ['staff-uploaded-photos'] });
      void queryClient.invalidateQueries({ queryKey: ['booking-photos'] });
    }
    prevDoneCount.current = doneCount;
  }, [doneCount, queryClient]);

  useEffect(() => {
    if (!landedIds) return;
    landedIds.split(',').forEach((id) => { void dismissQueuedPhoto(id); });
  }, [landedIds]);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">📷 Job Photos & Videos</h2>
        <p className="text-sm text-muted-foreground">Upload before & after media for your bookings</p>
      </div>

      {(bookingsError || photosError) && (
        <QueryError
          subject="photos"
          onRetry={() => {
            void refetchBookings();
            void refetchPhotos();
          }}
        />
      )}

      <Card>
        <CardContent className="p-4 space-y-4">
          <h3 className="font-medium">Upload Job Photos</h3>

          <Select value={selectedBookingId} onValueChange={setSelectedBookingId}>
            <SelectTrigger>
              <SelectValue placeholder="Select a booking..." />
            </SelectTrigger>
            <SelectContent>
              {bookings.map((booking) => (
                <SelectItem key={booking.id} value={booking.id}>
                  #{booking.booking_number}, {booking.customer ? `${booking.customer.first_name} ${booking.customer.last_name}` : 'Unknown'}, {format(new Date(booking.scheduled_at), 'MMM d')}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <div>
            <div className="flex rounded-lg bg-muted p-1" role="group" aria-label="Photo stage">
              {(['before', 'after', 'other'] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => { setPhotoType(t); setTypeInferred(false); }}
                  aria-pressed={photoType === t}
                  className={cn(
                    'flex-1 rounded-md py-2 text-sm font-medium capitalize transition-colors min-h-[44px]',
                    photoType === t
                      ? 'bg-background shadow-sm text-foreground'
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  {t}
                </button>
              ))}
            </div>
            <p className="mt-1 text-center text-xs text-muted-foreground">
              {typeInferred
                ? photoType === 'before'
                  ? 'Job not finished yet. Filing as Before.'
                  : 'Job is checked out. Filing as After.'
                : `Filing as ${photoType}.`}
            </p>
          </div>

          <input
            ref={cameraInputRef}
            type="file"
            accept="image/*,video/mp4,video/quicktime,video/x-m4v,.mov,.mp4"
            capture="environment"
            multiple
            tabIndex={-1}
            className={PICKER_INPUT_CLASS}
            onChange={(event) => handleFilesSelected(event, true)}
          />
          <input
            ref={libraryInputRef}
            type="file"
            accept="image/*,video/mp4,video/quicktime,video/x-m4v,.mov,.mp4"
            multiple
            tabIndex={-1}
            className={PICKER_INPUT_CLASS}
            onChange={(event) => handleFilesSelected(event, false)}
          />

          <div className="flex gap-2">
            <Button
              variant="outline"
              className="flex-1 gap-2 min-h-[48px] text-base"
              onClick={() => openPicker(cameraInputRef.current)}
              disabled={!selectedBookingId}
            >
              <Camera className="w-5 h-5" />
              Camera
            </Button>
            <Button
              variant="outline"
              className="flex-1 gap-2 min-h-[48px] text-base"
              onClick={() => openPicker(libraryInputRef.current)}
              disabled={!selectedBookingId}
            >
              <Upload className="w-5 h-5" />
              Library
            </Button>
          </div>

          {!selectedBookingId && (
            <p className="text-center text-xs text-amber-500">
              Pick a booking from the dropdown above before adding photos.
            </p>
          )}
          <p className="text-center text-xs text-muted-foreground">
            Each photo uploads on its own and stays on this phone until it goes through.
          </p>
          <PhotoUploadQueueList
            items={visibleQueue}
            onRetry={(id) => { void queue.retry(id); }}
            onDismiss={(id) => { void queue.dismiss(id); }}
          />
        </CardContent>
      </Card>

      <div>
        <h3 className="font-medium mb-3">Your Uploaded Media</h3>
        {loadingPhotos && photos.length === 0 && !photosError ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : photos.length === 0 ? (
          photosError ? null : (
            <div className="text-center py-12 text-muted-foreground">
              <Camera className="w-10 h-10 mx-auto mb-2" />
              <p>No photos uploaded yet</p>
              <p className="text-xs">Select a booking above and start uploading!</p>
            </div>
          )
        ) : (
          <div className="space-y-6">
            {Object.entries(groupedPhotos).map(([bookingId, group]) => {
              const ordered = inBeforeAfterOrder(group.items);
              const beforeItems = ordered.filter((item) => item.photo_type === 'before');
              const afterItems = ordered.filter((item) => item.photo_type === 'after');
              const otherItems = ordered.filter((item) => item.photo_type !== 'before' && item.photo_type !== 'after');

              return (
                <Card key={bookingId}>
                  <CardContent className="p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-medium text-sm">
                          {group.booking?.customer
                            ? `${group.booking.customer.first_name} ${group.booking.customer.last_name}`
                            : `Booking #${group.booking?.booking_number}`}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {group.booking?.scheduled_at ? format(new Date(group.booking.scheduled_at), 'EEE, MMM d, yyyy') : ''}
                        </p>
                      </div>
                      <Badge variant="outline" className="text-xs">
                        {group.items.length} file{group.items.length !== 1 ? 's' : ''}
                      </Badge>
                    </div>

                    {beforeItems.length > 0 && (
                      <div>
                        <p className="text-xs font-medium text-muted-foreground mb-1">📷 Before</p>
                        <div className="grid grid-cols-2 sm:flex gap-2 overflow-x-auto">
                          {beforeItems.map((item) => (
                            <MediaThumbnail key={item.id} item={item} onClick={() => setPreviewId(item.id)} />
                          ))}
                        </div>
                      </div>
                    )}

                    {afterItems.length > 0 && (
                      <div>
                        <p className="text-xs font-medium text-muted-foreground mb-1">✅ After</p>
                        <div className="grid grid-cols-2 sm:flex gap-2 overflow-x-auto">
                          {afterItems.map((item) => (
                            <MediaThumbnail key={item.id} item={item} onClick={() => setPreviewId(item.id)} />
                          ))}
                        </div>
                      </div>
                    )}

                    {otherItems.length > 0 && (
                      <div>
                        <p className="text-xs font-medium text-muted-foreground mb-1">📝 Other</p>
                        <div className="grid grid-cols-2 sm:flex gap-2 overflow-x-auto">
                          {otherItems.map((item) => (
                            <MediaThumbnail key={item.id} item={item} onClick={() => setPreviewId(item.id)} />
                          ))}
                        </div>
                      </div>
                    )}

                    <p className="text-xs text-muted-foreground">Sent to Admin ✅</p>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      <Dialog open={!!previewItem} onOpenChange={(open) => !open && setPreviewId(null)}>
        <DialogContent
          className="max-w-lg"
          onEscapeKeyDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
            setPreviewId(null);
          }}
        >
          <DialogHeader className="pr-8">
            <div className="flex items-start justify-between gap-3">
              <DialogTitle>Media Preview</DialogTitle>
              {previewIndex >= 0 && (
                <p className="shrink-0 text-sm font-medium tabular-nums text-muted-foreground" aria-live="polite">
                  {previewIndex + 1} / {galleryItems.length}
                </p>
              )}
            </div>
          </DialogHeader>
          {previewItem && (
            <div
              className="relative touch-pan-y"
              onPointerDown={galleryNav.onPointerDown}
              onPointerUp={galleryNav.onPointerUp}
              onPointerCancel={galleryNav.onPointerCancel}
            >
              {previewItem.media_type === 'video'
                || previewItem.photo_url?.toLowerCase().endsWith('.mp4')
                || previewItem.photo_url?.toLowerCase().endsWith('.mov') ? (
                <SignedVideo key={previewItem.id} src={previewItem.photo_url} bucket="booking-photos" className="w-full rounded-lg" />
              ) : (
                <SignedImage
                  key={previewItem.id}
                  src={displayPhotoPath(previewItem)}
                  bucket="booking-photos"
                  alt="Preview"
                  className="w-full rounded-lg"
                  loading="eager"
                  fallback={<div className="w-full h-48 flex items-center justify-center bg-muted"><ImageIcon className="w-10 h-10 text-muted-foreground" /></div>}
                />
              )}
              {timestampOverlay && (
                <div className="pointer-events-none absolute inset-x-0 bottom-0 rounded-b-lg bg-black/75 px-3 py-2 text-center text-xs font-medium text-white">
                  {timestampOverlay}
                </div>
              )}
              <Button
                type="button"
                variant="secondary"
                size="icon"
                className="hidden md:inline-flex absolute left-2 top-1/2 z-10 -translate-y-1/2 rounded-full bg-background/90 shadow"
                disabled={previewIndex <= 0}
                aria-label="Previous photo"
                onClick={() => showDelta(-1)}
              >
                <ChevronLeft className="w-5 h-5" />
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="icon"
                className="hidden md:inline-flex absolute right-2 top-1/2 z-10 -translate-y-1/2 rounded-full bg-background/90 shadow"
                disabled={previewIndex < 0 || previewIndex >= galleryItems.length - 1}
                aria-label="Next photo"
                onClick={() => showDelta(1)}
              >
                <ChevronRight className="w-5 h-5" />
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function MediaThumbnail({ item, onClick }: { item: PhotoRecord; onClick: () => void }) {
  const isVideo = item.media_type === 'video' || item.photo_url?.toLowerCase().endsWith('.mp4') || item.photo_url?.toLowerCase().endsWith('.mov');

  return (
    <div className="relative w-20 h-20 flex-shrink-0 rounded-lg overflow-hidden bg-muted cursor-pointer" onClick={onClick}>
      {isVideo ? (
        <div className="w-full h-full flex items-center justify-center bg-black/80">
          <Play className="w-6 h-6 text-white fill-white" />
        </div>
      ) : (
        <SignedImage
          src={displayPhotoPath(item)}
          bucket="booking-photos"
          alt=""
          className="w-full h-full object-cover"
          fallback={<div className="w-full h-full flex items-center justify-center"><ImageIcon className="w-5 h-5 text-muted-foreground" /></div>}
        />
      )}
      <Badge className="absolute bottom-0.5 right-0.5 text-[9px] px-1 py-0" variant="secondary">
        {isVideo ? '🎥' : '📷'}
      </Badge>
    </div>
  );
}

function SignedVideo({ src, bucket, className }: { src: string; bucket: string; className?: string }) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setUrl(null);

    supabase.storage.from(bucket).createSignedUrl(src, 3600).then(({ data }) => {
      if (active) {
        setUrl(data?.signedUrl ?? null);
      }
    });

    return () => {
      active = false;
    };
  }, [bucket, src]);

  if (!url) {
    return <div className={`flex items-center justify-center bg-muted ${className}`}><Loader2 className="w-6 h-6 animate-spin" /></div>;
  }

  return <video src={url} controls playsInline className={className} />;
}
