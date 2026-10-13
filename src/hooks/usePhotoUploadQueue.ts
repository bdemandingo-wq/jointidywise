import { useEffect, useMemo, useSyncExternalStore } from 'react';
import {
  dismissQueuedPhoto,
  enqueueBookingPhoto,
  getPhotoQueueSnapshot,
  retryQueuedPhoto,
  subscribePhotoQueue,
  type EnqueueBookingPhotoInput,
  type PhotoQueueItem,
} from '@/lib/photoUploadQueue';
import { kickPhotoUploadRunner, startPhotoUploadQueue } from '@/lib/photoUploadRunner';

export function usePhotoUploadQueue(filter?: { staffId?: string; bookingId?: string }) {
  const items = useSyncExternalStore(subscribePhotoQueue, getPhotoQueueSnapshot, getPhotoQueueSnapshot);

  useEffect(() => {
    startPhotoUploadQueue();
  }, []);

  const visible = useMemo(
    () => items.filter((item) => (
      (!filter?.staffId || item.staffId === filter.staffId)
      && (!filter?.bookingId || item.bookingId === filter.bookingId)
    )),
    [items, filter?.staffId, filter?.bookingId],
  );

  return {
    items: visible,
    enqueue: async (input: EnqueueBookingPhotoInput): Promise<PhotoQueueItem> => {
      const item = await enqueueBookingPhoto(input);
      kickPhotoUploadRunner();
      return item;
    },
    retry: async (id: string) => {
      await retryQueuedPhoto(id);
      kickPhotoUploadRunner();
    },
    dismiss: (id: string) => dismissQueuedPhoto(id),
  };
}
