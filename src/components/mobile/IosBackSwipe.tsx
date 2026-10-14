import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { isNativeIos } from '@/lib/nativeShell';

/**
 * Left-edge swipe pops router history. WKWebView's own back gesture is also
 * on. If that gesture already popped the history entry, this handler does
 * not pop a second time.
 */
export function IosBackSwipe() {
  const navigate = useNavigate();

  useEffect(() => {
    if (!isNativeIos()) return;

    let startX = 0;
    let startY = 0;
    let tracking = false;
    let popped = false;

    const onPop = () => {
      popped = true;
    };

    const onStart = (event: TouchEvent) => {
      const touch = event.touches[0];
      if (!touch) return;
      tracking = touch.clientX <= 24;
      startX = touch.clientX;
      startY = touch.clientY;
      popped = false;
    };

    const onMove = (event: TouchEvent) => {
      if (!tracking) return;
      const touch = event.touches[0];
      if (!touch) return;
      const dx = touch.clientX - startX;
      const dy = Math.abs(touch.clientY - startY);
      if (dy > 48 && dy > dx) tracking = false;
    };

    const onEnd = (event: TouchEvent) => {
      if (!tracking) return;
      tracking = false;
      const touch = event.changedTouches[0];
      if (!touch) return;
      const dx = touch.clientX - startX;
      const dy = Math.abs(touch.clientY - startY);
      if (dx < 72 || dy > 80) return;
      if (window.history.length <= 1) return;
      window.setTimeout(() => {
        if (popped) return;
        navigate(-1);
      }, 60);
    };

    window.addEventListener('popstate', onPop);
    document.addEventListener('touchstart', onStart, { passive: true });
    document.addEventListener('touchmove', onMove, { passive: true });
    document.addEventListener('touchend', onEnd, { passive: true });
    return () => {
      window.removeEventListener('popstate', onPop);
      document.removeEventListener('touchstart', onStart);
      document.removeEventListener('touchmove', onMove);
      document.removeEventListener('touchend', onEnd);
    };
  }, [navigate]);

  return null;
}
