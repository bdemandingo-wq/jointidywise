import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { Camera, Loader2, ImageIcon, Video } from 'lucide-react';
import { Capacitor } from '@capacitor/core';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { supabase } from '@/lib/supabase';
import { getUploadErrorMessage } from '@/lib/bookingMediaUpload';
import { toast } from 'sonner';
import { useNativeCamera } from '@/hooks/useNativeCamera';
import { usePhotoUploadQueue } from '@/hooks/usePhotoUploadQueue';
import { PhotoUploadQueueList } from '@/components/staff/PhotoUploadQueueList';

interface BookingPhotoUploadProps {
  bookingId: string;
  staffId: string;
  organizationId: string;
  onPhotoUploaded?: (path: string) => void;
}

const VIDEO_MAX_SIZE = 100 * 1024 * 1024;
const ALLOWED_PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];
const ALLOWED_VIDEO_TYPES = ['video/mp4', 'video/quicktime', 'video/x-m4v'];
const PICKER_INPUT_CLASS = 'absolute left-0 top-0 h-px w-px opacity-0 pointer-events-none';

type MediaMode = 'photo' | 'video';

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

function getValidationError(file: File, mediaMode: MediaMode): string | null {
  if (mediaMode === 'photo') {
    if (!ALLOWED_PHOTO_TYPES.includes(file.type) && !/\.(heic|heif)$/i.test(file.name)) {
      return 'Only JPG, PNG, WebP and HEIC photos are supported.';
    }

    // Size is checked after the queue compresses the photo. The original
    // iPhone file is often over 10MB and the JPEG is not.
    return null;
  }

  if (!ALLOWED_VIDEO_TYPES.includes(file.type) && !file.name.toLowerCase().endsWith('.mov')) {
    return 'Please upload MP4 or MOV videos only.';
  }

  if (file.size > VIDEO_MAX_SIZE) {
    return 'Video must be under 100MB. Try trimming it or recording a shorter clip.';
  }

  return null;
}

export function BookingPhotoUpload({ bookingId, staffId, organizationId, onPhotoUploaded }: BookingPhotoUploadProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  // Inferred from job state on open, not hardcoded. The old default was
  // 'after', so a cleaner photographing the mess on arrival filed it as
  // 'after' unless they actively tapped Before — which is most of why
  // everything ended up in one column.
  const [photoType, setPhotoType] = useState<'before' | 'after'>('before');
  const [typeInferred, setTypeInferred] = useState(true);
  const [mediaMode, setMediaMode] = useState<MediaMode>('photo');
  const queue = usePhotoUploadQueue({ staffId, bookingId });
  const doneCount = queue.items.filter((item) => item.status === 'done').length;
  const doneCountRef = useRef(0);
  const onUploadedRef = useRef(onPhotoUploaded);
  onUploadedRef.current = onPhotoUploaded;
  useEffect(() => {
    if (doneCount > doneCountRef.current) onUploadedRef.current?.('uploaded');
    doneCountRef.current = doneCount;
  }, [doneCount]);

  // Ref mirrors typeInferred so the async inference above reads the current
  // value rather than the one captured when the dialog opened.
  const typeInferredRef = useRef(true);
  typeInferredRef.current = typeInferred;

  const cameraPhotoInputRef = useRef<HTMLInputElement>(null);
  const libraryPhotoInputRef = useRef<HTMLInputElement>(null);
  const cameraVideoInputRef = useRef<HTMLInputElement>(null);
  const libraryVideoInputRef = useRef<HTMLInputElement>(null);
  const { isNative, isLoading: cameraLoading, takePicture, pickFromGallery } = useNativeCamera();

  const resetPickerInputs = () => {
    [cameraPhotoInputRef, libraryPhotoInputRef, cameraVideoInputRef, libraryVideoInputRef].forEach((ref) => {
      if (ref.current) ref.current.value = '';
    });
  };

  const queueList = (
    <PhotoUploadQueueList
      items={queue.items}
      onRetry={(id) => { void queue.retry(id); }}
      onDismiss={(id) => { void queue.dismiss(id); }}
    />
  );

  const saveToQueue = async (file: File, exif: unknown, fromCamera: boolean) => {
    const validationError = getValidationError(file, mediaMode);
    if (validationError) {
      toast.error(validationError, { duration: 6000 });
      return;
    }

    setSaving(true);
    try {
      // Persist before the upload starts. Closing the camera, leaving this
      // screen, or the webview reloading no longer throws the photo away.
      await queue.enqueue({
        file,
        bookingId,
        staffId,
        organizationId,
        photoType,
        liveCapture: fromCamera && mediaMode === 'photo',
        captureExif: exif,
      });
      toast.success(mediaMode === 'video' ? 'Video saved on this phone. Uploading…' : 'Photo saved on this phone. Uploading…');
    } catch (error) {
      console.error('Could not save photo to the queue', error);
      toast.error(getUploadErrorMessage(error, mediaMode === 'video'), { duration: 6000 });
    } finally {
      setSaving(false);
      resetPickerInputs();
    }
  };

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>, fromCamera: boolean) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    void saveToQueue(file, undefined, fromCamera);
  };

  const handleNativeCamera = async () => {
    const result = await takePicture('camera');
    if (result?.file) {
      await saveToQueue(result.file, result.exif, true);
    }
  };

  const handleNativeGallery = async () => {
    const result = await pickFromGallery();
    if (result?.file) {
      await saveToQueue(result.file, result.exif, false);
    }
  };

  return (
    <div className="flex w-full flex-col gap-2">
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        setIsOpen(open);
        if (!open) resetPickerInputs();
        if (open) {
          // Re-infer on every open. An override is an exception and must not
          // silently become the default for the next job — that is the
          // mechanism that produced the one-column problem. Within a single
          // open session the override sticks, so batching still works.
          setTypeInferred(true);
          setPhotoType('before');
          void (async () => {
            const { data } = await supabase
              .from('bookings')
              .select('status, cleaner_checkout_at')
              .eq('id', bookingId)
              .maybeSingle();
            const checkedOut =
              !!(data as { cleaner_checkout_at?: string | null } | null)?.cleaner_checkout_at ||
              (data as { status?: string } | null)?.status === 'completed';
            // Only apply if the cleaner hasn't already chosen — never yank the
            // control out from under a tap that landed while this was in flight.
            setPhotoType((current) => (typeInferredRef.current ? (checkedOut ? 'after' : 'before') : current));
          })();
        }
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          <Camera className="w-4 h-4" />
          Add Media
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Upload Cleaning Media</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex gap-2">
            <Button
              type="button"
              variant={mediaMode === 'photo' ? 'default' : 'outline'}
              size="sm"
              onClick={() => {
                setMediaMode('photo');
                resetPickerInputs();
              }}
              className="flex-1 gap-1.5"
            >
              <Camera className="w-4 h-4" />
              📷 Photo
            </Button>
            <Button
              type="button"
              variant={mediaMode === 'video' ? 'default' : 'outline'}
              size="sm"
              onClick={() => {
                setMediaMode('video');
                resetPickerInputs();
              }}
              className="flex-1 gap-1.5"
            >
              <Video className="w-4 h-4" />
              🎥 Video
            </Button>
          </div>

          <div>
            <div className="flex rounded-lg bg-muted p-1" role="group" aria-label="Photo stage">
              {(['before', 'after'] as const).map((t) => (
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
                  ? 'Job not finished yet. Filing as Before. Tap After to change.'
                  : 'Job is checked out. Filing as After. Tap Before to change.'
                : `Filing as ${photoType} for the rest of this upload.`}
            </p>
          </div>

          {mediaMode === 'video' && (
            <p className="text-xs text-muted-foreground text-center">Up to 2 minutes · MP4 or MOV · Max 100MB</p>
          )}

          <input
            ref={cameraPhotoInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            tabIndex={-1}
            className={PICKER_INPUT_CLASS}
            onChange={(event) => handleFileSelect(event, true)}
          />
          <input
            ref={libraryPhotoInputRef}
            type="file"
            accept="image/*"
            tabIndex={-1}
            className={PICKER_INPUT_CLASS}
            onChange={(event) => handleFileSelect(event, false)}
          />
          <input
            ref={cameraVideoInputRef}
            type="file"
            accept="video/mp4,video/quicktime,video/x-m4v,.mov,.mp4"
            capture="environment"
            tabIndex={-1}
            className={PICKER_INPUT_CLASS}
            onChange={(event) => handleFileSelect(event, true)}
          />
          <input
            ref={libraryVideoInputRef}
            type="file"
            accept="video/mp4,video/quicktime,video/x-m4v,.mov,.mp4"
            tabIndex={-1}
            className={PICKER_INPUT_CLASS}
            onChange={(event) => handleFileSelect(event, false)}
          />

          {mediaMode === 'photo' ? (
            isNative && Capacitor.isNativePlatform() ? (
              <div className="flex flex-col gap-3">
                <Button type="button" variant="outline" className="h-24 flex flex-col gap-2" onClick={handleNativeCamera} disabled={cameraLoading || saving}>
                  {cameraLoading || saving ? <Loader2 className="w-8 h-8 animate-spin" /> : <><Camera className="w-8 h-8" /><span>Take Photo</span></>}
                </Button>
                <Button type="button" variant="outline" className="h-24 flex flex-col gap-2" onClick={handleNativeGallery} disabled={cameraLoading || saving}>
                  <ImageIcon className="w-8 h-8" /><span>Choose from Gallery</span>
                </Button>
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                <Button type="button" variant="outline" className="h-24 flex flex-col gap-2" onClick={() => openPicker(cameraPhotoInputRef.current)} disabled={saving}>
                  <Camera className="w-8 h-8" /><span>Take Photo</span>
                </Button>
                <Button type="button" variant="outline" className="h-24 flex flex-col gap-2" onClick={() => openPicker(libraryPhotoInputRef.current)} disabled={saving}>
                  <ImageIcon className="w-8 h-8" /><span>Choose from Gallery</span>
                </Button>
              </div>
            )
          ) : (
            <div className="flex flex-col gap-3">
              <Button type="button" variant="outline" className="h-24 flex flex-col gap-2" onClick={() => openPicker(cameraVideoInputRef.current)} disabled={saving}>
                <Video className="w-8 h-8" /><span>Record Video</span>
              </Button>
              <Button type="button" variant="outline" className="h-24 flex flex-col gap-2" onClick={() => openPicker(libraryVideoInputRef.current)} disabled={saving}>
                <ImageIcon className="w-8 h-8" /><span>Choose from Library</span>
              </Button>
            </div>
          )}

          <p className="text-center text-xs text-muted-foreground">
            Each photo uploads on its own. It stays on this phone until it goes through, even if the signal drops.
          </p>
          {queueList}

          <Button variant="outline" className="w-full" onClick={() => setIsOpen(false)}>
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
    {!isOpen && queueList}
    </div>
  );
}
