import { useState, useMemo, useEffect, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { TabsContent } from '@/components/ui/tabs';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Checkbox } from '@/components/ui/checkbox';
import {
  CalendarCheck, Phone, Mail, Briefcase, Loader2,
  ChevronLeft, ChevronRight, Ban, X, Search,
  Calendar as CalendarIcon, Clock, AlertTriangle,
  ArrowUpDown, Eye, CheckCircle2, Trash2, Video, MessageSquare, ExternalLink
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format, startOfMonth, endOfMonth, startOfWeek, endOfWeek, eachDayOfInterval, isSameMonth, isSameDay, isToday, addMonths, subMonths, isBefore, startOfDay, isThisWeek } from 'date-fns';
import { calendarDayKey, orgDateKey } from '@/lib/orgDateRange';
import { toast } from 'sonner';
import { DEFAULT_AVAILABILITY, parseAvailability, slotsForDay, WEEKDAY_LABELS, type WeeklyAvailability } from '@/lib/demoAvailability';
import { QueryError } from '@/components/QueryError';
import { SUPPORT_EMAIL } from '@/lib/supportEmail';

interface DemoBooking {
  id: string;
  full_name: string;
  email: string;
  phone: string;
  business_name: string;
  team_size: string | null;
  biggest_challenge: string | null;
  booked_date: string;
  booked_time: string;
  timezone: string | null;
  status: string;
  cancellation_reason: string | null;
  reschedule_note: string | null;
  original_date: string | null;
  original_time: string | null;
  created_at: string;
  meeting_link: string | null;
}

// ── Google Calendar quick-add ─────────────────────────────────────────────
// Demo slots are defined in EST (see DemoBookingForm availability table), so
// we send wall-clock times plus ctz and let Google do the conversion — the
// guest's invite lands correctly in whatever timezone they're in.
const DEMO_TZ = 'America/New_York';
const DEMO_DURATION_MIN = 45;

/** New York's current calendar day — the demo calendar's "today". */
const demoToday = () => orgDateKey(new Date(), DEMO_TZ);

function buildGoogleCalendarUrl(demo: DemoBooking): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const [hh = 0, mm = 0] = demo.booked_time.split(':').map(Number);

  // Pure wall-clock arithmetic: build from parts, add duration, read parts back.
  // The Date is a CARRIER for wall-clock numbers, never an instant — it is
  // constructed and read in the same zone, so the arithmetic is exact, and the
  // URL carries ctz=DEMO_TZ so Google does the real conversion. Converting here
  // would double-apply an offset. (Demo slots run 08:00–17:45, and every DST
  // transition is in the small hours, so the +45min never crosses one.)
  const [y, mo, d] = demo.booked_date.split('-').map(Number);
  const start = new Date(y, mo - 1, d, hh, mm, 0, 0);
  const end = new Date(start.getTime() + DEMO_DURATION_MIN * 60000);
  /* eslint-disable local/no-device-local-dates -- wall-clock carrier, see above */
  const stamp = (dt: Date) =>
    `${dt.getFullYear()}${pad(dt.getMonth() + 1)}${pad(dt.getDate())}T${pad(dt.getHours())}${pad(dt.getMinutes())}00`;
  /* eslint-enable local/no-device-local-dates */

  const details = [
    `TidyWise demo with ${demo.full_name}${demo.business_name ? `, ${demo.business_name}` : ''}.`,
    '',
    `Email: ${demo.email}`,
    demo.phone ? `Phone: ${demo.phone}` : '',
    demo.team_size ? `Team size: ${demo.team_size}` : '',
    demo.biggest_challenge ? `Biggest challenge: ${demo.biggest_challenge}` : '',
    demo.timezone ? `Their timezone: ${demo.timezone}` : '',
    '',
    'Click "Add Google Meet video conferencing", then Save. Google emails the guest the link.',
  ].filter(Boolean).join('\n');

  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: `TidyWise Demo: ${demo.full_name}${demo.business_name ? ` (${demo.business_name})` : ''}`,
    dates: `${stamp(start)}/${stamp(end)}`,
    ctz: DEMO_TZ,
    details,
    add: demo.email,
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

interface BlockedDate {
  id: string;
  blocked_date: string;
  reason: string | null;
  notes: string | null;
}

const statusColors: Record<string, string> = {
  confirmed: 'bg-success/10 text-success',
  cancelled: 'bg-destructive/10 text-destructive',
  rescheduled: 'bg-warning/10 text-warning',
  completed: 'bg-info/10 text-info',
  pending: 'bg-warning/10 text-warning',
};

const statusIcons: Record<string, string> = {
  confirmed: '🟢',
  cancelled: '🔴',
  rescheduled: '🟡',
  completed: '✅',
  pending: '⏳',
};

function formatTime12h(time: string): string {
  const [h, m] = time.split(':').map(Number);
  const period = h >= 12 ? 'PM' : 'AM';
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${h12}:${m.toString().padStart(2, '0')} ${period}`;
}

const CANCEL_REASONS = [
  'Emergency came up',
  'Schedule conflict',
  'Need to reschedule',
  'Other',
];

// Availability comes from the demo_availability platform setting; see the
// editor + query below and @/lib/demoAvailability.

const TIDYWISE_ORG_ID = 'e95b92d0-7099-408e-a773-e4407b34f8b4';

export function DemoCalendarTab() {
  const queryClient = useQueryClient();
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [blockDialogOpen, setBlockDialogOpen] = useState(false);
  const [blockReason, setBlockReason] = useState('personal');
  const [blockNotes, setBlockNotes] = useState('');
  const [blockDateRange, setBlockDateRange] = useState<{ start: string; end: string }>({ start: '', end: '' });

  // Cancel/Reschedule state
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const [rescheduleDialogOpen, setRescheduleDialogOpen] = useState(false);
  const [activeBooking, setActiveBooking] = useState<DemoBooking | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [sendSmsOnCancel, setSendSmsOnCancel] = useState(true);
  const [rescheduleDate, setRescheduleDate] = useState('');
  const [rescheduleTime, setRescheduleTime] = useState('');

  // Detail modal
  const [detailBooking, setDetailBooking] = useState<DemoBooking | null>(null);

  // Confirmation text (per-row in-flight tracking)
  const [confirmingTextId, setConfirmingTextId] = useState<string | null>(null);

  // Bulk select
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);

  // Table controls
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [sortBy, setSortBy] = useState<'date-desc' | 'date-asc' | 'name' | 'status'>('date-desc');
  const [viewMode, setViewMode] = useState<'table' | 'calendar'>('table');

  const { data: bookings = [], isLoading, error: bookingsError } = useQuery({
    queryKey: ['demo-bookings'],
    queryFn: async () => {
      const { data, error } = await (supabase
        .from('demo_bookings' as any)
        .select('*') as any)
        .order('booked_date', { ascending: false });
      if (error) throw error;
      return (data || []) as DemoBooking[];
    },
  });

  const { data: blockedDates = [], error: blockedDatesError } = useQuery({
    queryKey: ['demo-blocked-dates'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('demo_blocked_dates' as any)
        .select('*');
      if (error) throw error;
      return (data || []) as unknown as BlockedDate[];
    },
  });

  const blockDateMutation = useMutation({
    mutationFn: async (dates: { blocked_date: string; reason: string; notes: string }[]) => {
      const results = await Promise.allSettled(
        dates.map(async (d) => {
          const { error } = await supabase.from('demo_blocked_dates' as any).insert(d as any);
          if (error && !error.message?.includes('duplicate')) throw error;
        })
      );
      const failed = results.find(r => r.status === 'rejected');
      if (failed) throw (failed as PromiseRejectedResult).reason;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['demo-blocked-dates'] });
      toast.success('Date(s) blocked');
      setBlockDialogOpen(false);
      setBlockDateRange({ start: '', end: '' });
      setBlockNotes('');
    },
    onError: () => toast.error('Failed to block date'),
  });

  const unblockMutation = useMutation({
    mutationFn: async (dateStr: string) => {
      const { error } = await supabase
        .from('demo_blocked_dates' as any)
        .delete()
        .eq('blocked_date', dateStr);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['demo-blocked-dates'] });
      toast.success('Date unblocked');
    },
  });

  const updateBookingMutation = useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: Record<string, any> }) => {
      const { error } = await supabase
        .from('demo_bookings' as any)
        .update(updates as any)
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['demo-bookings'] });
    },
  });

  // Platform-wide default meeting link (new demos auto-fill it via a DB trigger).
  const { data: defaultMeetingLink = '', error: meetingLinkError } = useQuery({
    queryKey: ['demo-default-meeting-link'],
    queryFn: async () => {
      const { data } = await supabase
        .from('platform_settings' as any)
        .select('value')
        .eq('key', 'demo_default_meeting_link')
        .maybeSingle();
      return (((data as any)?.value as { url?: string } | null)?.url ?? '') as string;
    },
  });
  const [defaultLinkDraft, setDefaultLinkDraft] = useState('');
  useEffect(() => setDefaultLinkDraft(defaultMeetingLink), [defaultMeetingLink]);

  const saveDefaultLinkMutation = useMutation({
    mutationFn: async (url: string) => {
      const { error } = await supabase
        .from('platform_settings' as any)
        .upsert(
          { key: 'demo_default_meeting_link', value: { url: url.trim() }, updated_at: new Date().toISOString() } as any,
          { onConflict: 'key' },
        );
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['demo-default-meeting-link'] });
      toast.success('Default meeting link saved');
    },
    onError: (e: any) => toast.error(e?.message ?? 'Could not save link'),
  });

  // Draft for the per-demo override input inside the detail modal. Reset it
  // whenever a different demo's detail dialog is opened.
  const perDemoLinkDraftRef = useRef('');
  useEffect(() => {
    perDemoLinkDraftRef.current = detailBooking?.meeting_link ?? '';
  }, [detailBooking]);

  // Weekly demo availability (editable). Admin reads platform_settings directly.
  const { data: availabilityRaw, error: availabilityError } = useQuery({
    queryKey: ['demo-availability'],
    queryFn: async () => {
      const { data } = await supabase
        .from('platform_settings' as any)
        .select('value')
        .eq('key', 'demo_availability')
        .maybeSingle();
      return (data as any)?.value ?? null;
    },
  });
  const availability = useMemo(() => parseAvailability(availabilityRaw), [availabilityRaw]);
  const [availDraft, setAvailDraft] = useState<WeeklyAvailability>(DEFAULT_AVAILABILITY);
  useEffect(() => setAvailDraft(availability), [availability]);

  const saveAvailabilityMutation = useMutation({
    mutationFn: async (weekly: WeeklyAvailability) => {
      const value: Record<string, unknown> = {};
      for (let d = 0; d <= 6; d++) value[d] = weekly[d];
      const { error } = await supabase
        .from('platform_settings' as any)
        .upsert(
          { key: 'demo_availability', value, updated_at: new Date().toISOString() } as any,
          { onConflict: 'key' },
        );
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['demo-availability'] });
      toast.success('Availability saved');
    },
    onError: (e: any) => toast.error(e?.message ?? 'Could not save availability'),
  });

  const bulkDeleteMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      const results = await Promise.allSettled(
        ids.map(async (id) => {
          const { error } = await supabase
            .from('demo_bookings' as any)
            .delete()
            .eq('id', id);
          if (error) throw error;
        })
      );
      const failed = results.find(r => r.status === 'rejected');
      if (failed) throw (failed as PromiseRejectedResult).reason;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['demo-bookings'] });
      setSelectedIds(new Set());
      toast.success('Selected bookings deleted');
    },
    onError: () => toast.error('Failed to delete bookings'),
  });

  const handleBulkDelete = async () => {
    if (selectedIds.size === 0) return;
    setBulkDeleting(true);
    try {
      await bulkDeleteMutation.mutateAsync(Array.from(selectedIds));
    } finally {
      setBulkDeleting(false);
    }
  };

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === filteredBookings.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredBookings.map(b => b.id)));
    }
  };

  // Filtered + sorted bookings
  const filteredBookings = useMemo(() => {
    let list = [...bookings];

    // Status filter
    if (statusFilter !== 'all') {
      list = list.filter(b => b.status === statusFilter);
    }

    // Search
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(b =>
        b.full_name.toLowerCase().includes(q) ||
        b.business_name.toLowerCase().includes(q) ||
        b.phone.includes(q) ||
        b.email.toLowerCase().includes(q)
      );
    }

    // Sort
    list.sort((a, b) => {
      switch (sortBy) {
        case 'date-desc': return b.booked_date.localeCompare(a.booked_date) || b.booked_time.localeCompare(a.booked_time);
        case 'date-asc': return a.booked_date.localeCompare(b.booked_date) || a.booked_time.localeCompare(b.booked_time);
        case 'name': return a.full_name.localeCompare(b.full_name);
        case 'status': return a.status.localeCompare(b.status);
        default: return 0;
      }
    });

    return list;
  }, [bookings, statusFilter, searchQuery, sortBy]);

  // Stats
  const stats = useMemo(() => {
    const confirmed = bookings.filter(b => b.status === 'confirmed').length;
    const rescheduled = bookings.filter(b => b.status === 'rescheduled').length;
    const completed = bookings.filter(b => b.status === 'completed').length;
    const cancelled = bookings.filter(b => b.status === 'cancelled').length;
    const thisWeek = bookings.filter(b => {
      try {
        return isThisWeek(new Date(b.booked_date + 'T00:00:00'), { weekStartsOn: 1 });
      } catch { return false; }
    }).length;
    return { total: bookings.length, confirmed, rescheduled, completed, cancelled, thisWeek };
  }, [bookings]);

  // Calendar computation
  const calendarDays = useMemo(() => {
    /* eslint-disable local/no-device-local-dates -- grid geometry: a month spans
       the same days and starts on the same weekday everywhere. Which cell is
       TODAY is the one thing that isn't, and that comes from demoToday(). */
    const monthStart = startOfMonth(currentMonth);
    const monthEnd = endOfMonth(currentMonth);
    return eachDayOfInterval({ start: startOfWeek(monthStart), end: endOfWeek(monthEnd) });
    /* eslint-enable local/no-device-local-dates */
  }, [currentMonth]);

  const blockedDateStrings = blockedDates.map(b => b.blocked_date);

  const getBookingsForDate = (date: Date) => {
    // Grid cell key matched against booked_date, itself a stored calendar date.
    const dateStr = calendarDayKey(date);
    return bookings.filter(b => b.booked_date === dateStr && b.status !== 'cancelled');
  };

  // Get history for a person by email
  const getBookingHistory = (email: string) => {
    return bookings.filter(b => b.email === email).sort((a, b) => b.created_at.localeCompare(a.created_at));
  };

  const sendSms = async (to: string, message: string) => {
    const { data, error } = await supabase.functions.invoke('send-openphone-sms', {
      body: { to, message, organizationId: TIDYWISE_ORG_ID },
    });
    if (error) {
      console.error('[DemoCalendarTab] SMS error:', error);
      throw error;
    }
    if (data && data.success === false) {
      console.error('[DemoCalendarTab] SMS failed:', data.error);
      throw new Error(data.error || 'SMS failed');
    }
    return data;
  };

  const handleCancel = async () => {
    if (!activeBooking) return;

    await updateBookingMutation.mutateAsync({
      id: activeBooking.id,
      updates: { status: 'cancelled', cancellation_reason: cancelReason },
    });

    if (sendSmsOnCancel) {
      const firstName = activeBooking.full_name.split(' ')[0];
      const dateDisplay = format(new Date(activeBooking.booked_date + 'T00:00:00'), 'EEEE, MMMM d');
      const timeDisplay = formatTime12h(activeBooking.booked_time.substring(0, 5));

      try {
        await sendSms(
          activeBooking.phone,
          `Hi ${firstName}! Emmanuel here from TidyWise.\n\nI have to cancel our demo scheduled for ${dateDisplay} at ${timeDisplay} EST. I sincerely apologize for the inconvenience! 🙏\n\nPlease rebook at your convenience:\n→ jointidywise.com/demo\n\nOr reply and we'll find a time.\n\n— Emmanuel\n${SUPPORT_EMAIL}`
        );
        toast.success('✅ Client notified via SMS');
      } catch (err) {
        console.error('[DemoCalendarTab] Cancel SMS failed:', err);
        toast.error('Demo cancelled but SMS notification failed');
      }
    } else {
      toast.success('Demo cancelled');
    }

    setCancelDialogOpen(false);
    setActiveBooking(null);
  };

  const handleReschedule = async () => {
    if (!activeBooking || !rescheduleDate || !rescheduleTime) return;

    try {
      await updateBookingMutation.mutateAsync({
        id: activeBooking.id,
        updates: {
          status: 'rescheduled',
          original_date: activeBooking.booked_date,
          original_time: activeBooking.booked_time,
          booked_date: rescheduleDate,
          booked_time: rescheduleTime + ':00',
          reschedule_note: 'Rescheduled by admin',
        },
      });

      const firstName = activeBooking.full_name.split(' ')[0];
      const oldDate = format(new Date(activeBooking.booked_date + 'T00:00:00'), 'EEEE, MMMM d');
      const oldTime = formatTime12h(activeBooking.booked_time.substring(0, 5));
      const newDate = format(new Date(rescheduleDate + 'T00:00:00'), 'EEEE, MMMM d');
      const newTime = formatTime12h(rescheduleTime);

      try {
        await sendSms(
          activeBooking.phone,
          `Hi ${firstName}! Emmanuel from TidyWise here.\n\nI need to move our demo from ${oldDate} at ${oldTime} to:\n\n📆 ${newDate}\n⏰ ${newTime} EST\n\nReply YES to confirm or NO if that doesn't work and we'll find another time together.\n\n— Emmanuel\n${SUPPORT_EMAIL}`
        );
        toast.success('✅ Demo rescheduled & client notified via SMS');
      } catch (err) {
        console.error('[DemoCalendarTab] Reschedule SMS failed:', err);
        toast.error('Demo rescheduled but SMS notification failed');
      }
    } catch (err) {
      console.error('[DemoCalendarTab] Reschedule update failed:', err);
      toast.error('Failed to reschedule demo');
    }

    setRescheduleDialogOpen(false);
    setActiveBooking(null);
  };

  const handleComplete = async (booking: DemoBooking) => {
    await updateBookingMutation.mutateAsync({
      id: booking.id,
      updates: { status: 'completed' },
    });
    toast.success('Demo marked as completed');
  };

  const handleSendConfirmationText = async (demo: DemoBooking) => {
    if (!demo.phone) return;
    setConfirmingTextId(demo.id);
    try {
      const firstName = demo.full_name.split(' ')[0];
      const dateDisplay = format(new Date(demo.booked_date + 'T00:00:00'), 'EEEE, MMMM d');
      const timeDisplay = formatTime12h(demo.booked_time.substring(0, 5));
      await sendSms(
        demo.phone,
        `Hi ${firstName}, confirming your TidyWise demo on ${dateDisplay} at ${timeDisplay} EST. You'll get a Google Meet link by email. Reply here if you need to reschedule.`
      );
      toast.success('✅ Confirmation text sent');
    } catch (err) {
      console.error('[DemoCalendarTab] Confirmation SMS failed:', err);
      toast.error('Failed to send confirmation text');
    } finally {
      setConfirmingTextId(null);
    }
  };

  // Reschedule time slots
  const rescheduleSlots = rescheduleDate
    // rescheduleDate is a yyyy-MM-dd string; the weekday of a calendar date is
    // the same in every timezone.
    /* eslint-disable-next-line local/no-device-local-dates */
    ? slotsForDay(availability, new Date(rescheduleDate + 'T00:00:00').getDay())
    : [];

  const formatDateDisplay = (dateStr: string) => {
    try {
      return format(new Date(dateStr + 'T00:00:00'), 'EEE, MMM d, yyyy');
    } catch { return dateStr; }
  };

  const demoQueryError = bookingsError || blockedDatesError || meetingLinkError || availabilityError;

  if (demoQueryError) {
    return (
      <TabsContent value="demos" className="space-y-4">
        <QueryError subject="demo calendar data" />
      </TabsContent>
    );
  }

  return (
    <TabsContent value="demos" className="space-y-4">
      {/* Stats Bar */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {[
          { label: 'Total', value: stats.total, color: 'text-foreground' },
          { label: 'Confirmed', value: stats.confirmed, color: 'text-success' },
          { label: 'Rescheduled', value: stats.rescheduled, color: 'text-warning' },
          { label: 'Completed', value: stats.completed, color: 'text-info' },
          { label: 'Cancelled', value: stats.cancelled, color: 'text-destructive' },
          { label: 'This Week', value: stats.thisWeek, color: 'text-primary' },
        ].map(stat => (
          <Card key={stat.label}>
            <CardContent className="p-3 text-center">
              <p className={`text-2xl font-bold ${stat.color}`}>{stat.value}</p>
              <p className="text-xs text-muted-foreground">{stat.label}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Default meeting link — new demos auto-fill it; override per demo below. */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Video className="w-4 h-4" /> Default demo meeting link
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <Input
            value={defaultLinkDraft}
            onChange={(e) => setDefaultLinkDraft(e.target.value)}
            placeholder="https://meet.google.com/your-permanent-room"
            className="flex-1"
          />
          <Button
            onClick={() => saveDefaultLinkMutation.mutate(defaultLinkDraft)}
            disabled={saveDefaultLinkMutation.isPending || defaultLinkDraft === defaultMeetingLink}
          >
            Save
          </Button>
        </CardContent>
      </Card>

      {/* Weekly demo availability editor */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <CalendarIcon className="w-4 h-4" /> Weekly demo availability (EST)
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {WEEKDAY_LABELS.map((label, d) => {
            const day = availDraft[d];
            const on = !!day;
            const setDay = (next: typeof day) =>
              setAvailDraft(prev => ({ ...prev, [d]: next }));
            return (
              <div key={d} className="flex items-center gap-3">
                <div className="w-28 flex items-center gap-2">
                  <Checkbox
                    checked={on}
                    onCheckedChange={(c) =>
                      setDay(c === true ? (DEFAULT_AVAILABILITY[d] ?? { start: 9, end: 17 }) : null)
                    }
                  />
                  <span className="text-sm">{label}</span>
                </div>
                {on ? (
                  <div className="flex items-center gap-2 text-sm">
                    <Select value={String(day!.start)} onValueChange={(v) => setDay({ ...day!, start: Number(v) })}>
                      <SelectTrigger className="w-28 h-8"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {Array.from({ length: 24 }, (_, h) => (
                          <SelectItem key={h} value={String(h)}>{formatTime12h(`${h}:00`)}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <span className="text-muted-foreground">to</span>
                    <Select value={String(day!.end)} onValueChange={(v) => setDay({ ...day!, end: Number(v) })}>
                      <SelectTrigger className="w-28 h-8"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {Array.from({ length: 24 }, (_, h) => h + 1).map((h) => (
                          <SelectItem key={h} value={String(h)}>{formatTime12h(`${h % 24}:00`)}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ) : (
                  <span className="text-sm text-muted-foreground">Unavailable</span>
                )}
              </div>
            );
          })}
          <div className="pt-2">
            <Button
              onClick={() => saveAvailabilityMutation.mutate(availDraft)}
              disabled={saveAvailabilityMutation.isPending}
            >
              Save availability
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Controls */}
      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
        <div className="flex items-center gap-2 flex-1 w-full sm:w-auto">
          <div className="relative flex-1 sm:max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search name, business, phone, email..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="pl-9"
            />
          </div>
          <Select value={sortBy} onValueChange={(v: any) => setSortBy(v)}>
            <SelectTrigger className="w-40">
              <ArrowUpDown className="w-4 h-4 mr-1" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="date-desc">Newest First</SelectItem>
              <SelectItem value="date-asc">Oldest First</SelectItem>
              <SelectItem value="name">By Name</SelectItem>
              <SelectItem value="status">By Status</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex gap-2 flex-wrap">
          {selectedIds.size > 0 && (
            <Button
              size="sm"
              variant="destructive"
              onClick={handleBulkDelete}
              disabled={bulkDeleting}
            >
              {bulkDeleting ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Trash2 className="w-4 h-4 mr-1" />}
              Delete ({selectedIds.size})
            </Button>
          )}
          <Button
            size="sm"
            variant={viewMode === 'table' ? 'default' : 'outline'}
            onClick={() => setViewMode('table')}
          >
            Table
          </Button>
          <Button
            size="sm"
            variant={viewMode === 'calendar' ? 'default' : 'outline'}
            onClick={() => setViewMode('calendar')}
          >
            Calendar
          </Button>
          <Button size="sm" variant="outline" onClick={() => setBlockDialogOpen(true)}>
            <Ban className="w-4 h-4 mr-1" /> Block Date
          </Button>
        </div>
      </div>

      {/* Filter Tabs */}
      <Tabs value={statusFilter} onValueChange={setStatusFilter}>
        <TabsList>
          <TabsTrigger value="all">All ({stats.total})</TabsTrigger>
          <TabsTrigger value="confirmed">Confirmed ({stats.confirmed})</TabsTrigger>
          <TabsTrigger value="rescheduled">Rescheduled ({stats.rescheduled})</TabsTrigger>
          <TabsTrigger value="completed">Completed ({stats.completed})</TabsTrigger>
          <TabsTrigger value="cancelled">Cancelled ({stats.cancelled})</TabsTrigger>
        </TabsList>
      </Tabs>

      {viewMode === 'table' ? (
        /* Full Width Table View */
        <Card>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="flex justify-center py-12">
                <Loader2 className="w-6 h-6 animate-spin text-primary" />
              </div>
            ) : filteredBookings.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <CalendarCheck className="w-12 h-12 mx-auto mb-3 opacity-30" />
                <p className="text-lg font-medium">No demo bookings found</p>
                <p className="text-sm mt-1">Try adjusting your search or filters</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-10">
                        <Checkbox
                          checked={filteredBookings.length > 0 && selectedIds.size === filteredBookings.length}
                          onCheckedChange={toggleSelectAll}
                        />
                      </TableHead>
                      <TableHead className="w-8">#</TableHead>
                      <TableHead>Name & Business</TableHead>
                      <TableHead>Date & Time</TableHead>
                      <TableHead>Phone</TableHead>
                      <TableHead>Email</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredBookings.map((demo, idx) => {
                      const history = getBookingHistory(demo.email);
                      const hasHistory = history.length > 1;

                      return (
                        <TableRow
                          key={demo.id}
                          className={`cursor-pointer hover:bg-muted/50 ${selectedIds.has(demo.id) ? 'bg-primary/5' : ''}`}
                          onClick={() => setDetailBooking(demo)}
                        >
                          <TableCell onClick={e => e.stopPropagation()}>
                            <Checkbox
                              checked={selectedIds.has(demo.id)}
                              onCheckedChange={() => toggleSelect(demo.id)}
                            />
                          </TableCell>
                          <TableCell className="font-mono text-xs text-muted-foreground">{idx + 1}</TableCell>
                          <TableCell>
                            <div>
                              <p className="font-semibold text-foreground">{demo.full_name}</p>
                              <p className="text-xs text-muted-foreground flex items-center gap-1">
                                <Briefcase className="w-3 h-3" /> {demo.business_name}
                              </p>
                              {hasHistory && (
                                <Badge variant="outline" className="text-[10px] mt-0.5">
                                  {history.length} bookings
                                </Badge>
                              )}
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-1 text-sm">
                              <CalendarIcon className="w-3.5 h-3.5 text-muted-foreground" />
                              {formatDateDisplay(demo.booked_date)}
                            </div>
                            <div className="flex items-center gap-1 text-xs text-muted-foreground">
                              <Clock className="w-3 h-3" />
                              {formatTime12h(demo.booked_time.substring(0, 5))} EST
                            </div>
                            {demo.meeting_link && (
                              <Button
                                size="sm"
                                className="mt-1.5 h-8 gap-1.5 bg-info text-info-foreground hover:bg-info/90"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  window.open(demo.meeting_link!, '_blank', 'noopener');
                                }}
                              >
                                <Video className="w-3.5 h-3.5" /> Join Call
                              </Button>
                            )}
                          </TableCell>
                          <TableCell>
                            <a
                              href={`tel:${demo.phone}`}
                              className="flex items-center gap-1 text-sm text-primary hover:underline"
                              onClick={e => e.stopPropagation()}
                            >
                              <Phone className="w-3.5 h-3.5" /> {demo.phone}
                            </a>
                          </TableCell>
                          <TableCell>
                            <a
                              href={`mailto:${demo.email}`}
                              className="flex items-center gap-1 text-sm text-primary hover:underline"
                              onClick={e => e.stopPropagation()}
                            >
                              <Mail className="w-3.5 h-3.5" /> {demo.email}
                            </a>
                          </TableCell>
                          <TableCell>
                            <Badge className={`text-xs ${statusColors[demo.status] || ''}`}>
                              {statusIcons[demo.status] || ''} {demo.status}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex items-center justify-end gap-1" onClick={e => e.stopPropagation()}>
                              {(demo.status === 'confirmed' || demo.status === 'rescheduled' || demo.status === 'cancelled') && (
                                <>
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    className="min-h-[44px] w-8 p-0"
                                    title="Reschedule"
                                    onClick={() => {
                                      setActiveBooking(demo);
                                      setRescheduleDialogOpen(true);
                                      setRescheduleDate('');
                                      setRescheduleTime('');
                                    }}
                                  >
                                    📅
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    className="min-h-[44px] w-8 p-0 text-destructive hover:text-destructive"
                                    title="Cancel"
                                    onClick={() => {
                                      setActiveBooking(demo);
                                      setCancelReason('');
                                      setSendSmsOnCancel(true);
                                      setCancelDialogOpen(true);
                                    }}
                                  >
                                    ❌
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    className="min-h-[44px] w-8 p-0"
                                    title="Complete"
                                    onClick={() => handleComplete(demo)}
                                  >
                                    ✅
                                  </Button>
                                </>
                              )}
                              {demo.status !== 'cancelled' && (
                                <>
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    className="min-h-[44px] w-8 p-0 text-info hover:text-info"
                                    title="Send Meet link — opens Google Calendar prefilled with their email and time"
                                    onClick={() => window.open(buildGoogleCalendarUrl(demo), '_blank', 'noopener')}
                                  >
                                    <Video className="w-4 h-4" />
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    className="min-h-[44px] w-8 p-0 text-info hover:text-info"
                                    title={demo.phone ? 'Send confirmation text' : 'No phone number on file'}
                                    disabled={!demo.phone || confirmingTextId === demo.id}
                                    onClick={() => handleSendConfirmationText(demo)}
                                  >
                                    {confirmingTextId === demo.id
                                      ? <Loader2 className="w-4 h-4 animate-spin" />
                                      : <MessageSquare className="w-4 h-4" />}
                                  </Button>
                                </>
                              )}
                              <Button
                                size="sm"
                                variant="ghost"
                                className="min-h-[44px] w-8 p-0"
                                title="View Details"
                                onClick={() => setDetailBooking(demo)}
                              >
                                <Eye className="w-4 h-4" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      ) : (
        /* Calendar View */
        <div className="grid lg:grid-cols-2 gap-4">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-lg flex items-center gap-2">
                  <CalendarIcon className="w-5 h-5 text-primary" />
                  Demo Calendar
                </CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between mb-3">
                <button onClick={() => setCurrentMonth(subMonths(currentMonth, 1))} className="p-1.5 hover:bg-muted rounded-lg">
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <span className="font-semibold text-sm">{format(currentMonth, 'MMMM yyyy')}</span>
                <button onClick={() => setCurrentMonth(addMonths(currentMonth, 1))} className="p-1.5 hover:bg-muted rounded-lg">
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
              <div className="grid grid-cols-7 mb-1">
                {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => (
                  <div key={i} className="text-center text-xs font-medium text-muted-foreground py-1">{d}</div>
                ))}
              </div>
              <div className="grid grid-cols-7 gap-0.5">
                {calendarDays.map((day, i) => {
                  /* eslint-disable-next-line local/no-device-local-dates -- cell vs displayed month; both grid tokens */
                  const inMonth = isSameMonth(day, currentMonth);
                  const dateStr = calendarDayKey(day);
                  const isBlocked = blockedDateStrings.includes(dateStr);
                  const dayBookings = getBookingsForDate(day);
                  // Was isToday(day) — the ADMIN's today. The demo calendar runs
                  // on New York's, so an admin abroad had the wrong cell ringed.
                  const today = dateStr === demoToday();
                  /* eslint-disable-next-line local/no-device-local-dates -- cell vs clicked cell; both grid tokens */
                  const selected = selectedDate && isSameDay(day, selectedDate);

                  return (
                    <button
                      key={i}
                      onClick={() => setSelectedDate(day)}
                      className={`
                        aspect-square flex flex-col items-center justify-center rounded-md text-xs relative transition-all
                        ${!inMonth ? 'text-muted-foreground/30' : 'hover:bg-muted'}
                        ${today ? 'ring-1 ring-primary/40' : ''}
                        ${selected ? 'bg-primary/10 ring-2 ring-primary' : ''}
                        ${isBlocked ? 'bg-destructive/10' : ''}
                      `}
                    >
                      <span>{format(day, 'd')}</span>
                      {dayBookings.length > 0 && (
                        <span className="absolute bottom-0.5 w-1.5 h-1.5 rounded-full bg-success" />
                      )}
                      {isBlocked && (
                        <span className="absolute top-0.5 right-0.5 text-destructive">
                          <X className="w-2.5 h-2.5" />
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>

              {selectedDate && (
                <div className="mt-3 pt-3 border-t border-border space-y-2">
                  <div className="flex items-center justify-between">
                    {/* Labels the clicked cell with its own day — a display
                        format, not a date key, so the rule does not flag it. */}
                    <p className="text-sm font-medium">{format(selectedDate, 'EEEE, MMM d')}</p>
                    {blockedDateStrings.includes(calendarDayKey(selectedDate)) && (
                      <Button size="sm" variant="ghost" className="text-xs min-h-[44px]" onClick={() => unblockMutation.mutate(calendarDayKey(selectedDate))}>
                        Unblock
                      </Button>
                    )}
                  </div>
                  {getBookingsForDate(selectedDate).length === 0 ? (
                    <p className="text-xs text-muted-foreground">No demos scheduled</p>
                  ) : (
                    getBookingsForDate(selectedDate).map(b => (
                      <div key={b.id} className="p-2 bg-muted/50 rounded-lg text-xs space-y-1 cursor-pointer hover:bg-muted" onClick={() => setDetailBooking(b)}>
                        <div className="flex items-center justify-between">
                          <span className="font-medium">{formatTime12h(b.booked_time.substring(0, 5))} EST</span>
                          <Badge className={`text-[10px] ${statusColors[b.status] || ''}`}>{b.status}</Badge>
                        </div>
                        <p>{b.full_name} — {b.business_name}</p>
                      </div>
                    ))
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Upcoming list */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-lg flex items-center gap-2">
                <CalendarCheck className="w-5 h-5 text-primary" />
                Upcoming Demos
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-[500px] pr-2">
                <div className="space-y-2">
                  {bookings
                    .filter(b => b.status === 'confirmed' || b.status === 'rescheduled')
                    // booked_date is a New York calendar day, so whether a demo
                    // is still upcoming is a New York question. Compared against
                    // the admin's midnight, a demo dropped off this list up to a
                    // day early — or lingered a day after it had happened.
                    .filter(b => b.booked_date >= demoToday())
                    .sort((a, b) => a.booked_date.localeCompare(b.booked_date))
                    .map(demo => (
                      <div key={demo.id} className="p-3 bg-muted/50 rounded-lg border border-border space-y-2 text-sm">
                        <div className="flex items-start justify-between">
                          <div>
                            <p className="font-semibold text-foreground">{demo.full_name}</p>
                            <p className="text-xs text-muted-foreground">{demo.business_name}</p>
                          </div>
                          <Badge className={`text-xs ${statusColors[demo.status] || ''}`}>{demo.status}</Badge>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {formatDateDisplay(demo.booked_date)} · {formatTime12h(demo.booked_time.substring(0, 5))} EST
                        </p>
                        <div className="flex gap-2 pt-1">
                          <Button size="sm" variant="outline" className="min-h-[44px] text-xs" onClick={() => { setActiveBooking(demo); setRescheduleDialogOpen(true); setRescheduleDate(''); setRescheduleTime(''); }}>
                            📅 Reschedule
                          </Button>
                          <Button size="sm" variant="outline" className="min-h-[44px] text-xs text-destructive" onClick={() => { setActiveBooking(demo); setCancelReason(''); setSendSmsOnCancel(true); setCancelDialogOpen(true); }}>
                            ❌ Cancel
                          </Button>
                          <Button size="sm" variant="outline" className="min-h-[44px] text-xs" onClick={() => handleComplete(demo)}>
                            ✅ Complete
                          </Button>
                        </div>
                      </div>
                    ))}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Detail Modal */}
      <Dialog open={!!detailBooking} onOpenChange={(open) => { if (!open) setDetailBooking(null); }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CalendarCheck className="w-5 h-5 text-primary" />
              Demo Details
            </DialogTitle>
          </DialogHeader>
          {detailBooking && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-bold text-foreground">{detailBooking.full_name}</h3>
                  <p className="text-sm text-muted-foreground">{detailBooking.business_name}</p>
                </div>
                <Badge className={`${statusColors[detailBooking.status] || ''}`}>
                  {statusIcons[detailBooking.status]} {detailBooking.status}
                </Badge>
              </div>

              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <Label className="text-xs text-muted-foreground">Date & Time</Label>
                  <p className="font-medium">
                    {formatDateDisplay(detailBooking.booked_date)}
                    <br />
                    {formatTime12h(detailBooking.booked_time.substring(0, 5))} EST
                  </p>
                </div>
                <div className="col-span-2">
                  <Label className="text-xs text-muted-foreground">Meeting link (this demo)</Label>
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center mt-1">
                    <Input
                      key={detailBooking.id}
                      defaultValue={detailBooking.meeting_link ?? ''}
                      placeholder="Leave blank to use the default"
                      className="flex-1"
                      onChange={(e) => (perDemoLinkDraftRef.current = e.target.value)}
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        updateBookingMutation.mutate(
                          { id: detailBooking.id, updates: { meeting_link: perDemoLinkDraftRef.current.trim() || null } },
                          { onSuccess: () => toast.success('Meeting link updated') },
                        )
                      }
                    >
                      Save
                    </Button>
                    {detailBooking.meeting_link && (
                      <Button
                        size="sm"
                        className="bg-info text-info-foreground hover:bg-info/90 gap-1.5"
                        onClick={() => window.open(detailBooking.meeting_link!, '_blank', 'noopener')}
                      >
                        <ExternalLink className="w-3.5 h-3.5" /> Join
                      </Button>
                    )}
                  </div>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Contact</Label>
                  <p>
                    <a href={`tel:${detailBooking.phone}`} className="text-primary hover:underline block">{detailBooking.phone}</a>
                    <a href={`mailto:${detailBooking.email}`} className="text-primary hover:underline block text-xs">{detailBooking.email}</a>
                  </p>
                </div>
                {detailBooking.team_size && (
                  <div>
                    <Label className="text-xs text-muted-foreground">Team Size</Label>
                    <p>{detailBooking.team_size}</p>
                  </div>
                )}
                {detailBooking.biggest_challenge && (
                  <div>
                    <Label className="text-xs text-muted-foreground">Biggest Challenge</Label>
                    <p>{detailBooking.biggest_challenge}</p>
                  </div>
                )}
                {detailBooking.original_date && (
                  <div className="col-span-2">
                    <Label className="text-xs text-muted-foreground">Originally Booked</Label>
                    <p className="text-sm">
                      {formatDateDisplay(detailBooking.original_date)} at{' '}
                      {detailBooking.original_time ? formatTime12h(detailBooking.original_time.substring(0, 5)) : 'N/A'} EST
                    </p>
                  </div>
                )}
                {detailBooking.cancellation_reason && (
                  <div className="col-span-2">
                    <Label className="text-xs text-muted-foreground">Cancellation Reason</Label>
                    <p className="text-sm text-destructive">{detailBooking.cancellation_reason}</p>
                  </div>
                )}
              </div>

              {/* Booking History */}
              {(() => {
                const history = getBookingHistory(detailBooking.email);
                if (history.length <= 1) return null;
                return (
                  <div>
                    <Label className="text-xs text-muted-foreground">Booking History ({history.length} total)</Label>
                    <div className="mt-1 space-y-1 max-h-32 overflow-y-auto">
                      {history.map(h => (
                        <div key={h.id} className="flex items-center justify-between text-xs p-1.5 rounded bg-muted/50">
                          <span>{formatDateDisplay(h.booked_date)} · {formatTime12h(h.booked_time.substring(0, 5))}</span>
                          <Badge className={`text-[10px] ${statusColors[h.status] || ''}`}>{h.status}</Badge>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })()}

              {/* Actions */}
              {(detailBooking.status === 'confirmed' || detailBooking.status === 'rescheduled' || detailBooking.status === 'cancelled') && (
                <div className="flex flex-wrap gap-2 pt-2 border-t border-border">
                  {detailBooking.status !== 'cancelled' && (
                    <>
                      <Button
                        size="sm"
                        onClick={() => window.open(buildGoogleCalendarUrl(detailBooking), '_blank', 'noopener')}
                      >
                        <Video className="w-4 h-4 mr-1" /> Send Meet Link
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        title={detailBooking.phone ? undefined : 'No phone number on file'}
                        disabled={!detailBooking.phone || confirmingTextId === detailBooking.id}
                        onClick={() => handleSendConfirmationText(detailBooking)}
                      >
                        {confirmingTextId === detailBooking.id
                          ? <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                          : <MessageSquare className="w-4 h-4 mr-1" />}
                        Send Confirmation Text
                      </Button>
                    </>
                  )}
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setActiveBooking(detailBooking);
                      setRescheduleDialogOpen(true);
                      setRescheduleDate('');
                      setRescheduleTime('');
                      setDetailBooking(null);
                    }}
                  >
                    📅 Reschedule
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-destructive"
                    onClick={() => {
                      setActiveBooking(detailBooking);
                      setCancelReason('');
                      setSendSmsOnCancel(true);
                      setCancelDialogOpen(true);
                      setDetailBooking(null);
                    }}
                  >
                    ❌ Cancel
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      handleComplete(detailBooking);
                      setDetailBooking(null);
                    }}
                  >
                    ✅ Complete
                  </Button>
                  <a href={`tel:${detailBooking.phone}`}>
                    <Button size="sm" variant="outline">
                      <Phone className="w-4 h-4 mr-1" /> Call
                    </Button>
                  </a>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Block Date Dialog */}
      <Dialog open={blockDialogOpen} onOpenChange={setBlockDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Block Date(s)</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Start Date</Label>
              <Input type="date" value={blockDateRange.start} onChange={e => setBlockDateRange(prev => ({ ...prev, start: e.target.value }))} className="mt-1" />
            </div>
            <div>
              <Label>End Date (optional for range)</Label>
              <Input type="date" value={blockDateRange.end} onChange={e => setBlockDateRange(prev => ({ ...prev, end: e.target.value }))} className="mt-1" />
            </div>
            <div>
              <Label>Reason</Label>
              <Select value={blockReason} onValueChange={setBlockReason}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="personal">Personal</SelectItem>
                  <SelectItem value="travel">Travel</SelectItem>
                  <SelectItem value="holiday">Holiday</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Notes (optional)</Label>
              <Textarea value={blockNotes} onChange={e => setBlockNotes(e.target.value)} className="mt-1" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setBlockDialogOpen(false)}>Cancel</Button>
            <Button
              disabled={!blockDateRange.start}
              onClick={() => {
                const dates: { blocked_date: string; reason: string; notes: string }[] = [];
                // Expanding one yyyy-MM-dd range into the calendar days it
                // covers. Strings in, strings out — no instant involved.
                const start = new Date(blockDateRange.start + 'T00:00:00');
                const end = blockDateRange.end ? new Date(blockDateRange.end + 'T00:00:00') : start;
                /* eslint-disable-next-line local/no-device-local-dates -- calendar-range expansion, see above */
                const days = eachDayOfInterval({ start, end });
                for (const d of days) {
                  dates.push({ blocked_date: calendarDayKey(d), reason: blockReason, notes: blockNotes });
                }
                blockDateMutation.mutate(dates);
              }}
            >
              Block
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Cancel Dialog */}
      <Dialog open={cancelDialogOpen} onOpenChange={setCancelDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Cancel Demo — {activeBooking?.full_name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Reason</Label>
              <div className="space-y-2 mt-2">
                {CANCEL_REASONS.map(r => (
                  <button
                    key={r}
                    onClick={() => setCancelReason(r)}
                    className={`w-full text-left px-3 py-2 rounded-lg border text-sm transition-all ${
                      cancelReason === r
                        ? 'bg-primary text-primary-foreground border-primary'
                        : 'bg-background border-border text-foreground hover:border-primary/50'
                    }`}
                  >
                    {r}
                  </button>
                ))}
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={sendSmsOnCancel}
                onChange={e => setSendSmsOnCancel(e.target.checked)}
                className="rounded"
              />
              Send cancellation SMS to prospect
            </label>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setCancelDialogOpen(false)}>Back</Button>
            <Button variant="destructive" disabled={!cancelReason || updateBookingMutation.isPending} onClick={handleCancel}>
              {updateBookingMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : null}
              Cancel Demo
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reschedule Dialog */}
      <Dialog open={rescheduleDialogOpen} onOpenChange={setRescheduleDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Reschedule — {activeBooking?.full_name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>New Date</Label>
              <Input type="date" value={rescheduleDate} onChange={e => { setRescheduleDate(e.target.value); setRescheduleTime(''); }} className="mt-1" />
            </div>
            {rescheduleSlots.length > 0 && (
              <div>
                <Label>New Time</Label>
                <div className="grid grid-cols-3 gap-2 mt-2">
                  {rescheduleSlots.map(t => (
                    <button
                      key={t}
                      onClick={() => setRescheduleTime(t)}
                      className={`px-2 py-2 rounded-lg border text-xs font-medium transition-all ${
                        rescheduleTime === t
                          ? 'bg-primary text-primary-foreground border-primary'
                          : 'bg-background border-border text-foreground hover:border-primary/50'
                      }`}
                    >
                      {formatTime12h(t)} EST
                    </button>
                  ))}
                </div>
              </div>
            )}
            {rescheduleDate && rescheduleSlots.length === 0 && (
              <p className="text-sm text-muted-foreground">No available slots for this day.</p>
            )}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRescheduleDialogOpen(false)}>Back</Button>
            <Button disabled={!rescheduleDate || !rescheduleTime || updateBookingMutation.isPending} onClick={handleReschedule}>
              {updateBookingMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : null}
              Reschedule & Notify
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </TabsContent>
  );
}
