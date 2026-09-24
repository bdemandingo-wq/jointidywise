import { Link, useLocation, useNavigate, matchPath } from 'react-router-dom';
import { useIsMobile } from '@/hooks/use-mobile';
import {
  Calendar,
  Users,
  ClipboardList,
  Settings,
  BarChart3,
  Briefcase,
  UserCircle,
  LogOut,
  ChevronDown,
  Home,
  DollarSign,
  Receipt,
  Package,
  Menu,
  Repeat,
  Target,
  MessageSquare,
  MapPin,
  CheckSquare,
  CreditCard,
  Sparkles,
  HelpCircle,
  GripVertical,
  Tag,
  Activity,
  Zap,
  Brain,
  Globe,
  Camera,
  Plus,
  Bell,
  Navigation as NavigationIcon,
  Gauge,
  Bug,
  Trash2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { OrgSwitcherList } from '@/components/OrgSwitcherList';
import { useMyStaffOrgs } from '@/hooks/useMyStaffOrgs';
import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useOrganization } from '@/contexts/OrganizationContext';
import { useOrgRole } from '@/hooks/useOrgRole';
import { useSidebarBadgesFull, type BadgeReason } from '@/hooks/useSidebarBadges';
import { useSidebarHiddenItems } from '@/hooks/useSidebarHiddenItems';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';
import { getSignedUrl } from '@/hooks/useSignedUrl';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/lib/supabase';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { usePlatform } from '@/hooks/usePlatform';
import { useToast } from '@/hooks/use-toast';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

const defaultNavigation = [
  { name: 'Dashboard', href: '/dashboard', icon: Home },
  { name: 'AI Intelligence', href: '/dashboard/ai-intelligence', icon: Brain },
  { name: 'Scheduler', href: '/dashboard/scheduler', icon: Calendar },
  { name: 'Tracking', href: '/dashboard/tracking', icon: NavigationIcon },
  { name: 'Bookings', href: '/dashboard/bookings', icon: ClipboardList },
  { name: 'Recurring', href: '/dashboard/recurring', icon: Repeat },
  { name: 'Customers', href: '/dashboard/customers', icon: Users },
  { name: 'Client Portal', href: '/dashboard/client-portal', icon: Globe },
  { name: 'Invoices', href: '/dashboard/invoices', icon: Receipt },
  { name: 'Messages', href: '/dashboard/messages', icon: MessageSquare },
  { name: 'Tasks', href: '/dashboard/tasks', icon: CheckSquare },
  { name: 'Leads', href: '/dashboard/leads', icon: Target },
  { name: 'Operations', href: '/dashboard/operations', icon: MapPin },
  { name: 'Campaigns', href: '/dashboard/campaigns', icon: Zap },
  { name: 'Discounts', href: '/dashboard/discounts', icon: Tag },
  { name: 'Feedback', href: '/dashboard/feedback', icon: MessageSquare },
  { name: 'Services', href: '/dashboard/services', icon: Briefcase },
  { name: 'Staff', href: '/dashboard/staff', icon: UserCircle },
  { name: 'Checklists', href: '/dashboard/checklists', icon: CheckSquare },
  { name: 'Booking Photos', href: '/dashboard/booking-photos', icon: Camera },
  { name: 'Inventory', href: '/dashboard/inventory', icon: Package },
  { name: 'Payroll', href: '/dashboard/payroll', icon: DollarSign },
  { name: 'Expenses', href: '/dashboard/expenses', icon: Receipt },
  { name: 'Finance', href: '/dashboard/finance', icon: Receipt },
  { name: 'Reports', href: '/dashboard/reports', icon: BarChart3 },
  { name: 'Benchmarks', href: '/dashboard/benchmarks', icon: Gauge },
  { name: 'Notifications', href: '/dashboard/notifications', icon: Bell },
  
  { name: 'Automation Center', href: '/dashboard/automation-center', icon: Zap },
  { name: 'Payment Setup', href: '/dashboard/payment-integration', icon: CreditCard },

];

/**
 * Help is pinned above the scrollable nav, so it is deliberately NOT a member of
 * defaultNavigation. Membership there would make it draggable, hideable, and
 * subject to a user's saved `tidywise_nav_order`.
 *
 * That last one is why moving it to the top of the array would not have worked:
 * the saved order wins on load, and the "append items not in the saved order"
 * loop only adds hrefs it has never seen — so an existing user's stored position
 * for /dashboard/help would have kept it exactly where it was. A stale
 * /dashboard/help entry in a saved order is harmless now: the .find() below
 * returns undefined and it is filtered out, so no migration is needed.
 */
const PINNED_HELP: NavItem = { name: 'Help', href: '/dashboard/help', icon: HelpCircle };

const iconMap: Record<string, typeof Home> = {
  Home, Calendar, ClipboardList, Repeat, Users, Target, MapPin, MessageSquare,
  Briefcase, UserCircle, CheckSquare, Package, DollarSign, Receipt, BarChart3,
  Sparkles, CreditCard, HelpCircle, Tag, Activity, Brain, Globe, Zap, Camera, Gauge, Bug,
};

interface NavItem {
  name: string;
  href: string;
  icon: typeof Home;
  badge?: number;
  breakdown?: BadgeReason[];
}

function BadgeWithReasons({ count, reasons }: { count: number; reasons?: BadgeReason[] }) {
  const items = (reasons || []).filter(r => r.count > 0);
  const badge = (
    <Badge variant="destructive" className="ml-auto h-5 w-5 flex items-center justify-center p-0 text-xs rounded-full">
      {count > 9 ? '9+' : count}
    </Badge>
  );
  if (items.length === 0) return badge;
  return (
    <Tooltip>
      <TooltipTrigger asChild><span className="ml-auto">{badge}</span></TooltipTrigger>
      <TooltipContent side="right" className="max-w-xs">
        <div className="space-y-0.5">
          <p className="text-xs font-semibold mb-1">Needs your attention</p>
          {items.map(r => (
            <p key={r.key} className="text-xs">
              {r.count} {r.count === 1 ? r.label : `${r.label}s`}
            </p>
          ))}
        </div>
      </TooltipContent>
    </Tooltip>
  );
}

interface AdminSidebarProps {
  isOpen: boolean;
  onToggle: () => void;
}

interface SortableNavItemProps {
  item: NavItem;
  isActive: boolean;
  isOpen: boolean;
  isMobile: boolean;
  onNavClick: () => void;
}

function SortableNavItem({ item, isActive, isOpen, isMobile, onNavClick }: SortableNavItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.href });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-center group pointer-events-auto touch-manipulation"
    >
      <button
        {...attributes}
        {...listeners}
        className={cn(
          "p-1 cursor-grab active:cursor-grabbing opacity-0 group-hover:opacity-100 transition-opacity touch-manipulation",
          isDragging && "opacity-100",
          isMobile && "hidden"
        )}
      >
        <GripVertical className="w-4 h-4 text-muted-foreground" />
      </button>
      <Link
        to={item.href}
        onClick={onNavClick}
        className={cn(
          'sidebar-link flex-1 min-h-[44px] pointer-events-auto touch-manipulation',
          isActive && 'active',
          !isOpen && !isMobile && 'justify-center px-2'
        )}
        title={!isOpen && !isMobile ? item.name : undefined}
      >
        <item.icon className="w-5 h-5 flex-shrink-0" />
        {(isOpen || isMobile) && <span>{item.name}</span>}
        {item.badge !== undefined && item.badge > 0 && (
          <BadgeWithReasons count={item.badge} reasons={item.breakdown} />
        )}
      </Link>
    </div>
  );
}

function StaticNavItem({ item, isActive, isOpen, isMobile, onNavClick, accent }: SortableNavItemProps) {
  return (
    <Link
      to={item.href}
      onClick={onNavClick}
      style={{ position: 'relative', zIndex: 1 }}
      className={cn(
        'sidebar-link min-h-[44px] pointer-events-auto touch-manipulation',
        accent && 'sidebar-link-help',
        isActive && 'active',
        !isOpen && !isMobile && 'justify-center px-2'
      )}
      title={!isOpen && !isMobile ? item.name : undefined}
    >
      <item.icon className="w-5 h-5 flex-shrink-0" />
      {(isOpen || isMobile) && <span>{item.name}</span>}
      {item.badge !== undefined && item.badge > 0 && (
        <BadgeWithReasons count={item.badge} reasons={item.breakdown} />
      )}
    </Link>
  );
}

export function AdminSidebar({ isOpen, onToggle }: AdminSidebarProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, signOut } = useAuth();
  const { organization, isOwner, allOrganizations, switchOrganization } = useOrganization();
  const { staffOrgs } = useMyStaffOrgs();
  const isMobileDevice = useIsMobile();
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  // Listen for the edge-swipe gesture dispatched by AdminLayout so the mobile
  // Sheet actually opens (its state is local to this component).
  useEffect(() => {
    const openHandler = () => setMobileOpen(true);
    const closeHandler = () => setMobileOpen(false);
    window.addEventListener('tw:open-mobile-sidebar', openHandler);
    window.addEventListener('tw:close-mobile-sidebar', closeHandler);
    return () => {
      window.removeEventListener('tw:open-mobile-sidebar', openHandler);
      window.removeEventListener('tw:close-mobile-sidebar', closeHandler);
    };
  }, []);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [businessDisplayName, setBusinessDisplayName] = useState<string>('My Business');
  const [navigation, setNavigation] = useState<NavItem[]>(defaultNavigation);
  const { hiddenItems, isLoading: hiddenItemsLoading } = useSidebarHiddenItems();
  const [orgToDelete, setOrgToDelete] = useState<{ id: string; name: string } | null>(null);
  const [isDeletingOrg, setIsDeletingOrg] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Every org the user belongs to. The list is already membership-scoped by
  // OrganizationContext — no additional filter needed. The "Add New Business"
  // button has its own separate owner_id guard below.
  const visibleOrganizations = allOrganizations;

  const handleDeleteOrg = async () => {
    if (!orgToDelete) return;
    setIsDeletingOrg(true);
    try {
      const { data, error } = await supabase.functions.invoke('delete-my-organization', {
        body: { organizationId: orgToDelete.id },
      });
      if (error || (data && data.error)) {
        throw new Error(error?.message || data?.error || 'Delete failed');
      }
      toast({ title: 'Business deleted', description: `${orgToDelete.name} was removed.` });
      setOrgToDelete(null);
      // Refresh the org list so the switcher updates immediately.
      await queryClient.invalidateQueries();
      window.location.reload();
    } catch (e: any) {
      toast({
        title: 'Could not delete business',
        description: e?.message || 'Please try again.',
        variant: 'destructive',
      });
    } finally {
      setIsDeletingOrg(false);
    }
  };

  // Unified badge counts + breakdowns (see useSidebarBadges for details).
  const { counts: badgeCounts, breakdowns: badgeBreakdowns } = useSidebarBadgesFull();


  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  // Hidden items now come from useSidebarHiddenItems (DB-backed, per-org).


  // Load navigation order from localStorage
  useEffect(() => {
    const savedOrder = localStorage.getItem('tidywise_nav_order');
    if (savedOrder) {
      try {
        const hrefOrder: string[] = JSON.parse(savedOrder);
        const reordered = hrefOrder
          .map(href => defaultNavigation.find(item => item.href === href))
          .filter((item): item is NavItem => item !== undefined);
        
        // Add any new nav items that weren't in saved order
        defaultNavigation.forEach(item => {
          if (!reordered.find(r => r.href === item.href)) {
            reordered.push(item);
          }
        });
        
        setNavigation(reordered);
      } catch (e) {
        console.error('Error parsing nav order:', e);
      }
    }
  }, []);

  // Platform detection for App Store compliance
  const { canShowPaymentFlows } = usePlatform();
  
  // Items to hide on native apps (App Store compliance - no payment flows)
  const nativeHiddenItems = useMemo(() => {
    if (canShowPaymentFlows) return [];
    // Hide payment-related items on native platforms (App Store compliance)
    return ['/dashboard/payment-integration', '/dashboard/subscription'];
  }, [canShowPaymentFlows]);

  // Managers (invited teammates without financial access) must not see the
  // admin Dashboard, Payroll, Expenses, Finance, or Reports. Filter those
  // out of the sidebar entirely — the routes are also gated server-side.
  const { hasFinancialAccess } = useOrgRole();
  const financialOnlyHrefs = useMemo(
    () => new Set(['/dashboard', '/dashboard/payroll', '/dashboard/expenses', '/dashboard/finance', '/dashboard/reports']),
    []
  );

  // Filter out hidden items and add badges. While the DB-backed visibility
  // preference is still loading we render an EMPTY list rather than the full
  // default set, so tabs the user hid never flash before the preference
  // resolves. The scoped localStorage cache means repeat visits hydrate
  // instantly (isLoading is already false), and first-time renders show a
  // brief blank list instead of the wrong content.
  const visibleNavigation = hiddenItemsLoading
    ? []
    : navigation
        .filter(item => !hiddenItems.includes(item.href) && !nativeHiddenItems.includes(item.href))
        .filter(item => hasFinancialAccess || !financialOnlyHrefs.has(item.href))
        .map(item => {
          const count = badgeCounts[item.href] || 0;
          return count > 0
            ? { ...item, badge: count, breakdown: badgeBreakdowns[item.href] }
            : item;
        });



  useEffect(() => {
    const fetchLogoAndName = async () => {
      if (!organization?.id) return;
      const { data } = await supabase
        .from('business_settings')
        .select('logo_url, company_name')
        .eq('organization_id', organization.id)
        .limit(1)
        .maybeSingle();
      
      if (data?.logo_url) {
        const raw = data.logo_url as string;
        if (raw.startsWith('storage:')) {
          const [, bucket, ...pathParts] = raw.split(':');
          const path = pathParts.join(':');
          try {
            const signed = await getSignedUrl(bucket, path, 86400);
            setLogoUrl(signed || raw);
          } catch {
            setLogoUrl(raw);
          }
        } else {
          setLogoUrl(raw);
        }
      }
      // Use company_name from business_settings if available, otherwise fall back to organization name
      if (data?.company_name) {
        setBusinessDisplayName(data.company_name);
      } else if (organization?.name) {
        setBusinessDisplayName(organization.name);
      }
    };
    fetchLogoAndName();
  }, [organization?.id, organization?.name]);

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    if (over && active.id !== over.id) {
      setNavigation((items) => {
        const oldIndex = items.findIndex(item => item.href === active.id);
        const newIndex = items.findIndex(item => item.href === over.id);
        const newOrder = arrayMove(items, oldIndex, newIndex);
        
        // Save to localStorage
        localStorage.setItem('tidywise_nav_order', JSON.stringify(newOrder.map(i => i.href)));
        
        return newOrder;
      });
    }
  };

  const handleLogout = async () => {
    await signOut();
    navigate('/');
  };

  const userInitials = user?.user_metadata?.full_name
    ?.split(' ')
    .map((n: string) => n[0])
    .join('')
    .toUpperCase() || user?.email?.charAt(0).toUpperCase() || 'U';

  const userName = user?.user_metadata?.full_name || user?.email?.split('@')[0] || 'User';

  const handleNavClick = () => {
    setMobileOpen(false);
  };

  const SidebarContent = ({ isMobile = false }: { isMobile?: boolean }) => (
    <>
      {/* Logo */}
      <div className="flex h-16 items-center gap-3 px-6 border-b border-sidebar-border shrink-0">
        {logoUrl ? (
          <div className="w-8 h-8 rounded-lg overflow-hidden flex items-center justify-center bg-sidebar-accent shrink-0">
            <img src={logoUrl} alt="Logo" className="w-full h-full object-contain" width={32} height={32} />
          </div>
        ) : (
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-primary to-accent flex items-center justify-center">
            <Calendar className="w-5 h-5 text-primary-foreground" />
          </div>
        )}
        {(isOpen || isMobile) && (
          <span className="text-lg font-bold text-sidebar-foreground">{businessDisplayName}</span>
        )}
      </div>

      {/* Pinned Help — must stay reachable however long the nav gets, so it
          lives OUTSIDE the scroll container below. `shrink-0` is the same
          mechanism the logo above and the Business Switcher below already use to
          stay out of the `flex-1` scroll area. This sits inside SidebarContent,
          which both the desktop <aside> and the mobile <Sheet> render, so one
          block covers both platforms.

          StaticNavItem, not SortableNavItem: a pinned row must not be draggable,
          and StaticNavItem is already the non-draggable renderer used on mobile,
          so the styling matches the rest of the list for free. */}
      <div className="px-3 pt-4 pb-2 shrink-0 border-b border-sidebar-border">
        <StaticNavItem
          item={PINNED_HELP}
          isActive={
            location.pathname === PINNED_HELP.href ||
            location.pathname.startsWith(PINNED_HELP.href)
          }
          isOpen={isOpen}
          isMobile={isMobile}
          onNavClick={handleNavClick}
        />
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-3 pt-2 pb-4 pointer-events-auto touch-manipulation relative z-10">
        {(isMobile || isMobileDevice) ? (
          <div className="space-y-0.5">
            {visibleNavigation.map((item) => {
              const isActive = location.pathname === item.href ||
                (item.href !== '/dashboard' && location.pathname.startsWith(item.href));
              return (
                <StaticNavItem
                  key={item.href}
                  item={item}
                  isActive={isActive}
                  isOpen={isOpen}
                  isMobile={isMobile}
                  onNavClick={handleNavClick}
                />
              );
            })}
          </div>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={visibleNavigation.map(item => item.href)}
              strategy={verticalListSortingStrategy}
            >
              <div className="space-y-1">
                {visibleNavigation.map((item) => {
                  const isActive = location.pathname === item.href || 
                    (item.href !== '/dashboard' && location.pathname.startsWith(item.href));
                  return (
                    <SortableNavItem
                      key={item.href}
                      item={item}
                      isActive={isActive}
                      isOpen={isOpen}
                      isMobile={isMobile}
                      onNavClick={handleNavClick}
                    />
                  );
                })}
              </div>
            </SortableContext>
          </DndContext>
        )}

        {/* Platform Admin Links - Only visible for support@tidywisecleaning.com */}
        {user?.email === 'support@tidywisecleaning.com' && (
          <div className="mt-4 pt-4 border-t border-sidebar-border space-y-1">
            <Link
              to="/dashboard/platform-analytics"
              onClick={handleNavClick}
              className={cn(
                'sidebar-link min-h-[44px] pointer-events-auto touch-manipulation',
                location.pathname === '/dashboard/platform-analytics' && 'active',
                !isOpen && !isMobile && 'justify-center px-2'
              )}
              title={!isOpen && !isMobile ? 'Platform Analytics' : undefined}
            >
              <Activity className="w-5 h-5 flex-shrink-0 text-amber-500" />
              {(isOpen || isMobile) && <span className="text-amber-500 font-medium">Platform Analytics</span>}
            </Link>
            <Link
              to="/dashboard/platform-feedback"
              onClick={handleNavClick}
              className={cn(
                'sidebar-link min-h-[44px] pointer-events-auto touch-manipulation',
                location.pathname === '/dashboard/platform-feedback' && 'active',
                !isOpen && !isMobile && 'justify-center px-2'
              )}
              title={!isOpen && !isMobile ? 'Feedback' : undefined}
            >
              <MessageSquare className="w-5 h-5 flex-shrink-0 text-amber-500" />
              {(isOpen || isMobile) && <span className="text-amber-500 font-medium">Feedback</span>}
            </Link>
          </div>

        )}

      </nav>

      {/* Business Switcher */}
      <div className={cn("border-t border-sidebar-border p-3 shrink-0", isMobile && "pb-[calc(0.75rem+env(safe-area-inset-bottom))]")}>
        <button
          onClick={() => setIsProfileOpen(!isProfileOpen)}
          className={cn(
            "w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-sidebar-accent transition-colors min-h-[44px] pointer-events-auto touch-manipulation",
            !isOpen && !isMobile && "justify-center px-2"
          )}
        >
          {logoUrl ? (
            <div className="w-9 h-9 rounded-full overflow-hidden flex items-center justify-center bg-sidebar-accent flex-shrink-0">
              <img src={logoUrl} alt="Business Logo" className="w-full h-full object-cover" width={36} height={36} />
            </div>
          ) : (
            <div className="w-9 h-9 rounded-full bg-gradient-to-br from-primary to-accent flex items-center justify-center text-sm font-medium text-primary-foreground flex-shrink-0">
              {businessDisplayName.substring(0, 2).toUpperCase()}
            </div>
          )}
          {(isOpen || isMobile) && (
            <>
              <div className="flex-1 text-left min-w-0">
                <p className="text-sm font-medium text-sidebar-foreground truncate">{businessDisplayName}</p>
                <p className="text-xs text-sidebar-foreground/60">{isOwner ? 'Owner' : 'Team Member'}</p>
              </div>
              <ChevronDown className={cn(
                "w-4 h-4 text-sidebar-foreground/60 transition-transform flex-shrink-0",
                isProfileOpen && "rotate-180"
              )} />
            </>
          )}
        </button>
        
        {isProfileOpen && (isOpen || isMobile) && (
          <div className="mt-2 py-2 space-y-1 animate-fade-in">
            {/* Business list — shared with the staff portal so the two cannot
                drift. The default classes reproduce this sidebar's original
                markup exactly; the delete button stays here because it is
                owner-only and admin-only. */}
            <OrgSwitcherList
              items={visibleOrganizations.map((orgItem) => {
                // Show "Staff" instead of "Member" when the user has an active
                // staff row in this org — that's the portal they'll land in.
                const isStaffInOrg = staffOrgs.some(s => s.organizationId === orgItem.organization.id);
                const roleLabel =
                  orgItem.role === 'owner' ? 'Owner'
                    : orgItem.role === 'admin' ? 'Admin'
                    : orgItem.role === 'manager' ? 'Manager'
                    : isStaffInOrg ? 'Staff'
                    : 'Member';
                return {
                  id: orgItem.organization.id,
                  name: orgItem.organization.name,
                  subtitle: roleLabel,
                };
              })}
              activeId={organization?.id ?? null}
              onSelect={switchOrganization}
              itemAction={(item) => {
                const orgItem = visibleOrganizations.find((o) => o.organization.id === item.id);
                if (!orgItem || orgItem.role !== 'owner' || item.id === organization?.id) return null;
                return (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setOrgToDelete({ id: item.id, name: item.name });
                    }}
                    aria-label={`Delete ${item.name}`}
                    className="p-2 rounded-md text-sidebar-foreground/40 hover:text-destructive hover:bg-destructive/10 transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                );
              }}
            />

            {/* Only the account that created this business may create another.
                An invited "owner" has owner permissions inside the workspace,
                but is not the organization's creator. */}
            {organization?.owner_id === user?.id && (
              <button
                onClick={() => {
                  setIsProfileOpen(false);
                  navigate('/onboarding?new=true');
                  handleNavClick();
                }}
                className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent transition-colors min-h-[44px] pointer-events-auto touch-manipulation"
              >
                <Plus className="w-4 h-4" />
                <span className="text-sm">Add New Business</span>
              </button>
            )}

            {/* Sign in to another account */}
            <button
              onClick={async () => {
                setIsProfileOpen(false);
                await signOut();
                navigate('/login', { replace: true });
              }}
              className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent transition-colors min-h-[44px] pointer-events-auto touch-manipulation"
            >
              <LogOut className="w-4 h-4" />
              <span className="text-sm text-left">Sign out and switch account</span>
            </button>

            {/* Settings */}
            <button 
              onClick={() => {
                setIsProfileOpen(false);
                navigate('/dashboard/settings');
                handleNavClick();
              }}
              className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent transition-colors min-h-[44px] pointer-events-auto touch-manipulation"
            >
              <Settings className="w-4 h-4" />
              <span className="text-sm">Settings</span>
            </button>

            {/* Logout */}
            <button 
              onClick={handleLogout}
              className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-destructive hover:bg-destructive/10 transition-colors min-h-[44px] pointer-events-auto touch-manipulation"
            >
              <LogOut className="w-4 h-4" />
              <span className="text-sm">Logout</span>
            </button>
          </div>
        )}
      </div>
    </>
  );

  return (
    <>
      {/* Mobile Sheet */}
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="left" className="w-64 p-0 bg-sidebar md:hidden z-[60] pointer-events-auto touch-manipulation">
          <div className="flex flex-col h-full pt-[env(safe-area-inset-top)]">
            <SidebarContent isMobile />
          </div>
        </SheetContent>
      </Sheet>

      {/* Mobile Toggle Button */}
      <Button
        variant="ghost"
        size="icon"
        className="hamburger-menu-btn fixed top-[calc(0.25rem+env(safe-area-inset-top))] left-1 z-50 min-w-[44px] min-h-[44px] md:hidden bg-background/80 backdrop-blur-sm touch-manipulation pointer-events-auto"
        onClick={() => setMobileOpen(true)}
        aria-label="Open navigation menu"
      >
        <Menu className="w-6 h-6" />
      </Button>

      {/* Desktop Sidebar */}
      <aside className={cn(
        "fixed left-0 top-0 z-40 h-screen bg-sidebar flex-col transition-all duration-300",
        "hidden md:flex",
        isOpen ? "w-64" : "w-16"
      )}>
        {/* Toggle Button */}
        <Button
          variant="ghost"
          size="icon"
          className="absolute -right-3 top-20 z-50 w-6 h-6 rounded-full bg-sidebar border border-sidebar-border shadow-sm hover:bg-sidebar-accent"
          onClick={onToggle}
        >
          <ChevronDown className={cn(
            "w-4 h-4 transition-transform",
            isOpen ? "-rotate-90" : "rotate-90"
          )} />
        </Button>

        <SidebarContent />
      </aside>

      <AlertDialog open={!!orgToDelete} onOpenChange={(open) => !open && !isDeletingOrg && setOrgToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {orgToDelete?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes this business and all of its bookings, customers, invoices, messages, and settings. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeletingOrg}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteOrg}
              disabled={isDeletingOrg}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeletingOrg ? 'Deleting…' : 'Delete business'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
