import { useSyncExternalStore } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { FlaskConical } from 'lucide-react';
import { purgeDemoQueries } from '@/lib/demo/cache';
import { endPublicDemo, isPublicDemoActive, isSampleDemoOn, subscribeDemoMode } from '@/lib/demo/session';

export function DemoModeBanner() {
  const on = useSyncExternalStore(subscribeDemoMode, isSampleDemoOn, () => false);
  const publicDemo = useSyncExternalStore(subscribeDemoMode, isPublicDemoActive, () => false);
  const queryClient = useQueryClient();
  if (!on) return null;

  const leave = () => {
    endPublicDemo();
    purgeDemoQueries(queryClient);
  };

  return (
    <div className="sticky top-0 z-40 bg-amber-400 text-amber-950 px-3 py-2 text-center text-sm font-medium">
      <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1">
        <span className="inline-flex items-center gap-2">
          <FlaskConical className="w-4 h-4 shrink-0" />
          <span className="rounded bg-amber-950 px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-amber-100">Demo</span>
          Sample data only. Texts, email, payments, and edits are turned off.
        </span>
        {publicDemo && (
          <>
            <Link to="/signup" onClick={leave} className="underline underline-offset-2 font-semibold">
              Start free trial
            </Link>
            <Link to="/" onClick={leave} className="underline underline-offset-2">
              Exit
            </Link>
          </>
        )}
      </div>
    </div>
  );
}
