import { ReactNode, Suspense, lazy, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { AdminHeaderSearch } from '@/components/admin/AdminHeaderSearch';
import { Button } from '@/components/ui/button';
import { ThemeToggle } from '@/components/admin/ThemeToggle';
import { useTestMode } from '@/contexts/TestModeContext';
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
  const { isTestMode } = useTestMode();

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
                <Link
                  to="/dashboard/settings?tab=general"
                  className="hidden md:inline text-xs font-medium text-warning underline-offset-2 hover:underline whitespace-nowrap"
                >
                  Demo mode on
                </Link>
              )}
            </div>

            {/* Desktop: full action bar */}
            <div className="hidden md:flex items-center gap-4 shrink-0">
              <AdminHeaderSearch />
              {actions}
              <AdminNotificationBell />
              <ThemeToggle />
              <Button className="h-9 w-auto px-3 gap-2" onClick={() => setBookingDialogOpen(true)}>
                <Plus className="w-4 h-4" />
                New Booking
              </Button>
            </div>

            {/* Mobile: compact icon cluster only */}
            <div className="flex md:hidden items-center gap-1 shrink-0">
              {isTestMode && (
                <Link
                  to="/dashboard/settings?tab=general"
                  className="text-[11px] font-medium text-warning leading-tight max-w-[4.5rem]"
                >
                  Demo on
                </Link>
              )}
              <AdminNotificationBell />
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
