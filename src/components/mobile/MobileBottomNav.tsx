import { NavLink, useLocation } from 'react-router-dom';
import {
  Home, Users, Target, MessageSquare, Settings, Calendar, BarChart3,
  ClipboardList, Bell, Plus, Brain, CalendarDays, Repeat, UserCircle,
  FileText, ListTodo, Crosshair, Megaphone, MessageCircle, Wrench,
  UsersRound, CheckSquare, Camera, Package, Percent, DollarSign,
  Receipt, PieChart, CreditCard, Zap, Briefcase, Image,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useEffect, useLayoutEffect, useRef, useState, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useOrgId } from '@/hooks/useOrgId';
import { AddBookingDialog } from '@/components/admin/AddBookingDialog';
import { useCopilot } from '@/hooks/useCopilot';
import {
  readCachedMobileNav,
  readLaunchMobileNav,
  sameMobileNav,
  sanitizeMobileNavSlots,
  writeCachedMobileNav,
  type MobileNavSlot,
} from '@/lib/mobileNavSlots';
import { hapticImpact } from '@/lib/haptics';
import { isNativeIos } from '@/lib/nativeShell';

const tabScrollY = new Map<string, number>();

function readTabScroll(): number {
  const inner = document.querySelector('main .overflow-auto, main .overflow-y-auto');
  if (inner instanceof HTMLElement && inner.scrollHeight > inner.clientHeight + 8) return inner.scrollTop;
  return window.scrollY;
}

function writeTabScroll(y: number) {
  const inner = document.querySelector('main .overflow-auto, main .overflow-y-auto');
  if (inner instanceof HTMLElement && inner.scrollHeight > inner.clientHeight + 8) {
    inner.scrollTop = y;
    return;
  }
  window.scrollTo(0, y);
}

export type MobileNavItem = MobileNavSlot;

export const DEFAULT_SLOTS: MobileNavItem[] = [
  { id: 'dashboard', label: 'Dashboard', to: '/dashboard', iconKey: 'Home' },
  { id: 'scheduler', label: 'Calendar', to: '/dashboard/scheduler', iconKey: 'Calendar' },
  // center slot is the + button (not stored)
  { id: 'bookings', label: 'Bookings', to: '/dashboard/bookings', iconKey: 'CalendarDays' },
  { id: 'reports', label: 'Reports', to: '/dashboard/reports', iconKey: 'BarChart3' },
];

export const ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  Home, Users, Target, MessageSquare, Settings, Calendar, BarChart3,
  ClipboardList, Bell, Brain, CalendarDays, Repeat, UserCircle,
  FileText, ListTodo, Crosshair, Megaphone, MessageCircle, Wrench,
  UsersRound, CheckSquare, Camera, Package, Percent, DollarSign,
  Receipt, PieChart, CreditCard, Zap, Briefcase, Image,
  Plus,
};

export const ALL_NAV_PAGES: Array<{ id: string; label: string; to: string; iconKey: string }> = [
  { id: 'dashboard', label: 'Dashboard', to: '/dashboard', iconKey: 'Home' },
  { id: 'ai-intelligence', label: 'AI Intelligence', to: '/dashboard/ai-intelligence', iconKey: 'Brain' },
  { id: 'scheduler', label: 'Scheduler', to: '/dashboard/scheduler', iconKey: 'Calendar' },
  { id: 'bookings', label: 'Bookings', to: '/dashboard/bookings', iconKey: 'CalendarDays' },
  { id: 'recurring', label: 'Recurring', to: '/dashboard/recurring', iconKey: 'Repeat' },
  { id: 'customers', label: 'Customers', to: '/dashboard/customers', iconKey: 'Users' },
  { id: 'client-portal', label: 'Client Portal', to: '/dashboard/client-portal', iconKey: 'UserCircle' },
  { id: 'invoices', label: 'Invoices', to: '/dashboard/invoices', iconKey: 'FileText' },
  { id: 'messages', label: 'Messages', to: '/dashboard/messages', iconKey: 'MessageSquare' },
  { id: 'tasks', label: 'Tasks', to: '/dashboard/tasks', iconKey: 'ListTodo' },
  { id: 'leads', label: 'Leads', to: '/dashboard/leads', iconKey: 'Target' },
  { id: 'operations', label: 'Operations', to: '/dashboard/operations', iconKey: 'Crosshair' },
  { id: 'campaigns', label: 'Campaigns', to: '/dashboard/campaigns', iconKey: 'Megaphone' },
  { id: 'feedback', label: 'Feedback', to: '/dashboard/feedback', iconKey: 'MessageCircle' },
  { id: 'services', label: 'Services', to: '/dashboard/services', iconKey: 'Wrench' },
  { id: 'staff', label: 'Staff', to: '/dashboard/staff', iconKey: 'UsersRound' },
  { id: 'checklists', label: 'Checklists', to: '/dashboard/checklists', iconKey: 'CheckSquare' },
  { id: 'booking-photos', label: 'Booking Photos', to: '/dashboard/booking-photos', iconKey: 'Camera' },
  { id: 'inventory', label: 'Inventory', to: '/dashboard/inventory', iconKey: 'Package' },
  { id: 'discounts', label: 'Discounts', to: '/dashboard/discounts', iconKey: 'Percent' },
  { id: 'payroll', label: 'Payroll', to: '/dashboard/payroll', iconKey: 'DollarSign' },
  { id: 'expenses', label: 'Expenses', to: '/dashboard/expenses', iconKey: 'Receipt' },
  { id: 'finance', label: 'Finance', to: '/dashboard/finance', iconKey: 'PieChart' },
  { id: 'reports', label: 'Reports', to: '/dashboard/reports', iconKey: 'BarChart3' },
  { id: 'subscription', label: 'Subscription', to: '/dashboard/subscription', iconKey: 'CreditCard' },
  { id: 'automation-center', label: 'Automation Center', to: '/dashboard/automation-center', iconKey: 'Zap' },
  { id: 'payment-integration', label: 'Payment Setup', to: '/dashboard/payment-integration', iconKey: 'Briefcase' },
];

function isDashboardRoute(pathname: string) {
  return pathname.startsWith('/dashboard') || pathname.startsWith('/admin');
}

export function MobileBottomNav() {
  const location = useLocation();
  const { organizationId } = useOrgId();
  const { isOpen: copilotOpen } = useCopilot();
  // null means "not known yet" — a neutral placeholder, never the default
  // Reports tab that would then flip to the org's saved Payroll tab.
  const [slots, setSlots] = useState<MobileNavItem[] | null>(() => readLaunchMobileNav());
  const [showAddBooking, setShowAddBooking] = useState(false);
  const fetchGen = useRef(0);

  const isDashboard = isDashboardRoute(location.pathname);

  const triggerHaptic = useCallback(() => {
    hapticImpact('light');
  }, []);

  useEffect(() => {
    if (!isNativeIos()) return;
    const path = location.pathname;
    const remember = () => {
      tabScrollY.set(path, readTabScroll());
    };
    document.addEventListener('scroll', remember, { passive: true, capture: true });
    window.addEventListener('scroll', remember, { passive: true });
    return () => {
      document.removeEventListener('scroll', remember, true);
      window.removeEventListener('scroll', remember);
    };
  }, [location.pathname]);

  useLayoutEffect(() => {
    if (!isNativeIos()) return;
    const y = tabScrollY.get(location.pathname) ?? 0;
    writeTabScroll(y);
  }, [location.pathname]);

  useEffect(() => {
    const onSaved = (event: Event) => {
      const detail = (event as CustomEvent<{ organizationId?: string; items?: unknown }>).detail;
      const next = sanitizeMobileNavSlots(detail?.items);
      if (!next) return;
      fetchGen.current += 1;
      if (detail?.organizationId) writeCachedMobileNav(detail.organizationId, next);
      setSlots((current) => (sameMobileNav(current, next) ? current : next));
    };
    window.addEventListener('tw:mobile-nav-saved', onSaved);
    return () => window.removeEventListener('tw:mobile-nav-saved', onSaved);
  }, []);

  useEffect(() => {
    if (!isDashboard || !organizationId) return;
    const cached = readCachedMobileNav(organizationId);
    setSlots((current) => (sameMobileNav(current, cached) ? current : cached));
    const gen = ++fetchGen.current;
    let cancelled = false;

    const load = async () => {
      try {
        const { data, error } = await supabase
          .from('organization_mobile_nav_settings')
          .select('items')
          .eq('organization_id', organizationId)
          .eq('role', 'admin')
          .maybeSingle();

        if (error) throw error;
        if (cancelled || gen !== fetchGen.current) return;
        // No saved row means the built-in default. A saved row wins, including Payroll.
        const sanitized = sanitizeMobileNavSlots((data as { items?: unknown } | null)?.items) ?? DEFAULT_SLOTS;
        writeCachedMobileNav(organizationId, sanitized);
        setSlots((current) => (sameMobileNav(current, sanitized) ? current : sanitized));
      } catch {
        if (!cancelled && gen === fetchGen.current) {
          setSlots((current) => current ?? DEFAULT_SLOTS);
        }
      }
    };

    load();
    return () => { cancelled = true; };
  }, [organizationId, isDashboard]);

  if (!isDashboard || copilotOpen) return null;

  const leftSlots = slots?.slice(0, 2) ?? null;
  const rightSlots = slots?.slice(2, 4) ?? null;


  const handleAdd = () => {
    triggerHaptic();
    setShowAddBooking(true);
  };

  return (
    <nav
      className={cn(
        'fixed left-0 right-0 bottom-0 z-50 md:hidden',
        isNativeIos()
          ? 'bg-background border-t border-border'
          : 'bg-background/95 backdrop-blur-md border-t border-border/30'
      )}
      aria-label="Primary"
    >
      <div className="relative grid grid-cols-5 items-end pb-[env(safe-area-inset-bottom)]">
        {/* Left 2 slots. Placeholder until the saved row (or the default) is known. */}
        {leftSlots
          ? leftSlots.map((item) => (
            <NavItem key={item.id} item={item} onTap={triggerHaptic} currentPath={location.pathname} />
          ))
          : [0, 1].map((key) => <NavPlaceholder key={key} />)}

        {/* Center + FAB */}
        <div className="flex items-center justify-center relative">
          <button
            type="button"
            onClick={handleAdd}
            className={cn(
              'absolute -top-3 flex items-center justify-center',
              'w-12 h-12 rounded-full',
              'bg-primary text-primary-foreground',
              'shadow-lg shadow-primary/30',
              'active:scale-95 transition-transform duration-150',
              'touch-manipulation'
            )}
            aria-label="New booking"
          >
            <Plus className="w-6 h-6" strokeWidth={2.5} />
          </button>
          {/* Spacer to keep grid height */}
          <div className="h-12" />
        </div>

        {/* Right 2 slots */}
        {rightSlots
          ? rightSlots.map((item) => (
            <NavItem key={item.id} item={item} onTap={triggerHaptic} currentPath={location.pathname} />
          ))
          : [2, 3].map((key) => <NavPlaceholder key={key} />)}
      </div>
      <AddBookingDialog open={showAddBooking} onOpenChange={setShowAddBooking} />
    </nav>
  );
}

function NavPlaceholder() {
  return (
    <div className="flex h-12 flex-col items-center justify-center gap-1" aria-hidden="true">
      <div className="h-[18px] w-[18px] rounded bg-muted" />
      <div className="h-2 w-8 rounded bg-muted" />
    </div>
  );
}

function NavItem({ item, onTap, currentPath }: { item: MobileNavItem; onTap: () => void; currentPath: string }) {
  const Icon = ICON_MAP[item.iconKey] ?? Home;
  const isActive = currentPath === item.to || (item.to !== '/dashboard' && currentPath.startsWith(item.to + '/'));
  const isExactDashboard = item.to === '/dashboard' && currentPath === '/dashboard';
  const active = isActive || isExactDashboard;

  return (
    <NavLink
      to={item.to}
      onClick={() => {
        if (isNativeIos()) tabScrollY.set(currentPath, readTabScroll());
        onTap();
      }}
      className={cn(
        'flex flex-col items-center justify-center gap-0.5',
        'text-[10px] font-medium',
        isNativeIos() ? 'transition-transform duration-100' : 'transition-all duration-200',
        'active:scale-[0.96] will-change-transform touch-manipulation',
        'h-12',
        active ? 'text-primary font-semibold' : 'text-muted-foreground'
      )}
    >
      <Icon className="h-[18px] w-[18px]" aria-hidden="true" />
      <span className="leading-none">{item.label}</span>
    </NavLink>
  );
}
