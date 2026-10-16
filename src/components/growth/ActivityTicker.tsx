import { useEffect, useState } from 'react';
import { ACTIVITY_TICKER_INTERVAL_MS, tickerIndexAfterChange, tickerLines } from '@/lib/publicActivity';
import type { PublicActivityEvent } from '@/lib/publicActivity';

/** Rotating line of real events. Hidden when nothing happened in the last 24 hours. */
export function ActivityTicker({ events }: { events: PublicActivityEvent[] }) {
  const lines = tickerLines(events);
  const lineKey = lines.map((line) => `${line.kind}\u0000${line.text}`).join('\n');
  const count = lines.length;
  const [position, setPosition] = useState<{
    lineKey: string;
    index: number;
    shownText: string;
    shownKind: string;
  }>({
    lineKey,
    index: 0,
    shownText: lines[0]?.text ?? '',
    shownKind: lines[0]?.kind ?? '',
  });

  const remembered = { text: position.shownText, kind: position.shownKind };
  const synced = position.lineKey === lineKey;
  const index = synced
    ? (count === 0 ? 0 : position.index % count)
    : tickerIndexAfterChange(lines, remembered);
  const line = count === 0 ? null : lines[index];

  // Remember the sentence on screen. When the lines change, continue at the
  // next line whose kind differs from the one that was showing.
  if (!synced) {
    setPosition({
      lineKey,
      index,
      shownText: line?.text ?? '',
      shownKind: line?.kind ?? '',
    });
  } else if (line && (line.text !== position.shownText || line.kind !== position.shownKind)) {
    setPosition({
      lineKey,
      index,
      shownText: line.text,
      shownKind: line.kind,
    });
  }

  useEffect(() => {
    if (count < 2) return;
    const timer = window.setInterval(() => {
      setPosition((current) => {
        if (current.lineKey !== lineKey) return current;
        return { ...current, index: (current.index + 1) % count };
      });
    }, ACTIVITY_TICKER_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [lineKey, count]);

  if (!line) return null;

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
        {line.text}
      </p>
    </div>
  );
}
