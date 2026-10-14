import { ReactNode, useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { AdminSidebar } from './AdminSidebar';
import { AdminHeader } from './AdminHeader';
import { DemoModeBanner } from './DemoModeBanner';

import { PlanStateBanner } from './PlanStateBanner';
import { TrialDaysBanner } from './TrialDaysBanner';
import { OfflineIndicator } from './OfflineIndicator';
import { MobileBottomNav } from '@/components/mobile/MobileBottomNav';
import { cn } from '@/lib/utils';
import { matchPath, useLocation } from 'react-router-dom';
import { useBrandingColors } from '@/hooks/useBrandingColors';
import { useIsMobile } from '@/hooks/use-mobile';
import { useBodyPointerEventsRecovery } from '@/hooks/useBodyPointerEventsRecovery';
import { usePullToRefresh } from '@/hooks/usePullToRefresh';
import { PullToRefreshIndicator } from '@/components/admin/PullToRefreshIndicator';
import { Capacitor } from '@capacitor/core';
import { isSampleDemoOn, subscribeDemoMode } from '@/lib/demo/session';

const LIST_PULL_PREFIXES = [
  '/dashboard/customers',
  '/dashboard/leads',
  '/dashboard/invoices',
  '/dashboard/tasks',
  '/dashboard/estimates',
  '/dashboard/recurring',
];

// Prefix of the list query on that page: useCustomers ['customers', org],
// LeadsPage ['leads', org], InvoicesPage ['invoices', org],
// TasksPage ['tasks-and-notes', org], EstimatesPage ['estimates', org],
// RecurringBookingsPage ['recurring-bookings', org].
function listQueryKey(pathname: string): string {
  if (pathname.includes('/customers')) return 'customers';
  if (pathname.includes('/leads')) return 'leads';
  if (pathname.includes('/invoices')) return 'invoices';
  if (pathname.includes('/tasks')) return 'tasks-and-notes';
  if (pathname.includes('/estimates')) return 'estimates';
  if (pathname.includes('/recurring')) return 'recurring-bookings';
  return 'bookings';
}

interface AdminLayoutProps {
  children: ReactNode;
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}

export function AdminLayout({ children, title, subtitle, actions }: AdminLayoutProps) {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const location = useLocation();
  const queryClient = useQueryClient();
  const listPull = LIST_PULL_PREFIXES.some(
    (prefix) => location.pathname === prefix || location.pathname.startsWith(`${prefix}/`),
  );
  const refreshList = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: [listQueryKey(location.pathname)] });
  }, [location.pathname, queryClient]);
  const { refreshing, pullDistance, handlers: pullHandlers } = usePullToRefresh(refreshList);

  // Admin pages pass `title` into the header but most of them never touch
  // document.title, so the browser tab stayed on the marketing default.
  // No cleanup restore: the next page sets its own title, and restoring the
  // previous one flashes the page you just left.
  useLayoutEffect(() => {
    if (title) document.title = `${title} | TidyWise`;
  }, [title]);
  
  // Apply org branding colors to entire CRM theme
  useBrandingColors();
  const isMobileView = useIsMobile();
  const demoOn = useSyncExternalStore(subscribeDemoMode, isSampleDemoOn, () => false);
  const headerRef = useRef<HTMLDivElement>(null);

  // Insurance against a Radix modal stranding pointer-events:none on <body>,
  // which makes the whole app unclickable with nothing on screen to explain it.
  useBodyPointerEventsRecovery();

  // Edge-swipe to open the sidebar on touch devices. React synthetic touch
  // handlers on the wrapper miss touches that land on fixed-positioned
  // children (header, bottom nav, sheet overlays), so we attach native
  // document-level listeners. On mobile we dispatch a global event so the
  // AdminSidebar Sheet (which owns its own open state) actually opens.
  useEffect(() => {
    let startX = 0;
    let startY = 0;
    let fromEdge = false;
    let tracking = false;
    let maxDy = 0;
    let maxDx = 0;

    const onStart = (e: TouchEvent) => {
      const t = e.touches[0];
      if (!t) return;
      startX = t.clientX;
      startY = t.clientY;
      fromEdge = t.clientX <= 28;
      tracking = true;
      maxDy = 0;
      maxDx = 0;
    };

    // Judge the gesture on its PATH, not just its endpoints. Without this a
    // vertical scroll that drifts sideways and curves back — which is most
    // thumb scrolling near the left edge — ended within 60px vertically of its
    // start and 50px to the right, and opened the sidebar. Reading a list near
    // the left edge would open it unasked.
    const onMove = (e: TouchEvent) => {
      if (!tracking) return;
      const t = e.touches[0];
      if (!t) return;
      const dy = Math.abs(t.clientY - startY);
      const dx = t.clientX - startX;
      if (dy > maxDy) maxDy = dy;
      if (Math.abs(dx) > Math.abs(maxDx)) maxDx = dx;
      // Once a gesture has clearly become a vertical scroll, it can never
      // become a sidebar swipe, however it ends.
      if (maxDy > 40 && maxDy > Math.abs(maxDx)) tracking = false;
    };

    const onEnd = (e: TouchEvent) => {
      if (!tracking) return;
      tracking = false;
      const t = e.changedTouches[0];
      if (!t) return;
      const dx = t.clientX - startX;
      const dy = Math.abs(t.clientY - startY);
      // Endpoint check kept, plus the path's worst vertical excursion.
      if (dy > 60 || maxDy > 60) return;
      if (isMobileView) {
        // The iOS shell uses this edge for back. The menu button still opens
        // the sidebar. The website keeps the edge-swipe opener.
        if (Capacitor.getPlatform() === 'ios' && fromEdge) return;
        if (fromEdge && dx > 50) {
          window.dispatchEvent(new CustomEvent('tw:open-mobile-sidebar'));
        } else if (dx < -60 && startX <= 288) {
          window.dispatchEvent(new CustomEvent('tw:close-mobile-sidebar'));
        }
        return;
      }
      // Desktop swipe (rare, but preserved)
      if (fromEdge && dx > 60 && !sidebarOpen) setSidebarOpen(true);
      else if (dx < -60 && sidebarOpen && startX <= 288) setSidebarOpen(false);
    };

    // onCancel is a named function so it can actually be removed. It used to be
    // an inline arrow, which the cleanup below never unsubscribed — and since
    // this effect re-runs whenever sidebarOpen changes, that leaked one
    // listener per toggle for the life of the page.
    const onCancel = () => { tracking = false; };

    document.addEventListener('touchstart', onStart, { passive: true });
    document.addEventListener('touchmove', onMove, { passive: true });
    document.addEventListener('touchend', onEnd, { passive: true });
    document.addEventListener('touchcancel', onCancel, { passive: true });
    return () => {
      document.removeEventListener('touchstart', onStart);
      document.removeEventListener('touchmove', onMove);
      document.removeEventListener('touchend', onEnd);
      document.removeEventListener('touchcancel', onCancel);
    };
  }, [isMobileView, sidebarOpen]);
  const isInsideConversation = Boolean(
    matchPath('/dashboard/messages/:conversationId', location.pathname)
  );
  const hideHeader = isMobileView && (
    location.pathname.includes('/messages') ||
    location.pathname.includes('/scheduler') ||
    location.pathname.includes('/calendar')
  ) || isInsideConversation;

  const pinDemoChrome = demoOn && isMobileView;

  useLayoutEffect(() => {
    const root = document.documentElement;
    if (!pinDemoChrome) {
      root.style.removeProperty('--admin-header-h');
      return;
    }
    const el = headerRef.current;
    const apply = () => {
      root.style.setProperty('--admin-header-h', `${hideHeader || !el ? 0 : el.offsetHeight}px`);
    };
    apply();
    const observer = new ResizeObserver(apply);
    if (el && !hideHeader) observer.observe(el);
    return () => {
      observer.disconnect();
      root.style.removeProperty('--admin-header-h');
    };
  }, [pinDemoChrome, hideHeader]);

  // The Tidy co-pilot bubble + panel are NOT mounted here. They live in
  // App.tsx so the CopilotProvider survives route changes — otherwise every
  // navigation would remount the provider and clear the conversation.
  return (
    <div className="min-h-screen w-full max-w-full overflow-x-clip bg-background">
      <AdminSidebar isOpen={sidebarOpen} onToggle={() => setSidebarOpen(!sidebarOpen)} />

      <div
        className={cn(
          "transition-all duration-300 min-h-screen w-full max-w-full overflow-x-clip",
          "pl-0 md:pl-16",
          sidebarOpen && "md:pl-64",
          pinDemoChrome && "flex h-dvh flex-col overflow-hidden",
        )}
        style={pinDemoChrome ? {
          paddingTop: hideHeader
            ? 'var(--demo-banner-h, 0px)'
            : 'calc(var(--demo-banner-h, 0px) + var(--admin-header-h, 0px))',
        } : undefined}
      >
        <div className={cn(pinDemoChrome && "fixed inset-x-0 top-0 z-40")}>
          <DemoModeBanner />
        </div>
        {!hideHeader && (
          <div
            ref={headerRef}
            className={cn(
              'z-30',
              pinDemoChrome
                ? 'fixed inset-x-0 bg-background top-[var(--demo-banner-h,0px)]'
                : 'sticky top-[var(--demo-banner-h,0px)]',
              !demoOn && 'pt-[env(safe-area-inset-top)]',
            )}
          >
            <AdminHeader title={title} subtitle={subtitle} actions={actions} />
          </div>
        )}

        <main
          className={cn(
            "animate-page-enter flex-1 w-full max-w-full min-w-0 overflow-x-auto",
            "px-3 py-3 md:p-4 pb-[calc(11.25rem+env(safe-area-inset-bottom))] md:pb-24",
            pinDemoChrome && "min-h-0 overflow-y-auto",
          )}
          {...(listPull ? pullHandlers : {})}
        >
          {listPull && <PullToRefreshIndicator pullDistance={pullDistance} refreshing={refreshing} />}
          <PlanStateBanner />
          <TrialDaysBanner />
          {children}
        </main>
      </div>

      <OfflineIndicator />

      <MobileBottomNav />
    </div>
  );
}
