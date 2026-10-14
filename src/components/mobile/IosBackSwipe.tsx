import { useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { IOS_BACK_SWIPE_SETTLE_MS, isIosBackSwipeRoot } from '@/lib/iosBackSwipe';
import { isNativeIos } from '@/lib/nativeShell';

/**
 * Left-edge swipe on screens that are not a tab or portal root.
 *
 * AppDelegate sets allowsBackForwardNavigationGestures, so WKWebView
 * already pops the history entry for this gesture. A second navigate(-1)
 * would skip a page. The path is recorded at touchstart; the JS pop runs
 * only if that path is still current after the web view has had time to
 * move it.
 */
export function IosBackSwipe() {
  const navigate = useNavigate();
  const location = useLocation();
  const pathRef = useRef(location.pathname);
  pathRef.current = location.pathname;

  useEffect(() => {
    if (!isNativeIos()) return;

    let startX = 0;
    let startY = 0;
    let tracking = false;
    let startPath = '';

    const onStart = (event: TouchEvent) => {
      const touch = event.touches[0];
      if (!touch || isIosBackSwipeRoot(pathRef.current)) {
        tracking = false;
        return;
      }
      tracking = touch.clientX <= 24;
      startX = touch.clientX;
      startY = touch.clientY;
      startPath = pathRef.current;
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
      if (isIosBackSwipeRoot(startPath) || isIosBackSwipeRoot(pathRef.current)) return;
      if (window.history.length <= 1) return;
      const pathAtGesture = startPath;
      window.setTimeout(() => {
        if (pathRef.current !== pathAtGesture) return;
        if (isIosBackSwipeRoot(pathRef.current)) return;
        if (window.history.length <= 1) return;
        navigate(-1);
      }, IOS_BACK_SWIPE_SETTLE_MS);
    };

    document.addEventListener('touchstart', onStart, { passive: true });
    document.addEventListener('touchmove', onMove, { passive: true });
    document.addEventListener('touchend', onEnd, { passive: true });
    return () => {
      document.removeEventListener('touchstart', onStart);
      document.removeEventListener('touchmove', onMove);
      document.removeEventListener('touchend', onEnd);
    };
  }, [navigate]);

  return null;
}
