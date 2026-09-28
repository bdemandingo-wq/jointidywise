import { useState, useMemo, useCallback, useRef, useEffect, type ReactNode } from 'react';
import { usePullToRefresh } from '@/hooks/usePullToRefresh';
import { PullToRefreshIndicator } from '@/components/admin/PullToRefreshIndicator';
import { useIsMobile } from '@/hooks/use-mobile';
import {
  DndContext,
  DragEndEvent,
  DragOverlay,
  DragStartEvent,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  pointerWithin,
} from '@dnd-kit/core';
import {
  ChevronLeft,
  ChevronRight,
  Plus,
  Clock,
  MapPin,
  User,
  Phone,
  Loader2,
  Search,
  Edit,
  GripVertical,
  Users,
  Copy,
  Trash2,
  Bell,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';
import { useBookings, useUpdateBooking, useDeleteBooking, BookingWithDetails } from '@/hooks/useBookings';
import { format, startOfWeek, endOfWeek, addWeeks, subWeeks, addMonths, subMonths, startOfMonth, endOfMonth, addDays } from 'date-fns';
import { AddBookingDialog } from './AddBookingDialog';
import { useTestMode } from '@/contexts/TestModeContext';
import { useOrganization } from '@/contexts/OrganizationContext';
import { useQuery } from '@tanstack/react-query';
import { useOrgTimezone } from '@/hooks/useOrgTimezone';
import { calendarDayKey, orgDateKey, orgSetTimeOnDay, formatInOrgTz } from '@/lib/orgDateRange';
import { getDateInTimezone, formatInTimezone } from '@/lib/timezoneUtils';
import { fmt } from '@/lib/activeCurrency';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

const statusColors: Record<string, string> = {
  pending: 'bg-warning/20 text-warning border-warning/30',
  confirmed: 'bg-primary/20 text-primary border-primary/30',
  in_progress: 'bg-info/20 text-info border-info/30',
  completed: 'bg-success/20 text-success border-success/30',
  rescheduled: 'bg-purple-500/20 text-purple-700 border-purple-500/30',
  cancelled: 'bg-destructive/20 text-destructive border-destructive/30',
  no_show: 'bg-muted text-muted-foreground border-muted',
};

const statusLabels: Record<string, string> = {
  pending: 'pending payment',
  confirmed: 'scheduled',
  in_progress: 'in progress',
  completed: 'completed',
  rescheduled: 'rescheduled',
  cancelled: 'cancelled',
  no_show: 'no show',
};

// Bolder, more distinct staff colors with higher saturation and contrast
const STAFF_COLOR_PALETTE = [
  '#1d4ed8', // deep blue
  '#15803d', // forest green
  '#7c3aed', // vivid purple
  '#c2410c', // burnt orange
  '#be185d', // magenta
  '#0e7490', // dark cyan
  '#b91c1c', // bold red
  '#4338ca', // indigo
  '#0f766e', // teal
  '#a21caf', // fuchsia
  '#ca8a04', // dark yellow
  '#0369a1', // sky blue dark
];

const getStaffColor = (staffId: string | null | undefined, staffList: { id: string; calendar_color?: string | null }[]): string => {
  if (!staffId) return '#6b7280'; // gray for unassigned
  
  // Check if staff has a custom color
  const staff = staffList.find(s => s.id === staffId);
  if (staff?.calendar_color) {
    return staff.calendar_color;
  }
  
  // Fall back to palette based on sorted index
  const sortedStaffIds = staffList.map(s => s.id).sort();
  const index = sortedStaffIds.indexOf(staffId);
  
  if (index === -1) return '#6b7280';
  
  return STAFF_COLOR_PALETTE[index % STAFF_COLOR_PALETTE.length];
};

interface SchedulerCalendarProps {
  searchTerm?: string;
  onSearchChange?: (term: string) => void;
  statusFilter?: 'all' | 'pending' | 'confirmed' | 'in_progress' | 'completed' | 'cancelled';
  staffFilter?: string | null;
}

interface DraggableBookingProps {
  booking: BookingWithDetails;
  index: number;
  onClick: () => void;
  staffList: { id: string; name: string; calendar_color?: string | null }[];
  teamStaffIds?: string[];
}

interface DroppableDayProps {
  id: string;
  disabled?: boolean;
  className?: string;
  children?: ReactNode;
}

function DroppableDay({ id, disabled, className, children }: DroppableDayProps) {
  const { isOver, setNodeRef } = useDroppable({ id, disabled });

  return (
    <div
      ref={setNodeRef}
      className={cn(
        className,
        isOver && 'ring-2 ring-primary/30 bg-primary/5 ring-inset'
      )}
    >
      {children}
    </div>
  );
}

function TrashDropZone({ floating }: { floating?: boolean }) {
  const { isOver, setNodeRef } = useDroppable({ id: 'trash-zone' });

  if (floating) {
    return (
      <div
        ref={setNodeRef}
        className={cn(
          'fixed top-4 left-1/2 -translate-x-1/2 z-50 flex items-center justify-center gap-2 px-6 py-3 rounded-2xl border-2 border-dashed transition-all duration-200 shadow-lg',
          isOver
            ? 'border-destructive bg-destructive/20 scale-110 shadow-destructive/30'
            : 'border-destructive/60 bg-background/95 backdrop-blur-sm'
        )}
      >
        <Trash2 className={cn('w-5 h-5 text-destructive', isOver && 'animate-bounce')} />
        <span className={cn(
          'text-sm font-bold text-destructive whitespace-nowrap',
          isOver && 'animate-pulse'
        )}>
          Drop to Delete
        </span>
      </div>
    );
  }

  return (
    <div
      ref={setNodeRef}
      className={cn(
        'flex items-center justify-center px-3 py-1.5 rounded-md border-2 border-dashed transition-all duration-200 select-none',
        isOver
          ? 'border-destructive bg-destructive/15 scale-105'
          : 'border-destructive/40 bg-destructive/5 hover:bg-destructive/10'
      )}
      title="Drag a booking here to delete"
    >
      <span className={cn(
        'text-xs font-bold text-destructive whitespace-nowrap',
        isOver && 'animate-pulse'
      )}>
        Drag to Delete
      </span>
    </div>
  );
}

// Helper to format customer name as "FirstName L." 
const formatCustomerName = (customer: { first_name: string; last_name: string } | null): string => {
  if (!customer) return 'Customer';
  const firstName = customer.first_name || '';
  const lastInitial = customer.last_name ? `${customer.last_name.charAt(0)}.` : '';
  return `${firstName} ${lastInitial}`.trim();
};

function DraggableBooking({ booking, index, onClick, staffList, teamStaffIds = [], disableDrag }: DraggableBookingProps & { disableDrag?: boolean }) {
  const color = getStaffColor(booking.staff_id, staffList);
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: booking.id,
    disabled: disableDrag,
  });

  // Get team member colors (excluding primary)
  const teamColors = teamStaffIds
    .filter(id => id !== booking.staff_id)
    .map(id => getStaffColor(id, staffList));

  return (
    <div
      ref={setNodeRef}
      {...(disableDrag ? {} : { ...attributes, ...listeners })}
      onClick={() => {
        if (!isDragging) onClick();
      }}
      className={cn(
        'booking-pill w-full text-left select-none',
        !disableDrag && 'cursor-grab active:cursor-grabbing',
        isDragging && 'opacity-50'
      )}
      style={{
        backgroundColor: `${color}20`,
        color: color,
        borderLeft: `3px solid ${color}`,
      }}
    >
      <div className="flex items-center gap-1">
        {!disableDrag && <GripVertical className="w-3 h-3 opacity-0 group-hover:opacity-50 shrink-0" />}
        <span className="truncate font-medium">{formatCustomerName(booking.customer)}</span>
        {teamColors.length > 0 && (
          <div className="flex items-center gap-0.5 ml-auto shrink-0">
            {teamColors.map((tc, i) => (
              <div key={i} className="w-2 h-2 rounded-full" style={{ backgroundColor: tc }} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function SchedulerCalendar({ searchTerm = '', onSearchChange, statusFilter = 'all', staffFilter = null }: SchedulerCalendarProps) {
  const isMobile = useIsMobile();
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedBooking, setSelectedBooking] = useState<BookingWithDetails | null>(null);
  const [viewMode, setViewMode] = useState<'month' | 'week'>('month');
  const [sendingEmail, setSendingEmail] = useState(false);
  const [sendingClientNotif, setSendingClientNotif] = useState(false);
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [editingBooking, setEditingBooking] = useState<BookingWithDetails | null>(null);
  const [localSearchTerm, setLocalSearchTerm] = useState('');
  const [searchResultsOpen, setSearchResultsOpen] = useState(false);
  const [activeBooking, setActiveBooking] = useState<BookingWithDetails | null>(null);
  const [dayBookingsPopup, setDayBookingsPopup] = useState<{ date: Date; bookings: BookingWithDetails[] } | null>(null);
  const { isTestMode, maskName, maskEmail, maskAddress } = useTestMode();
  const { organization } = useOrganization();
  const { timezone: orgTimezone } = useOrgTimezone();

  const { data: allBookings = [], isLoading, refetch } = useBookings();

  const handleRefresh = useCallback(async () => {
    await refetch();
  }, [refetch]);

  const { refreshing, pullDistance, handlers: pullHandlers } = usePullToRefresh(handleRefresh);

  // Fetch team assignments for the selected booking (org-scoped)
  const { data: teamMembers = [], error: teamMembersError } = useQuery({
    queryKey: ['booking-team-assignments', selectedBooking?.id, organization?.id],
    queryFn: async () => {
      if (!selectedBooking?.id || !organization?.id) return [];
      const { data, error } = await supabase
        .from('booking_team_assignments')
        .select('staff_id, staff:staff(id, name)')
        .eq('booking_id', selectedBooking.id)
        .eq('organization_id', organization.id);
      if (error) return [];
      return (data || []).map((a: any) => a.staff).filter(Boolean);
    },
    enabled: !!selectedBooking?.id && !!organization?.id,
  });

  // Fetch all team assignments for calendar display
  const { data: allTeamAssignments = [], error: allTeamAssignmentsError } = useQuery({
    queryKey: ['all-team-assignments', organization?.id],
    queryFn: async () => {
      if (!organization?.id) return [];
      const { data, error } = await supabase
        .from('booking_team_assignments')
        .select('booking_id, staff_id')
        .eq('organization_id', organization.id);
      if (error) return [];
      return data || [];
    },
    enabled: !!organization?.id,
  });

  // Build a map of booking_id -> staff_ids for team assignments
  const teamAssignmentMap = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const a of allTeamAssignments) {
      const existing = map.get(a.booking_id) || [];
      existing.push(a.staff_id);
      map.set(a.booking_id, existing);
    }
    return map;
  }, [allTeamAssignments]);
  const updateBooking = useUpdateBooking();
  const deleteBooking = useDeleteBooking();
  const [pendingDeleteIds, setPendingDeleteIds] = useState<Set<string>>(new Set());
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const pendingDeleteTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  // Clear any pending delete timers on unmount
  useEffect(() => {
    const timers = pendingDeleteTimers.current;
    return () => {
      timers.forEach(t => clearTimeout(t));
      timers.clear();
    };
  }, []);
  // Fetch staff for color consistency
  const { data: staffList = [], error: staffListError } = useQuery({
    queryKey: ['staff-for-calendar', organization?.id],
    queryFn: async () => {
      if (!organization?.id) return [];
      const { data, error } = await supabase
        .from('staff')
        .select('id, name, calendar_color')
        .eq('organization_id', organization.id)
        .eq('is_active', true)
        .order('name');
      if (error) throw error;
      return data || [];
    },
    enabled: !!organization?.id,
  });

  useEffect(() => {
    if (teamMembersError) toast.error('Failed to load team assignments');
    if (allTeamAssignmentsError) toast.error('Failed to load team assignments');
    if (staffListError) toast.error('Failed to load staff list');
  }, [teamMembersError, allTeamAssignmentsError, staffListError]);

  // On mobile, require long-press (500ms delay) to initiate drag; on desktop use distance
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: isMobile
        ? { delay: 500, tolerance: 5 }
        : { distance: 8 },
    })
  );

  const activeSearchTerm = searchTerm || localSearchTerm;

  const searchResults = useMemo(() => {
    if (!activeSearchTerm.trim()) return [];
    
    const term = activeSearchTerm.toLowerCase();
    return allBookings.filter(b => {
      const customerName = b.customer 
        ? `${b.customer.first_name} ${b.customer.last_name}`.toLowerCase()
        : '';
      const serviceName = b.service?.name?.toLowerCase() || '';
      const staffName = b.staff?.name?.toLowerCase() || '';
      
      return customerName.includes(term) || 
             serviceName.includes(term) || 
             staffName.includes(term) ||
             b.booking_number.toString().includes(term);
    }).sort((a, b) => new Date(b.scheduled_at).getTime() - new Date(a.scheduled_at).getTime());
  }, [allBookings, activeSearchTerm]);

  const bookings = useMemo(() => {
    // Compute the full visible grid date range (including overflow days from prev/next month)
    let startStr: string, endStr: string;

    /*
      GRID GEOMETRY. currentDate is which week/month is on screen, and these
      derive the cells around it. A month spans the same days and starts on the
      same weekday in every timezone, so device-local arithmetic yields the
      right calendar — and the keys produced here are compared against
      getDateInTimezone(scheduled_at, orgTimezone) just below, which is what
      makes the two sides agree. What must NOT come from the device is which
      cell is today; that is isOrgTodayCell, and it does not.
    */
    /* eslint-disable local/no-device-local-dates -- grid geometry, see above */
    if (viewMode === 'week') {
      startStr = format(startOfWeek(currentDate), 'yyyy-MM-dd');
      endStr = format(endOfWeek(currentDate), 'yyyy-MM-dd');
    } else {
      const mStart = startOfMonth(currentDate);
      const mEnd = endOfMonth(currentDate);
      const padding = mStart.getDay();
      const gridStart = addDays(mStart, -padding);
      const totalCells = Math.ceil((padding + mEnd.getDate()) / 7) * 7;
      const gridEnd = addDays(gridStart, totalCells - 1);
      startStr = format(gridStart, 'yyyy-MM-dd');
      endStr = format(gridEnd, 'yyyy-MM-dd');
    }
    /* eslint-enable local/no-device-local-dates */

    // Use timezone-aware comparison (same as getBookingsForDate) to avoid mismatches
    return allBookings.filter(b => {
      if (pendingDeleteIds.has(b.id)) return false;
      const bookingDateStr = getDateInTimezone(b.scheduled_at, orgTimezone);
      const inDateRange = bookingDateStr >= startStr && bookingDateStr <= endStr;
      const matchesStatus = statusFilter === 'all' || b.status === statusFilter;
      const matchesStaff = !staffFilter || b.staff_id === staffFilter;
      return inDateRange && matchesStatus && matchesStaff;
    });
  }, [allBookings, currentDate, viewMode, statusFilter, staffFilter, orgTimezone, pendingDeleteIds]);

  const { year, month, days, monthWeekRows } = useMemo(() => {
    /* eslint-disable local/no-device-local-dates -- grid geometry: which month
       is displayed, and the cells composing it. Not instants. */
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();

    if (viewMode === 'week') {
      const weekStart = startOfWeek(currentDate);
      const days: Date[] = [];
      for (let i = 0; i < 7; i++) {
        days.push(addDays(weekStart, i));
      }
      return { year, month, days, monthWeekRows: 1 };
    }

    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const startPadding = firstDay.getDay();
    const daysInMonth = lastDay.getDate();
    const totalCells = Math.ceil((startPadding + daysInMonth) / 7) * 7;

    const days: Date[] = [];

    // Previous month overflow days
    for (let i = startPadding - 1; i >= 0; i--) {
      days.push(new Date(year, month, -i));
    }

    // Current month days
    for (let i = 1; i <= daysInMonth; i++) {
      days.push(new Date(year, month, i));
    }

    // Next month overflow days
    let nextDay = 1;
    while (days.length < totalCells) {
      days.push(new Date(year, month + 1, nextDay++));
    }

    /* eslint-enable local/no-device-local-dates */
    return { year, month, days, monthWeekRows: totalCells / 7 };
  }, [currentDate, viewMode]);

  const getBookingsForDate = (date: Date): BookingWithDetails[] => {
    // The cell's own calendar day, matched against each booking's day resolved
    // in the ORG's zone on the next line. Grid key vs org key — the pairing is
    // the point; converting the grid token too would double-shift it.
    // eslint-disable-next-line local/no-device-local-dates
    const dateStr = format(date, 'yyyy-MM-dd');
    return bookings.filter(b => getDateInTimezone(b.scheduled_at, orgTimezone) === dateStr);
  };

  const navigate = (direction: number) => {
    if (viewMode === 'week') {
      setCurrentDate(direction > 0 ? addWeeks(currentDate, 1) : subWeeks(currentDate, 1));
    } else {
      setCurrentDate(direction > 0 ? addMonths(currentDate, 1) : subMonths(currentDate, 1));
    }
  };

  const goToToday = () => {
    const today = new Date();
    setCurrentDate(today);
    setViewMode('week');
    setDayBookingsPopup({ date: today, bookings: getBookingsForDate(today) });
  };

  // `date` is a grid token, so its own calendar day is read as-is; what had to
  // move is the comparison point. This was the device's today, so an admin
  // outside the org's timezone had the wrong cell ringed for hours each day.
  const isOrgTodayCell = (date: Date) => calendarDayKey(date) === orgDateKey(new Date(), orgTimezone);

  const handleDragStart = (event: DragStartEvent) => {
    const booking = allBookings.find(b => b.id === event.active.id);
    if (booking) {
      setActiveBooking(booking);
    }
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveBooking(null);

    if (!over) return;

    const bookingId = active.id as string;
    const targetId = over.id as string;
    const booking = allBookings.find(b => b.id === bookingId);
    if (!booking) return;

    // Handle trash drop — soft delete with 5s undo window
    if (targetId === 'trash-zone') {
      setActiveBooking(null);
      const customerName = formatCustomerName(booking.customer);

      // Hide booking from view immediately
      setPendingDeleteIds(prev => {
        const next = new Set(prev);
        next.add(bookingId);
        return next;
      });

      // After 5s, perform the actual delete
      const timer = setTimeout(async () => {
        pendingDeleteTimers.current.delete(bookingId);
        try {
          await deleteBooking.mutateAsync(bookingId);
        } catch (err) {
          console.error('Delete failed:', err);
          toast.error('Failed to delete booking');
        }
        setPendingDeleteIds(prev => {
          const next = new Set(prev);
          next.delete(bookingId);
          return next;
        });
      }, 5000);
      pendingDeleteTimers.current.set(bookingId, timer);

      toast(`${customerName}'s booking deleted`, {
        duration: 5000,
        action: {
          label: 'Undo',
          onClick: () => {
            const t = pendingDeleteTimers.current.get(bookingId);
            if (t) {
              clearTimeout(t);
              pendingDeleteTimers.current.delete(bookingId);
            }
            setPendingDeleteIds(prev => {
              const next = new Set(prev);
              next.delete(bookingId);
              return next;
            });
            toast.success('Booking restored');
          },
        },
      });
      return;
    }

    if (!targetId.startsWith('day-')) return;

    // The drop target id is the grid cell's key, and those cells are matched
    // against getDateInTimezone(scheduled_at, orgTimezone) — so the cell means
    // an ORG calendar day. Read it as three numbers, not as an instant.
    const [ty, tm, td] = targetId.replace('day-', '').split('-').map(Number);

    if (!booking) return;

    const currentScheduled = new Date(booking.scheduled_at);
    const previousScheduledISO = booking.scheduled_at; // Store for undo

    /*
      This used to be setHours(targetDate, currentScheduled.getHours()) — the
      booking's hour as the ADMIN'S DEVICE renders it, written onto a
      device-local midnight. Simulated across four device zones it put 8 of 16
      drags in the wrong place:
        - an hour off across either zone's DST transition, and
        - a whole day early for evening jobs, because 22:00 in New York is the
          next calendar day in Manila or London. The cleaner gets dispatched on
          the wrong date.
      It only ever worked when the admin's device happened to match the org.

      What must be preserved is the booking's ORG-local time of day, placed on
      the ORG day that was dropped on.
    */
    const [orgH, orgMin] = formatInOrgTz(currentScheduled, orgTimezone, {
      hour: '2-digit', minute: '2-digit', hour12: false, hourCycle: 'h23',
    }).split(':').map(Number);
    const newScheduled = orgSetTimeOnDay(ty, tm, td, orgH, orgMin, orgTimezone);

    // Same org day => nothing moved. Comparing device days could call a real
    // move a no-op for exactly the evening bookings described above.
    if (orgDateKey(currentScheduled, orgTimezone) === orgDateKey(newScheduled, orgTimezone)) return;

    const customerName = formatCustomerName(booking.customer);

    try {
      await updateBooking.mutateAsync({
        id: bookingId,
        scheduled_at: newScheduled.toISOString(),
      });
      
      // Show success toast with undo action
      toast.success(
        `${customerName} moved to ${formatInOrgTz(newScheduled, orgTimezone, { month: 'short', day: 'numeric' })}`,
        {
          duration: 8000,
          action: {
            label: 'Undo',
            onClick: async () => {
              try {
                await updateBooking.mutateAsync({
                  id: bookingId,
                  scheduled_at: previousScheduledISO,
                });
                toast.success(`Booking restored to ${formatInOrgTz(currentScheduled, orgTimezone, { month: 'short', day: 'numeric', year: 'numeric' })}`);
              } catch (undoError) {
                toast.error('Failed to undo');
                console.error(undoError);
              }
            },
          },
        }
      );
    } catch (error: any) {
      toast.error('Failed to reschedule booking');
      console.error(error);
    }
  };

  const sendCleanerNotification = async (booking: BookingWithDetails) => {
    setSendingEmail(true);
    try {
      const customerName = booking.customer 
        ? `${booking.customer.first_name} ${booking.customer.last_name}`
        : 'Unknown Customer';

      // Get team members for this booking (org-scoped)
      const { data: teamAssignments } = await supabase
        .from('booking_team_assignments')
        .select('staff_id, staff:staff(id, name, phone)')
        .eq('booking_id', booking.id)
        .eq('organization_id', organization?.id ?? '');

      // Collect all staff to notify (primary + team members)
      const staffToNotify: { name: string; phone: string }[] = [];
      
      // Add primary staff if assigned
      if (booking.staff?.phone) {
        staffToNotify.push({ name: booking.staff.name, phone: booking.staff.phone });
      }
      
      // Add team members (avoid duplicates)
      if (teamAssignments && teamAssignments.length > 0) {
        for (const assignment of teamAssignments) {
          const staffMember = assignment.staff as any;
          if (staffMember?.phone && !staffToNotify.some(s => s.phone === staffMember.phone)) {
            staffToNotify.push({ name: staffMember.name, phone: staffMember.phone });
          }
        }
      }

      if (staffToNotify.length === 0) {
        toast.error('No cleaners assigned or none have phone numbers');
        return;
      }

      let successCount = 0;
      let failCount = 0;

      for (const staffMember of staffToNotify) {
        try {
          const { data, error } = await supabase.functions.invoke('send-cleaner-notification', {
            body: {
              cleanerName: staffMember.name,
              cleanerPhone: staffMember.phone,
              customerName,
              customerPhone: booking.customer?.phone || 'Not provided',
              serviceName: booking.service?.name || (booking.total_amount === 0 ? 'Re-clean' : 'Cleaning Service'),
              appointmentDate: formatInTimezone(booking.scheduled_at, orgTimezone, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }),
              appointmentTime: formatInTimezone(booking.scheduled_at, orgTimezone, { hour: 'numeric', minute: '2-digit', hour12: true, timeZoneName: 'short' }),
              address: [booking.address, (booking as any).apt_suite ? `Unit ${(booking as any).apt_suite}` : null, booking.city, booking.state, booking.zip_code].filter(Boolean).join(', ') || 'Address not provided',
              bookingNumber: booking.booking_number,
              organizationId: organization?.id,
            },
          });

          if (error) throw error;
          if (data?.error) throw new Error(data.error);
          successCount++;
        } catch (err) {
          console.error(`Failed to notify ${staffMember.name}:`, err);
          failCount++;
        }
      }

      if (successCount > 0) {
        const message = staffToNotify.length > 1 
          ? `SMS sent to ${successCount} team member(s)${failCount > 0 ? `, ${failCount} failed` : ''}`
          : `SMS sent to ${staffToNotify[0].name}`;
        toast.success(message);
      } else {
        toast.error('All notifications failed');
      }
    } catch (err: any) {
      console.error('Failed to send notification:', err);
      toast.error('Failed to send notification: ' + (err.message || 'Unknown error'));
    } finally {
      setSendingEmail(false);
    }
  };

  const sendClientNotification = async (booking: BookingWithDetails) => {
    if (!booking.customer?.phone) { toast.error('No customer phone number found'); return; }
    setSendingClientNotif(true);
    try {
      const scheduledDate = new Date(booking.scheduled_at);
      const { data, error } = await supabase.functions.invoke('send-booking-reminder', {
        body: {
          bookingId: booking.id,
          customerPhone: booking.customer.phone,
          customerName: `${booking.customer.first_name} ${booking.customer.last_name}`,
          serviceName: booking.service?.name || 'Cleaning Service',
          scheduledAt: booking.scheduled_at,
          // These two strings go into an SMS the CUSTOMER receives. Rendered
          // without a timeZone they were the admin's device clock, so an admin
          // travelling could text a customer the wrong appointment time — the
          // booking itself unchanged, only the message wrong. The org's clock
          // is the one the customer's appointment is actually in.
          address: booking.address || '',
          totalAmount: booking.total_amount,
          organizationId: organization?.id,
        },
      });
      if (error || data?.error) throw new Error(error?.message || data?.error);
      toast.success(`Reminder sent to ${booking.customer.first_name}`);
    } catch (err: any) {
      toast.error('Failed to notify client: ' + (err.message || 'Unknown error'));
    } finally {
      setSendingClientNotif(false);
    }
  };

  const handleSearchChange = (value: string) => {
    setLocalSearchTerm(value);
    if (onSearchChange) {
      onSearchChange(value);
    }
    setSearchResultsOpen(value.length > 0);
  };

  const handleEditBooking = () => {
    if (selectedBooking) {
      setEditingBooking(selectedBooking);
      setSelectedBooking(null);
    }
  };

  const getHeaderTitle = () => {
    if (viewMode === 'week') {
      /* eslint-disable-next-line local/no-device-local-dates -- header label for the displayed week; grid geometry */
      const weekStart = startOfWeek(currentDate);
      /* eslint-disable-next-line local/no-device-local-dates -- ditto */
      const weekEnd = endOfWeek(currentDate);
      return `${format(weekStart, 'MMM d')} - ${format(weekEnd, 'MMM d, yyyy')}`;
    }
    return `${MONTHS[month]} ${year}`;
  };

  const getFullAddress = (booking: BookingWithDetails) => {
    const parts = [
      booking.address,
      booking.city,
      booking.state,
      booking.zip_code
    ].filter(Boolean);
    return parts.length > 0 ? parts.join(', ') : null;
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={pointerWithin}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <div
        className="bg-card rounded-xl border border-border shadow-sm flex flex-col h-[calc(100vh-10rem)] md:h-[calc(100vh-8rem)]"
        {...pullHandlers}
      >
        <PullToRefreshIndicator pullDistance={pullDistance} refreshing={refreshing} />
        {/* Calendar Header */}
        <div className="flex items-center justify-between p-2 md:p-4 border-b border-border flex-wrap gap-2 md:gap-4 pt-[calc(0.5rem+env(safe-area-inset-top,0px))] md:pt-4">
          <div className="flex items-center gap-2 md:gap-4">
            {isMobile ? (
              <h1 className="text-base font-semibold pl-10 text-foreground">Scheduler</h1>
            ) : (
              <TrashDropZone />
            )}
          </div>
          <div className="flex items-center gap-2 md:gap-4">
            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8"
                onClick={() => navigate(-1)}
              >
                <ChevronLeft className="w-4 h-4" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8"
                onClick={() => navigate(1)}
              >
                <ChevronRight className="w-4 h-4" />
              </Button>
            </div>
            <h2 className="text-sm md:text-lg font-semibold whitespace-nowrap">
              {getHeaderTitle()}
            </h2>
            <Button variant="outline" size="sm" onClick={goToToday}>
              Today
            </Button>
          </div>

          <div className="flex items-center gap-1.5 md:gap-2 flex-wrap">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search bookings..."
                value={activeSearchTerm}
                onChange={(e) => handleSearchChange(e.target.value)}
                className="pl-10 w-40 md:w-64"
                onFocus={() => activeSearchTerm && setSearchResultsOpen(true)}
              />
              
              {searchResultsOpen && activeSearchTerm && (
                <div className="absolute top-full left-0 right-0 mt-1 bg-popover border border-border rounded-lg shadow-lg max-h-96 overflow-auto z-50">
                  {searchResults.length === 0 ? (
                    <div className="p-4 text-center text-muted-foreground">
                      No results found
                    </div>
                  ) : (
                    searchResults.slice(0, 10).map((booking) => (
                      <button
                        key={booking.id}
                        className="w-full p-3 text-left hover:bg-muted/50 border-b border-border last:border-0"
                        onClick={() => {
                          setSelectedBooking(booking);
                          setSearchResultsOpen(false);
                        }}
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-medium">
                            {booking.customer 
                              ? maskName(`${booking.customer.first_name} ${booking.customer.last_name}`)
                              : 'Unknown'}
                          </span>
                          <Badge className={cn('text-xs', statusColors[booking.status])}>
                            {statusLabels[booking.status] || booking.status}
                          </Badge>
                        </div>
                        <div className="text-sm text-muted-foreground mt-1">
                          {booking.service?.name || (booking.total_amount === 0 ? 'Re-clean' : 'Service')} • {formatInTimezone(booking.scheduled_at, orgTimezone, { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true, timeZoneName: 'short' })}
                        </div>
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>

            <div className="flex bg-secondary rounded-lg p-1">
              <Button
                variant={viewMode === 'month' ? 'default' : 'ghost'}
                size="sm"
                onClick={() => setViewMode('month')}
                className="h-7"
              >
                Month
              </Button>
              <Button
                variant={viewMode === 'week' ? 'default' : 'ghost'}
                size="sm"
                onClick={() => setViewMode('week')}
                className="h-7"
              >
                Week
              </Button>
            </div>
            <Button size="sm" className="gap-2" onClick={() => setAddDialogOpen(true)}>
              <Plus className="w-4 h-4" />
              Add Booking
            </Button>
          </div>
        </div>

        {searchResultsOpen && (
          <div 
            className="fixed inset-0 z-40" 
            onClick={() => setSearchResultsOpen(false)}
          />
        )}

        {!isMobile && (
          <div className="px-4 py-2 bg-secondary/30 border-b border-border text-sm text-muted-foreground flex items-center gap-2">
            <GripVertical className="w-4 h-4" />
            Drag and drop bookings to reschedule them
          </div>
        )}

        {/* Day Headers */}
        <div className="flex-1 flex flex-col overflow-hidden">
        <div className="grid grid-cols-7 border-b border-border">
          {DAYS.map((day) => (
            <div
              key={day}
              className="py-1.5 md:py-3 text-center text-[10px] md:text-sm font-medium text-muted-foreground"
            >
              {isMobile ? day.charAt(0) : day}
            </div>
          ))}
        </div>

        {/* Calendar Grid */}
        <div
          className="grid grid-cols-7 flex-1 min-h-0"
          style={{
            gridTemplateRows:
              viewMode === 'week'
                ? 'repeat(1, minmax(0, 1fr))'
                : `repeat(${monthWeekRows}, minmax(0, 1fr))`,
          }}
        >
          {isLoading ? (
            <div className="col-span-7 flex items-center justify-center h-64">
              <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
            </div>
          ) : (
            days.map((date, index) => {
               const dayBookings = getBookingsForDate(date);
               // Is this cell an overflow day from the neighbouring month?
               // Cell vs displayed month — both grid tokens, no instant.
               // eslint-disable-next-line local/no-device-local-dates
               const isOutsideMonth = date.getMonth() !== month;
               return (
                <DroppableDay
                  key={index}
                  /* eslint-disable-next-line local/no-device-local-dates -- the cell's key; parsed back as an ORG day by the drop handler */
                  id={`day-${format(date, 'yyyy-MM-dd')}`}
                  disabled={isOutsideMonth}
                  className={cn(
                    'calendar-day min-h-0 overflow-hidden',
                    viewMode === 'week'
                      ? (isMobile ? 'min-h-[100px]' : 'min-h-[200px]')
                      : '',
                    isOrgTodayCell(date) && 'today',
                    isOutsideMonth && 'bg-muted/20 opacity-40'
                  )}
                >
                    <>
                      <span
                        className={cn(
                          'text-[10px] md:text-sm font-medium mb-0.5 md:mb-1',
                          isOrgTodayCell(date) && 'text-primary',
                          isOutsideMonth && 'text-muted-foreground'
                        )}
                      >
                        {/* eslint-disable-next-line local/no-device-local-dates -- the number printed in the cell IS the cell's day */}
                        {viewMode === 'week' ? (isMobile ? format(date, 'd') : format(date, 'MMM d')) : date.getDate()}
                      </span>
                        <div
                          className={cn(
                            'w-full space-y-0.5 md:space-y-1 overflow-y-auto overflow-x-hidden scrollbar-thin min-h-0',
                            viewMode === 'week'
                              ? (isMobile ? 'max-h-[80px]' : 'max-h-[200px]')
                              : 'flex-1'
                          )}
                        >
                        {(() => {
                          const maxVisible = isMobile && viewMode === 'month' ? 2 : dayBookings.length;
                          const visibleBookings = dayBookings.slice(0, maxVisible);
                          const overflowCount = dayBookings.length - maxVisible;
                          return (
                            <>
                              {visibleBookings.map((booking, bIndex) => (
                                <DraggableBooking
                                  key={booking.id}
                                  booking={booking}
                                  index={bIndex}
                                  onClick={() => setSelectedBooking(booking)}
                                  staffList={staffList}
                                  teamStaffIds={teamAssignmentMap.get(booking.id)}
                                  disableDrag={isMobile}
                                />
                              ))}
                              {overflowCount > 0 && (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setDayBookingsPopup({ date: date!, bookings: dayBookings });
                                  }}
                                  className="w-full text-center text-[10px] font-semibold text-primary bg-primary/10 rounded py-0.5 hover:bg-primary/20 transition-colors"
                                >
                                  +{overflowCount} more
                                </button>
                              )}
                            </>
                          );
                        })()}
                      </div>
                    </>

                </DroppableDay>
              );
            })
          )}
        </div>
        </div>

        {/* Drag Overlay */}
        <DragOverlay>
          {activeBooking && (
            <div className="booking-pill bg-primary/20 text-primary border-l-4 border-primary px-2 py-1 rounded text-sm shadow-lg">
              {formatCustomerName(activeBooking.customer)}
            </div>
          )}
        </DragOverlay>

        {/* Day Bookings Popup - shows all bookings for a day when clicking +X */}
        <Dialog open={!!dayBookingsPopup} onOpenChange={() => setDayBookingsPopup(null)}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>
                {dayBookingsPopup && format(dayBookingsPopup.date, 'MMMM d, yyyy')}
              </DialogTitle>
            </DialogHeader>
            {dayBookingsPopup && (
              <div className="space-y-2 max-h-[60vh] overflow-y-auto">
                {dayBookingsPopup.bookings.map((booking) => {
                  const color = getStaffColor(booking.staff_id, staffList);
                  const fullName = booking.customer 
                    ? `${booking.customer.first_name} ${booking.customer.last_name}`
                    : 'Customer';
                  return (
                    <button
                      key={booking.id}
                      onClick={() => {
                        setDayBookingsPopup(null);
                        setSelectedBooking(booking);
                      }}
                      className="w-full text-left px-4 py-3 rounded-lg border transition-all hover:brightness-95"
                      style={{
                        backgroundColor: `${color}15`,
                        borderColor: `${color}40`,
                        borderLeftWidth: '4px',
                        borderLeftColor: color,
                      }}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-medium" style={{ color }}>{maskName(fullName)}</span>
                        <Badge className={cn('text-xs', statusColors[booking.status])}>
                          {statusLabels[booking.status] || booking.status}
                        </Badge>
                      </div>
                      <div className="text-xs text-muted-foreground mt-1 flex items-center gap-2">
                        <span>{formatInTimezone(booking.scheduled_at, orgTimezone, { hour: 'numeric', minute: '2-digit', hour12: true, timeZoneName: 'short' })}</span>
                        <span>•</span>
                        <span>{booking.service?.name || 'Service'}</span>
                        {!isTestMode && booking.total_amount > 0 && (
                          <>
                            <span>•</span>
                            <span>{fmt(Number(booking.total_amount))}</span>
                          </>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </DialogContent>
        </Dialog>

        {/* Booking Detail Dialog */}
        <Dialog open={!!selectedBooking} onOpenChange={() => setSelectedBooking(null)}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Booking Details</DialogTitle>
            </DialogHeader>
            {selectedBooking && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-lg font-semibold">
                    {selectedBooking.service?.name || (selectedBooking.total_amount === 0 ? 'Re-clean' : 'Service')}
                  </span>
                  <Badge className={cn('capitalize', statusColors[selectedBooking.status])}>
                    {statusLabels[selectedBooking.status] || selectedBooking.status}
                  </Badge>
                </div>
                
                <div className="flex items-center justify-between text-sm text-muted-foreground">
                  <span>Booking #{selectedBooking.booking_number}</span>
                  {!isTestMode && (
                    <span className="font-semibold text-foreground text-base">
                      ${Number(selectedBooking.total_amount).toFixed(2)}
                    </span>
                  )}
                </div>
                
                <div className="space-y-3">
                  <div className="flex items-center gap-3 text-sm">
                    <User className="w-4 h-4 text-muted-foreground" />
                    <div>
                      <p className="font-medium">
                        {selectedBooking.customer 
                          ? maskName(`${selectedBooking.customer.first_name} ${selectedBooking.customer.last_name}`)
                          : 'Unknown Customer'
                        }
                      </p>
                      <p className="text-muted-foreground">
                        {selectedBooking.customer ? maskEmail(selectedBooking.customer.email) : 'No email'}
                      </p>
                    </div>
                  </div>
                  
                  <div className="flex items-center gap-3 text-sm">
                    <Clock className="w-4 h-4 text-muted-foreground" />
                    <div>
                      <p className="font-medium">
                        {formatInTimezone(selectedBooking.scheduled_at, orgTimezone, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
                      </p>
                      <p className="text-muted-foreground">
                        {formatInTimezone(selectedBooking.scheduled_at, orgTimezone, { hour: 'numeric', minute: '2-digit', hour12: true, timeZoneName: 'short' })}
                      </p>
                    </div>
                  </div>
                  
                  {getFullAddress(selectedBooking) && (
                    <div className="flex items-center gap-3 text-sm">
                      <MapPin className="w-4 h-4 text-muted-foreground" />
                      <p>{maskAddress(getFullAddress(selectedBooking))}</p>
                    </div>
                  )}

                  {/* Staff / Team Assignments */}
                  {(selectedBooking.staff || teamMembers.length > 0) && (() => {
                    // Filter out primary staff from team list to avoid duplicates
                    const additionalTeam = teamMembers.filter((m: any) => m.id !== selectedBooking.staff_id);
                    return (
                      <div className="flex items-start gap-3 text-sm">
                        <Users className="w-4 h-4 text-muted-foreground mt-0.5" />
                        <div>
                          <p className="font-medium">Assigned Staff</p>
                          {selectedBooking.staff && (
                            <p className="text-muted-foreground">
                              {maskName(selectedBooking.staff.name)}{additionalTeam.length > 0 ? ' (Primary)' : ''}
                            </p>
                          )}
                          {additionalTeam.map((member: any) => (
                            <p key={member.id} className="text-muted-foreground">
                              {maskName(member.name)} (Team)
                            </p>
                          ))}
                        </div>
                      </div>
                    );
                  })()}
                </div>

                <div className={`grid gap-2 pt-4 border-t ${selectedBooking.staff ? 'grid-cols-2' : 'grid-cols-2'}`}>
                  <Button
                    variant="outline"
                    className="flex-col gap-1 h-auto py-2 text-xs"
                    onClick={handleEditBooking}
                  >
                    <Edit className="w-4 h-4" />
                    Edit
                  </Button>
                  <Button
                    variant="outline"
                    className="flex-col gap-1 h-auto py-2 text-xs"
                    onClick={() => {
                      const duplicated = {
                        ...selectedBooking,
                        id: '' as any,
                        booking_number: 0,
                        status: 'pending' as const,
                        payment_status: 'pending' as const,
                      };
                      setSelectedBooking(null);
                      setTimeout(() => {
                        setEditingBooking(duplicated as BookingWithDetails);
                      }, 100);
                    }}
                  >
                    <Copy className="w-4 h-4" />
                    Duplicate
                  </Button>
                  <Button
                    variant="outline"
                    className="flex-col gap-1 h-auto py-2 text-xs"
                    onClick={() => sendClientNotification(selectedBooking)}
                    disabled={sendingClientNotif || !selectedBooking.customer?.phone}
                  >
                    {sendingClientNotif ? <Loader2 className="w-4 h-4 animate-spin" /> : <Bell className="w-4 h-4" />}
                    Notify Client
                  </Button>
                  {selectedBooking.staff && (
                    <Button
                      variant="outline"
                      className="flex-col gap-1 h-auto py-2 text-xs"
                      onClick={() => sendCleanerNotification(selectedBooking)}
                      disabled={sendingEmail}
                    >
                      {sendingEmail ? <Loader2 className="w-4 h-4 animate-spin" /> : <Phone className="w-4 h-4" />}
                      Notify Cleaner
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    className="flex-col gap-1 h-auto py-2 text-xs text-destructive border-destructive/40 hover:bg-destructive/10 hover:text-destructive"
                    onClick={() => setConfirmDeleteId(selectedBooking.id)}
                  >
                    <Trash2 className="w-4 h-4" />
                    Delete
                  </Button>
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>

        {/* Delete confirmation (tap path — drag-to-trash doesn't work on touch) */}
        <AlertDialog open={!!confirmDeleteId} onOpenChange={(open) => { if (!open) setConfirmDeleteId(null); }}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete this booking?</AlertDialogTitle>
              <AlertDialogDescription>
                This permanently removes the booking. This can't be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                onClick={async () => {
                  const id = confirmDeleteId!;
                  setConfirmDeleteId(null);
                  setSelectedBooking(null);
                  try {
                    await deleteBooking.mutateAsync(id);
                    toast.success('Booking deleted');
                  } catch (err) {
                    console.error('Delete failed:', err);
                    toast.error('Failed to delete booking');
                  }
                }}
              >
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Add/Edit Booking Dialog */}
        <AddBookingDialog
          open={addDialogOpen || !!editingBooking}
          onOpenChange={(open) => {
            if (!open) {
              setAddDialogOpen(false);
              setEditingBooking(null);
            }
          }}
          booking={editingBooking}
          onDuplicate={(duplicatedBooking) => {
            // Close current dialog first, then reopen with duplicated booking
            setEditingBooking(null);
            setAddDialogOpen(false);
            // Use setTimeout to ensure dialog closes before reopening
            setTimeout(() => {
              setEditingBooking({
                ...duplicatedBooking,
                id: '' as any,
                booking_number: 0,
              });
              setAddDialogOpen(true);
            }, 100);
          }}
        />

      </div>
    </DndContext>
  );
}