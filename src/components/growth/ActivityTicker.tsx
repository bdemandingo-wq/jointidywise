import { useEffect, useState } from 'react';
import { ACTIVITY_TICKER_INTERVAL_MS, tickerLines } from '@/lib/publicActivity';
import type { PublicActivityEvent } from '@/lib/publicActivity';

/** Rotating line of real events. Hidden when nothing happened in the last 24 hours. */
export function ActivityTicker({ events }: { events: PublicActivityEvent[] }) {
  const lines = tickerLines(events);
  const lineKey = lines.join('\n');
  const count = lines.length;
  const [position, setPosition] = useState({ lineKey, index: 0 });

  // An aged-out event replaces the lines. Start at the first sentence so the
  // old index cannot land on the same kind that was just showing.
  if (position.lineKey !== lineKey) {
    setPosition({ lineKey, index: 0 });
  }

  useEffect(() => {
    if (count < 2) return;
    const timer = window.setInterval(() => {
      setPosition((current) => ({
        lineKey,
        index: ((current.lineKey === lineKey ? current.index : 0) + 1) % count,
      }));
    }, ACTIVITY_TICKER_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [lineKey, count]);

  if (count === 0) return null;
  const index = position.lineKey === lineKey ? position.index : 0;
  const line = lines[index % count];

  return (
    <div
      className="fixed bottom-4 left-1/2 z-40 w-[min(100%-2rem,36rem)] -translate-x-1/2"
      style={{ marginBottom: 'env(safe-area-inset-bottom)' }}
    >
      <p
        role="status"
        aria-live="polite"
        className="rounded-full border border-border bg-background/95 px-4 py-2 text-center text-sm text-foreground shadow-lg backdrop-blur"
      >
        {line}
      </p>
    </div>
  );
}
