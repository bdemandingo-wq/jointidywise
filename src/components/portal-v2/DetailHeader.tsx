import { ChevronLeft } from 'lucide-react';
import { StatusBadge } from './StatusBadge';

/** §2 (1c, 3a, 3b): circular back + title + sub + optional trailing badge. */
export function DetailHeader({
  title,
  sub,
  badge,
  onBack,
}: {
  title: string;
  sub?: string;
  badge?: { tone: 'info' | 'success' | 'warn' | 'danger'; label: string };
  onBack?: () => void;
}) {
  return (
    <header className="flex items-center gap-3 px-5 pb-3 pt-[calc(env(safe-area-inset-top,0px)+1rem)]">
      <button
        type="button"
        onClick={onBack}
        aria-label="Back"
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[hsl(var(--pv-border))] bg-[hsl(var(--pv-surface))] text-[hsl(var(--pv-ink))] transition-colors duration-150 ease-out active:bg-[hsl(var(--pv-sunken))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--pv-brand))] focus-visible:ring-offset-2 focus-visible:ring-offset-[hsl(var(--pv-bg))]"
      >
        <ChevronLeft className="h-5 w-5" aria-hidden />
      </button>
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-[17px] font-extrabold leading-tight text-[hsl(var(--pv-ink))]">
          {title}
        </h1>
        {sub && (
          <p className="truncate text-[11.5px] font-medium text-[hsl(var(--pv-ink-3))]">
            {sub}
          </p>
        )}
      </div>
      {badge && <StatusBadge tone={badge.tone} label={badge.label} />}
    </header>
  );
}
