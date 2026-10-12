import { useEffect, useRef, type PointerEvent as ReactPointerEvent } from 'react';

/**
 * Left/right move a gallery. Escape closes it.
 *
 * The listener is on window in the capture phase and stops the event, so
 * Escape cannot continue to another handler that logs the user out.
 */
export function useGalleryNavigation(
  open: boolean,
  onStep: (delta: number) => void,
  onClose: () => void,
) {
  const stepRef = useRef(onStep);
  const closeRef = useRef(onClose);
  stepRef.current = onStep;
  closeRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' && event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable) return;

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();

      if (event.key === 'Escape') closeRef.current();
      else stepRef.current(event.key === 'ArrowLeft' ? -1 : 1);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open]);

  const swipeRef = useRef<{ x: number; y: number; pointerType: string } | null>(null);

  const onPointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.pointerType === 'mouse') return;
    const target = event.target as HTMLElement | null;
    if (target?.closest('button, a')) return;
    swipeRef.current = { x: event.clientX, y: event.clientY, pointerType: event.pointerType };
  };

  const onPointerUp = (event: ReactPointerEvent<HTMLElement>) => {
    const start = swipeRef.current;
    swipeRef.current = null;
    if (!start) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (Math.abs(dx) < 48 || Math.abs(dx) < Math.abs(dy)) return;
    // Swipe left reveals the next photo, the same direction as the Photos app.
    stepRef.current(dx < 0 ? 1 : -1);
  };

  const onPointerCancel = () => {
    swipeRef.current = null;
  };

  return { onPointerDown, onPointerUp, onPointerCancel };
}
