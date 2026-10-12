import { ReactNode, Suspense, lazy, useState } from 'react';
import { Plus, Eye, EyeOff } from 'lucide-react';
import { AdminHeaderSearch } from '@/components/admin/AdminHeaderSearch';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { ThemeToggle } from '@/components/admin/ThemeToggle';
import { useTestMode } from '@/contexts/TestModeContext';
import { Badge } from '@/components/ui/badge';
import { AdminNotificationBell } from '@/components/admin/AdminNotificationBell';


// Performance: the booking dialog is a heavy multi-step flow; only load it when opened.
const AddBookingDialog = lazy(() =>
  import('@/components/admin/AddBookingDialog').then((m) => ({ default: m.AddBookingDialog }))
);

interface AdminHeaderProps {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}

export function AdminHeader({ title, actions }: AdminHeaderProps) {
  const [bookingDialogOpen, setBookingDialogOpen] = useState(false);
  const { isTestMode, toggleTestMode } = useTestMode();

  return (
    <>
      <div className="portal-v2 sticky top-0 z-30 w-full max-w-full overflow-x-hidden">
        <header className="bg-background/80 backdrop-blur-sm border-b border-border pt-[env(safe-area-inset-top)]">

          {/* Primary row: hamburger spacer + title + icon buttons */}
          <div className="flex h-12 max-w-full items-center gap-2 px-3 md:h-14 md:px-4">
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <div className="w-10 md:hidden shrink-0" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <h1 className="text-sm md:text-xl font-semibold text-foreground leading-tight truncate">{title}</h1>
              </div>
              {isTestMode && (
                <Badge variant="outline" className="hidden md:flex bg-accent/10 text-foreground border-accent/30">
                  Demo Mode
                </Badge>
              )}
            </div>

            {/* Desktop: full action bar */}
            <div className="hidden md:flex items-center gap-4 shrink-0">
              <AdminHeaderSearch />
              {actions}
              <AdminNotificationBell />
              <Button variant="ghost" size="icon" onClick={toggleTestMode}
                title={isTestMode ? 'Disable Demo Mode' : 'Enable Demo Mode'}
                className={cn("h-9 w-9", isTestMode ? 'text-warning' : '')}>
                {isTestMode ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
              </Button>
              <ThemeToggle />
              <Button className="h-9 w-auto px-3 gap-2" onClick={() => setBookingDialogOpen(true)}>
                <Plus className="w-4 h-4" />
                New Booking
              </Button>
            </div>

            {/* Mobile: compact icon cluster only */}
            <div className="flex md:hidden items-center gap-1 shrink-0">
              <AdminNotificationBell />
              <Button variant="ghost" size="icon" onClick={toggleTestMode}
                title={isTestMode ? 'Disable Demo Mode' : 'Enable Demo Mode'}
                className={cn("h-10 w-10", isTestMode ? 'text-warning' : '')}>
                {isTestMode ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
              </Button>
              <ThemeToggle />
            </div>
          </div>

          {/* Mobile actions sub-row — only rendered when the page has actions */}
          {actions && (
            <div className="md:hidden flex items-center gap-2 px-3 pb-2 overflow-x-auto scrollbar-none">
              {actions}
            </div>
          )}
        </header>
      </div>

      <Suspense fallback={null}>
        {bookingDialogOpen ? (
          <AddBookingDialog open={bookingDialogOpen} onOpenChange={setBookingDialogOpen} />
        ) : null}
      </Suspense>
    </>
  );
}
