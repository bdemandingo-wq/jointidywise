import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { formatInTimezone, getDateInTimezone } from "@/lib/timezoneUtils";
import {
  CalendarDays,
  Clock,
  LogOut,
  MapPin,
  Star,
  Trophy,
  Calendar,
  Plus,
  Bell,
  CheckCircle2,
  XCircle,
  Loader2,
  Settings,
  User,
  Trash2,
  X,
  RotateCcw,
  CalendarClock,
  AlertTriangle,
  Package,
  BarChart2,
  ImageIcon,
  Send,
  Home,
  Gift,
} from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { SEOHead } from '@/components/SEOHead';
import { useClientPortal } from "@/contexts/ClientPortalContext";
import { supabase } from "@/lib/supabase";
import { readEdgeFunctionError } from '@/lib/edgeFunctionError';
import { PortalSettingsTab } from "@/components/portal/PortalSettingsTab";
import { PortalProfileTab } from "@/components/portal/PortalProfileTab";
import { PortalPaymentMethodCard } from '@/components/portal/PortalPaymentMethodCard';
import { ThemeToggle } from '@/components/admin/ThemeToggle';
import { PortalPhotoJournalTab } from "@/components/portal/PortalPhotoJournalTab";
import { LoyaltyTierBanner } from "@/components/portal/LoyaltyTierBanner";
import { useOrgTiers } from "@/hooks/useOrgTiers";
import { tierProgressPercent, type TierDef } from "@/lib/loyaltyTier";

import { usePlatform } from "@/hooks/usePlatform";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { orgAddDays } from '@/lib/orgDateRange';

interface Booking {
  id: string;
  booking_number: number;
  scheduled_at: string;
  status: string;
  total_amount: number;
  address: string | null;
  service: { name: string } | null;
  service_id: string | null;
}

interface BookingRequest {
  id: string;
  requested_date: string;
  status: string;
  notes: string | null;
  admin_response_note: string | null;
  created_at: string;
  service_name: string | null;
}

interface Notification {
  id: string;
  title: string;
  message: string;
  type: string;
  is_read: boolean;
  created_at: string;
}

interface InspectionReport {
  id: string;
  photo_url: string;
  inspection_note: string | null;
  issue_category: 'broken' | 'missing' | 'low_inventory' | 'general' | null;
  created_at: string | null;
  booking: {
    booking_number: number;
    scheduled_at: string;
  } | null;
}

const INSPECTION_CATEGORY_CONFIG = {
  broken:        { label: 'Broken',        icon: AlertTriangle, chip: 'pv-chip-danger' },
  missing:       { label: 'Missing',       icon: Package,       chip: 'pv-chip-warn' },
  low_inventory: { label: 'Low inventory', icon: BarChart2,     chip: 'pv-chip-warn' },
  general:       { label: 'Note',          icon: ImageIcon,     chip: 'pv-chip-neutral' },
} as const;

// Loyalty is tiers-only. There is no points redemption, no credit balance, and
// no Redeem button — tier benefits are applied by the business, not claimed
// here. The previous LoyaltyRedeemButton lived at this spot.
//
// NOTE: this component is deliberately defined at MODULE scope, not inside the
// page component. When it was an inline `const LoyaltyCard = () => (...)`, every
// parent re-render created a new component identity, so React unmounted and
// remounted the whole subtree — which reset the redeem button's in-flight guard
// and let the same customer redeem repeatedly. Keep it out here.
function PortalLoyaltyCard({
  points,
  tier,
  lifetimeSpend,
  tiers,
}: {
  points: number;
  tier: string | null;
  lifetimeSpend: number | null | undefined;
  tiers: TierDef[] | undefined;
}) {
  // Progress is derived from this org's own thresholds. It used to come from a
  // hardcoded { bronze: 25, silver: 50, gold: 75, platinum: 100 } lookup, which
  // returned 25% for every org that renamed its tiers. Null when we cannot know.
  const progress =
    tiers && tiers.length > 0 && lifetimeSpend !== null && lifetimeSpend !== undefined
      ? tierProgressPercent(lifetimeSpend, tiers)
      : null;

  return (
    <Card className="pv-quiet" data-testid="portal-loyalty-card">
      <CardContent className="px-4 sm:px-2 py-4">
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="pv-eyebrow mb-1">Loyalty</p>
            <p className="text-[13.5px] text-[hsl(var(--pv-ink-2))] capitalize">
              <span className="text-[hsl(var(--pv-ink))] font-medium">{points}</span> pts
              {tier ? (
                <>
                  <span className="text-[hsl(var(--pv-ink-4))] mx-1.5">·</span>
                  {tier} member
                </>
              ) : null}
            </p>
          </div>
          <Trophy className="h-4 w-4 text-[hsl(var(--pv-ink-4))] shrink-0" />
        </div>
        {/* Omit the bar entirely rather than show a meaningless 0% or 25% */}
        {progress !== null && (
          <Progress value={progress} className="h-1 mt-3 bg-[hsl(var(--pv-sunken))]" />
        )}
      </CardContent>
    </Card>
  );
}

function InspectionPhoto({ path }: { path: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState(false);

  const fetchUrl = () => {
    setError(false);
    supabase.storage.from('booking-photos').createSignedUrl(path, 3600).then(({ data }) => {
      if (data?.signedUrl) setUrl(data.signedUrl);
    });
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps -- fetchUrl is recreated each render; runs once per path
  useEffect(() => { fetchUrl(); }, [path]);

  if (error) return (
    <div className="w-full h-40 bg-[hsl(var(--pv-sunken))] rounded-t-[16px] flex flex-col items-center justify-center gap-2">
      <ImageIcon className="w-6 h-6 text-[hsl(var(--pv-ink-4))]" />
      <button onClick={fetchUrl} className="text-xs text-[hsl(var(--pv-brand))] underline">Reload</button>
    </div>
  );
  if (!url) return <div className="w-full h-40 bg-[hsl(var(--pv-sunken))] rounded-t-[16px] flex items-center justify-center"><Loader2 className="w-5 h-5 animate-spin text-[hsl(var(--pv-ink-4))]" /></div>;
  return <img src={url} alt="Inspection" className="w-full h-40 object-cover rounded-t-[16px]" height={160} loading="lazy" onError={fetchUrl} />;
}

/* ─────────────────────────── Chips / small atoms ─────────────────────────── */

function StatusChip({ status }: { status: string }) {
  const map: Record<string, { label: string; chip: string }> = {
    pending:   { label: 'Pending',   chip: 'pv-chip-neutral' },
    approved:  { label: 'Approved',  chip: 'pv-chip-brand' },
    rejected:  { label: 'Rejected',  chip: 'pv-chip-danger' },
    confirmed: { label: 'Confirmed', chip: 'pv-chip-brand' },
    completed: { label: 'Completed', chip: 'pv-chip-success' },
    cancelled: { label: 'Cancelled', chip: 'pv-chip-danger' },
  };
  const s = map[status] || { label: status, chip: 'pv-chip-neutral' };
  return <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-medium ${s.chip}`}>{s.label}</span>;
}

/* ───────────────────────────── Bottom Nav (pill) ─────────────────────────── */

function BottomPillNav({
  activeTab,
  onTab,
  onRequest,
  unread,
  reportsCount,
}: {
  activeTab: string;
  onTab: (v: string) => void;
  onRequest: () => void;
  unread: number;
  reportsCount: number;
}) {
  const items = [
    { id: 'upcoming',      label: 'Home',    icon: Home },
    { id: 'history',       label: 'History', icon: CalendarDays },
    { id: 'notifications', label: 'Alerts',  icon: Bell,           badge: unread },
    { id: 'reports',       label: 'Reports', icon: AlertTriangle,  badge: reportsCount },
    { id: 'profile',       label: 'You',     icon: User },
  ];
  return (
    <nav className="portal-v2-nav" aria-label="Portal navigation">
      {items.map(({ id, label, icon: Icon, badge }) => (
        <button
          key={id}
          data-active={activeTab === id}
          onClick={() => onTab(id)}
          aria-label={label}
        >
          <span className="relative inline-flex">
            <Icon className="h-[18px] w-[18px]" strokeWidth={2} />
            {badge && badge > 0 ? (
              <span className="absolute -top-1 -right-1.5 min-w-[14px] h-[14px] px-1 rounded-full text-[9px] font-semibold bg-[hsl(var(--pv-danger))] text-white flex items-center justify-center">
                {badge > 9 ? '9+' : badge}
              </span>
            ) : null}
          </span>
          <span className="pv-nav-label">{label}</span>
        </button>
      ))}
      <button
        onClick={onRequest}
        aria-label="Book"
        style={{ background: 'hsl(var(--pv-brand))', color: 'hsl(var(--pv-brand-ink))' }}
        className="!px-3 sm:!px-4"
      >
        <Plus className="h-[18px] w-[18px]" strokeWidth={2.4} />
        <span className="pv-nav-label">Book</span>
      </button>

    </nav>
  );
}

/* ═══════════════════════════════ PAGE ══════════════════════════════════════ */

export default function PortalDashboardPage() {
  const navigate = useNavigate();
  const { user, customer, loyalty, signOut, loading, refreshData, invokePortal } = useClientPortal();
  // tierDefs is the narrow { name, minSpending } shape the tier-math helpers
  // take; the hook's `tiers` carries the full rows for the profile tab.
  const { tierDefs: orgTiers } = useOrgTiers();
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [requests, setRequests] = useState<BookingRequest[]>([]);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [markingAllRead, setMarkingAllRead] = useState(false);
  const [inspectionReports, setInspectionReports] = useState<InspectionReport[]>([]);
  const [referrals, setReferrals] = useState<{id:string;referred_email:string;status:string;credit_amount:number;credit_awarded:boolean;created_at:string}[]>([]);
  const [referralCode, setReferralCode] = useState<string | null>(null);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteName, setInviteName] = useState('');
  const [sendingInvite, setSendingInvite] = useState(false);
  const [loadingData, setLoadingData] = useState(true);
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const [bookingToCancel, setBookingToCancel] = useState<Booking | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [orgTimezone, setOrgTimezone] = useState<string>("America/New_York");
  const [activeTab, setActiveTab] = useState<string>('upcoming');
  const { isNative } = usePlatform();

  useEffect(() => {
    if (!loading && !user) {
      navigate("/portal", { replace: true });
    }
  }, [user, loading, navigate]);

  useEffect(() => {
    if (!user) return;

    const fetchData = async () => {
      setLoadingData(true);

      if (user.organization_id) {
        const { data: settings } = await supabase
          .from("business_settings")
          .select("timezone")
          .eq("organization_id", user.organization_id)
          .maybeSingle();
        if (settings?.timezone) setOrgTimezone(settings.timezone);
      }

      if (!user.customer_id) {
        console.warn("[PortalDashboard] portal user has no customer_id linked", { userId: user.id });
        toast.error(
          "Your portal account isn't linked to a customer profile yet. Please contact support so we can connect it.",
          { duration: 10000 }
        );
        setBookings([]);
        setRequests([]);
        setNotifications([]);
        setInspectionReports([]);
        setLoadingData(false);
        return;
      }

      const { data: bookingsData } = await invokePortal("client-portal-api", {
        body: { action: "get_bookings" },
      });

      const transformedBookings = (bookingsData || []).map((b: any) => ({
        id: b.id,
        booking_number: b.booking_number,
        scheduled_at: b.scheduled_at,
        status: b.status,
        total_amount: b.total_amount,
        address: b.address,
        service: b.service_name ? { name: b.service_name } : null,
        service_id: b.service_id || null,
      }));

      setBookings(transformedBookings);

      const { data: requestsData } = await invokePortal("client-portal-api", {
        body: { action: "get_requests" },
      });

      setRequests((requestsData || []) as BookingRequest[]);

      const { data: notificationsData } = await invokePortal("client-portal-api", {
        body: { action: "get_notifications" },
      });

      setNotifications((notificationsData || []) as Notification[]);

      const bookingIds = (bookingsData || []).map((b: any) => b.id);
      if (bookingIds.length > 0) {
        const { data: inspectionData } = await (supabase
          .from('booking_photos' as any) as any)
          .select(`
            id, photo_url, inspection_note, issue_category, created_at,
            booking:bookings!booking_photos_booking_id_fkey(booking_number, scheduled_at)
          `)
          .in('booking_id', bookingIds)
          .eq('photo_type', 'inspection')
          .order('created_at', { ascending: false });

        const validReports = ((inspectionData || []) as InspectionReport[]).filter(r => r.booking);
        setInspectionReports(validReports);
      }

      if (user.customer_id) {
        // Portal has no Supabase auth session, so any direct RLS-protected
        // query returns nothing. Both the share code and the referral list
        // come from the session-verified edge function.
        const [{ data: userData }, { data: referralData }] = await Promise.all([
          invokePortal("client-portal-api", { body: { action: "get_user_data" } }),
          invokePortal("client-portal-api", { body: { action: "get_referrals" } }),
        ]);

        const share = (Array.isArray(userData) ? userData[0] : userData) as { share_referral_code?: string } | null;
        if (share?.share_referral_code) setReferralCode(share.share_referral_code);

        if (Array.isArray(referralData)) setReferrals(referralData as any);
      }

      setLoadingData(false);
    };

    fetchData();
  // eslint-disable-next-line react-hooks/exhaustive-deps -- invokePortal is recreated each render; runs once when user is set
  }, [user]);

  const handleSignOut = () => {
    signOut();
    navigate("/portal", { replace: true });
  };

  const markNotificationRead = async (id: string) => {
    if (!user) return;
    const { error } = await invokePortal("client-portal-api", {
      body: { action: "mark_notification_read", notificationId: id },
    });
    if (error) {
      console.error("[portal] markNotificationRead failed", error);
      toast.error(await readEdgeFunctionError(error, "Couldn't mark as read. Please try again."));
      return;
    }
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, is_read: true } : n)));
  };

  /**
   * Mark every unread notification read.
   *
   * A LOOP, not a new RPC, deliberately. mark_client_notification_read is
   * per-notification and — since the 2026-07-29 lockdown — reachable only
   * through client-portal-api, so each one is an authenticated edge-function
   * round-trip rather than a direct RPC.
   *
   * Three things keep that acceptable:
   *   - only UNREAD rows are sent, and unread is what the badge shows, so the
   *     realistic count is what a person was willing to look at — not the
   *     lifetime total.
   *   - bounded concurrency, so a long list doesn't open 200 sockets at once.
   *   - the UI updates from what actually succeeded, so a partial failure
   *     leaves the remaining ones visibly unread rather than silently lost.
   *
   * If this ever needs to handle hundreds, it wants a mark_all RPC instead —
   * roughly where a spinner outlasts someone's patience, call it 50.
   */
  const markAllNotificationsRead = async () => {
    if (!user) return;
    const unread = notifications.filter((n) => !n.is_read);
    if (unread.length === 0) return;

    setMarkingAllRead(true);
    const succeeded = new Set<string>();
    const CONCURRENCY = 4;

    try {
      for (let i = 0; i < unread.length; i += CONCURRENCY) {
        const batch = unread.slice(i, i + CONCURRENCY);
        const results = await Promise.all(
          batch.map(async (n) => {
            const { error } = await invokePortal("client-portal-api", {
              body: { action: "mark_notification_read", notificationId: n.id },
            });
            return { id: n.id, ok: !error };
          }),
        );
        for (const r of results) if (r.ok) succeeded.add(r.id);
      }

      setNotifications((prev) =>
        prev.map((n) => (succeeded.has(n.id) ? { ...n, is_read: true } : n)),
      );

      const failed = unread.length - succeeded.size;
      if (failed === 0) {
        toast.success(`Marked ${succeeded.size} as read`);
      } else if (succeeded.size === 0) {
        toast.error("Couldn't mark those as read. Please try again.");
      } else {
        toast.warning(`Marked ${succeeded.size} as read, ${failed} didn't go through.`);
      }
    } finally {
      setMarkingAllRead(false);
    }
  };

  const deleteNotification = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!user) return;
    // The mark-read step used to log to the console and continue, so a failure
    // here was invisible: the delete proceeded and the toast still said
    // "Notification deleted". Surface it and stop.
    const { error: markError } = await invokePortal("client-portal-api", {
      body: { action: "mark_notification_read", notificationId: id },
    });
    if (markError) {
      console.error("[portal] mark-as-read step of delete failed", markError);
      toast.error(await readEdgeFunctionError(markError, "Couldn't delete that notification. Please try again."));
      return;
    }
    const { data, error: deleteError } = await invokePortal("client-portal-api", {
      body: { action: "delete_notification", notificationId: id },
    });
    if (deleteError) {
      console.error("[portal] deleteNotification failed", deleteError);
      toast.error(await readEdgeFunctionError(deleteError, "Couldn't delete that notification. Please try again."));
      return;
    }
    if (data) {
      setNotifications((prev) => prev.filter((n) => n.id !== id));
      toast.success("Notification deleted");
    } else {
      toast.error("That notification couldn't be deleted.");
    }
  };

  const deleteRequest = async (id: string) => {
    if (!user) return;
    // `error` was previously not destructured at all: a failure left the row on
    // screen with no message, which is the worst way for this to break.
    const { data, error } = await invokePortal("client-portal-api", {
      body: { action: "delete_booking_request", requestId: id },
    });
    if (error) {
      console.error("[portal] deleteRequest failed", error);
      toast.error(await readEdgeFunctionError(error, "Couldn't delete that request. Please try again."));
      return;
    }
    if (data) {
      setRequests((prev) => prev.filter((r) => r.id !== id));
      toast.success("Request deleted");
    }
  };

  const handleCancelClick = (booking: Booking) => {
    setBookingToCancel(booking);
    setCancelDialogOpen(true);
  };

  const confirmCancelBooking = async () => {
    if (!user || !bookingToCancel) return;
    setCancelling(true);
    try {
      // The proxy returns the function's JSONB verbatim, so result.success,
      // result.error and result.within_48_hours are read exactly as before —
      // the 48-hour fee warning depends on that field surviving unflattened.
      const { data, error } = await invokePortal("client-portal-api", {
        body: { action: "cancel_booking", bookingId: bookingToCancel.id },
      });
      if (error) { toast.error(await readEdgeFunctionError(error, "Failed to cancel booking")); return; }
      const result = (data && typeof data === 'object' ? data : null) as {
        success?: boolean; error?: string; within_48_hours?: boolean;
      } | null;
      if (!result) { toast.error("Couldn't complete the cancellation. Please contact us directly."); return; }
      if (!result.success) {
        if (result.within_48_hours) {
          toast.error(result.error || "Same day or next day cancellations may incur a fee. Please contact us directly.", { duration: 6000 });
        } else {
          toast.error(result.error || "Unable to cancel booking");
        }
        return;
      }
      setBookings((prev) => prev.map((b) => b.id === bookingToCancel.id ? { ...b, status: "cancelled" } : b));
      toast.success("Booking cancelled successfully");
    } catch (err) {
      toast.error("An unexpected error occurred");
    } finally {
      setCancelling(false);
      setCancelDialogOpen(false);
      setBookingToCancel(null);
    }
  };

  const handleRebook = (booking: Booking) => {
    const params = new URLSearchParams();
    if (booking.service_id) params.set("service", booking.service_id);
    if (booking.address) params.set("notes", `Same address: ${booking.address}`);
    navigate(`/portal/request?${params.toString()}`);
  };

  const handleReschedule = (booking: Booking) => {
    const params = new URLSearchParams();
    if (booking.service_id) params.set("service", booking.service_id);
    params.set("notes", `Reschedule of booking #${booking.booking_number}${booking.address ? ` at ${booking.address}` : ""}`);
    params.set("reschedule", "true");
    navigate(`/portal/request?${params.toString()}`);
  };

  const sendInvite = async () => {
    if (!user || !inviteEmail.trim()) return;
    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const trimmed = inviteEmail.trim();
    if (!emailPattern.test(trimmed)) {
      toast.error("That doesn't look like a valid email address");
      return;
    }
    setSendingInvite(true);
    try {
      const { data: rpcResult, error: rpcError } = await invokePortal("client-portal-api", {
        body: {
          action: "create_referral",
          p_referred_email: trimmed,
          p_referred_name: inviteName.trim() || null,
        },
      });
      if (rpcError) throw new Error(rpcError.message);
      const result = rpcResult as { error?: string; referral_id?: string };
      if (result?.error) throw new Error(result.error);

      const { error: fnError } = await supabase.functions.invoke('send-referral-invite', {
        body: { referralId: result.referral_id },
      });
      if (fnError) throw new Error(fnError.message);

      toast.success(`Invite sent to ${inviteEmail}!`);
      setInviteEmail('');
      setInviteName('');

      if (user.customer_id) {
        const { data: referralData } = await invokePortal("client-portal-api", {
          body: { action: "get_referrals" },
        });
        if (Array.isArray(referralData)) setReferrals(referralData as any);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to send invite');
    } finally {
      setSendingInvite(false);
    }
  };

  const unreadCount = notifications.filter((n) => !n.is_read).length;
  const upcomingBookings = useMemo(
    () => bookings.filter((b) => new Date(b.scheduled_at) >= new Date() && b.status !== "cancelled" && b.status !== "completed"),
    [bookings]
  );
  const pastBookings = useMemo(
    () => bookings.filter((b) => new Date(b.scheduled_at) < new Date() || b.status === "cancelled" || b.status === "completed"),
    [bookings]
  );

  if (loading || !user || !customer) {
    return (
      <main className="portal-v2 min-h-screen flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-[hsl(var(--pv-ink-4))]" />
      </main>
    );
  }

  // No hardcoded tier default: "bronze" is one org's tier name, and the
  // resolver legitimately returns null for a customer below the lowest
  // threshold. A default here would invent a tier the org never defined.
  const displayLoyalty = loyalty ?? {
    points: 0,
    lifetime_points: 0,
    tier: null as string | null,
    lifetime_spend: null as number | null,
  };

  const getDateLabel = (dateStr: string) => {
    const bookingDay = getDateInTimezone(dateStr, orgTimezone);
    const todayStr = getDateInTimezone(new Date(), orgTimezone);
    // now + 24h read in the org's zone is usually tomorrow and is not on a
    // DST day. orgAddDays steps the org CALENDAR, which is what "Tomorrow" means.
    const tomorrowStr = getDateInTimezone(orgAddDays(new Date(), 1, orgTimezone), orgTimezone);
    if (bookingDay === todayStr) return "Today";
    if (bookingDay === tomorrowStr) return "Tomorrow";
    return formatInTimezone(dateStr, orgTimezone, { weekday: "short", month: "short", day: "numeric" });
  };

  const nextBooking = upcomingBookings.length > 0
    ? upcomingBookings.slice().sort((a, b) => new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime())[0]
    : null;

  const firstName = customer.first_name || 'there';

  /* ─────────────────────────── SHARED SECTIONS ─────────────────────────── */

  const HeroCard = () => (
    <Card className="pv-hero">
      <CardContent className="px-4 sm:px-2 py-6 sm:py-12">
        <p className="pv-eyebrow mb-3">Next appointment</p>
        {nextBooking ? (
          <>
            <h2 className="pv-display text-[26px] sm:text-[44px] leading-[1.05] text-[hsl(var(--pv-ink))] max-w-2xl text-balance break-words">
              {nextBooking.service?.name || "Service"}
            </h2>
            <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 text-[13.5px] sm:text-[14px] text-[hsl(var(--pv-ink-2))]">
              <span className="inline-flex items-center gap-2 min-w-0">
                <Calendar className="h-4 w-4 text-[hsl(var(--pv-ink-4))] shrink-0" />
                <span className="font-medium text-[hsl(var(--pv-ink))]">{getDateLabel(nextBooking.scheduled_at)}</span>
                <span className="text-[hsl(var(--pv-ink-3))]">
                  · {formatInTimezone(nextBooking.scheduled_at, orgTimezone, { hour: "numeric", minute: "2-digit", hour12: true, timeZoneName: 'short' })}
                </span>
              </span>
              {nextBooking.address && (
                <span className="inline-flex items-center gap-2 min-w-0 max-w-full">
                  <MapPin className="h-4 w-4 text-[hsl(var(--pv-ink-4))] shrink-0" />
                  <span className="truncate">{nextBooking.address}</span>
                </span>
              )}
              <StatusChip status={nextBooking.status || 'pending'} />
            </div>
            <div className="mt-6 sm:mt-8 flex flex-wrap items-center gap-2 sm:gap-3">
              <Button
                onClick={() => handleReschedule(nextBooking)}
                className="h-11 rounded-full px-5 sm:px-6 text-[14px] font-medium"
              >
                <CalendarClock className="h-4 w-4 mr-1.5" />
                Reschedule
              </Button>
              <button
                onClick={() => handleCancelClick(nextBooking)}
                className="h-11 px-3 text-[13.5px] font-medium text-[hsl(var(--pv-ink-3))] hover:text-[hsl(var(--pv-danger))] transition-colors"
              >
                Cancel booking
              </button>
            </div>
          </>
        ) : (
          <>
            <h2 className="pv-display text-[26px] sm:text-[40px] leading-[1.08] text-[hsl(var(--pv-ink))]">
              Nothing on the calendar
            </h2>
            <p className="mt-3 text-[15px] text-[hsl(var(--pv-ink-3))] max-w-md">
              When you'd like your next clean, we're a tap away.
            </p>
            <div className="mt-6 sm:mt-8">
              <Button
                onClick={() => navigate('/portal/request')}
                className="h-11 rounded-full px-5 sm:px-6 text-[14px] font-medium"
              >
                <Plus className="h-4 w-4 mr-1.5" />
                Request a booking
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );


  // PortalLoyaltyCard is defined at module scope — see the note beside it.

  const QuickActions = () => (
    <Card className="pv-quiet">
      <CardContent className="px-2 sm:px-2 py-2">
        <p className="pv-eyebrow mb-1 px-2">Shortcuts</p>
        {[
          { icon: Gift,      label: 'Refer a friend', onClick: () => setActiveTab('referrals') },
          { icon: ImageIcon, label: 'Photo journal',  onClick: () => setActiveTab('journal') },
        ].map(({ icon: Icon, label, onClick }) => (
          <button
            key={label}
            onClick={onClick}
            className="w-full flex items-center gap-3 px-2 py-2.5 rounded-[8px] text-left text-[13.5px] text-[hsl(var(--pv-ink-2))]
                       hover:bg-[hsl(var(--pv-sunken))] hover:text-[hsl(var(--pv-ink))] transition-colors"
          >
            <Icon className="h-4 w-4 text-[hsl(var(--pv-ink-4))]" />
            <span className="flex-1">{label}</span>
            <span className="text-[hsl(var(--pv-ink-3))] text-[13px]">→</span>
          </button>
        ))}
      </CardContent>
    </Card>
  );



  /* ─────────────────────────────── LAYOUT ─────────────────────────────── */

  return (
    <main className="portal-v2 min-h-dvh">
      <SEOHead
        title="My Dashboard | Client Portal"
        description="View your bookings, loyalty status, and manage appointments."
        canonical="/portal/dashboard"
        noIndex
      />

      {/* Header */}
      <header
        className={`sticky top-0 z-40 border-b border-[hsl(var(--pv-border))] bg-[hsl(var(--pv-bg)/0.85)] backdrop-blur-md ${isNative ? 'portal-v2-header-safe' : ''}`}
      >
        <div className="max-w-5xl mx-auto px-3 sm:px-6 py-3 flex items-center justify-between gap-2">
          <div className="min-w-0 flex-1">
            <p className="text-[10px] sm:text-[11px] font-medium uppercase tracking-[0.12em] text-[hsl(var(--pv-ink-3))]">Client portal</p>
            <h1 className="pv-display text-[18px] sm:text-[22px] leading-tight text-[hsl(var(--pv-ink))] truncate">
              Hello, {firstName}
            </h1>
          </div>

          <div className="flex items-center gap-1">
            <Sheet>
              <SheetTrigger asChild>
                <button
                  className="relative h-11 w-11 min-h-[44px] min-w-[44px] rounded-full inline-flex items-center justify-center hover:bg-[hsl(var(--pv-sunken))] transition-colors"
                  aria-label="Notifications"
                >
                  <Bell className="h-[18px] w-[18px] text-[hsl(var(--pv-ink-2))]" />
                  {unreadCount > 0 && (
                    <span className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-[hsl(var(--pv-danger))] ring-2 ring-[hsl(var(--pv-bg))]" />
                  )}
                </button>
              </SheetTrigger>
              <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto">
                <SheetHeader>
                  <SheetTitle>Notifications</SheetTitle>
                </SheetHeader>
                <div className="mt-4 space-y-2">
                  {notifications.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-8">No notifications yet</p>
                  ) : (
                    notifications.map((notification) => (
                      <div
                        key={notification.id}
                        className={`p-3 rounded-[12px] border cursor-pointer transition-colors ${
                          !notification.is_read
                            ? 'bg-[hsl(var(--pv-brand-soft))] border-[hsl(var(--pv-brand)/0.25)]'
                            : 'bg-[hsl(var(--pv-surface))] border-[hsl(var(--pv-border))]'
                        }`}
                        onClick={() => markNotificationRead(notification.id)}
                      >
                        <div className="flex items-start gap-3">
                          {notification.type === "approved" ? <CheckCircle2 className="h-4 w-4 text-[hsl(var(--pv-success))] mt-0.5 shrink-0" /> :
                           notification.type === "rejected" ? <XCircle className="h-4 w-4 text-[hsl(var(--pv-danger))] mt-0.5 shrink-0" /> :
                           <Bell className="h-4 w-4 text-[hsl(var(--pv-brand))] mt-0.5 shrink-0" />}
                          <div className="flex-1 min-w-0">
                            <p className="font-medium text-[13.5px]">{notification.title}</p>
                            <p className="text-[12.5px] text-[hsl(var(--pv-ink-3))]">{notification.message}</p>
                            <p className="text-[11px] text-[hsl(var(--pv-ink-3))] mt-1">
                              {formatInTimezone(notification.created_at, orgTimezone, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true, timeZoneName: 'short' })}
                            </p>
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </SheetContent>
            </Sheet>
            {/* Same next-themes mechanism the admin side uses — ThemeProvider
                already wraps every route in App.tsx, so this is the existing
                toggle, not a second implementation. */}
            <ThemeToggle className="h-11 w-11 min-h-[44px] min-w-[44px]" />
            {/* Sign out lives in the header, not only inside the Settings
                sheet. It was reachable only by opening that sheet and scrolling
                past two full tab components — on a shared device a client
                effectively could not get out. 44px tap target, same floor as
                the rest of the app. */}
            <button
              onClick={handleSignOut}
              aria-label="Sign out"
              title="Sign out"
              className="h-11 w-11 min-h-[44px] min-w-[44px] rounded-full inline-flex items-center justify-center hover:bg-[hsl(var(--pv-sunken))] transition-colors"
            >
              <LogOut className="h-[18px] w-[18px] text-[hsl(var(--pv-ink-2))]" />
            </button>
            <Sheet>
              <SheetTrigger asChild>
                <button
                  className="h-11 w-11 min-h-[44px] min-w-[44px] rounded-full inline-flex items-center justify-center hover:bg-[hsl(var(--pv-sunken))] transition-colors"
                  aria-label="Settings"
                >
                  <Settings className="h-[18px] w-[18px] text-[hsl(var(--pv-ink-2))]" />
                </button>
              </SheetTrigger>
              <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto">
                <SheetHeader>
                  <SheetTitle>Settings</SheetTitle>
                </SheetHeader>
                <div className="mt-4 space-y-6">
                  {/* Kept here too — someone already in Settings should not
                      have to close the sheet to sign out. The header button is
                      the discoverable one. */}
                  <Button variant="outline" className="w-full gap-2 h-11 rounded-full text-sm" onClick={handleSignOut}>
                    <LogOut className="h-4 w-4" />
                    Sign out
                  </Button>
                  <PortalProfileTab />
                  <PortalSettingsTab />
                </div>
              </SheetContent>
            </Sheet>
          </div>
        </div>
      </header>

      {/* Content */}
      <div className="portal-v2-scroll max-w-5xl mx-auto px-3 sm:px-6 pt-5 sm:pt-8 overflow-x-clip">
        <LoyaltyTierBanner
          lifetimeSpend={displayLoyalty.lifetime_spend}
          tiers={orgTiers}
        />

        <div className="mt-4 grid gap-5 lg:grid-cols-3">
          {/* min-w-0: grid/flex children default to min-width:auto, so the
              9-tab strip below forced this column (and every card in it)
              wider than the phone screen instead of scrolling. */}
          <div className="lg:col-span-2 space-y-5 min-w-0">
            <HeroCard />

            <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full min-w-0">
              <div className="portal-v2-tabs-scroller">
                <TabsList className="w-full max-w-full overflow-x-auto no-scrollbar flex flex-nowrap justify-start h-auto snap-x">
                  <TabsTrigger value="upcoming" className="snap-start shrink-0 whitespace-nowrap">Upcoming</TabsTrigger>
                  <TabsTrigger value="requests" className="snap-start shrink-0 whitespace-nowrap">Requests</TabsTrigger>
                  <TabsTrigger value="history" className="snap-start shrink-0 whitespace-nowrap">History</TabsTrigger>
                  <TabsTrigger value="notifications" className="snap-start shrink-0 whitespace-nowrap">
                    Alerts{unreadCount > 0 && <span className="ml-1.5 text-[hsl(var(--pv-danger))]">{unreadCount}</span>}
                  </TabsTrigger>
                  <TabsTrigger value="journal" className="snap-start shrink-0 whitespace-nowrap">Journal</TabsTrigger>
                  <TabsTrigger value="referrals" className="snap-start shrink-0 whitespace-nowrap">Referrals</TabsTrigger>
                  <TabsTrigger value="reports" className="snap-start shrink-0 whitespace-nowrap">
                    Reports{inspectionReports.length > 0 && <span className="ml-1.5 text-[hsl(var(--pv-warn))]">{inspectionReports.length}</span>}
                  </TabsTrigger>
                  <TabsTrigger value="profile" className="snap-start shrink-0 whitespace-nowrap">Profile</TabsTrigger>
                  <TabsTrigger value="payment" className="snap-start shrink-0 whitespace-nowrap">Payment</TabsTrigger>
                  <TabsTrigger value="settings" className="snap-start shrink-0 whitespace-nowrap">Settings</TabsTrigger>
                </TabsList>
              </div>

              {/* Upcoming */}
              <TabsContent value="upcoming" className="space-y-3 mt-5">
                {loadingData ? (
                  <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-[hsl(var(--pv-ink-4))]" /></div>
                ) : upcomingBookings.length === 0 ? (
                  <EmptyState icon={CalendarDays} title="Nothing upcoming yet" cta="Request a booking" onCta={() => navigate('/portal/request')} />
                ) : (
                  upcomingBookings.map((booking) => (
                    <BookingRow
                      key={booking.id}
                      booking={booking}
                      dateLabel={getDateLabel(booking.scheduled_at)}
                      timeLabel={formatInTimezone(booking.scheduled_at, orgTimezone, { hour: 'numeric', minute: '2-digit', hour12: true, timeZoneName: 'short' })}
                      onReschedule={() => handleReschedule(booking)}
                      onCancel={() => handleCancelClick(booking)}
                    />
                  ))
                )}
              </TabsContent>

              {/* Requests */}
              <TabsContent value="requests" className="space-y-3 mt-5">
                {loadingData ? (
                  <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-[hsl(var(--pv-ink-4))]" /></div>
                ) : requests.length === 0 ? (
                  <EmptyState icon={Clock} title="No booking requests yet" />
                ) : (
                  requests.map((request) => (
                    <Card key={request.id} className="pv-card">
                      <CardContent className="p-4 sm:p-5 flex items-start justify-between gap-4">
                        <div className="min-w-0 flex-1 space-y-1.5">
                          <p className="text-[14.5px] font-medium text-[hsl(var(--pv-ink))]">{request.service_name || 'Service request'}</p>
                          <p className="pv-meta inline-flex items-center gap-1.5">
                            <Calendar className="h-3.5 w-3.5" />
                            {formatInTimezone(request.requested_date, orgTimezone, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true, timeZoneName: 'short' })}
                          </p>
                          {request.notes && <p className="text-[13px] text-[hsl(var(--pv-ink-2))]">{request.notes}</p>}
                          {request.admin_response_note && (
                            <p className="text-[13px] text-[hsl(var(--pv-brand))]">Response: {request.admin_response_note}</p>
                          )}
                        </div>
                        <div className="flex flex-col items-end gap-2 shrink-0">
                          <StatusChip status={request.status} />
                          <button
                            onClick={() => deleteRequest(request.id)}
                            className="h-11 w-11 rounded-full inline-flex items-center justify-center text-[hsl(var(--pv-ink-3))] hover:text-[hsl(var(--pv-danger))] hover:bg-[hsl(var(--pv-danger-soft))] transition-colors"
                            aria-label="Delete request"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </CardContent>
                    </Card>
                  ))
                )}
              </TabsContent>

              {/* History */}
              <TabsContent value="history" className="space-y-3 mt-5">
                {loadingData ? (
                  <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-[hsl(var(--pv-ink-4))]" /></div>
                ) : pastBookings.length === 0 ? (
                  <EmptyState icon={Star} title="No booking history yet" />
                ) : (
                  pastBookings.map((booking) => (
                    <Card key={booking.id} className="pv-card">
                      <CardContent className="p-4 sm:p-5 flex items-start justify-between gap-4">
                        <div className="min-w-0 space-y-1.5">
                          <p className="text-[14.5px] font-medium text-[hsl(var(--pv-ink))]">{booking.service?.name || 'Service'}</p>
                          <p className="pv-meta inline-flex items-center gap-1.5">
                            <Calendar className="h-3.5 w-3.5" />
                            {formatInTimezone(booking.scheduled_at, orgTimezone, { month: 'short', day: 'numeric', year: 'numeric' })}
                          </p>
                          {booking.address && (
                            <p className="pv-meta inline-flex items-center gap-1.5">
                              <MapPin className="h-3.5 w-3.5" />
                              <span className="truncate">{booking.address}</span>
                            </p>
                          )}
                        </div>
                        <div className="flex flex-col items-end gap-2 shrink-0">
                          <StatusChip status={booking.status} />
                          <p className="pv-display text-[18px] text-[hsl(var(--pv-ink))] tabular-nums">${booking.total_amount}</p>
                          {booking.status === 'completed' && (
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-9 rounded-full px-3 text-[12.5px]"
                              onClick={() => handleRebook(booking)}
                            >
                              <RotateCcw className="h-3.5 w-3.5 mr-1" />
                              Rebook
                            </Button>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  ))
                )}
              </TabsContent>

              {/* Alerts */}
              <TabsContent value="notifications" className="space-y-3 mt-5">
                {/* Only offered when there is something to do — a Mark all read
                    that does nothing is a button that teaches people the app is
                    unresponsive. */}
                {unreadCount > 0 && (
                  <div className="flex justify-end mb-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={markAllNotificationsRead}
                      disabled={markingAllRead}
                      className="gap-1.5"
                    >
                      {markingAllRead && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                      Mark all read ({unreadCount})
                    </Button>
                  </div>
                )}
                {loadingData ? (
                  <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-[hsl(var(--pv-ink-4))]" /></div>
                ) : notifications.length === 0 ? (
                  <EmptyState icon={Bell} title="No notifications yet" />
                ) : (
                  notifications.map((notification) => (
                    <Card
                      key={notification.id}
                      className={`pv-card cursor-pointer ${!notification.is_read ? 'bg-[hsl(var(--pv-brand-soft))] border-[hsl(var(--pv-brand)/0.25)]' : ''}`}
                      onClick={() => markNotificationRead(notification.id)}
                    >
                      <CardContent className="p-4 flex items-start gap-3">
                        {notification.type === 'approved' ? <CheckCircle2 className="h-4 w-4 text-[hsl(var(--pv-success))] mt-0.5" /> :
                         notification.type === 'rejected' ? <XCircle className="h-4 w-4 text-[hsl(var(--pv-danger))] mt-0.5" /> :
                         <Bell className="h-4 w-4 text-[hsl(var(--pv-brand))] mt-0.5" />}
                        <div className="flex-1 min-w-0">
                          <p className="text-[14px] font-medium text-[hsl(var(--pv-ink))]">{notification.title}</p>
                          <p className="text-[13px] text-[hsl(var(--pv-ink-3))]">{notification.message}</p>
                          <p className="text-[11.5px] text-[hsl(var(--pv-ink-3))] mt-1">
                            {formatInTimezone(notification.created_at, orgTimezone, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true, timeZoneName: 'short' })}
                          </p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          {!notification.is_read && <div className="h-2 w-2 rounded-full bg-[hsl(var(--pv-brand))]" />}
                          <button
                            onClick={(e) => deleteNotification(notification.id, e)}
                            className="h-11 w-11 rounded-full inline-flex items-center justify-center text-[hsl(var(--pv-ink-3))] hover:text-[hsl(var(--pv-danger))] hover:bg-[hsl(var(--pv-danger-soft))] transition-colors"
                            aria-label="Delete notification"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </CardContent>
                    </Card>
                  ))
                )}
              </TabsContent>

              {/* Journal */}
              <TabsContent value="journal" className="space-y-3 mt-5">
                <div>
                  <h2 className="pv-display text-[22px] text-[hsl(var(--pv-ink))]">Photo journal</h2>
                  <p className="text-[13.5px] text-[hsl(var(--pv-ink-3))] mt-1">A visual history of every cleaning, captured by your team.</p>
                </div>
                <PortalPhotoJournalTab />
              </TabsContent>

              {/* Referrals */}
              <TabsContent value="referrals" className="space-y-4 mt-5">
                <div>
                  <h2 className="pv-display text-[22px] text-[hsl(var(--pv-ink))]">Refer a friend</h2>
                  <p className="text-[13.5px] text-[hsl(var(--pv-ink-3))] mt-1">
                    Earn ${referrals[0]?.credit_amount ?? 25} credit for every friend who books a cleaning.
                  </p>
                </div>
                {referralCode ? (
                  <Card className="pv-card"><CardContent className="p-4 sm:p-5">
                    <p className="pv-eyebrow mb-2">Your referral code</p>
                    <div className="flex items-center gap-2">
                      <code className="flex-1 bg-[hsl(var(--pv-sunken))] px-3 py-2.5 rounded-[10px] text-[14px] font-mono font-semibold tracking-[0.08em] text-[hsl(var(--pv-ink))]">{referralCode}</code>
                      <Button size="sm" variant="outline" className="h-11 rounded-full px-4" onClick={() => { navigator.clipboard.writeText(referralCode); toast.success('Copied!'); }}>Copy</Button>
                    </div>
                  </CardContent></Card>
                ) : (
                  <Card className="pv-card"><CardContent className="p-4 text-center text-[13px] text-[hsl(var(--pv-ink-3))]">
                    Your referral code is being set up. Please check back shortly.
                  </CardContent></Card>
                )}

                <Card className="pv-card"><CardContent className="p-4 sm:p-5 space-y-3">
                  <p className="text-[14px] font-medium text-[hsl(var(--pv-ink))]">Send an email invite</p>
                  <div>
                    <Label htmlFor="invite-email" className="text-[12px] text-[hsl(var(--pv-ink-3))]">Friend's email</Label>
                    <Input id="invite-email" type="email" placeholder="friend@example.com" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} className="mt-1 h-11 rounded-[10px]" />
                  </div>
                  <div>
                    <Label htmlFor="invite-name" className="text-[12px] text-[hsl(var(--pv-ink-3))]">Friend's name (optional)</Label>
                    <Input id="invite-name" type="text" placeholder="Jane" value={inviteName} onChange={(e) => setInviteName(e.target.value)} className="mt-1 h-11 rounded-[10px]" />
                  </div>
                  <Button className="w-full h-11 rounded-full gap-2" onClick={sendInvite} disabled={sendingInvite || !inviteEmail.trim()}>
                    {sendingInvite ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                    Send invite
                  </Button>
                </CardContent></Card>

                {referrals.length > 0 && (
                  <div>
                    <p className="pv-eyebrow mb-2">Your referrals ({referrals.length})</p>
                    <div className="space-y-2">
                      {referrals.map((r) => (
                        <div key={r.id} className="flex items-center justify-between p-3.5 border border-[hsl(var(--pv-border))] bg-[hsl(var(--pv-surface))] rounded-[12px] text-[13.5px]">
                          <div>
                            <p className="font-medium text-[hsl(var(--pv-ink))]">{r.referred_email}</p>
                            <p className="text-[12px] text-[hsl(var(--pv-ink-3))]">{formatInTimezone(r.created_at, orgTimezone, { month: 'short', day: 'numeric', year: 'numeric' })}</p>
                          </div>
                          <div className="text-right space-y-1">
                            <StatusChip status={r.status === 'completed' ? 'completed' : 'pending'} />
                            {r.credit_awarded && <p className="text-[12px] text-[hsl(var(--pv-success))] font-medium">${r.credit_amount} earned</p>}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </TabsContent>

              {/* Reports */}
              <TabsContent value="reports" className="space-y-3 mt-5">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-[hsl(var(--pv-warn))]" />
                  <h2 className="pv-display text-[22px] text-[hsl(var(--pv-ink))]">Property reports</h2>
                </div>
                <p className="text-[13.5px] text-[hsl(var(--pv-ink-3))]">Items your cleaner flagged during a visit.</p>
                {loadingData ? (
                  <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-[hsl(var(--pv-ink-4))]" /></div>
                ) : inspectionReports.length === 0 ? (
                  <Card className="pv-card"><CardContent className="p-10 text-center">
                    <CheckCircle2 className="h-8 w-8 mx-auto text-[hsl(var(--pv-success))] mb-3" />
                    <p className="pv-display text-[18px] text-[hsl(var(--pv-ink))]">All good</p>
                    <p className="text-[13px] text-[hsl(var(--pv-ink-3))] mt-1">No property issues have been reported.</p>
                  </CardContent></Card>
                ) : (
                  <div className="grid gap-3 sm:grid-cols-2">
                    {inspectionReports.map((report) => {
                      const cat = report.issue_category || 'general';
                      const config = INSPECTION_CATEGORY_CONFIG[cat as keyof typeof INSPECTION_CATEGORY_CONFIG] || INSPECTION_CATEGORY_CONFIG.general;
                      const Icon = config.icon;
                      return (
                        <Card key={report.id} className="pv-card overflow-hidden">
                          <InspectionPhoto path={report.photo_url} />
                          <CardContent className="p-4 space-y-2">
                            <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium ${config.chip}`}>
                              <Icon className="w-3 h-3" />
                              {config.label}
                            </span>
                            {report.inspection_note && <p className="text-[13.5px] text-[hsl(var(--pv-ink))]">{report.inspection_note}</p>}
                            {report.booking && (
                              <p className="text-[12px] text-[hsl(var(--pv-ink-3))]">
                                Booking #{report.booking.booking_number} · {formatInTimezone(report.booking.scheduled_at, orgTimezone, { month: 'short', day: 'numeric', year: 'numeric' })}
                              </p>
                            )}
                          </CardContent>
                        </Card>
                      );
                    })}
                  </div>
                )}
              </TabsContent>

              <TabsContent value="profile" className="mt-5"><PortalProfileTab /></TabsContent>
              <TabsContent value="payment" className="mt-5">
                {/* organization_id lives on the portal user, not the customer record. */}
                {customer?.email && user?.organization_id ? (
                  <PortalPaymentMethodCard
                    email={customer.email}
                    customerName={`${customer.first_name ?? ''} ${customer.last_name ?? ''}`.trim()}
                    organizationId={user.organization_id}
                  />
                ) : null}
              </TabsContent>
              <TabsContent value="settings" className="mt-5"><PortalSettingsTab /></TabsContent>
            </Tabs>
          </div>

          {/* Right rail — hidden on mobile, sticky on desktop */}
          <aside className="hidden lg:block space-y-4">
            <div className="sticky top-24 space-y-4">
              <PortalLoyaltyCard
                points={displayLoyalty.points}
                tier={displayLoyalty.tier}
                lifetimeSpend={displayLoyalty.lifetime_spend}
                tiers={orgTiers}
              />
              <QuickActions />
            </div>
          </aside>
        </div>

        {/* Loyalty + quick actions on mobile appear inline below */}
        <div className="lg:hidden mt-5 space-y-4">
          <PortalLoyaltyCard
            points={displayLoyalty.points}
            tier={displayLoyalty.tier}
            lifetimeSpend={displayLoyalty.lifetime_spend}
            tiers={orgTiers}
          />
          <QuickActions />
        </div>
      </div>

      {/* Floating pill nav */}
      <BottomPillNav
        activeTab={activeTab}
        onTab={setActiveTab}
        onRequest={() => navigate('/portal/request')}
        unread={unreadCount}
        reportsCount={inspectionReports.length}
      />

      {/* Cancel dialog */}
      <AlertDialog open={cancelDialogOpen} onOpenChange={setCancelDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel booking?</AlertDialogTitle>
            <AlertDialogDescription>
              {bookingToCancel && (
                <>
                  Are you sure you want to cancel your{' '}
                  <strong>{bookingToCancel.service?.name || 'cleaning'}</strong> scheduled for{' '}
                  <strong>{formatInTimezone(bookingToCancel.scheduled_at, orgTimezone, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true, timeZoneName: 'short' })}</strong>?
                  <br /><br />
                  <span className="text-muted-foreground text-sm">
                    {/* Deliberately names no tier. "Platinum" is one org's tier
                        name, and this dialog is shown to every org's customers —
                        a business with tiers called Copper and Diamond was
                        promising a Platinum benefit. It cannot read the org's own
                        tiers either: no tier-to-fee-waiver rule exists in data
                        (client_tier_settings.benefits is free text), so naming
                        the top tier would invent a promise nobody configured. */}
                    Note: Same day or next day cancellations (within 48 hours) may incur a fee.
                  </span>
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={cancelling}>Keep booking</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmCancelBooking}
              disabled={cancelling}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {cancelling ? (<><Loader2 className="h-4 w-4 mr-2 animate-spin" />Cancelling…</>) : 'Yes, cancel'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  );
}

/* ─────────────────────────── Sub-components ─────────────────────────── */

function EmptyState({ icon: Icon, title, cta, onCta }: { icon: any; title: string; cta?: string; onCta?: () => void }) {
  return (
    <Card className="pv-card">
      <CardContent className="p-10 text-center">
        <Icon className="h-8 w-8 mx-auto text-[hsl(var(--pv-ink-4))] mb-3" />
        <p className="text-[14px] text-[hsl(var(--pv-ink-2))]">{title}</p>
        {cta && (
          <Button variant="link" className="mt-2 text-[hsl(var(--pv-brand))]" onClick={onCta}>{cta}</Button>
        )}
      </CardContent>
    </Card>
  );
}

function BookingRow({
  booking, dateLabel, timeLabel, onReschedule, onCancel,
}: {
  booking: Booking; dateLabel: string; timeLabel: string; onReschedule: () => void; onCancel: () => void;
}) {
  return (
    <Card className="pv-row">
      <CardContent className="px-1 sm:px-2 py-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <p className="text-[14px] font-medium text-[hsl(var(--pv-ink))]">{booking.service?.name || 'Service'}</p>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12.5px] text-[hsl(var(--pv-ink-3))]">
              <span className="inline-flex items-center gap-1.5"><Calendar className="h-3.5 w-3.5" />{dateLabel}</span>
              <span className="inline-flex items-center gap-1.5"><Clock className="h-3.5 w-3.5" />{timeLabel}</span>
              {booking.address && <span className="inline-flex items-center gap-1.5 min-w-0"><MapPin className="h-3.5 w-3.5" /><span className="truncate">{booking.address}</span></span>}
            </div>
          </div>
          <div className="flex items-center justify-between sm:justify-end gap-3 shrink-0">
            <StatusChip status={booking.status} />
            <p className="text-[14px] font-medium text-[hsl(var(--pv-ink))] tabular-nums">${booking.total_amount}</p>
            {booking.status !== 'completed' && booking.status !== 'cancelled' && (
              <div className="flex gap-1">
                <button
                  onClick={onReschedule}
                  className="h-9 px-3 rounded-full text-[12.5px] font-medium text-[hsl(var(--pv-ink-2))] hover:text-[hsl(var(--pv-ink))] hover:bg-[hsl(var(--pv-sunken))] transition-colors"
                >
                  Reschedule
                </button>
                <button
                  onClick={onCancel}
                  className="h-9 w-9 rounded-full inline-flex items-center justify-center text-[hsl(var(--pv-ink-3))] hover:text-[hsl(var(--pv-danger))] hover:bg-[hsl(var(--pv-danger-soft))] transition-colors"
                  aria-label="Cancel"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

