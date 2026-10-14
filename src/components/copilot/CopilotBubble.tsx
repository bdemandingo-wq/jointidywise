import { Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useCopilot } from '@/hooks/useCopilot';

const BUBBLE_COLOR = '#4f46e5';

export function CopilotBubble() {
  const { isOpen, toggle, hasUnread } = useCopilot();

  if (isOpen) return null;

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label="Open Tidy"
      aria-pressed={false}
      data-tour-id="tidy-bubble"
      className={cn(
        'copilot-bubble fixed z-30',
        'bottom-[calc(7rem+env(safe-area-inset-bottom))] md:bottom-6',
        'right-[calc(1rem+env(safe-area-inset-right))] md:right-6',
        'w-14 h-14 max-w-[calc(100vw-2rem)] rounded-full',
        'flex items-center justify-center',
        'text-white shadow-lg hover:shadow-xl',
        'transition-transform duration-200 hover:scale-105 active:scale-95',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2',
        'focus-visible:ring-[#4f46e5]',
      )}
      style={{ backgroundColor: BUBBLE_COLOR }}
    >
      {hasUnread && (
        <span
          aria-hidden="true"
          className="absolute -top-0.5 -right-0.5 flex h-3 w-3"
        >
          <span className="absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75 animate-ping" />
          <span className="relative inline-flex h-3 w-3 rounded-full bg-rose-500" />
        </span>
      )}
      <Sparkles className="w-6 h-6" strokeWidth={2.25} />
    </button>
  );
}
