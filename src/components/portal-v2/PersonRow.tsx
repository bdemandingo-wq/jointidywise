import { MoreHorizontal } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Avatar } from './Avatar';
import { StatusBadge } from './StatusBadge';

/**
 * A person in a list. Sibling of ListRow — it shares the same fixed 46px lead
 * gutter (§3 rule 13) so the two align in a single list — but the trailing half
 * is different enough to be its own component rather than a ListRow variant.
 *
 * WHAT /dashboard/staff ACTUALLY SHOWS PER PERSON, which is not what a
 * "PersonRow" sounds like:
 *
 *   avatar      initials, hue derived from the name
 *   name        the person's name
 *   pay rate    "$28/hr" — gated on hasFinancialAccess. The row renders the
 *               rate the caller is allowed to show rather than dropping the field
 *   tax class   a 1099 / W-2 badge
 *   inactive    NOT a status pill — the whole row dims, the border goes dashed
 *               and the avatar goes greyscale
 *   actions     a kebab menu with four items, not one action
 *
 * Notably there is NO ROLE on this screen. Role belongs to org members
 * (owner / manager), which is a different list. So `facts` and `badges` are
 * slots rather than named fields — the screens disagree about what a person's
 * two or three salient facts are, and hardcoding staff's choices would make
 * every other caller fight the component.
 *
 * §5.1: `inactive` is a real, deliberate state with its own look, so a row
 * whose data FAILED must never fall back to it — a failed read rendering as a
 * greyed-out dashed row says "this person is deactivated", which is a claim.
 * Use `state="error"` instead; it keeps the row present and says what happened.
 */
export function PersonRow({
  name,
  facts,
  lines,
  badges,
  inactive,
  state = 'ready',
  onClick,
  actions,
  onRetry,
  className,
}: {
  name: string;
  /** Short salient facts — "$28/hr", "3 jobs today". Pre-formatted by the caller. */
  facts?: string[];
  /* Long-form fields that get their own line instead of joining the wrapped
     facts row. The desktop customers table has Contact and Address columns;
     at 390px an email, a phone and a street address dropped into the same
     wrap row read as one run-on string. Short scannable values —
     "24 bookings", "$3,180.00" — still belong in `facts`. */
  lines?: string[];
  badges?: { tone: 'info' | 'success' | 'warn' | 'danger'; label: string }[];
  inactive?: boolean;
  state?: 'ready' | 'error';
  onClick?: () => void;
  /** A kebab menu, a button, whatever this screen owns. */
  actions?: React.ReactNode;
  onRetry?: () => void;
  className?: string;
}) {
  if (state === 'error') {
    return (
      <div
        role="alert"
        className={cn('flex min-h-[56px] w-full items-center gap-3 px-1 py-2', className)}
      >
        <span className="flex w-[46px] shrink-0 justify-center">
          <span
            aria-hidden
            className="h-9 w-9 rounded-full border border-dashed border-[hsl(var(--pv-border-strong))]"
          />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-bold text-[hsl(var(--pv-ink))]">
            {name}
          </span>
          <span className="block text-[11.5px] font-normal text-[hsl(var(--pv-ink-3))]">
            Couldn&rsquo;t load their details
          </span>
        </span>
        <button
          type="button"
          onClick={onRetry}
          className="shrink-0 text-[11.5px] font-bold text-[hsl(var(--pv-brand))] underline-offset-2 hover:underline"
        >
          Retry
        </button>
      </div>
    );
  }

  const Root = onClick ? 'button' : 'div';

  return (
    <div
      className={cn(
        'flex min-h-[56px] w-full items-center gap-1',
        inactive && 'opacity-60',
        className,
      )}
    >
      <Root
        {...(onClick ? { type: 'button' as const, onClick } : {})}
        className={cn(
          'flex min-w-0 flex-1 items-center gap-3 rounded-[10px] px-1 py-2 text-left',
          onClick &&
            'transition-colors duration-150 ease-out active:bg-[hsl(var(--pv-sunken))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--pv-brand))]',
        )}
      >
        <span className="flex w-[46px] shrink-0 justify-center">
          <Avatar name={name} className={cn(inactive && 'grayscale')} />
        </span>

        <span className="min-w-0 flex-1">
          <span
            className={cn(
              'block truncate text-[13px] font-bold text-[hsl(var(--pv-ink))]',
              inactive && 'line-through decoration-[hsl(var(--pv-ink-3))]',
            )}
          >
            {name}
          </span>

          {lines?.map((l) => (
            <span
              key={l}
              className="mt-0.5 block truncate text-[11.5px] font-medium text-[hsl(var(--pv-ink-3))]"
            >
              {l}
            </span>
          ))}

          {(facts?.length || badges?.length) && (
            <span className="mt-0.5 flex flex-wrap items-center gap-1.5">
              {facts?.map((f) => (
                <span
                  key={f}
                  className="text-[11.5px] font-medium tabular-nums text-[hsl(var(--pv-ink-3))]"
                >
                  {f}
                </span>
              ))}
              {badges?.map((b) => (
                <StatusBadge key={b.label} tone={b.tone} label={b.label} />
              ))}
            </span>
          )}
        </span>
      </Root>

      {actions && <span className="shrink-0">{actions}</span>}
    </div>
  );
}

/** The kebab most person lists use — four-ish actions, not one. */
export function PersonRowMenu({ label = 'More actions', onClick }: { label?: string; onClick?: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="flex h-11 w-11 items-center justify-center rounded-full text-[hsl(var(--pv-ink-3))] transition-colors duration-150 ease-out active:bg-[hsl(var(--pv-sunken))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--pv-brand))]"
    >
      <MoreHorizontal className="h-4 w-4" aria-hidden />
    </button>
  );
}
