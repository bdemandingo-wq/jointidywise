import { useEffect, useState } from 'react';
import { activitySentence } from '@/lib/publicActivity';
import type { PublicActivityEvent } from '@/lib/publicActivity';

/** Rotating line of real events. Hidden when there is nothing to show. */
export function ActivityTicker({ events }: { events: PublicActivityEvent[] }) {
  const lines = events
    .map((event) => activitySentence(event))
    .filter((line): line is string => Boolean(line));
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (lines.length < 2) return;
    const timer = window.setInterval(() => {
      setIndex((current) => (current + 1) % lines.length);
    }, 5000);
    return () => window.clearInterval(timer);
  }, [lines.length]);

  if (lines.length === 0) return null;
  const line = lines[index % lines.length];

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
