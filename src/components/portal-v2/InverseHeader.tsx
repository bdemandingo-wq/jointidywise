import { Menu, Bell, TrendingDown, TrendingUp } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * §2 (1b): the admin hero. Navy, with radius.hero on the bottom corners only —
 * it is flush to the top of the screen, so the shape reads as a header rather
 * than a card.
 *
 * §3 rule 1: the revenue figure is stat.xl and owns the screen; everything in
 * StatWellRow is several steps down. §3 rule 2: this is the one navy surface.
 *
 * §5.1: `revenue` is a string. Zero is a real answer for an empty period and
 * renders as $0.00 — but on FAILURE the caller passes `error`, which replaces
 * the figure entirely. Never $0.00 on a failed read.
 */
export function InverseHeader({
  eyebrow,
  business,
  revenueLabel,
  revenue,
  trend,
  wells,
  notifications = 0,
  error = false,
  onRetry,
}: {
  eyebrow: string;
  business: string;
  revenueLabel: string;
  revenue?: string;
  trend?: { direction: 'up' | 'down'; label: string };
  wells: React.ReactNode;
  notifications?: number;
  error?: boolean;
  onRetry?: () => void;
}) {
  const badge = notifications > 9 ? '9+' : String(notifications);

  return (
    <header className="rounded-b-[26px] bg-[hsl(var(--pv-inverse))] px-5 pb-4 pt-[calc(env(safe-area-inset-top,0px)+1rem)] dark:border-b dark:border-[hsl(var(--pv-inverse-border))]">
      <div className="flex items-center gap-3">
        <button
          type="button"
          aria-label="Menu"
          className="flex h-11 w-11 items-center justify-center rounded-full bg-[hsl(var(--pv-inverse-well))] text-[hsl(var(--pv-on-inverse))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--pv-on-inverse))]"
        >
          <Menu className="h-[18px] w-[18px]" aria-hidden />
        </button>
        <div className="min-w-0 flex-1">
          <p className="text-[10.5px] font-extrabold uppercase tracking-[0.08em] text-[hsl(var(--pv-on-inverse-muted))]">
            {eyebrow}
          </p>
          <p className="truncate text-[15px] font-extrabold text-[hsl(var(--pv-on-inverse))]">
            {business}
          </p>
        </div>
        <button
          type="button"
          aria-label={notifications > 0 ? `Notifications, ${badge} unread` : 'Notifications'}
          className="relative flex h-11 w-11 items-center justify-center rounded-full bg-[hsl(var(--pv-inverse-well))] text-[hsl(var(--pv-on-inverse))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--pv-on-inverse))]"
        >
          <Bell className="h-[18px] w-[18px]" aria-hidden />
          {notifications > 0 && (
            <span
              aria-hidden
              className="absolute -right-0.5 -top-0.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-[hsl(var(--pv-danger))] px-1 text-[10px] font-extrabold tabular-nums text-[hsl(var(--destructive-foreground))]"
            >
              {badge}
            </span>
          )}
        </button>
      </div>

      <div className="mt-4">
        <p className="text-[10.5px] font-extrabold uppercase tracking-[0.08em] text-[hsl(var(--pv-on-inverse-muted))]">
          {revenueLabel}
        </p>
        {error ? (
          <div role="alert">
            <p className="mt-1 text-[17px] font-extrabold text-[hsl(var(--pv-on-inverse))]">
              Couldn&rsquo;t load revenue
            </p>
            <button
              type="button"
              onClick={onRetry}
              className="mt-1 text-[11.5px] font-bold text-[hsl(var(--pv-link-on-inverse))] underline-offset-2 hover:underline"
            >
              Retry
            </button>
          </div>
        ) : (
          <div className="mt-1 flex items-end gap-2.5">
            <p className="text-[32px] font-extrabold leading-none tracking-[-0.02em] tabular-nums text-[hsl(var(--pv-on-inverse))]">
              {revenue}
            </p>
            {trend && (
              <span
                className={cn(
                  'mb-0.5 flex items-center gap-1 rounded-full px-2 py-[3px] text-[10.5px] font-bold tabular-nums',
                  'bg-[hsl(var(--pv-inverse-well))]',
                  trend.direction === 'down'
                    ? 'text-[hsl(var(--pv-orange-alert))]'
                    : 'text-[hsl(var(--pv-on-inverse))]',
                )}
              >
                {trend.direction === 'down' ? (
                  <TrendingDown className="h-3 w-3" aria-hidden />
                ) : (
                  <TrendingUp className="h-3 w-3" aria-hidden />
                )}
                {trend.label}
              </span>
            )}
          </div>
        )}
      </div>

      <div className="mt-3.5 flex gap-2">{wells}</div>
    </header>
  );
}
