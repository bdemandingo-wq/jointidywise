import { activitySentence } from '@/lib/publicActivity';
import type { PublicActivityEvent } from '@/lib/publicActivity';

/** Dashboard card. Fewer events show as a shorter list. None hides the card. */
export function ActivityFeedCard({ events }: { events: PublicActivityEvent[] }) {
  const lines = events
    .map((event) => activitySentence(event))
    .filter((line): line is string => Boolean(line))
    .slice(0, 4);

  if (lines.length === 0) return null;

  return (
    <section className="mb-4 rounded-xl border border-border bg-card p-4 shadow-sm">
      <h2 className="text-sm font-semibold text-foreground">Happening on TidyWise</h2>
      <ul className="mt-3 space-y-2">
        {lines.map((line, index) => (
          <li key={`${index}-${line}`} className="text-sm text-muted-foreground">
            {line}
          </li>
        ))}
      </ul>
    </section>
  );
}
