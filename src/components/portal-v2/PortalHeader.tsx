import { Bell, Settings } from 'lucide-react';
import { Avatar } from './Avatar';
import { Eyebrow } from './Card';

/**
 * §2 (2a, 2b): eyebrow + greeting; bell with count badge; avatar.
 * §5 notification badge: caps at "9+", hidden at 0.
 * §3 rule 14: tap targets >= 44px on cleaner-facing screens.
 */
export function PortalHeader({
  eyebrow,
  greeting,
  name,
  notifications = 0,
  onBell,
  trailing = 'avatar',
  onSettings,
}: {
  eyebrow: string;
  greeting: string;
  name: string;
  notifications?: number;
  onBell?: () => void;
  /** 2a ends in the cleaner's avatar; 2b ends in settings. §2. */
  trailing?: 'avatar' | 'settings';
  onSettings?: () => void;
}) {
  const badge = notifications > 9 ? '9+' : String(notifications);

  return (
    <header className="flex items-center gap-3 px-5 pb-3 pt-[calc(env(safe-area-inset-top,0px)+1rem)]">
      <div className="min-w-0 flex-1">
        <Eyebrow>{eyebrow}</Eyebrow>
        <h1 className="truncate text-[19px] font-extrabold leading-tight text-[hsl(var(--pv-ink))]">
          {greeting}
        </h1>
      </div>

      <button
        type="button"
        onClick={onBell}
        aria-label={
          notifications > 0 ? `Notifications, ${badge} unread` : 'Notifications'
        }
        className="relative flex h-11 w-11 items-center justify-center rounded-full border border-[hsl(var(--pv-border))] bg-[hsl(var(--pv-surface))] text-[hsl(var(--pv-ink))] transition-colors duration-150 ease-out active:bg-[hsl(var(--pv-sunken))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--pv-brand))] focus-visible:ring-offset-2 focus-visible:ring-offset-[hsl(var(--pv-bg))]"
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

      {trailing === 'avatar' ? (
        <Avatar name={name} />
      ) : (
        <button
          type="button"
          onClick={onSettings}
          aria-label="Settings"
          className="flex h-11 w-11 items-center justify-center rounded-full border border-[hsl(var(--pv-border))] bg-[hsl(var(--pv-surface))] text-[hsl(var(--pv-ink))] transition-colors duration-150 ease-out active:bg-[hsl(var(--pv-sunken))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--pv-brand))] focus-visible:ring-offset-2 focus-visible:ring-offset-[hsl(var(--pv-bg))]"
        >
          <Settings className="h-[18px] w-[18px]" aria-hidden />
        </button>
      )}
    </header>
  );
}
