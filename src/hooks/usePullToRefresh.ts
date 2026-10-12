import { useState, useRef, useCallback } from 'react';

/**
 * Native-feel pull-to-refresh hook for touch devices.
 * Returns handlers to attach to a scrollable container and a refreshing state.
 */
export function usePullToRefresh(onRefresh: () => Promise<void>) {
  const [refreshing, setRefreshing] = useState(false);
  const [pullDistance, setPullDistance] = useState(0);
  const startY = useRef<number | null>(null);
  const scrollTop = useRef(0);

  const threshold = 64;
  // The last move and the finger-up can land in the same frame, before React
  // has committed pullDistance into the handler closure. A ref is what the
  // gesture actually reached.
  const pullDistanceRef = useRef(0);
  const refreshingRef = useRef(false);

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    // Support both inner scroll containers and body-scrolled pages
    scrollTop.current = (e.currentTarget as HTMLElement).scrollTop || window.scrollY;
    if (scrollTop.current <= 0) {
      startY.current = e.touches[0].clientY;
    }
  }, []);

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    if (startY.current === null || refreshingRef.current) return;
    const currentY = e.touches[0].clientY;
    const dy = currentY - startY.current;
    if (dy > 0 && scrollTop.current <= 0) {
      // Apply resistance
      const next = Math.min(dy * 0.4, threshold * 1.5);
      pullDistanceRef.current = next;
      setPullDistance(next);
    }
  }, []);

  const onTouchEnd = useCallback(async () => {
    const distance = pullDistanceRef.current;
    if (distance >= threshold && !refreshingRef.current) {
      refreshingRef.current = true;
      setRefreshing(true);
      try {
        await onRefresh();
      } finally {
        refreshingRef.current = false;
        setRefreshing(false);
      }
    }
    pullDistanceRef.current = 0;
    setPullDistance(0);
    startY.current = null;
  }, [onRefresh]);

  return {
    refreshing,
    pullDistance,
    handlers: { onTouchStart, onTouchMove, onTouchEnd },
  };
}
