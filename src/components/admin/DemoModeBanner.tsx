import { useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { purgeDemoQueries } from '@/lib/demo/cache';
import { useOrgDemoToggle } from '@/lib/demo/useOrgDemoToggle';
import { endPublicDemo, isPublicDemoActive, isSampleDemoOn, subscribeDemoMode } from '@/lib/demo/session';

const BANNER_COPY =
  'Demo mode is on. Real texts and emails to your customers and team are paused, including booking confirmations.';

export function DemoModeBanner() {
  const on = useSyncExternalStore(subscribeDemoMode, isSampleDemoOn, () => false);
  const publicDemo = useSyncExternalStore(subscribeDemoMode, isPublicDemoActive, () => false);
  const { toggle } = useOrgDemoToggle();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const bannerRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const el = bannerRef.current;
    if (!on || !el) {
      document.documentElement.style.removeProperty('--demo-banner-h');
      return;
    }
    const apply = () => {
      document.documentElement.style.setProperty('--demo-banner-h', `${el.offsetHeight}px`);
    };
    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(el);
    return () => {
      observer.disconnect();
      document.documentElement.style.removeProperty('--demo-banner-h');
    };
  }, [on]);

  if (!on) return null;

  const turnOff = async () => {
    if (busy) return;
    setBusy(true);
    try {
      if (publicDemo) {
        endPublicDemo();
        purgeDemoQueries(queryClient);
        return;
      }
      await toggle();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      ref={bannerRef}
      role="status"
      className="sticky top-0 z-40 border-b border-amber-700 bg-amber-400 pt-[env(safe-area-inset-top)] text-amber-950"
    >
      <div className="flex flex-col gap-2 px-3 py-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
        <p className="min-w-0 text-sm font-medium leading-5">
          {BANNER_COPY}
        </p>
        <button
          type="button"
          onClick={() => { void turnOff(); }}
          disabled={busy}
          className="inline-flex min-h-[44px] w-full shrink-0 items-center justify-center rounded-md bg-amber-950 px-4 text-sm font-semibold text-amber-50 disabled:opacity-70 sm:w-auto"
        >
          Turn off demo mode
        </button>
      </div>
    </div>
  );
}
