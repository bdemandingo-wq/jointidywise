import { useState, useEffect, useMemo, useRef } from 'react';
import { Bell, Clock, Check, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { ScrollArea } from '@/components/ui/scroll-area';
import { supabase } from '@/lib/supabase';
import { format } from 'date-fns';
import { useOrgTimezone } from '@/hooks/useOrgTimezone';
import { useNavigate } from 'react-router-dom';
import { useOrgId } from '@/hooks/useOrgId';
import { showBrowserNotification } from '@/hooks/usePushNotifications';
import { isIosAppShell } from '@/lib/pushRuntime';
import { useNotificationPreferences, useUpdateNotificationPreferences } from '@/hooks/useNotificationPreferences';
import { isChannelEnabled, isMasterChannelOn, typeByKey } from '@/lib/notificationCatalog';
import { systemNotificationCatalogKey } from '@/lib/notificationGroups';
import { Checkbox } from '@/components/ui/checkbox';
import { orgDayOfWeek, orgDateKey } from '@/lib/orgDateRange';
import { useQueryClient } from '@tanstack/react-query';
import { refreshBadges } from '@/lib/badgeRefresh';
import { OrgTimestamp } from '@/components/OrgTimestamp';
import { ADMIN_NOTIFICATION_REFRESH } from '@/lib/adminNotificationRefresh';

interface AdminNotification {
  id: string;
  type: 'booking' | 'payment' | 'customer' | 'staff' | 'system';
  /** Catalog key from src/lib/notificationCatalog.ts driving channels + route. */
  typeKey?: string;
  title: string;
  message: string;
  is_read: boolean;
  created_at: string;
  resource_id?: string;
  resource_type?: string;
  link?: string;
}

type NotificationListener = (orgId: string, list: AdminNotification[]) => void;

const notificationListeners = new Set<NotificationListener>();
const notificationCache = new Map<string, AdminNotification[]>();
const notificationInflight = new Map<string, Promise<AdminNotification[]>>();

let notificationChannel: ReturnType<typeof supabase.channel> | null = null;
let notificationChannelOrg: string | null = null;
let notificationChannelHolders = 0;
let notificationTimezone = 'America/New_York';
let notificationPushAllowed: (typeKey?: string) => boolean = () => false;

function publishNotifications(orgId: string, list: AdminNotification[]) {
  notificationCache.set(orgId, list);
  for (const listener of notificationListeners) listener(orgId, list);
}

function updateStoredNotifications(
  orgId: string,
  update: (prev: AdminNotification[]) => AdminNotification[],
) {
  publishNotifications(orgId, update(notificationCache.get(orgId) ?? []));
}

function deliverAdminBrowserNotification(notification: Pick<AdminNotification, 'id' | 'title' | 'message'>) {
  if (
    typeof window !== 'undefined' &&
    'Notification' in window &&
    !isIosAppShell() &&
    Notification.permission === 'default'
  ) {
    Notification.requestPermission().catch(() => {});
  }
  showBrowserNotification({
    title: notification.title,
    body: notification.message,
    tag: notification.id,
  });
}

/**
 * The header mounts this bell twice (desktop row and mobile row). One load
 * serves both. The three reads used to run one after another, and the Monday
 * reminder downloaded every booking id in the week to count them.
 */
async function loadAdminNotifications(organizationId: string, orgTimezone: string): Promise<AdminNotification[]> {
  const today = new Date();
  const dayOfWeek = orgDayOfWeek(today, orgTimezone);
  const todayKey = orgDateKey(today, orgTimezone);
  const weeklyKey = `weekly-reminder-dismissed-${organizationId}-${todayKey}`;
  const wantWeekly = dayOfWeek === 1 && localStorage.getItem(weeklyKey) !== 'true';
  const weekEnd = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();

  const requestsQuery = supabase
    .from('admin_booking_request_notifications')
    .select(`
      id,
      is_read,
      created_at,
      booking_request:client_booking_requests(
        id,
        requested_date,
        customer:customers(first_name, last_name),
        service:services(name)
      )
    `)
    .eq('organization_id', organizationId)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(10);

  const bookingsQuery = supabase
    .from('bookings')
    .select(`
      id,
      booking_number,
      status,
      created_at,
      payment_status,
      scheduled_at,
      customers:customer_id (first_name, last_name),
      services:service_id (name)
    `)
    .eq('organization_id', organizationId)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(10);

  const systemQuery = supabase
    .from('admin_system_notifications')
    .select('id, type, title, message, link, is_read, created_at')
    .eq('organization_id', organizationId)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(15);

  const weeklyQuery = wantWeekly
    ? supabase
      .from('bookings')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', organizationId)
      .in('status', ['pending', 'confirmed'])
      .gte('scheduled_at', today.toISOString())
      .lte('scheduled_at', weekEnd)
    : Promise.resolve({ count: 0, error: null });

  const [requestResult, bookingResult, systemResult, weeklyResult] = await Promise.all([
    requestsQuery,
    bookingsQuery,
    systemQuery,
    weeklyQuery,
  ]);

  type RequestRow = {
    id: string;
    is_read: boolean;
    created_at: string;
    booking_request?: {
      id?: string;
      requested_date?: string | null;
      customer?: { first_name?: string | null; last_name?: string | null } | null;
      service?: { name?: string | null } | null;
    } | null;
  };
  type BookingRow = {
    id: string;
    status?: string | null;
    created_at: string;
    payment_status?: string | null;
    scheduled_at?: string | null;
    customers?: { first_name?: string | null; last_name?: string | null } | null;
    services?: { name?: string | null } | null;
  };
  type SystemRow = {
    id: string;
    type: string;
    title: string;
    message: string;
    link?: string | null;
    is_read: boolean | null;
    created_at: string;
  };

  const requestRows = (requestResult.data ?? []) as RequestRow[];
  const bookingRows = (bookingResult.error ? [] : (bookingResult.data ?? [])) as BookingRow[];
  const systemRows = (systemResult.data ?? []) as SystemRow[];

  const bookingRequestNotifs: AdminNotification[] = requestRows.map((n) => {
    const customerName = n.booking_request?.customer
      ? `${n.booking_request.customer.first_name} ${n.booking_request.customer.last_name}`
      : 'Customer';
    const serviceName = n.booking_request?.service?.name || 'Service';
    const requestDate = n.booking_request?.requested_date
      ? format(new Date(n.booking_request.requested_date), 'MMM d, yyyy')
      : 'TBD';
    return {
      id: `request-${n.id}`,
      type: 'customer' as const,
      typeKey: 'client.portal_request',
      title: 'New Booking Request',
      message: `${customerName} requested ${serviceName} on ${requestDate}`,
      is_read: n.is_read,
      created_at: n.created_at,
      resource_id: n.booking_request?.id,
      resource_type: 'booking_request',
    };
  });

  const bookingNotifications: AdminNotification[] = bookingRows.map((booking) => {
    const customerName = booking.customers
      ? `${booking.customers.first_name} ${booking.customers.last_name}`
      : 'Unknown Customer';
    const serviceName = booking.services?.name || 'Service';
    const cleanDate = booking.scheduled_at
      ? format(new Date(booking.scheduled_at), 'MMM d, yyyy')
      : 'TBD';
    return {
      id: `booking-${booking.id}`,
      type: 'booking' as const,
      typeKey: 'booking.new',
      title: customerName,
      message: `${serviceName} • ${cleanDate}`,
      is_read: true,
      created_at: booking.created_at,
      resource_id: booking.id,
      resource_type: 'booking',
    };
  });

  const weeklyReminders: AdminNotification[] = [];
  const weeklyCount = weeklyResult.error ? 0 : (weeklyResult.count ?? 0);
  if (wantWeekly && weeklyCount > 0) {
    weeklyReminders.push({
      id: `weekly-reminder-${todayKey}`,
      type: 'system',
      title: '📅 Weekly Booking Reminders',
      message: `You have ${weeklyCount} upcoming booking${weeklyCount > 1 ? 's' : ''} this week. Send reminders to your customers!`,
      is_read: false,
      created_at: today.toISOString(),
      resource_type: 'reminder',
    });
  }

  const systemNotifications: AdminNotification[] = systemRows.map((n) => ({
    id: `system-${n.id}`,
    type: 'system' as const,
    typeKey: systemNotificationCatalogKey(n.type),
    title: n.title,
    message: n.message,
    is_read: !!n.is_read,
    created_at: n.created_at,
    resource_id: n.id,
    resource_type: n.type,
    link: n.link || undefined,
  }));

  return [...bookingRequestNotifs, ...bookingNotifications, ...weeklyReminders, ...systemNotifications]
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
}

function loadAdminNotificationsShared(organizationId: string, orgTimezone: string, force: boolean) {
  if (!force) {
    const pending = notificationInflight.get(organizationId);
    if (pending) return pending;
  }
  const promise = loadAdminNotifications(organizationId, orgTimezone);
  if (!force) notificationInflight.set(organizationId, promise);
  return promise.finally(() => {
    if (notificationInflight.get(organizationId) === promise) {
      notificationInflight.delete(organizationId);
    }
  });
}

function bookingCustomerName(value: { first_name?: string | null; last_name?: string | null } | null | undefined) {
  if (!value) return null;
  const name = `${value.first_name ?? ''} ${value.last_name ?? ''}`.trim();
  return name || null;
}

function ensureNotificationChannel(organizationId: string) {
  if (notificationChannel && notificationChannelOrg === organizationId) return;
  if (notificationChannel) {
    void supabase.removeChannel(notificationChannel);
    notificationChannel = null;
  }
  notificationChannelOrg = organizationId;
  notificationChannel = supabase
    .channel(`admin-notifications-${organizationId}`)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'admin_booking_request_notifications',
        filter: `organization_id=eq.${organizationId}`,
      },
      () => {
        void loadAdminNotificationsShared(organizationId, notificationTimezone, true).then((list) => {
          publishNotifications(organizationId, list);
        });
        if (notificationPushAllowed('client.portal_request')) {
          deliverAdminBrowserNotification({
            id: `request-${Date.now()}`,
            title: 'New Booking Request',
            message: 'A new booking request is waiting for review.',
          });
        }
      },
    )
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'bookings',
        filter: `organization_id=eq.${organizationId}`,
      },
      (payload) => {
        const newBooking = payload.new as {
          id?: string;
          scheduled_at?: string;
          created_at?: string;
        };
        if (!newBooking.id) return;
        const newNotification: AdminNotification = {
          id: `booking-${newBooking.id}`,
          type: 'booking',
          typeKey: 'booking.new',
          title: 'New Booking Created',
          message: `Scheduled for ${newBooking.scheduled_at ? format(new Date(newBooking.scheduled_at), 'MMM d') : 'TBD'}`,
          is_read: false,
          created_at: newBooking.created_at ?? new Date().toISOString(),
          resource_id: newBooking.id,
          resource_type: 'booking',
        };
        updateStoredNotifications(organizationId, (prev) => (
          prev.some((entry) => entry.id === newNotification.id) ? prev : [newNotification, ...prev]
        ));
        if (notificationPushAllowed('booking.new')) deliverAdminBrowserNotification(newNotification);
      },
    )
    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'bookings',
        filter: `organization_id=eq.${organizationId}`,
      },
      async (payload) => {
        const updatedBooking = payload.new as {
          id?: string;
          status?: string;
          payment_status?: string;
        };
        const oldBooking = payload.old as {
          status?: string;
          payment_status?: string;
        };
        if (!updatedBooking.id) return;
        const statusChanged = Object.prototype.hasOwnProperty.call(oldBooking, 'status')
          && oldBooking.status !== updatedBooking.status;
        const paymentChanged = Object.prototype.hasOwnProperty.call(oldBooking, 'payment_status')
          && oldBooking.payment_status !== updatedBooking.payment_status;
        if (!statusChanged && !paymentChanged) return;

        let customerName = 'Customer';
        let scheduledDate = '';
        const { data: bookingDetails } = await supabase
          .from('bookings')
          .select('customers:customer_id(first_name, last_name), scheduled_at')
          .eq('id', updatedBooking.id)
          .single();
        if (bookingDetails) {
          const named = bookingCustomerName(
            bookingDetails.customers as { first_name?: string | null; last_name?: string | null } | null,
          );
          if (named) customerName = named;
          if (bookingDetails.scheduled_at) scheduledDate = format(new Date(bookingDetails.scheduled_at), 'MMM d, yyyy');
        }

        const statusKey =
          paymentChanged && updatedBooking.payment_status === 'failed' ? 'booking.payment_failed' :
          statusChanged && updatedBooking.status === 'cancelled' ? 'booking.cancelled' :
          statusChanged && updatedBooking.status === 'completed' ? 'booking.completed' :
          statusChanged && updatedBooking.status === 'confirmed' ? 'booking.confirmed' :
          statusChanged ? 'booking.rescheduled' :
          null;
        if (!statusKey) return;
        const newNotification: AdminNotification = {
          id: `booking-update-${updatedBooking.id}-${Date.now()}`,
          type: 'booking',
          typeKey: statusKey,
          title: `${customerName}${scheduledDate ? ` • ${scheduledDate}` : ''}`,
          message: statusKey === 'booking.payment_failed'
            ? 'Payment failed'
            : `Status changed to ${updatedBooking.status}`,
          is_read: false,
          created_at: new Date().toISOString(),
          resource_id: updatedBooking.id,
          resource_type: 'booking',
        };
        updateStoredNotifications(organizationId, (prev) => [newNotification, ...prev]);
        if (notificationPushAllowed(statusKey)) deliverAdminBrowserNotification(newNotification);
      },
    )
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'admin_system_notifications',
        filter: `organization_id=eq.${organizationId}`,
      },
      () => {
        void loadAdminNotificationsShared(organizationId, notificationTimezone, true).then((list) => {
          publishNotifications(organizationId, list);
        });
      },
    )
    .subscribe();
}

function onNotificationPullRefresh() {
  const orgId = notificationChannelOrg;
  if (!orgId) return;
  void loadAdminNotificationsShared(orgId, notificationTimezone, true)
    .then((list) => publishNotifications(orgId, list))
    .catch((error) => {
      console.error('Error fetching notifications:', error);
    });
}

function holdNotificationChannel(organizationId: string) {
  notificationChannelHolders += 1;
  if (notificationChannelHolders === 1) {
    window.addEventListener(ADMIN_NOTIFICATION_REFRESH, onNotificationPullRefresh);
  }
  ensureNotificationChannel(organizationId);
  return () => {
    notificationChannelHolders -= 1;
    if (notificationChannelHolders <= 0) {
      notificationChannelHolders = 0;
      window.removeEventListener(ADMIN_NOTIFICATION_REFRESH, onNotificationPullRefresh);
      if (notificationChannel) void supabase.removeChannel(notificationChannel);
      notificationChannel = null;
      notificationChannelOrg = null;
    }
  };
}

export function AdminNotificationBell() {
  // The weekly reminder is about the BUSINESS's week and is dismissed per
  // business day, so both come from the org's clock.
  const { timezone: orgTimezone } = useOrgTimezone();
  const { organizationId } = useOrgId();
  const navigate = useNavigate();
  const [notifications, setNotifications] = useState<AdminNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isOpen, setIsOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(() => {
    if (typeof window === 'undefined') return new Set();
    try {
      return new Set(JSON.parse(localStorage.getItem('admin-notif-dismissed') || '[]'));
    } catch { return new Set(); }
  });
  const prefs = useNotificationPreferences();
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;
  const { snoozeType } = useUpdateNotificationPreferences();

  const browserPushAllowed = (typeKey?: string) => {
    const current = prefsRef.current;
    if (!typeKey) return isMasterChannelOn('browser_push', current.channels);
    return isChannelEnabled(
      typeKey,
      'browser_push',
      current.notification_matrix,
      current.snoozed_until,
      current.channels,
    );
  };

  const persistDismissed = (next: Set<string>) => {
    setDismissedIds(new Set(next));
    try { localStorage.setItem('admin-notif-dismissed', JSON.stringify([...next])); } catch { /* quota */ }
  };

  // One-time prompt for browser notification permission so desktop notifications
  // actually fire when realtime events arrive (booking requests, new leads, etc.).
  useEffect(() => {
    // Inside the iOS app, window.Notification is not the app's push permission.
    // Calling it here never creates Settings → Notifications and can hang.
    if (typeof window === 'undefined' || !('Notification' in window) || isIosAppShell()) return;
    if (Notification.permission !== 'default') return;
    const KEY = 'admin-notif-permission-asked-v1';
    if (localStorage.getItem(KEY)) return;
    // Defer slightly so it doesn't block initial render
    const t = window.setTimeout(() => {
      localStorage.setItem(KEY, '1');
      Notification.requestPermission().catch(() => {});
    }, 1500);
    return () => window.clearTimeout(t);
  }, []);

  notificationTimezone = orgTimezone;
  notificationPushAllowed = browserPushAllowed;

  useEffect(() => {
    const listener = (orgId: string, list: AdminNotification[]) => {
      if (orgId !== organizationId) return;
      setNotifications(list);
      setUnreadCount(list.filter((n) => !n.is_read).length);
    };
    notificationListeners.add(listener);
    if (organizationId) {
      const cached = notificationCache.get(organizationId);
      if (cached) listener(organizationId, cached);
    }
    return () => { notificationListeners.delete(listener); };
  }, [organizationId]);

  useEffect(() => {
    if (!organizationId) return;
    let cancelled = false;
    const start = () => {
      if (cancelled) return;
      void loadAdminNotificationsShared(organizationId, orgTimezone, false)
        .then((list) => {
          if (!cancelled) publishNotifications(organizationId, list);
        })
        .catch((error) => {
          console.error('Error fetching notifications:', error);
        });
    };
    // A cached list is already on screen. A cold read waits so it does not
    // sit on the same connection as the jobs query the skeleton is blocked on.
    const wait = notificationCache.has(organizationId) ? 0 : 1200;
    const timer = window.setTimeout(start, wait);
    const release = holdNotificationChannel(organizationId);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      release();
    };
  // The zone is whatever this render has. The previous effect did not
  // re-subscribe when business_settings returned the real timezone.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organizationId]);

  // Opening the bell before the deferred read should not show an empty list.
  useEffect(() => {
    if (!isOpen || !organizationId) return;
    let cancelled = false;
    void loadAdminNotificationsShared(organizationId, notificationTimezone, false)
      .then((list) => {
        if (!cancelled) publishNotifications(organizationId, list);
      })
      .catch((error) => {
        console.error('Error fetching notifications:', error);
      });
    return () => { cancelled = true; };
  }, [isOpen, organizationId]);

  const queryClient = useQueryClient();

  const markAsRead = async (notificationId: string) => {
    if (organizationId) {
      updateStoredNotifications(organizationId, (prev) =>
        prev.map((n) => (n.id === notificationId ? { ...n, is_read: true } : n))
      );
    } else {
      setNotifications((prev) =>
        prev.map((n) => (n.id === notificationId ? { ...n, is_read: true } : n))
      );
      setUnreadCount((prev) => Math.max(0, prev - 1));
    }

    // If it's a booking request notification, also mark it as read in the database
    if (notificationId.startsWith('request-')) {
      const dbId = notificationId.replace('request-', '');
      await supabase
        .from('admin_booking_request_notifications')
        .update({ is_read: true })
        .eq('id', dbId);
    } else if (notificationId.startsWith('system-')) {
      const dbId = notificationId.replace('system-', '');
      await supabase
        .from('admin_system_notifications')
        .update({ is_read: true })
        .eq('id', dbId);
    }
    refreshBadges(queryClient);
  };

  const markAllAsRead = async () => {
    if (unreadCount > 0) {
      if (organizationId) {
        updateStoredNotifications(organizationId, (prev) => prev.map((n) => ({ ...n, is_read: true })));
      } else {
        setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
        setUnreadCount(0);
      }
      
      // Also mark all booking request notifications as read in the database
      if (organizationId) {
        await supabase
          .from('admin_booking_request_notifications')
          .update({ is_read: true })
          .eq('organization_id', organizationId)
          .eq('is_read', false);
        await supabase
          .from('admin_system_notifications')
          .update({ is_read: true })
          .eq('organization_id', organizationId)
          .eq('is_read', false);
      }

      // Dismiss weekly reminder so it doesn't reappear
      // Must match the key built above, which is the ORG's day.
      const today = orgDateKey(new Date(), orgTimezone);
      localStorage.setItem(`weekly-reminder-dismissed-${organizationId}-${today}`, 'true');
    } else {
      // Clear all notifications if all are already read
      if (organizationId) updateStoredNotifications(organizationId, () => []);
      else setNotifications([]);
      
      // Also dismiss weekly reminder on clear all
      // Must match the key built above, which is the ORG's day.
      const today = orgDateKey(new Date(), orgTimezone);
      localStorage.setItem(`weekly-reminder-dismissed-${organizationId}-${today}`, 'true');
    }
    setIsOpen(false);
    refreshBadges(queryClient);
  };

  const handleNotificationClick = (notification: AdminNotification) => {
    if (!notification.is_read) {
      markAsRead(notification.id);
    }
    setIsOpen(false);
    const route = notification.typeKey ? typeByKey(notification.typeKey)?.route : undefined;
    const dest = notification.link || route;
    if (dest) navigate(dest);
  };

  const dismissOne = (id: string) => {
    persistDismissed(new Set([...dismissedIds, id]));
    setSelected(prev => {
      const n = new Set(prev); n.delete(id); return n;
    });
  };

  const markSelectedComplete = () => {
    if (!selected.size) return;
    const next = new Set(dismissedIds);
    selected.forEach(id => next.add(id));
    persistDismissed(next);
    if (organizationId) {
      updateStoredNotifications(organizationId, (prev) => prev.map((n) => selected.has(n.id) ? { ...n, is_read: true } : n));
    } else {
      setNotifications(prev => prev.map(n => selected.has(n.id) ? { ...n, is_read: true } : n));
    }
    setSelected(new Set());
    refreshBadges(queryClient);
  };

  const snoozeSelected = async (hours: number) => {
    const typeKeys = new Set<string>();
    notifications.forEach(n => { if (selected.has(n.id) && n.typeKey) typeKeys.add(n.typeKey); });
    for (const k of typeKeys) await snoozeType(k, hours);
    setSelected(new Set());
    refreshBadges(queryClient);
  };

  const getTypeIcon = (type: string) => {
    switch (type) {
      case 'booking': return '📅';
      case 'payment': return '💳';
      case 'customer': return '👤';
      case 'staff': return '👷';
      default: return '🔔';
    }
  };

  // Filter by user preferences (bell channel + snooze) and by dismissed ids.
  const visibleNotifications = useMemo(() => {
    return notifications.filter(n => {
      if (dismissedIds.has(n.id)) return false;
      if (n.typeKey) {
        return isChannelEnabled(n.typeKey, 'bell', prefs.notification_matrix, prefs.snoozed_until, prefs.channels);
      }
      return true;
    });
  }, [notifications, dismissedIds, prefs.notification_matrix, prefs.snoozed_until, prefs.channels]);

  const visibleUnread = visibleNotifications.filter(n => !n.is_read).length;

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative">
          <Bell className="h-5 w-5" />
          {visibleUnread > 0 && (
            <Badge
              variant="destructive"
              className="absolute -top-1 -right-1 h-5 w-5 flex items-center justify-center p-0 text-xs"
            >
              {visibleUnread > 9 ? '9+' : visibleUnread}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-96 p-0" align="end">
        <div className="flex items-center justify-between p-3 border-b gap-2">
          <h4 className="font-semibold text-sm">Notifications</h4>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => navigate('/dashboard/notifications')}>
              Preferences
            </Button>
            {visibleNotifications.length > 0 && (
              <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={markAllAsRead}>
                {visibleUnread > 0 ? 'Mark all read' : 'Clear all'}
              </Button>
            )}
          </div>
        </div>

        {selected.size > 0 && (
          <div className="flex items-center justify-between gap-2 px-3 py-2 bg-muted/40 border-b text-xs">
            <span className="text-muted-foreground">{selected.size} selected</span>
            <div className="flex gap-1">
              <Button size="sm" variant="ghost" className="h-6 px-2 gap-1" onClick={() => snoozeSelected(24)}>
                <Clock className="w-3 h-3" /> 24h
              </Button>
              <Button size="sm" variant="ghost" className="h-6 px-2 gap-1" onClick={markSelectedComplete}>
                <Check className="w-3 h-3" /> Complete
              </Button>
            </div>
          </div>
        )}

        <ScrollArea className="h-80">
          {visibleNotifications.length === 0 ? (
            <div className="p-4 text-center text-muted-foreground text-sm">
              No notifications yet
            </div>
          ) : (
            <div className="divide-y">
              {visibleNotifications.slice(0, 25).map((notification) => {
                const checked = selected.has(notification.id);
                return (
                  <div
                    key={notification.id}
                    className={`group flex items-start gap-2 p-3 hover:bg-muted/50 transition-colors ${
                      !notification.is_read ? 'bg-primary/5' : ''
                    }`}
                  >
                    <Checkbox
                      checked={checked}
                      onCheckedChange={(v) => {
                        setSelected(prev => {
                          const n = new Set(prev);
                          if (v) n.add(notification.id); else n.delete(notification.id);
                          return n;
                        });
                      }}
                      className="mt-1"
                      aria-label="Select notification"
                    />
                    <button
                      type="button"
                      className="flex-1 text-left min-w-0"
                      onClick={() => handleNotificationClick(notification)}
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-base">{getTypeIcon(notification.type)}</span>
                        <p className="font-medium text-sm truncate">{notification.title}</p>
                        {!notification.is_read && (
                          <span className="w-2 h-2 rounded-full bg-primary shrink-0" />
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">
                        {notification.message}
                      </p>
                      <p className="text-[10px] text-muted-foreground mt-1">
                        <OrgTimestamp value={notification.created_at} />
                      </p>
                    </button>
                    <div className="opacity-0 group-hover:opacity-100 flex flex-col gap-1">
                      {notification.typeKey && (
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-6 w-6"
                          title="Snooze 24h"
                          onClick={() => snoozeType(notification.typeKey!, 24)}
                        >
                          <Clock className="w-3.5 h-3.5" />
                        </Button>
                      )}
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-6 w-6"
                        title="Dismiss"
                        onClick={() => dismissOne(notification.id)}
                      >
                        <X className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}
