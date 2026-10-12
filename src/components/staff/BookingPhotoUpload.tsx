import { useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { Camera, X, CheckCircle, Loader2, ImageIcon, Video } from 'lucide-react';
import { Capacitor } from '@capacitor/core';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Progress } from '@/components/ui/progress';
import { supabase } from '@/lib/supabase';
import { uploadBookingMedia, getUploadErrorMessage } from '@/lib/bookingMediaUpload';
import { toast } from 'sonner';
import { useNativeCamera } from '@/hooks/useNativeCamera';

interface BookingPhotoUploadProps {
  bookingId: string;
  staffId: string;
  organizationId: string;
  onPhotoUploaded?: (path: string) => void;
}

const PHOTO_MAX_SIZE = 10 * 1024 * 1024;
const VIDEO_MAX_SIZE = 100 * 1024 * 1024;
const ALLOWED_PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic'];
const ALLOWED_VIDEO_TYPES = ['video/mp4', 'video/quicktime', 'video/x-m4v'];
const PICKER_INPUT_CLASS = 'absolute left-0 top-0 h-px w-px opacity-0 pointer-events-none';

type MediaMode = 'photo' | 'video';

function formatFileSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

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
    if (!ALLOWED_PHOTO_TYPES.includes(file.type) && !file.name.toLowerCase().endsWith('.heic')) {
      return 'Only JPG, PNG, WebP and HEIC photos are supported.';
    }

    if (file.size > PHOTO_MAX_SIZE) {
      return 'Photo must be under 10MB. Please try again with a smaller image.';
    }

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
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  // Inferred from job state on open, not hardcoded. The old default was
  // 'after', so a cleaner photographing the mess on arrival filed it as
  // 'after' unless they actively tapped Before — which is most of why
  // everything ended up in one column.
  const [photoType, setPhotoType] = useState<'before' | 'after'>('before');
  const [typeInferred, setTypeInferred] = useState(true);
  const [mediaMode, setMediaMode] = useState<MediaMode>('photo');
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [captureExif, setCaptureExif] = useState<unknown>(null);
  const [liveCapture, setLiveCapture] = useState(false);
  const [videoDuration, setVideoDuration] = useState<number | null>(null);

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

  const clearPreview = () => {
    if (previewUrl?.startsWith('blob:')) {
      URL.revokeObjectURL(previewUrl);
    }

    setPreviewUrl(null);
    setSelectedFile(null);
    setCaptureExif(null);
    setLiveCapture(false);
    setVideoDuration(null);
    resetPickerInputs();
  };

  const setPreviewForFile = (file: File, nextPreviewUrl: string, exif?: unknown, fromCamera = false) => {
    const validationError = getValidationError(file, mediaMode);
    if (validationError) {
      if (nextPreviewUrl.startsWith('blob:')) {
        URL.revokeObjectURL(nextPreviewUrl);
      }
      toast.error(validationError, { duration: 6000 });
      return;
    }

    if (previewUrl?.startsWith('blob:')) {
      URL.revokeObjectURL(previewUrl);
    }

    setSelectedFile(file);
    setCaptureExif(exif ?? null);
    setLiveCapture(fromCamera);
    setPreviewUrl(nextPreviewUrl);
    setVideoDuration(null);

    if (file.type.startsWith('video/') || file.name.toLowerCase().endsWith('.mov')) {
      const video = document.createElement('video');
      video.preload = 'metadata';
      video.onloadedmetadata = () => {
        setVideoDuration(Math.round(video.duration));
      };
      video.src = nextPreviewUrl;
    }
  };

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>, fromCamera: boolean) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    const objectUrl = URL.createObjectURL(file);
    setPreviewForFile(file, objectUrl, undefined, fromCamera);
  };

  const handleNativeCamera = async () => {
    const result = await takePicture('camera');
    if (result?.file && result.dataUrl) {
      setPreviewForFile(result.file, result.dataUrl, result.exif, true);
    }
  };

  const handleNativeGallery = async () => {
    const result = await pickFromGallery();
    if (result?.file && result.dataUrl) {
      setPreviewForFile(result.file, result.dataUrl, result.exif, false);
    }
  };

  const handleUpload = async () => {
    if (!selectedFile) return;

    setUploading(true);
    setUploadProgress(0);

    const progressInterval = setInterval(() => {
      setUploadProgress((prev) => {
        if (prev >= 90) {
          clearInterval(progressInterval);
          return 90;
        }
        return prev + (mediaMode === 'video' ? 2 : 10);
      });
    }, mediaMode === 'video' ? 500 : 200);

    try {
      // The booking lookup and org resolution moved into uploadBookingMedia —
      // doing it here as well was two round-trips for the same row.
      const { filePath } = await uploadBookingMedia({
        file: selectedFile,
        bookingId,
        staffId,
        photoType,
        organizationIdFallback: organizationId,
        captureExif,
        liveCapture: liveCapture && mediaMode === 'photo',
      });

      clearInterval(progressInterval);
      setUploadProgress(100);

      toast.success(mediaMode === 'video' ? 'Video uploaded successfully!' : 'Photo uploaded successfully!');
      setIsOpen(false);
      clearPreview();
      setUploadProgress(0);
      onPhotoUploaded?.(filePath);
    } catch (error) {
      clearInterval(progressInterval);
      setUploadProgress(0);
      console.error('Upload error:', error);


      toast.error(getUploadErrorMessage(error, mediaMode === 'video'), { duration: 6000 });
    } finally {
      setUploading(false);
    }
  };

  const isVideo = selectedFile?.type?.startsWith('video/') || selectedFile?.name?.toLowerCase().endsWith('.mov');

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        setIsOpen(open);
        if (!open) clearPreview();
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
                clearPreview();
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
                clearPreview();
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

          {!previewUrl ? (
            mediaMode === 'photo' ? (
              isNative && Capacitor.isNativePlatform() ? (
                <div className="flex flex-col gap-3">
                  <Button type="button" variant="outline" className="h-24 flex flex-col gap-2" onClick={handleNativeCamera} disabled={cameraLoading || uploading}>
                    {cameraLoading ? <Loader2 className="w-8 h-8 animate-spin" /> : <><Camera className="w-8 h-8" /><span>Take Photo</span></>}
                  </Button>
                  <Button type="button" variant="outline" className="h-24 flex flex-col gap-2" onClick={handleNativeGallery} disabled={cameraLoading || uploading}>
                    <ImageIcon className="w-8 h-8" /><span>Choose from Gallery</span>
                  </Button>
                </div>
              ) : (
                <div className="flex flex-col gap-3">
                  <Button type="button" variant="outline" className="h-24 flex flex-col gap-2" onClick={() => openPicker(cameraPhotoInputRef.current)} disabled={uploading}>
                    <Camera className="w-8 h-8" /><span>Take Photo</span>
                  </Button>
                  <Button type="button" variant="outline" className="h-24 flex flex-col gap-2" onClick={() => openPicker(libraryPhotoInputRef.current)} disabled={uploading}>
                    <ImageIcon className="w-8 h-8" /><span>Choose from Gallery</span>
                  </Button>
                </div>
              )
            ) : (
              <div className="flex flex-col gap-3">
                <Button type="button" variant="outline" className="h-24 flex flex-col gap-2" onClick={() => openPicker(cameraVideoInputRef.current)} disabled={uploading}>
                  <Video className="w-8 h-8" /><span>Record Video</span>
                </Button>
                <Button type="button" variant="outline" className="h-24 flex flex-col gap-2" onClick={() => openPicker(libraryVideoInputRef.current)} disabled={uploading}>
                  <ImageIcon className="w-8 h-8" /><span>Choose from Library</span>
                </Button>
              </div>
            )
          ) : (
            <div className="relative">
              {isVideo ? (
                <video
                  src={previewUrl}
                  controls
                  className="w-full max-h-48 rounded-lg bg-black"
                  playsInline
                />
              ) : (
                <img src={previewUrl} alt="Preview" className="w-full h-48 object-cover rounded-lg" height={192} />
              )}
              <Button type="button" variant="destructive" size="icon" className="absolute top-2 right-2 w-8 h-8" onClick={clearPreview}>
                <X className="w-4 h-4" />
              </Button>
              {selectedFile && (
                <div className="mt-2 flex items-center gap-3 text-xs text-muted-foreground">
                  <span>{formatFileSize(selectedFile.size)}</span>
                  {videoDuration != null && (
                    <span>{Math.floor(videoDuration / 60)}:{String(videoDuration % 60).padStart(2, '0')}</span>
                  )}
                </div>
              )}
            </div>
          )}

          {uploading && (
            <div className="space-y-1">
              <Progress value={uploadProgress} className="h-2" />
              <p className="text-xs text-muted-foreground text-center">Uploading... {uploadProgress}%</p>
            </div>
          )}

          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" onClick={() => setIsOpen(false)}>
              Cancel
            </Button>
            <Button className="flex-1 gap-2" onClick={handleUpload} disabled={!selectedFile || uploading}>
              {uploading ? (
                <><Loader2 className="w-4 h-4 animate-spin" />Uploading...</>
              ) : (
                <><CheckCircle className="w-4 h-4" />Upload {mediaMode === 'video' ? 'Video' : 'Photo'}</>
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
