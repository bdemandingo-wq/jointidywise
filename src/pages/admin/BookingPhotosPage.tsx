import { useEffect, useRef, useState } from 'react';
import { AdminLayout } from '@/components/admin/AdminLayout';
import { PlanFeatureGate } from '@/components/admin/PlanFeatureGate';
import { QueryError } from '@/components/QueryError';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { SignedImage } from '@/components/ui/signed-image';
import { Capacitor } from '@capacitor/core';
import { Share } from '@capacitor/share';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Search, Camera, Calendar, User, Loader2, Image as ImageIcon, Trash2, Play, Download, Video, ArrowLeftRight, ChevronLeft, ChevronRight } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useOrganization } from '@/contexts/OrganizationContext';
import { useOrgTimezone } from '@/hooks/useOrgTimezone';
import { formatInTimezone } from '@/lib/timezoneUtils';
import { toast } from 'sonner';
import { SEOHead } from '@/components/SEOHead';
import { confirmDialog } from "@/components/AppDialogs";
import { stepGalleryIndex } from '@/lib/photoGallery';
import { proofOverlayLabel } from '@/lib/photoProofStamp';
import { useGalleryNavigation } from '@/hooks/useGalleryNavigation';
import { useBookingMediaGallery, isVideoMedia, type BookingPhoto } from '@/hooks/useBookingMediaGallery';
import { VirtualMediaGrid } from '@/components/admin/VirtualMediaGrid';
import { GalleryZoom } from '@/components/admin/GalleryZoom';
import { adjacentMedia } from '@/lib/bookingMediaGallery';
import { prefetchMediaOriginal } from '@/lib/mediaThumbnail';
import { Skeleton } from '@/components/ui/skeleton';

function SignedVideo({ src, bucket, className }: { src: string; bucket: string; className?: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let active = true;
    setUrl(null);
    setError(false);

    supabase.storage.from(bucket).createSignedUrl(src, 3600).then(({ data, error: signedUrlError }) => {
      if (!active) return;
      if (signedUrlError || !data?.signedUrl) {
        setError(true);
        return;
      }
      setUrl(data.signedUrl);
    });

    return () => {
      active = false;
    };
  }, [bucket, src]);

  if (error) return (
    <div className={`flex items-center justify-center bg-muted ${className}`}>
      <Video className="w-8 h-8 text-muted-foreground" />
    </div>
  );

  if (!url) return (
    <div className={`flex items-center justify-center bg-muted ${className}`}>
      <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
    </div>
  );

  return <video src={url} controls playsInline className={className} />;
}

export default function BookingPhotosPage() {
  const { organization } = useOrganization();
  const { timezone: orgTz } = useOrgTimezone();
  const queryClient = useQueryClient();
  const [searchTerm, setSearchTerm] = useState('');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [mediaFilter, setMediaFilter] = useState<string>('all');
  const [viewerId, setViewerId] = useState<string | null>(null);
  const [movingId, setMovingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const { photos, isLoading, error: photosError, refetch, complete, hasNextPage, fetchNextPage } = useBookingMediaGallery(organization?.id);
  // Surface query errors so silent RLS/permission failures don't look like "no data"
  useEffect(() => {
    if (photosError) {
      toast.error(`Couldn't load booking media: ${(photosError as Error).message || 'unknown error'}`);
    }
  }, [photosError]);

  const filtered = photos.filter((photo) => {
    const matchesType = typeFilter === 'all' || photo.photo_type === typeFilter;
    const matchesMedia = mediaFilter === 'all' || (mediaFilter === 'video' ? isVideoMedia(photo) : !isVideoMedia(photo));

    if (!searchTerm) return matchesType && matchesMedia;

    const term = searchTerm.toLowerCase();
    const customerName = photo.booking?.customer
      ? `${photo.booking.customer.first_name} ${photo.booking.customer.last_name}`.toLowerCase()
      : '';
    const staffName = photo.staff?.name?.toLowerCase() || '';
    const bookingNum = photo.booking?.booking_number?.toString() || '';

    return matchesType && matchesMedia && (customerName.includes(term) || staffName.includes(term) || bookingNum.includes(term));
  });

  // Gallery order is the grid the user is looking at, filters included.
  // This page is a flat list, so it is not regrouped here.
  const filteredRef = useRef(filtered);
  filteredRef.current = filtered;
  const viewerIndex = filtered.findIndex((photo) => photo.id === viewerId);
  const selectedPhoto = viewerIndex >= 0 ? filtered[viewerIndex] : null;

  const showDelta = (delta: number) => {
    setViewerId((current) => {
      const list = filteredRef.current;
      const index = list.findIndex((photo) => photo.id === current);
      if (index < 0) return current;
      const next = stepGalleryIndex(index, list.length, delta);
      return list[next]?.id ?? current;
    });
  };

  const galleryNav = useGalleryNavigation(viewerIndex >= 0, showDelta, () => setViewerId(null));
  const visibleIds = filtered.map((photo) => photo.id).join('\n');
  useEffect(() => {
    for (const photo of adjacentMedia(filteredRef.current, viewerIndex, isVideoMedia)) void prefetchMediaOriginal('booking-photos', photo.photo_url);
  }, [viewerIndex, visibleIds]);
  const timestampOverlay = selectedPhoto ? proofOverlayLabel(selectedPhoto, orgTz) : null;
  useEffect(() => {
    if (viewerId && !filteredRef.current.some((photo) => photo.id === viewerId)) setViewerId(null);
  }, [viewerId, visibleIds]);

  // Reclassify a misfiled photo. The stage is stored twice — as this column
  // and inside the storage path (`.../{photoType}/{ts}.jpg`) — but nothing
  // reads the path for classification, so the column is authoritative and the
  // object is deliberately left where it is. Moving storage objects to keep a
  // redundant encoding in sync would risk breaking photo_url for no gain.
  const handleMovePhoto = async (photo: BookingPhoto, target: 'before' | 'after') => {
    setMovingId(photo.id);
    try {
      const { error } = await supabase
        .from('booking_photos')
        .update({ photo_type: target })
        .eq('id', photo.id);
      if (error) throw error;

      queryClient.invalidateQueries({ queryKey: ['booking-photos', organization?.id] });
      toast.success(`Moved to ${target}`);
    } catch (error) {
      console.error(error);
      toast.error('Could not move this photo');
    } finally {
      setMovingId(null);
    }
  };

  const handleDelete = async (photo: BookingPhoto) => {
    if (!(await confirmDialog(`Delete this ${isVideoMedia(photo) ? 'video' : 'photo'}? This cannot be undone.`))) return;

    setDeletingId(photo.id);
    try {
      // Delete DB record first so the photo list updates immediately
      const { error: dbError } = await supabase.from('booking_photos').delete().eq('id', photo.id);
      if (dbError) throw dbError;

      // Then remove from storage — failure here leaves an orphan file but doesn't affect UI
      const { error: storageError } = await supabase.storage.from('booking-photos').remove([photo.photo_url]);
      if (storageError) {
        console.warn('Storage remove failed (orphaned file):', storageError.message);
      }

      queryClient.invalidateQueries({ queryKey: ['booking-photos', organization?.id] });
      toast.success(`${isVideoMedia(photo) ? 'Video' : 'Photo'} deleted`);
      if (viewerId === photo.id) {
        const neighbor = filtered[viewerIndex + 1] ?? filtered[viewerIndex - 1] ?? null;
        setViewerId(neighbor?.id ?? null);
      }
    } catch (error) {
      console.error(error);
      toast.error('Failed to delete');
    } finally {
      setDeletingId(null);
    }
  };

  const handleDownload = async (photo: BookingPhoto) => {
    try {
      const { data, error } = await supabase.storage.from('booking-photos').createSignedUrl(photo.photo_url, 300);
      if (error || !data?.signedUrl) throw error;
      const filename = photo.photo_url.split('/').pop() || 'photo.jpg';

      // Fetch the actual bytes — a cross-origin <a download> is ignored by
      // browsers and just navigates (which opened Safari on the phone).
      const resp = await fetch(data.signedUrl);
      const blob = await resp.blob();

      if (Capacitor.isNativePlatform()) {
        // Native: write to cache then open the iOS share sheet, where the
        // user can "Save Image" straight to Photos.
        const base64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve((reader.result as string).split(',')[1]);
          reader.onerror = () => reject(new Error('read failed'));
          reader.readAsDataURL(blob);
        });
        const written = await Filesystem.writeFile({
          path: filename,
          data: base64,
          directory: Directory.Cache,
        });
        await Share.share({ files: [written.uri] });
      } else {
        const objectUrl = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = objectUrl;
        anchor.download = filename;
        anchor.click();
        URL.revokeObjectURL(objectUrl);
      }
    } catch {
      toast.error('Failed to download');
    }
  };

  const videoCount = photos.filter((photo) => isVideoMedia(photo)).length;
  const photoCount = photos.length - videoCount;

  return (
    <AdminLayout title="Booking Media">
<div className="portal-v2 portal-v2-scroll">
      <SEOHead title="Booking Media | TidyWise" description="View and manage photos and videos from your cleaning bookings" noIndex />
      <PlanFeatureGate feature="booking_photos">
        <div className="space-y-6">
          <p className="text-muted-foreground">All before and after photos and videos uploaded by your cleaners</p>

          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search by customer, cleaner, or booking #..."
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                className="pl-10"
              />
            </div>
            <Select value={typeFilter} onValueChange={setTypeFilter}>
              <SelectTrigger className="w-[140px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Types</SelectItem>
                <SelectItem value="before">Before</SelectItem>
                <SelectItem value="after">After</SelectItem>
                <SelectItem value="inspection">Inspection</SelectItem>
              </SelectContent>
            </Select>
            <Select value={mediaFilter} onValueChange={setMediaFilter}>
              <SelectTrigger className="w-[140px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Media</SelectItem>
                <SelectItem value="photo">📷 Photos</SelectItem>
                <SelectItem value="video">🎥 Videos</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-wrap gap-x-3 gap-y-1 text-sm text-muted-foreground">
            <span>{complete ? `${photos.length} total` : `Loading library · ${photos.length} loaded`}</span>
            <span>•</span>
            <span>📷 {photoCount} photos</span>
            <span>•</span>
            <span>🎥 {videoCount} videos</span>
            <span>•</span>
            <span>{photos.filter((photo) => photo.photo_type === 'before').length} before</span>
            <span>•</span>
            <span>{photos.filter((photo) => photo.photo_type === 'after').length} after</span>
            <span>•</span>
            <span>⚠️ {photos.filter((photo) => photo.photo_type === 'inspection').length} inspection</span>
          </div>

          {isLoading ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2">{Array.from({ length: 10 }, (_, i) => <Skeleton key={i} className="aspect-square rounded-lg" />)}</div>
          ) : photosError ? (
            <QueryError subject="booking photos" onRetry={() => { void (hasNextPage ? fetchNextPage() : refetch()); }} />
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
              <Camera className="w-12 h-12 mb-3" />
              <p className="text-lg font-medium">No media yet</p>
              <p className="text-sm">Photos and videos will appear here when your cleaners upload them from the staff portal</p>
            </div>
          ) : (
            <VirtualMediaGrid items={filtered} renderItem={(photo) => {
                const isVideo = isVideoMedia(photo);
                return (
                  <Card
                    key={photo.id}
                    role="button" tabIndex={0} aria-label={`Open ${photo.photo_type || 'booking'} ${isVideo ? 'video' : 'photo'} ${photo.id}`}
                    onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setViewerId(photo.id); } }}
                    className="overflow-hidden cursor-pointer hover:shadow-md transition-shadow group"
                    onClick={() => setViewerId(photo.id)}
                  >
                    <div className="aspect-square relative bg-muted">
                      {isVideo ? (
                        <div className="w-full h-full flex items-center justify-center bg-muted">
                          <Play className="w-10 h-10 text-foreground fill-current" />
                        </div>
                      ) : (
                        <SignedImage
                          src={photo.photo_url}
                          bucket="booking-photos"
                          alt={`${photo.photo_type || 'Booking'} photo`}
                          className="w-full h-full object-cover"
                          thumbWidth={400}
                          galleryThumbnail
                          fallback={
                            <div className="w-full h-full flex items-center justify-center">
                              <ImageIcon className="w-8 h-8 text-muted-foreground" />
                            </div>
                          }
                        />
                      )}
                      <div className="absolute top-2 left-2 flex gap-1 flex-wrap">
                        <Badge
                          className="text-xs capitalize"
                          variant={photo.photo_type === 'before' ? 'secondary' : photo.photo_type === 'inspection' ? 'destructive' : 'default'}
                        >
                          {photo.photo_type === 'inspection' ? '⚠️ Inspection' : (photo.photo_type || 'photo')}
                        </Badge>
                        <Badge className="text-xs" variant="outline">
                          {isVideo ? '🎥' : '📷'}
                        </Badge>
                      </div>
                    </div>
                    <CardContent className="p-2">
                      <p className="text-xs font-medium truncate">
                        {photo.booking?.customer
                          ? `${photo.booking.customer.first_name} ${photo.booking.customer.last_name}`
                          : `Booking #${photo.booking?.booking_number || '—'}`}
                      </p>
                      <p className="text-xs text-muted-foreground truncate">
                        {photo.staff ? photo.staff.name : 'Unknown cleaner'}
                      </p>
                      {photo.created_at && (
                        <p className="text-xs text-muted-foreground">
                          {formatInTimezone(photo.created_at, orgTz, { month: 'short', day: 'numeric', year: 'numeric' })}
                        </p>
                      )}
                    </CardContent>
                  </Card>
                );
              }} />
          )}
        </div>

        <Dialog open={!!selectedPhoto} onOpenChange={(open) => !open && setViewerId(null)}>
          <DialogContent
            className="portal-v2 !fixed !inset-0 !left-0 !top-0 !translate-x-0 !translate-y-0 !w-full !max-w-none !h-dvh !max-h-dvh !rounded-none !border-0 !p-0 !z-[10000] [&>button]:!h-11 [&>button]:!w-11 [&>button]:!top-[max(4px,env(safe-area-inset-top))] [&>button]:!right-2 flex flex-col overflow-hidden bg-background pt-[env(safe-area-inset-top,0px)] pb-[env(safe-area-inset-bottom,0px)]"
            onEscapeKeyDown={(event) => {
              event.preventDefault();
              event.stopPropagation();
              setViewerId(null);
            }}
          >
            <DialogHeader className="px-4 pt-4 pr-14 shrink-0">
              <div className="flex items-start justify-between gap-3">
                <DialogTitle className="flex items-center gap-2 text-left">
                  {selectedPhoto && isVideoMedia(selectedPhoto) ? <Video className="w-5 h-5" /> : <Camera className="w-5 h-5" />}
                  {selectedPhoto?.photo_type === 'inspection' ? 'Inspection Report' : selectedPhoto?.photo_type === 'before' ? 'Before' : 'After'} {selectedPhoto && isVideoMedia(selectedPhoto) ? 'Video' : 'Photo'} — Booking #{selectedPhoto?.booking?.booking_number}
                </DialogTitle>
                {viewerIndex >= 0 && (
                  <p className="shrink-0 pt-0.5 text-sm font-medium tabular-nums text-muted-foreground" aria-live="polite">
                    {viewerIndex + 1} / {filtered.length}
                  </p>
                )}
              </div>
            </DialogHeader>
            {selectedPhoto && (
              <div className="flex flex-1 min-h-0 flex-col gap-3">
                <div
                  className="relative flex-1 min-h-0 overflow-hidden bg-muted touch-pan-y"
                  onPointerDown={isVideoMedia(selectedPhoto) ? galleryNav.onPointerDown : undefined}
                  onPointerUp={isVideoMedia(selectedPhoto) ? galleryNav.onPointerUp : undefined}
                  onPointerCancel={galleryNav.onPointerCancel}
                >
                  {isVideoMedia(selectedPhoto) ? (
                    <SignedVideo
                      key={selectedPhoto.id}
                      src={selectedPhoto.photo_url}
                      bucket="booking-photos"
                      className="w-full h-full object-contain"
                    />
                  ) : (
                    <GalleryZoom key={selectedPhoto.id} onStep={showDelta}><SignedImage
                      src={selectedPhoto.photo_url}
                      bucket="booking-photos"
                      alt="Full size"
                      className="w-full h-full object-contain"
                      loading="eager"
                      fallback={
                        <div className="w-full h-64 flex items-center justify-center">
                          <ImageIcon className="w-12 h-12 text-muted-foreground" />
                        </div>
                      }
                    /></GalleryZoom>
                  )}
                  {timestampOverlay && (
                    <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-background/90 px-3 py-2 text-center text-xs font-medium text-foreground">
                      {timestampOverlay}
                    </div>
                  )}
                  <Button
                    type="button"
                    variant="secondary"
                    size="icon"
                    className="hidden md:inline-flex absolute left-2 top-1/2 z-10 -translate-y-1/2 rounded-full bg-background/90 shadow"
                    disabled={viewerIndex <= 0}
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
                    disabled={viewerIndex < 0 || viewerIndex >= filtered.length - 1}
                    aria-label="Next photo"
                    onClick={() => showDelta(1)}
                  >
                    <ChevronRight className="w-5 h-5" />
                  </Button>
                </div>
                {selectedPhoto.photo_type === 'inspection' && (
                  <div className="border border-destructive/30 bg-destructive/10 mx-4 p-3 space-y-1 max-h-24 overflow-y-auto shrink-0">
                    <div className="flex items-center gap-2">
                      <Badge variant="destructive" className="text-xs capitalize">
                        ⚠️ {selectedPhoto.issue_category?.replace('_', ' ') || 'Inspection'}
                      </Badge>
                    </div>
                    {selectedPhoto.inspection_note && (
                      <p className="text-sm mt-1">{selectedPhoto.inspection_note}</p>
                    )}
                  </div>
                )}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs px-4 shrink-0 max-h-[20dvh] overflow-y-auto">
                  <div className="flex items-center gap-2">
                    <User className="w-4 h-4 text-muted-foreground" />
                    <span>
                      {selectedPhoto.booking?.customer
                        ? `${selectedPhoto.booking.customer.first_name} ${selectedPhoto.booking.customer.last_name}`
                        : '—'}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <User className="w-4 h-4 text-muted-foreground" />
                    <span>Cleaner: {selectedPhoto.staff ? selectedPhoto.staff.name : '—'}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Calendar className="w-4 h-4 text-muted-foreground" />
                    <span>
                      {selectedPhoto.booking?.scheduled_at
                        ? formatInTimezone(selectedPhoto.booking.scheduled_at, orgTz, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
                        : '—'}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Calendar className="w-4 h-4 text-muted-foreground" />
                    <span>Uploaded: {selectedPhoto.created_at ? formatInTimezone(selectedPhoto.created_at, orgTz, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true, timeZoneName: 'short' }) : '—'}</span>
                  </div>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2 px-4 pb-3 shrink-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-2"
                      onClick={() => handleDownload(selectedPhoto)}
                    >
                      <Download className="w-4 h-4" />
                      Download
                    </Button>
                    {/* Only offered for before/after. An inspection photo has a
                        different meaning and must not be silently restaged. */}
                    {(selectedPhoto.photo_type === 'before' || selectedPhoto.photo_type === 'after') && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="gap-2"
                        disabled={movingId === selectedPhoto.id}
                        onClick={() =>
                          handleMovePhoto(
                            selectedPhoto,
                            selectedPhoto.photo_type === 'before' ? 'after' : 'before',
                          )
                        }
                      >
                        {movingId === selectedPhoto.id
                          ? <Loader2 className="w-4 h-4 animate-spin" />
                          : <ArrowLeftRight className="w-4 h-4" />}
                        Move to {selectedPhoto.photo_type === 'before' ? 'after' : 'before'}
                      </Button>
                    )}
                  </div>
                  <Button
                    variant="destructive"
                    size="sm"
                    className="gap-2"
                    onClick={() => handleDelete(selectedPhoto)}
                    disabled={deletingId === selectedPhoto.id}
                  >
                    {deletingId === selectedPhoto.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                    Delete
                  </Button>
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>
      </PlanFeatureGate>
    </div>
</AdminLayout>
  );
}

