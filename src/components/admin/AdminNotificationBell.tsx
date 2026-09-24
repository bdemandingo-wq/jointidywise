import { useState, useEffect, useMemo } from 'react';
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
import { formatInTimezone } from '@/lib/timezoneUtils';
import { useNavigate } from 'react-router-dom';
import { useOrgId } from '@/hooks/useOrgId';
import { showBrowserNotification } from '@/hooks/usePushNotifications';
import { useNotificationPreferences, useUpdateNotificationPreferences } from '@/hooks/useNotificationPreferences';
import { isChannelEnabled, typeByKey } from '@/lib/notificationCatalog';
import { Checkbox } from '@/components/ui/checkbox';
import { orgDayOfWeek, orgDateKey } from '@/lib/orgDateRange';
import { useQueryClient } from '@tanstack/react-query';
import { refreshBadges } from '@/lib/badgeRefresh';

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

export function AdminNotificationBell() {
  // The weekly reminder is about the BUSINESS's week and is dismissed per
  // business day, so both come from the org's clock.
  const { timezone: orgTimezone } = useOrgTimezone();
  const { organizationId } = useOrgId();
  const navigate = useNavigate();
  const [notifications, setNotifications] = useState<AdminNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isOpen, setIsOpen] = useState(false);
  const [hasFetched, setHasFetched] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(() => {
    if (typeof window === 'undefined') return new Set();
    try {
      return new Set(JSON.parse(localStorage.getItem('admin-notif-dismissed') || '[]'));
    } catch { return new Set(); }
  });
  const prefs = useNotificationPreferences();
  const { snoozeType } = useUpdateNotificationPreferences();

  const persistDismissed = (set: Set<string>) => {
    setDismissedIds(new Set(set));
    try { localStorage.setItem('admin-notif-dismissed', JSON.stringify([...set])); } catch {}
  };

  // One-time prompt for browser notification permission so desktop notifications
  // actually fire when realtime events arrive (booking requests, new leads, etc.).
  useEffect(() => {
    if (typeof window === 'undefined' || !('Notification' in window)) return;
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

  const deliverBrowserNotification = (notification: Pick<AdminNotification, 'id' | 'title' | 'message'>) => {
    // Best-effort: if permission was never granted, request it lazily on first event
    if (
      typeof window !== 'undefined' &&
      'Notification' in window &&
      Notification.permission === 'default'
    ) {
      Notification.requestPermission().catch(() => {});
    }
    showBrowserNotification({
      title: notification.title,
      body: notification.message,
      tag: notification.id,
    });
  };

  // Simulated notifications based on recent activity
  const fetchNotifications = async (force = false) => {
    if (!organizationId) return;
    if (hasFetched && !force) return;

    try {
      // Fetch recent booking request notifications
      const { data: requestNotifications, error: reqError } = await supabase
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
        .limit(10);

      const bookingRequestNotifs: AdminNotification[] = (requestNotifications || []).map((n: any) => {
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
          title: `New Booking Request`,
          message: `${customerName} requested ${serviceName} on ${requestDate}`,
          is_read: n.is_read,
          created_at: n.created_at,
          resource_id: n.booking_request?.id,
          resource_type: 'booking_request',
        };
      });

      // Fetch recent bookings with customer and service info
      const { data: recentBookings, error } = await supabase
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
        .limit(10);

      const bookingNotifications: AdminNotification[] = [];
      if (!error && recentBookings) {
        recentBookings.forEach((booking: any) => {
          const customerName = booking.customers 
            ? `${booking.customers.first_name} ${booking.customers.last_name}` 
            : 'Unknown Customer';
          const serviceName = booking.services?.name || 'Service';
          const cleanDate = booking.scheduled_at 
            ? format(new Date(booking.scheduled_at), 'MMM d, yyyy')
            : 'TBD';
          
          bookingNotifications.push({
            id: `booking-${booking.id}`,
            type: 'booking' as const,
            typeKey: 'booking.new',
            title: customerName,
            message: `${serviceName} • ${cleanDate}`,
            is_read: true,
            created_at: booking.created_at,
            resource_id: booking.id,
            resource_type: 'booking',
          });
        });
      }

      // Add weekly booking reminder notification (Monday) — only if not dismissed
      const today = new Date();
      /*
        "Is it Monday?" is a question about the BUSINESS's week — the reminder
        is about the business's upcoming bookings. Read from the device, an
        admin in Manila got it on the org's Sunday evening and an admin in
        Hawaii missed Monday entirely.

        The dismissal key was toISOString().split('T') — a UTC date, which
        rolls over mid-afternoon for the Americas. Dismiss the reminder after
        that rollover and it returned the same business day under a new key.
      */
      const dayOfWeek = orgDayOfWeek(today, orgTimezone); // 0=Sunday, 1=Monday
      const todayKey = orgDateKey(today, orgTimezone);
      const weeklyReminders: AdminNotification[] = [];
      const weeklyKey = `weekly-reminder-dismissed-${organizationId}-${todayKey}`;
      const wasDismissed = localStorage.getItem(weeklyKey) === 'true';
      
      if (dayOfWeek === 1 && !wasDismissed) { // Monday and not dismissed
        // Check how many upcoming bookings this week
        // A DURATION — "bookings in the next seven days" — not a calendar
        // boundary, so elapsed time is the right measure.
        const weekEnd = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000);
        
        const { data: upcomingBookings } = await supabase
          .from('bookings')
          .select('id')
          .eq('organization_id', organizationId)
          .in('status', ['pending', 'confirmed'])
          .gte('scheduled_at', today.toISOString())
          .lte('scheduled_at', weekEnd.toISOString());
        
        const count = upcomingBookings?.length || 0;
        if (count > 0) {
          weeklyReminders.push({
            id: `weekly-reminder-${todayKey}`,
            type: 'system',
            title: '📅 Weekly Booking Reminders',
            message: `You have ${count} upcoming booking${count > 1 ? 's' : ''} this week. Send reminders to your customers!`,
            is_read: false,
            created_at: today.toISOString(),
            resource_type: 'reminder',
          });
        }
      }

      // Fetch admin system notifications (e.g., month-end P&L reminder)
      const { data: systemNotifs } = await supabase
        .from('admin_system_notifications')
        .select('id, type, title, message, link, is_read, created_at')
        .eq('organization_id', organizationId)
        .order('created_at', { ascending: false })
        .limit(15);

      const systemNotifications: AdminNotification[] = (systemNotifs || []).map((n: any) => ({
        id: `system-${n.id}`,
        type: 'system' as const,
        title: n.title,
        message: n.message,
        is_read: !!n.is_read,
        created_at: n.created_at,
        resource_id: n.id,
        resource_type: n.type,
        link: n.link || undefined,
      }));

      // Combine and sort by created_at
      const allNotifications = [...bookingRequestNotifs, ...bookingNotifications, ...weeklyReminders, ...systemNotifications]
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

      setNotifications(allNotifications);
      setUnreadCount(allNotifications.filter((n) => !n.is_read).length);
      setHasFetched(true);
    } catch (error) {
      console.error('Error fetching notifications:', error);
    }
  };

  useEffect(() => {
    if (organizationId) {
      fetchNotifications();

      // Subscribe to realtime booking changes
      const channel = supabase
        .channel('admin-notifications')
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'admin_booking_request_notifications',
            filter: `organization_id=eq.${organizationId}`,
          },
          () => {
            // Refresh notifications when a new booking request comes in
            fetchNotifications(true);
            deliverBrowserNotification({
              id: `request-${Date.now()}`,
              title: 'New Booking Request',
              message: 'A new booking request is waiting for review.',
            });
          }
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
            const newBooking = payload.new as any;
            // Fetch full booking details for better notification
            fetchNotifications();
            const newNotification: AdminNotification = {
              id: `booking-${newBooking.id}`,
              type: 'booking',
              typeKey: 'booking.new',
              title: 'New Booking Created',
              message: `Scheduled for ${newBooking.scheduled_at ? format(new Date(newBooking.scheduled_at), 'MMM d') : 'TBD'}`,
              is_read: false,
              created_at: newBooking.created_at,
              resource_id: newBooking.id,
              resource_type: 'booking',
            };
            setNotifications((prev) => [newNotification, ...prev]);
            setUnreadCount((prev) => prev + 1);
            deliverBrowserNotification(newNotification);
          }
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
            const updatedBooking = payload.new as any;
            const oldBooking = payload.old as any;
            
            // Only notify on status changes
            if (oldBooking.status !== updatedBooking.status || oldBooking.payment_status !== updatedBooking.payment_status) {
              // Fetch customer name for the notification
              let customerName = 'Customer';
              let scheduledDate = '';
              const { data: bookingDetails } = await supabase
                .from('bookings')
                .select('customers:customer_id(first_name, last_name), scheduled_at')
                .eq('id', updatedBooking.id)
                .single();
              if (bookingDetails) {
                const c = bookingDetails.customers as any;
                if (c) customerName = `${c.first_name} ${c.last_name}`;
                if (bookingDetails.scheduled_at) scheduledDate = format(new Date(bookingDetails.scheduled_at), 'MMM d, yyyy');
              }

              const statusKey =
                updatedBooking.status === 'cancelled' ? 'booking.cancelled' :
                updatedBooking.status === 'completed' ? 'booking.completed' :
                oldBooking.payment_status !== updatedBooking.payment_status && updatedBooking.payment_status === 'failed' ? 'booking.payment_failed' :
                'booking.rescheduled';
              const newNotification: AdminNotification = {
                id: `booking-update-${updatedBooking.id}-${Date.now()}`,
                type: 'booking',
                typeKey: statusKey,
                title: `${customerName}${scheduledDate ? ` • ${scheduledDate}` : ''}`,
                message: `Status changed to ${updatedBooking.status}`,
                is_read: false,
                created_at: new Date().toISOString(),
                resource_id: updatedBooking.id,
                resource_type: 'booking',
              };
              setNotifications((prev) => [newNotification, ...prev]);
              setUnreadCount((prev) => prev + 1);
              deliverBrowserNotification(newNotification);
            }
          }
        )
        .subscribe();

      return () => {
        supabase.removeChannel(channel);
      };
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- fetchNotifications is recreated each render; runs once per org
  }, [organizationId]);

  const queryClient = useQueryClient();

  const markAsRead = async (notificationId: string) => {
    setNotifications((prev) =>
      prev.map((n) => (n.id === notificationId ? { ...n, is_read: true } : n))
    );
    setUnreadCount((prev) => Math.max(0, prev - 1));

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
      setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
      setUnreadCount(0);
      
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
      setNotifications([]);
      
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
    setNotifications(prev => prev.map(n => selected.has(n.id) ? { ...n, is_read: true } : n));
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
        return isChannelEnabled(n.typeKey, 'bell', prefs.notification_matrix, prefs.snoozed_until);
      }
      return true;
    });
  }, [notifications, dismissedIds, prefs.notification_matrix, prefs.snoozed_until]);

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
                        {format(new Date(notification.created_at), 'MMM d, h:mm a')}
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
