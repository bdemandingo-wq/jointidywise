import { CheckCircle, Loader2, RotateCcw, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SignedImage } from '@/components/ui/signed-image';
import type { PhotoQueueItem } from '@/lib/photoUploadQueue';

function isVideoName(item: PhotoQueueItem): boolean {
  return item.mimeType.startsWith('video/') || item.fileName.toLowerCase().endsWith('.mov');
}

export function PhotoUploadQueueList({
  items,
  onRetry,
  onDismiss,
}: {
  items: PhotoQueueItem[];
  onRetry: (id: string) => void;
  onDismiss: (id: string) => void;
}) {
  if (!items.length) return null;

  return (
    <div className="space-y-2" aria-live="polite">
      {items.map((item) => (
        <div key={item.id} className="flex items-center gap-3 rounded-lg border p-2">
          <div className="h-12 w-12 flex-shrink-0 overflow-hidden rounded bg-muted">
            {item.status === 'done' && item.remotePath && !isVideoName(item) ? (
              <SignedImage
                src={item.remotePath}
                bucket="booking-photos"
                alt=""
                className="h-full w-full object-cover"
                fallback={<div className="flex h-full w-full items-center justify-center text-[10px] text-muted-foreground">Saved</div>}
              />
            ) : item.previewUrl && !isVideoName(item) ? (
              <img src={item.previewUrl} alt="" className="h-full w-full object-cover" width={48} height={48} />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-[10px] text-muted-foreground">
                {isVideoName(item) ? 'Video' : 'Photo'}
              </div>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs">{item.fileName}</p>
            <p className="text-xs capitalize text-muted-foreground">{item.photoType}</p>
            {item.status === 'pending' && (
              <p className="text-xs text-muted-foreground">
                {item.attempts > 0 ? `Saved on this phone. Retrying…` : 'Saved on this phone. Waiting to upload.'}
              </p>
            )}
            {item.status === 'uploading' && (
              <p className="flex items-center gap-1 text-xs text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" />
                Uploading…
              </p>
            )}
            {item.status === 'done' && (
              <p className="flex items-center gap-1 text-xs text-primary">
                <CheckCircle className="h-3 w-3" />
                Uploaded
              </p>
            )}
            {item.status === 'error' && (
              <div className="flex items-center gap-2">
                <p className="truncate text-xs text-destructive">{item.error || 'Upload failed. Try again.'}</p>
                <Button type="button" size="sm" variant="ghost" className="h-7 gap-1 text-xs" onClick={() => onRetry(item.id)}>
                  <RotateCcw className="h-3 w-3" />
                  Retry
                </Button>
              </div>
            )}
          </div>
          {item.status !== 'uploading' && (
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="h-7 w-7"
              aria-label={item.status === 'done' ? 'Hide uploaded photo' : 'Remove photo from queue'}
              onClick={() => onDismiss(item.id)}
            >
              <X className="h-3 w-3" />
            </Button>
          )}
        </div>
      ))}
    </div>
  );
}
