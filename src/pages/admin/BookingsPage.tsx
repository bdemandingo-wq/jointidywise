import { useState, useMemo, useCallback, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
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
import { AdminLayout } from '@/components/admin/AdminLayout';
import { AttentionStrip } from '@/components/admin/AttentionStrip';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar as CalendarComponent } from '@/components/ui/calendar';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { 
  Search, 
  Download, 
  MoreHorizontal, 
  Eye, 
  Edit, 
  Trash2, 
  Plus, 
  Loader2, 
  CreditCard, 
  XCircle, 
  Copy,
  Calendar,
  User,
  Clock,
  DollarSign,
  Filter,
  CalendarRange,
  X,
  Phone,
  Bell,
  Settings2,
  Star,
  PlusCircle,
  RotateCcw,
  Heart,
  Banknote,
  UserPlus,
  ChevronDown,
  CheckCircle,
  FileSpreadsheet,
  FileText,
  Printer,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { matrixToCsv } from '@/lib/orgDataExport';
import { handleSmsError } from '@/lib/smsErrorHandler';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuLabel,
  DropdownMenuGroup,
} from '@/components/ui/dropdown-menu';
import { useBookings, useDraftBookings, useUpdateBooking, useDeleteBooking, useStaff, useServices, BookingWithDetails } from '@/hooks/useBookings';
import { format, isWithinInterval, startOfDay, endOfDay, differenceInDays, differenceInHours, addDays } from 'date-fns';
import { useOrgTimezone } from '@/hooks/useOrgTimezone';
import { orgStartOfDay, orgEndOfDay, orgDateKey, formatInOrgTz } from '@/lib/orgDateRange';
import { formatInTimezone, getDateInTimezone } from '@/lib/timezoneUtils';
import { AddBookingDialog } from '@/components/admin/AddBookingDialog';
import { BookingDetailsDialog, AdjustPaymentDialog } from '@/components/admin/BookingDialogs';
import { PaymentHistoryLogDialog } from '@/components/admin/PaymentHistoryLogDialog';
import { BulkEditCleanerWages } from '@/components/admin/BulkEditCleanerWages';
import { supabase } from '@/lib/supabase';
import { QuotesTabContent } from '@/components/admin/QuotesTabContent';
import { AdditionalChargesDialog } from '@/components/admin/AdditionalChargesDialog';
import { toast } from '@/hooks/use-toast';
import { ToastAction } from '@/components/ui/toast';
import { showChargeFailureToastLegacy, extractFailureReason } from '@/lib/chargeErrorToast';
import { DateRange } from 'react-day-picker';
import { useTestMode } from '@/contexts/TestModeContext';
import { useOrganization } from '@/contexts/OrganizationContext';
import { useIsMobile } from '@/hooks/use-mobile';
import { usePullToRefresh } from '@/hooks/usePullToRefresh';
import { PullToRefreshIndicator } from '@/components/admin/PullToRefreshIndicator';
import { BookingActionSheet } from '@/components/admin/BookingActionSheet';
import { CancelBookingDialog, type CancellationCategory } from '@/components/admin/CancelBookingDialog';
import { BulkEditBookingsDialog } from '@/components/admin/BulkEditBookingsDialog';
import { MobileActionSheet } from '@/components/ui/mobile-action-sheet';
import { usePlatform } from '@/hooks/usePlatform';
import { fmt } from '@/lib/activeCurrency';
import { formatFullAddress } from '@/lib/formatAddress';
import { readEdgeFunctionError } from '@/lib/edgeFunctionError';

const statusConfig: Record<string, { bg: string; text: string; dot: string }> = {
  pending: { bg: 'bg-warning/10', text: 'text-warning', dot: 'bg-warning' },
  confirmed: { bg: 'bg-info/10', text: 'text-info', dot: 'bg-info' },
  in_progress: { bg: 'bg-info/10', text: 'text-info', dot: 'bg-info' },
  completed: { bg: 'bg-success/10', text: 'text-success', dot: 'bg-success' },
  cancelled: { bg: 'bg-destructive/10', text: 'text-destructive', dot: 'bg-destructive' },
  no_show: { bg: 'bg-muted', text: 'text-muted-foreground', dot: 'bg-muted-foreground' },
  // Live, actionable state — the job still needs doing, just on a new date.
  // Info-coloured on purpose: it is what the action sheet already showed by
  // accident, so nothing changes visually for anyone used to it.
  rescheduled: { bg: 'bg-info/10', text: 'text-info', dot: 'bg-info' },
};

const statusLabels: Record<string, string> = {
  pending: 'pending payment',
  confirmed: 'scheduled',
  in_progress: 'in progress',
  completed: 'completed',
  cancelled: 'cancelled',
  no_show: 'no show',
  rescheduled: 'rescheduled',
};

const getPaymentStatusInfo = (booking: BookingWithDetails) => {
  const hasPaymentIntent = !!(booking as any).payment_intent_id;

  if (booking.payment_status === 'paid') {
    return { label: 'Paid', bg: 'bg-success/10', text: 'text-success', icon: '✓' };
  }

  if (booking.payment_status === 'refunded') {
    return { label: 'Refunded', bg: 'bg-muted', text: 'text-muted-foreground', icon: '↩' };
  }

  if (booking.payment_status === 'partial') {
    return { label: 'Partially Refunded', bg: 'bg-muted', text: 'text-foreground', icon: '↩' };
  }

  if (hasPaymentIntent) {
    return { label: 'Hold', bg: 'bg-warning/10', text: 'text-warning', icon: '◐' };
  }

  return { label: 'Unpaid', bg: 'bg-destructive/10', text: 'text-destructive', icon: '○' };
};

export default function BookingsPage() {
  const [selectedDrafts, setSelectedDrafts] = useState<Set<string>>(new Set());
  const [bulkDraftDeleteOpen, setBulkDraftDeleteOpen] = useState(false);
  const [bulkDraftDeleting, setBulkDraftDeleting] = useState(false);
  const isMobile = useIsMobile();
  const { timezone: orgTz } = useOrgTimezone();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  // Handle deep-links like /dashboard/bookings?newBooking=true&customerId=<id>
  // (e.g. the "Book" button on a customer profile, or widget tap) by opening
  // the New Booking dialog with the customer already selected.
  // Depends on searchParams so it fires when the widget deep link changes the
  // hash while BookingsPage is already mounted.
  useEffect(() => {
    if (searchParams.get('newBooking') === 'true') {
      const cid = searchParams.get('customerId');
      setPrefillCustomerId(cid || null);
      setEditingBooking(null);
      setAddDialogOpen(true);
      // Strip the params so re-opening/closing doesn't retrigger.
      const next = new URLSearchParams(searchParams);
      next.delete('newBooking');
      next.delete('customerId');
      setSearchParams(next, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);
  const [activeTab, setActiveTab] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [dateRange, setDateRange] = useState<DateRange | undefined>(undefined);
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [prefillCustomerId, setPrefillCustomerId] = useState<string | null>(null);
  const [viewDialogOpen, setViewDialogOpen] = useState(false);
  const [adjustPaymentOpen, setAdjustPaymentOpen] = useState(false);
  const [activeBooking, setActiveBooking] = useState<BookingWithDetails | null>(null);
  const [editingBooking, setEditingBooking] = useState<BookingWithDetails | null>(null);
  const [capturingPayment, setCapturingPayment] = useState<string | null>(null);
  const [cancelingHold, setCancelingHold] = useState<string | null>(null);
  const [chargingCard, setChargingCard] = useState<string | null>(null);
  const [placingHold, setPlacingHold] = useState<string | null>(null);
  const [placeHoldConfirmBooking, setPlaceHoldConfirmBooking] = useState<BookingWithDetails | null>(null);
  const [selectedBookings, setSelectedBookings] = useState<Set<string>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [bulkAssigning, setBulkAssigning] = useState(false);
  const [bulkAssignDialogOpen, setBulkAssignDialogOpen] = useState(false);
  const [selectedStaffId, setSelectedStaffId] = useState<string>('');
  const [exporting, setExporting] = useState(false);
  const [chargeConfirmBooking, setChargeConfirmBooking] = useState<BookingWithDetails | null>(null);
  const [captureConfirmBooking, setCaptureConfirmBooking] = useState<BookingWithDetails | null>(null);
  const [paymentHistoryOpen, setPaymentHistoryOpen] = useState(false);
  const [paymentHistoryBooking, setPaymentHistoryBooking] = useState<BookingWithDetails | null>(null);
  const [sendingReminder, setSendingReminder] = useState<string | null>(null);
  const [sendingCleanerNotification, setSendingCleanerNotification] = useState<string | null>(null);
  const [bulkNotifyingCleaners, setBulkNotifyingCleaners] = useState(false);
  const [notifyingOpenJob, setNotifyingOpenJob] = useState<string | null>(null);
  const [cleanerPickerOpen, setCleanerPickerOpen] = useState(false);
  const [cleanerPickerBooking, setCleanerPickerBooking] = useState<BookingWithDetails | null>(null);
  const [selectedCleanerIds, setSelectedCleanerIds] = useState<Set<string>>(new Set());
  const [sendingReviewRequest, setSendingReviewRequest] = useState<string | null>(null);
  const [sendingTipRequest, setSendingTipRequest] = useState<string | null>(null);
  const [bulkNotifyingWeek, setBulkNotifyingWeek] = useState(false);
  const [weeklyReminderDialogOpen, setWeeklyReminderDialogOpen] = useState(false);
  const [weeklyReminderClients, setWeeklyReminderClients] = useState<BookingWithDetails[]>([]);
  const [sendingWeeklyReminders, setSendingWeeklyReminders] = useState(false);
  const [additionalChargesOpen, setAdditionalChargesOpen] = useState(false);
  const [additionalChargesBooking, setAdditionalChargesBooking] = useState<BookingWithDetails | null>(null);
  const [refundDialogBooking, setRefundDialogBooking] = useState<BookingWithDetails | null>(null);
  const [refundType, setRefundType] = useState<'full' | 'partial'>('full');
  const [refundAmount, setRefundAmount] = useState('');
  const [processingRefund, setProcessingRefund] = useState(false);
  const [depositDialogBooking, setDepositDialogBooking] = useState<BookingWithDetails | null>(null);
  const [depositAmount, setDepositAmount] = useState('');
  const [sendingDepositRequest, setSendingDepositRequest] = useState(false);
  const [assignCleanerBooking, setAssignCleanerBooking] = useState<BookingWithDetails | null>(null);
  const [assigningCleaner, setAssigningCleaner] = useState(false);
  const [assignTeamIds, setAssignTeamIds] = useState<Set<string>>(new Set());
  const [actionSheetBooking, setActionSheetBooking] = useState<BookingWithDetails | null>(null);
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({});
  const [bulkEditOpen, setBulkEditOpen] = useState(false);
  const [deleteConfirmBooking, setDeleteConfirmBooking] = useState<BookingWithDetails | null>(null);
  const [bulkDeleteConfirmOpen, setBulkDeleteConfirmOpen] = useState(false);
  const [bulkDeleteCount, setBulkDeleteCount] = useState(0);
  const [cancelBookingTarget, setCancelBookingTarget] = useState<BookingWithDetails | null>(null);

  const { data: bookings = [], isLoading, error } = useBookings();
  const { data: draftsFromDb = [] } = useDraftBookings();
  const { data: staffList = [] } = useStaff();
  const { data: servicesList = [] } = useServices();
  const queryClient = useQueryClient();

  const handlePullRefresh = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ['bookings'] });
  }, [queryClient]);

  const { refreshing, pullDistance, handlers: pullHandlers } = usePullToRefresh(handlePullRefresh);
  const updateBooking = useUpdateBooking();
  const deleteBooking = useDeleteBooking();
  const { isTestMode, maskName, maskEmail, maskAmount, maskAddress } = useTestMode();
  const { organization } = useOrganization();
  const { canShowPaymentFlows } = usePlatform();

  // Helper: is a booking fully done (completed + paid)?
  const isFullyDone = useCallback((b: BookingWithDetails) => {
    return b.status === 'completed' && b.payment_status === 'paid';
  }, []);

  // Sort bookings: today's active bookings pinned to top, then reverse chronological
  // On mobile: additionally pin uncompleted/unpaid bookings above fully-done ones
  const sortedBookings = useMemo(() => {
    // "Today" needs to be evaluated in the org's timezone so admins in other
    // timezones (or on a DST boundary day) see the same set of jobs pinned
    // to the top as their team in the field would.
    const todayInOrgTz = getDateInTimezone(new Date(), orgTz);
    const isTodayActive = (b: typeof bookings[0]) => {
      if (b.status === 'completed' || b.status === 'cancelled') return false;
      return getDateInTimezone(b.scheduled_at, orgTz) === todayInOrgTz;
    };

    return [...bookings].sort((a, b) => {
      // Pin today's active (scheduled/in-progress) bookings to the very top
      const aTodayActive = isTodayActive(a);
      const bTodayActive = isTodayActive(b);
      if (aTodayActive !== bTodayActive) return aTodayActive ? -1 : 1;
      if (aTodayActive && bTodayActive) {
        return new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime();
      }

      // Push completed/cancelled bookings to the bottom
      const aCompleted = a.status === 'completed' || a.status === 'cancelled';
      const bCompleted = b.status === 'completed' || b.status === 'cancelled';
      if (aCompleted !== bCompleted) return aCompleted ? 1 : -1;

      // Within non-completed: upcoming dates first (chronological)
      if (!aCompleted && !bCompleted) {
        return new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime();
      }

      // Within completed: most recent first
      return new Date(b.scheduled_at).getTime() - new Date(a.scheduled_at).getTime();
    });
  }, [bookings, orgTz]);

  // Draft bookings: true is_draft rows fetched separately (useBookings excludes them),
  // plus non-draft rows with pending status + pending payment (legacy "draft" behavior).
  const draftBookings = useMemo(() => {
    const pendingPending = sortedBookings.filter((b) =>
      b.status === 'pending' && b.payment_status === 'pending' && !(b as any).is_draft
    );
    return [...(draftsFromDb as BookingWithDetails[]), ...pendingPending];
  }, [sortedBookings, draftsFromDb]);

  const filteredBookings = sortedBookings.filter((booking) => {
    const customerName = booking.customer 
      ? `${booking.customer.first_name} ${booking.customer.last_name}`.toLowerCase()
      : '';
    const serviceName = booking.service?.name?.toLowerCase() || '';
    const bookingNum = booking.booking_number.toString();
    
    const matchesSearch =
      customerName.includes(searchTerm.toLowerCase()) ||
      serviceName.includes(searchTerm.toLowerCase()) ||
      bookingNum.includes(searchTerm);
    // Status filter - "pending" means bookings that haven't started yet (future bookings), "completed" means completed bookings
    let matchesStatus = true;
    if (statusFilter !== 'all') {
      if (statusFilter === 'pending') {
        // Pending = bookings scheduled in the future that haven't started yet
        const now = new Date();
        const scheduledDate = new Date(booking.scheduled_at);
        matchesStatus = scheduledDate > now && !['completed', 'cancelled', 'no_show'].includes(booking.status);
      } else if (statusFilter === 'completed') {
        matchesStatus = booking.status === 'completed';
      } else {
        matchesStatus = booking.status === statusFilter;
      }
    }
    
    // Date range filter
    let matchesDate = true;
    if (dateRange?.from) {
      // dateRange.from/to are picker tokens, but they are used here as an
      // INSTANT window against scheduled_at. Resolved in the admin's zone, a
      // 9pm booking fell outside a "today" filter set from a device further
      // east — the row simply was not there.
      const bookingDate = new Date(booking.scheduled_at);
      const start = orgStartOfDay(dateRange.from, orgTz);
      const end = orgEndOfDay(dateRange.to ?? dateRange.from, orgTz);
      matchesDate = isWithinInterval(bookingDate, { start, end });
    }

    // Tab filter
    const isDraft = (booking as any).is_draft === true || 
      (booking.status === 'pending' && booking.payment_status === 'pending');
    const matchesTab = activeTab === 'all' || (activeTab === 'drafts' && isDraft);
    
    return matchesSearch && matchesStatus && matchesDate && matchesTab;
  });

  // Stats. `confirmed` = booked but not yet done; `completed` = job finished.
  // Those two and `total` are COUNTS, not money — the completed tile used to
  // carry a DollarSign, which is what made it read as a revenue figure.
  //
  // All three are lifetime figures over every booking the org has ever had:
  // `bookings` is unfiltered, so they ignore the search, status and date
  // controls below them. They now say "all time" on the card rather than
  // implying they describe the current view.
  //
  // `owed` is the one money figure, and it is a genuine receivable: a job that
  // happened and has not been paid for. It replaces a "Pending Payment" count
  // of every booking ever carrying payment_status 'pending' — 64 rows for
  // TIDYWISE, of which 57 were future work nobody owed yet and 6 were
  // cancelled jobs that will never be paid. The real figure was one job at
  // $130. Requiring status 'completed' excludes future work and cancellations
  // in a single condition, so no separate cancelled filter is needed.
  const owedBookings = bookings.filter(
    b => b.status === 'completed' && b.payment_status === 'pending'
  );
  const stats = {
    total: bookings.length,
    owed: owedBookings.reduce((sum, b) => sum + Number(b.total_amount || 0), 0),
    owedCount: owedBookings.length,
    confirmed: bookings.filter(b => b.status === 'confirmed').length,
    completed: bookings.filter(b => b.status === 'completed').length,
  };

  const handleStatusChange = async (bookingId: string, newStatus: string) => {
    // Find the booking to get details for cancellation notification
    const booking = bookings?.find(b => b.id === bookingId);
    
    await updateBooking.mutateAsync({
      id: bookingId,
      status: newStatus as BookingWithDetails['status'],
    });

    // Trigger post-booking upsell when booking is confirmed
    if (newStatus === 'confirmed' && booking && organization?.id) {
      supabase.functions.invoke('post-booking-upsell', {
        body: { bookingId, organizationId: organization.id },
      }).then(({ error }) => {
        // Don't toast — upsell is best-effort & not admin-visible — but do
        // surface the error to the console so it shows up in observability
        // tools instead of vanishing.
        if (error) console.error('[post-booking-upsell] failed', error);
      }).catch((err) => {
        console.error('[post-booking-upsell] threw', err);
      });
    }

    // Send cancellation SMS notification if status changed to cancelled
    if (newStatus === 'cancelled' && booking && organization?.id) {

      supabase.functions.invoke('send-cancellation-sms-notification', {
        body: {
          customerName: booking.customer ? `${booking.customer.first_name} ${booking.customer.last_name}` : 'Customer',
          serviceName: booking.service?.name || 'Cleaning',
          scheduledAt: booking.scheduled_at,
      /*
        No formattedDate/formattedTime. All three of these edge functions
        (send-booking-reminder, send-cancellation-sms-notification,
        send-admin-sms-notification) already fetch business_settings.timezone
        and format scheduledAt with it, using these exact option shapes — the
        client strings were only ever an OVERRIDE of a correct server path with
        the admin's clock. Three components formatted independently and two of
        them got it wrong; the fix is to stop having a client opinion at all.
      */
          bookingNumber: booking.booking_number,
          organizationId: organization.id,
        }
      }).then(({ error }) => {
        // Admin actively cancelled — they should know if the customer
        // wasn't actually notified by SMS.
        if (error) {
          console.error('[cancellation-sms] edge function returned error', error);
          toast({
            title: "Cancellation SMS didn't send",
            description: "The booking was cancelled, but we couldn't send the customer an SMS. Reach out to them directly.",
            variant: "destructive",
          });
        }
      }).catch((err) => {
        console.error('[cancellation-sms] threw', err);
        toast({
          title: "Cancellation SMS didn't send",
          description: "The booking was cancelled, but we couldn't send the customer an SMS. Reach out to them directly.",
          variant: "destructive",
        });
      });
    }
  };

  const handleDelete = (booking: BookingWithDetails) => {
    setDeleteConfirmBooking(booking);
  };

  const handleConfirmCancel = async ({ reason, category }: { reason: string; category: CancellationCategory }) => {
    if (!cancelBookingTarget) return;
    await updateBooking.mutateAsync({
      id: cancelBookingTarget.id,
      status: 'cancelled' as any,
      cancellation_reason: reason,
      cancellation_category: category,
      cancelled_at: new Date().toISOString(),
    } as any);
    // Reuse handleStatusChange's SMS notify by simulating its effect (already updated above; trigger SMS):
    if (organization?.id) {
      const scheduledDate = new Date(cancelBookingTarget.scheduled_at);
      supabase.functions.invoke('send-cancellation-sms-notification', {
        body: {
          customerName: cancelBookingTarget.customer ? `${cancelBookingTarget.customer.first_name} ${cancelBookingTarget.customer.last_name}` : 'Customer',
          serviceName: cancelBookingTarget.service?.name || 'Cleaning',
          scheduledAt: cancelBookingTarget.scheduled_at,
          bookingNumber: cancelBookingTarget.booking_number,
          organizationId: organization.id,
        },
      }).catch(() => {});
    }
    toast({ title: 'Booking Cancelled', description: `Booking #${cancelBookingTarget.booking_number} marked as cancelled.` });
    setCancelBookingTarget(null);
  };

  const confirmDelete = async () => {
    if (!deleteConfirmBooking) return;
    await deleteBooking.mutateAsync(deleteConfirmBooking.id);
    setSelectedBookings(prev => {
      const next = new Set(prev);
      next.delete(deleteConfirmBooking.id);
      return next;
    });
    setDeleteConfirmBooking(null);
  };

  const handleBulkDelete = () => {
    if (selectedBookings.size === 0) return;
    setBulkDeleteCount(selectedBookings.size);
    setBulkDeleteConfirmOpen(true);
  };

  const confirmBulkDelete = async () => {
    const count = bulkDeleteCount;
    setBulkDeleting(true);
    try {
      for (const id of selectedBookings) {
        await deleteBooking.mutateAsync(id);
      }
      setSelectedBookings(new Set());
      setBulkDeleteConfirmOpen(false);
      toast({ title: "Deleted", description: `${count} bookings deleted successfully` });
    } catch (error) {
      toast({ title: "Error", description: "Failed to delete some bookings", variant: "destructive" });
    } finally {
      setBulkDeleting(false);
    }
  };

  const handleBulkAssign = async () => {
    if (selectedBookings.size === 0 || !selectedStaffId) return;
    
    setBulkAssigning(true);
    try {
      const count = selectedBookings.size;
      for (const id of selectedBookings) {
        await updateBooking.mutateAsync({
          id,
          staff_id: selectedStaffId,
        });
      }
      setSelectedBookings(new Set());
      setBulkAssignDialogOpen(false);
      setSelectedStaffId('');
      toast({ title: "Assigned", description: `${count} bookings assigned to cleaner successfully` });
    } catch (error) {
      toast({ title: "Error", description: "Failed to assign some bookings", variant: "destructive" });
    } finally {
      setBulkAssigning(false);
    }
  };

  const toggleSelectAll = () => {
    if (selectedBookings.size === filteredBookings.length) {
      setSelectedBookings(new Set());
    } else {
      setSelectedBookings(new Set(filteredBookings.map(b => b.id)));
    }
  };

  const toggleSelectBooking = (id: string) => {
    setSelectedBookings(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handlePlaceHold = async (booking: BookingWithDetails) => {
    if (!booking.customer?.email) {
      toast({ title: "Error", description: "No customer email found", variant: "destructive" });
      return;
    }

    if (!organization?.id) {
      toast({ title: "Error", description: "Organization context required", variant: "destructive" });
      return;
    }

    setPlacingHold(booking.id);

    try {
      const { data, error } = await supabase.functions.invoke('charge-customer-card', {
        body: {
          email: booking.customer.email,
          amount: booking.total_amount,
          description: `Hold for Booking #${booking.booking_number} - ${booking.service?.name || 'Service'}`,
          bookingId: booking.id,
          organizationId: organization.id,
        }
      });

      if (error) throw error;

      if (data.success) {
        toast({
          title: "Hold Placed",
          description: data.message
        });

        await updateBooking.mutateAsync({
          id: booking.id,
          payment_intent_id: data.paymentIntentId,
          payment_status: 'pending' as any,
        });
      } else {
        showChargeFailureToastLegacy({
          failureReason: extractFailureReason(data),
          declineCode: data?.decline_code || data?.declineCode,
          declined: !!data?.declined,
          customer: booking.customer,
          organizationId: organization.id,
          amount: booking.total_amount,
        });
      }
    } catch (error: any) {
      console.error('Failed to place hold:', error);
      toast({
        title: "Error",
        // Not error.message — supabase-js reports every non-2xx as "Edge
        // Function returned a non-2xx status code". The real reason (card
        // declined, no card on file, Stripe not connected) is in the body.
        description: await readEdgeFunctionError(error, "Failed to place hold"),
        variant: "destructive"
      });
    } finally {
      setPlacingHold(null);
    }
  };

  const handleProcessRefund = async (booking: BookingWithDetails) => {
    const paymentIntentId = (booking as any).payment_intent_id;

    if (!organization?.id) {
      toast({ title: "Error", description: "Organization context required", variant: "destructive" });
      return;
    }

    // Parse once, round to whole cents to avoid IEEE-754 surprises
    // (0.1 + 0.2 problem) propagating into Stripe API calls and the DB.
    // Doing this at the entry point means every downstream comparison /
    // subtraction stays consistent.
    const parsedRefundAmount = refundType === 'partial'
      ? Math.round(parseFloat(refundAmount) * 100) / 100
      : 0;

    if (refundType === 'partial' && (!refundAmount || !Number.isFinite(parsedRefundAmount) || parsedRefundAmount <= 0)) {
      toast({ title: "Error", description: "Please enter a valid refund amount", variant: "destructive" });
      return;
    }

    setProcessingRefund(true);

    try {
      // If no payment intent, handle as manual refund (just update status)
      if (!paymentIntentId) {
        const newStatus = refundType === 'full' ? 'refunded' : 'partial';
        const manualRefundAmount = refundType === 'full'
          ? (booking.total_amount || 0)
          : parsedRefundAmount;
        const nextTotalAmount = refundType === 'full'
          ? 0
          : Math.max(0, Math.round(((booking.total_amount || 0) - manualRefundAmount) * 100) / 100);

        await updateBooking.mutateAsync({
          id: booking.id,
          payment_status: newStatus as any,
          total_amount: nextTotalAmount,
        });
        toast({
          title: "Refund Recorded (Manual)",
          description: refundType === 'full'
            ? `Full refund of ${fmt(booking.total_amount)} recorded. No Stripe refund was processed. Refund the customer manually if needed.`
            : `Partial refund of ${fmt(parsedRefundAmount)} recorded. No Stripe refund was processed. Refund the customer manually if needed.`,
        });
        setRefundDialogBooking(null);
        setRefundType('full');
        setRefundAmount('');
        return;
      }

      const { data, error } = await supabase.functions.invoke('process-refund', {
        body: {
          paymentIntentId,
          organizationId: organization.id,
          refundType,
          amount: refundType === 'partial' ? parsedRefundAmount : undefined,
        }
      });

      if (error) throw error;

      if (data.success) {
        const refundedAmount = Math.round(Number(data.amount || 0) * 100) / 100;
        const nextTotalAmount = data.isFullRefund
          ? 0
          : Math.max(0, Math.round(((booking.total_amount || 0) - refundedAmount) * 100) / 100);

        toast({
          title: "Refund Processed",
          description: data.message,
        });

        await updateBooking.mutateAsync({
          id: booking.id,
          payment_status: (data.isFullRefund ? 'refunded' : 'partial') as any,
          total_amount: nextTotalAmount,
        });

        setRefundDialogBooking(null);
        setRefundType('full');
        setRefundAmount('');
      } else {
        toast({
          title: "Refund Failed",
          description: data.error,
          variant: "destructive"
        });
      }
    } catch (error: any) {
      console.error('Failed to process refund:', error);
      toast({
        title: "Error",
        description: error.message || "Failed to process refund",
        variant: "destructive"
      });
    } finally {
      setProcessingRefund(false);
    }
  };

  const handleCapturePayment = async (booking: BookingWithDetails) => {
    const paymentIntentId = (booking as any).payment_intent_id;
    
    if (!paymentIntentId) {
      toast({ title: "Error", description: "No payment hold found for this booking", variant: "destructive" });
      return;
    }

    if (!organization?.id) {
      toast({ title: "Error", description: "Organization context required", variant: "destructive" });
      return;
    }

    setCapturingPayment(booking.id);
    
    try {
      const { data, error } = await supabase.functions.invoke('capture-payment', {
        body: {
          paymentIntentId,
          amountToCapture: booking.total_amount,
          organizationId: organization.id,
        }
      });

      if (error) throw error;

      if (data.success) {
        toast({ 
          title: "Payment Captured", 
          description: data.message 
        });
        
        await updateBooking.mutateAsync({ 
          id: booking.id, 
          payment_status: 'paid' as any
        });
      } else {
        toast({ 
          title: "Capture Failed", 
          description: data.error, 
          variant: "destructive" 
        });
      }
    } catch (error: any) {
      console.error('Failed to capture payment:', error);
      toast({ 
        title: "Error", 
        description: await readEdgeFunctionError(error, "Failed to capture payment"), 
        variant: "destructive" 
      });
    } finally {
      setCapturingPayment(null);
    }
  };

  const handleCancelHold = async (booking: BookingWithDetails, attempt: number = 1) => {
    const paymentIntentId = (booking as any).payment_intent_id;
    const MAX_ATTEMPTS = 3;

    if (!paymentIntentId) {
      toast({
        title: "No hold to release",
        description: "This booking has no payment hold on file.",
        variant: "destructive",
      });
      return;
    }

    if (!organization?.id) {
      toast({
        title: "Organization context missing",
        description: "Please refresh the page and try again.",
        variant: "destructive",
      });
      return;
    }

    setCancelingHold(booking.id);

    // Show in-progress toast for clarity on slow networks
    toast({
      title: attempt > 1 ? `Retrying release (attempt ${attempt})…` : "Releasing hold…",
      description: "Contacting Stripe to release the authorized funds.",
    });

    try {
      const { data, error } = await supabase.functions.invoke('cancel-hold', {
        body: {
          paymentIntentId,
          organizationId: organization.id,
        }
      });

      // Network/transport-level failures (function not deployed, CORS, offline, 5xx without body)
      if (error) {
        const rawMsg = (error as any)?.message || String(error);
        const isFetchFailure =
          rawMsg.includes('Failed to fetch') ||
          rawMsg.includes('Failed to send a request') ||
          rawMsg.includes('NetworkError');

        // Edge function not deployed / unreachable
        if (isFetchFailure) {
          toast({
            title: "Edge function unreachable",
            description: "The cancel-hold function isn't responding. It may not be deployed or the network dropped.",
            variant: "destructive",
            action: attempt < MAX_ATTEMPTS ? (
              <ToastAction altText="Retry" onClick={() => handleCancelHold(booking, attempt + 1)}>
                Retry
              </ToastAction>
            ) : undefined,
          });
          return;
        }

        // Try to extract structured error from non-2xx responses
        const ctx = (error as any)?.context;
        let bodyMsg = '';
        let bodyStatus = '';
        try {
          if (ctx?.body) {
            const parsed = typeof ctx.body === 'string' ? JSON.parse(ctx.body) : ctx.body;
            bodyMsg = parsed.error || '';
            bodyStatus = parsed.status || '';
          }
        } catch { /* ignore parse errors */ }
        const combined = `${rawMsg} ${bodyMsg} ${bodyStatus}`.toLowerCase();

        if (combined.includes('canceled')) {
          toast({
            title: "Already released",
            description: "This hold was previously released. Syncing booking status…",
          });
          await updateBooking.mutateAsync({
            id: booking.id,
            payment_status: 'refunded' as any,
          });
          return;
        }

        if (combined.includes('succeeded')) {
          toast({
            title: "Payment already captured",
            description: "This charge already went through. Use Refund instead of Release Hold.",
            variant: "destructive",
          });
          return;
        }

        if (combined.includes('unauthorized') || combined.includes('forbidden')) {
          toast({
            title: "Permission denied",
            description: bodyMsg || "You don't have permission to release this hold.",
            variant: "destructive",
          });
          return;
        }

        // Generic non-2xx — show details and offer retry
        toast({
          title: "Release failed",
          description: bodyMsg || rawMsg || "An unknown error occurred while releasing the hold.",
          variant: "destructive",
          action: attempt < MAX_ATTEMPTS ? (
            <ToastAction altText="Retry" onClick={() => handleCancelHold(booking, attempt + 1)}>
              Retry
            </ToastAction>
          ) : undefined,
        });
        return;
      }

      // Data-level error (200 response with error field — defensive)
      if (data?.error) {
        const lower = String(data.error).toLowerCase();
        if (lower.includes('succeeded')) {
          toast({
            title: "Payment already captured",
            description: "This charge already went through. Use Refund instead of Release Hold.",
            variant: "destructive",
          });
          return;
        }
        if (lower.includes('canceled') || data.status === 'canceled') {
          toast({
            title: "Already released",
            description: "This hold was previously released. Syncing booking status…",
          });
          await updateBooking.mutateAsync({
            id: booking.id,
            payment_status: 'refunded' as any,
          });
          return;
        }
        toast({
          title: "Release failed",
          description: data.error,
          variant: "destructive",
          action: attempt < MAX_ATTEMPTS ? (
            <ToastAction altText="Retry" onClick={() => handleCancelHold(booking, attempt + 1)}>
              Retry
            </ToastAction>
          ) : undefined,
        });
        return;
      }

      if (data?.success) {
        await updateBooking.mutateAsync({
          id: booking.id,
          payment_status: 'refunded' as any,
        });

        if (data.alreadyCanceled) {
          toast({
            title: "Already released",
            description: data.message || "This hold was previously released. Booking status synced.",
          });
        } else {
          toast({
            title: "✓ Hold released",
            description: data.message || `${fmt((data.amountReleased ?? 0))} returned to the customer.`,
          });
        }
        return;
      }

      // Fallback — unexpected shape
      toast({
        title: "Unexpected response",
        description: "The release request completed but returned an unexpected response. Please verify in Stripe.",
        variant: "destructive",
      });
    } catch (err: any) {
      console.error('Failed to cancel hold:', err);
      toast({
        title: "Release failed",
        description: err?.message || "An unexpected error occurred.",
        variant: "destructive",
        action: attempt < MAX_ATTEMPTS ? (
          <ToastAction altText="Retry" onClick={() => handleCancelHold(booking, attempt + 1)}>
            Retry
          </ToastAction>
        ) : undefined,
      });
    } finally {
      setCancelingHold(null);
    }
  };

  const handleChargeCard = async (booking: BookingWithDetails) => {
    // UI-level single-submit guard (prevents double-click / double-tap charges)
    if (chargingCard === booking.id) return;

    if (booking.payment_status === 'paid') {
      toast({ title: "Already paid", description: "This booking is already marked as paid." });
      return;
    }

    if (!booking.customer?.email) {
      toast({ title: "Error", description: "No customer email found", variant: "destructive" });
      return;
    }

    setChargingCard(booking.id);
    
    try {
      const { data, error } = await supabase.functions.invoke('charge-card-directly', {
        body: {
          email: booking.customer.email,
          amount: booking.total_amount,
          description: `Booking #${booking.booking_number} - ${booking.service?.name || 'Service'}`,
          organizationId: organization?.id,
          bookingId: booking.id,
          // Let the edge function generate the idempotency key with a time bucket
        }
      });

      if (error) throw error;

      if (data.success) {
        // charge-card-directly already wrote payment_status='paid' and
        // payment_intent_id to the booking via service role inside the same
        // request as the Stripe capture. Calling updateBooking() here again
        // would race: a transient client-side failure could leave the user
        // staring at "Payment Successful" while the cache still reflects the
        // pre-charge state, then a manual retry would attempt a second charge.
        // Just refetch from the source of truth.
        toast({
          title: "Payment Successful",
          description: data.message,
        });
        queryClient.invalidateQueries({ queryKey: ['bookings'] });
      } else {
        showChargeFailureToastLegacy({
          failureReason: extractFailureReason(data),
          declineCode: data?.decline_code || data?.declineCode,
          declined: !!data?.declined,
          customer: booking.customer,
          organizationId: organization?.id ?? null,
          amount: booking.total_amount,
        });
      }
    } catch (error: any) {
      console.error('Failed to charge card:', error);

      // This previously read error.context.body as a string, which is the OLD
      // supabase-js shape. FunctionsClient now throws
      // `new FunctionsHttpError(response)`, so context IS the Response and
      // .body is a ReadableStream — the string check could never pass, and
      // every declined card fell through to error.message, i.e. the merchant
      // was told "Edge Function returned a non-2xx status code" instead of why
      // the card was declined. readEdgeFunctionError handles both shapes.
      const errorMessage = await readEdgeFunctionError(error, "Failed to charge card");

      showChargeFailureToastLegacy({
        failureReason: errorMessage,
        customer: booking.customer,
        organizationId: organization?.id ?? null,
        amount: booking.total_amount,
      });
    } finally {
      setChargingCard(null);
    }
  };

  const handleDuplicate = (booking: BookingWithDetails) => {
    setEditingBooking({
      ...booking,
      id: '',
      booking_number: 0,
      payment_intent_id: null,
      payment_status: 'pending',
    });
    setAddDialogOpen(true);
  };

  const handleSendReminder = async (booking: BookingWithDetails) => {
    if (!booking.customer?.phone) {
      toast({ title: "Error", description: "No customer phone number found", variant: "destructive" });
      return;
    }

    setSendingReminder(booking.id);
    
    try {
      // IMPORTANT: do NOT pre-format date/time here — toLocale* uses the
      // admin's *device* timezone, which can flip AM↔PM if the admin is in
      // a different zone than the business. Let the edge function format
      // using the organization's timezone (single source of truth).
      const response = await supabase.functions.invoke('send-booking-reminder', {
        body: {
          bookingId: booking.id,
          customerPhone: booking.customer.phone,
          customerName: `${booking.customer.first_name} ${booking.customer.last_name}`,
          serviceName: booking.service?.name || 'Cleaning Service',
          scheduledAt: booking.scheduled_at,
          address: booking.address || '',
          totalAmount: booking.total_amount,
          organizationId: organization?.id,
        }
      });

      // Handle SMS-specific errors
      if ((await handleSmsError(response))) {
        return;
      }
      toast({ title: "Reminder Sent", description: `SMS sent to ${booking.customer.phone}` });
    } catch (error: any) {
      console.error('Failed to send reminder:', error);
      toast({ title: "Error", description: error.message || "Failed to send reminder", variant: "destructive" });
    } finally {
      setSendingReminder(null);
    }
  };

  const handleSendCleanerNotification = async (booking: BookingWithDetails) => {
    setSendingCleanerNotification(booking.id);
    
    try {
      const scheduledDate = new Date(booking.scheduled_at);
      const fullAddress = formatFullAddress(booking as any);

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
        toast({ title: "Error", description: "No cleaners assigned or none have phone numbers", variant: "destructive" });
        return;
      }

      let successCount = 0;
      let failCount = 0;

      for (const staffMember of staffToNotify) {
        try {
          const response = await supabase.functions.invoke('send-cleaner-notification', {
            body: {
              cleanerName: staffMember.name,
              cleanerPhone: staffMember.phone,
              customerName: booking.customer ? `${booking.customer.first_name} ${booking.customer.last_name}` : 'Customer',
              customerPhone: booking.customer?.phone || 'N/A',
              serviceName: booking.service?.name || 'Cleaning Service',
              appointmentDate: format(scheduledDate, 'EEEE, MMMM d, yyyy'),
              appointmentTime: format(scheduledDate, 'h:mm a'),
              scheduledAt: booking.scheduled_at,
              address: fullAddress || 'Address not provided',
              bookingNumber: booking.booking_number,
              organizationId: organization?.id,
            }
          });

          // Handle SMS-specific errors
          if ((await handleSmsError(response))) {
            failCount++;
            continue;
          }
          if (response.data && !response.data.success) throw new Error(response.data.error || 'SMS delivery failed');
          successCount++;
        } catch (error) {
          console.error(`Failed to notify ${staffMember.name}:`, error);
          failCount++;
        }
      }

      if (successCount > 0) {
        const message = staffToNotify.length > 1 
          ? `SMS sent to ${successCount} team member(s)${failCount > 0 ? `, ${failCount} failed` : ''}`
          : `SMS sent to ${staffToNotify[0].name}`;
        toast({ title: "Notification Sent", description: message });
      } else {
        toast({ title: "SMS Not Sent", description: "All notifications failed", variant: "destructive" });
      }
    } catch (error: any) {
      console.error('Failed to send cleaner notification:', error);
      toast({ title: "Error", description: error.message || "Failed to send cleaner notification", variant: "destructive" });
    } finally {
      setSendingCleanerNotification(null);
    }
  };

  // Collect every cleaner on a booking: the primary (booking.staff) plus
  // teammates from booking_team_assignments. Look up phones from staffList
  // since team assignments don't carry them.
  const getBookingCleaners = (booking: BookingWithDetails): { name: string; phone: string }[] => {
    const seen = new Set<string>();
    const result: { name: string; phone: string }[] = [];

    // Primary cleaner
    if (booking.staff?.phone) {
      seen.add(booking.staff.id);
      result.push({ name: booking.staff.name, phone: booking.staff.phone });
    }

    // Team assignments
    for (const ta of booking.booking_team_assignments ?? []) {
      if (seen.has(ta.staff_id)) continue;
      seen.add(ta.staff_id);
      const s = staffList.find(st => st.id === ta.staff_id);
      if (s?.phone) {
        result.push({ name: s.name, phone: s.phone });
      }
    }

    return result;
  };

  const handleBulkNotifyCleaners = async () => {
    if (selectedBookings.size === 0) return;

    const selectedBookingsList = filteredBookings.filter(b => selectedBookings.has(b.id));
    const bookingsWithCleaners = selectedBookingsList.filter(b => getBookingCleaners(b).length > 0);

    if (bookingsWithCleaners.length === 0) {
      toast({ title: "No Cleaners to Notify", description: "None of the selected bookings have assigned cleaners with phone numbers.", variant: "destructive" });
      return;
    }

    setBulkNotifyingCleaners(true);
    let successCount = 0;
    let failCount = 0;

    try {
      for (const booking of bookingsWithCleaners) {
        const cleaners = getBookingCleaners(booking);
        for (const cleaner of cleaners) {
          try {
            const scheduledDate = new Date(booking.scheduled_at);
            const fullAddress = formatFullAddress(booking as any);

            const { data, error } = await supabase.functions.invoke('send-cleaner-notification', {
              body: {
                cleanerName: cleaner.name,
                cleanerPhone: cleaner.phone,
                customerName: booking.customer ? `${booking.customer.first_name} ${booking.customer.last_name}` : 'Customer',
                customerPhone: booking.customer?.phone || 'N/A',
                serviceName: booking.service?.name || 'Cleaning Service',
                appointmentDate: format(scheduledDate, 'EEEE, MMMM d, yyyy'),
                appointmentTime: format(scheduledDate, 'h:mm a'),
                address: fullAddress || 'Address not provided',
                bookingNumber: booking.booking_number,
                organizationId: organization?.id,
              }
            });

            if (error) throw error;
            if (!data?.success) throw new Error(data?.error || 'SMS delivery failed');
            successCount++;
          } catch (error) {
            console.error(`Failed to notify cleaner ${cleaner.name} for booking #${booking.booking_number}:`, error);
            failCount++;
          }
        }
      }

      if (successCount > 0) {
        toast({
          title: "Notifications Sent",
          description: `Successfully notified ${successCount} cleaner(s) via SMS${failCount > 0 ? `. ${failCount} failed.` : '.'}`
        });
      } else {
        toast({ title: "Error", description: "Failed to send notifications", variant: "destructive" });
      }
    } finally {
      setBulkNotifyingCleaners(false);
    }
  };

  // Open the cleaner picker dialog for an open job
  const handleOpenCleanerPicker = (booking: BookingWithDetails) => {
    if (booking.staff) {
      toast({ title: "Already Assigned", description: "This job is already assigned to a cleaner.", variant: "destructive" });
      return;
    }
    if (!organization?.id) {
      toast({ title: "Error", description: "Organization context required", variant: "destructive" });
      return;
    }
    // Pre-select all active staff
    const allActiveIds = new Set(staffList.filter(s => s.is_active).map(s => s.id));
    setSelectedCleanerIds(allActiveIds);
    setCleanerPickerBooking(booking);
    setCleanerPickerOpen(true);
  };

  // Notify selected cleaners about an open/unassigned job
  const handleNotifySelectedCleaners = async () => {
    const booking = cleanerPickerBooking;
    if (!booking || !organization?.id || selectedCleanerIds.size === 0) return;

    setCleanerPickerOpen(false);
    setNotifyingOpenJob(booking.id);

    try {
      const scheduledDate = new Date(booking.scheduled_at);
      const fullAddress = formatFullAddress(booking as any);

      const { error } = await supabase.functions.invoke('notify-cleaners-open-job', {
        body: {
          jobDetails: {
            booking_id: booking.id,
            booking_number: booking.booking_number,
            service_name: booking.service?.name || 'Cleaning Service',
            scheduled_date: format(scheduledDate, 'MMMM d, yyyy'),
            scheduled_time: format(scheduledDate, 'h:mm a'),
            address: fullAddress || 'Address not provided',
            square_footage: booking.square_footage || '',
            duration: booking.duration,
            total_amount: booking.total_amount,
          },
          organizationId: organization.id,
          staffIds: Array.from(selectedCleanerIds),
        }
      });

      if (error) throw error;

      toast({ 
        title: "Cleaners Notified", 
        description: `Sent notification to ${selectedCleanerIds.size} cleaner(s) about open job #${booking.booking_number}` 
      });
    } catch (error: any) {
      console.error('Failed to notify cleaners:', error);
      toast({ title: "Error", description: error.message || "Failed to notify cleaners", variant: "destructive" });
    } finally {
      setNotifyingOpenJob(null);
      setCleanerPickerBooking(null);
    }
  };

  const handleSendTipRequest = async (booking: BookingWithDetails) => {
    if (!booking.customer?.phone) {
      toast({ title: "Error", description: "Customer has no phone number", variant: "destructive" });
      return;
    }
    if (!organization?.id) {
      toast({ title: "Error", description: "Organization context required", variant: "destructive" });
      return;
    }

    setSendingTipRequest(booking.id);
    try {
      const { data, error } = await supabase.functions.invoke('send-tip-request', {
        body: {
          bookingId: booking.id,
          organizationId: organization.id,
        },
      });

      if (error) throw error;
      if (data?.success) {
        toast({ title: "Tip Link Sent", description: `Tip request SMS sent to ${booking.customer.first_name}` });
      } else {
        toast({ title: "Error", description: data?.error || "Failed to send tip request", variant: "destructive" });
      }
    } catch (error: any) {
      console.error('Failed to send tip request:', error);
      toast({ title: "Error", description: error.message || "Failed to send tip request", variant: "destructive" });
    } finally {
      setSendingTipRequest(null);
    }
  };

  const handleSendDepositRequest = async () => {
    if (!depositDialogBooking || !depositAmount || !organization?.id) return;
    const amount = parseFloat(depositAmount);
    if (isNaN(amount) || amount <= 0) {
      toast({ title: "Error", description: "Please enter a valid deposit amount", variant: "destructive" });
      return;
    }
    if (!depositDialogBooking.customer?.phone) {
      toast({ title: "Error", description: "Customer has no phone number", variant: "destructive" });
      return;
    }

    setSendingDepositRequest(true);
    try {
      const { data, error } = await supabase.functions.invoke('send-deposit-request', {
        body: {
          bookingId: depositDialogBooking.id,
          organizationId: organization.id,
          amount,
        },
      });

      if (error) throw error;
      if (data?.success) {
        toast({ title: "Deposit Link Sent", description: `Deposit request of ${fmt(amount)} sent to ${depositDialogBooking.customer.first_name}` });
        setDepositDialogBooking(null);
        setDepositAmount('');
      } else {
        toast({ title: "Error", description: data?.error || "Failed to send deposit request", variant: "destructive" });
      }
    } catch (error: any) {
      console.error('Failed to send deposit request:', error);
      toast({ title: "Error", description: error.message || "Failed to send deposit request", variant: "destructive" });
    } finally {
      setSendingDepositRequest(false);
    }
  };

  const handleBulkNotifyWeekCleaners = async () => {
    const now = new Date();
    const weekEnd = addDays(now, 7);

    const upcomingWeekBookings = sortedBookings.filter(b => {
      const scheduledDate = new Date(b.scheduled_at);
      return scheduledDate >= now &&
             scheduledDate <= weekEnd &&
             getBookingCleaners(b).length > 0 &&
             !['cancelled', 'completed'].includes(b.status);
    });

    if (upcomingWeekBookings.length === 0) {
      toast({ title: "No Bookings", description: "No upcoming bookings with assigned cleaners found for this week.", variant: "destructive" });
      return;
    }

    setBulkNotifyingWeek(true);
    let successCount = 0;
    let failCount = 0;

    try {
      for (const booking of upcomingWeekBookings) {
        const cleaners = getBookingCleaners(booking);
        for (const cleaner of cleaners) {
          try {
            const scheduledDate = new Date(booking.scheduled_at);
            const fullAddress = formatFullAddress(booking as any);

            const { data, error } = await supabase.functions.invoke('send-cleaner-notification', {
              body: {
                cleanerName: cleaner.name,
                cleanerPhone: cleaner.phone,
                customerName: booking.customer ? `${booking.customer.first_name} ${booking.customer.last_name}` : 'Customer',
                customerPhone: booking.customer?.phone || 'N/A',
                serviceName: booking.service?.name || 'Cleaning Service',
                appointmentDate: format(scheduledDate, 'EEEE, MMMM d, yyyy'),
                appointmentTime: format(scheduledDate, 'h:mm a'),
                address: fullAddress || 'Address not provided',
                bookingNumber: booking.booking_number,
                organizationId: organization?.id,
              }
            });

            if (error) throw error;
            if (!data?.success) throw new Error(data?.error || 'SMS delivery failed');
            successCount++;
          } catch (error) {
            console.error(`Failed to notify cleaner ${cleaner.name} for booking #${booking.booking_number}:`, error);
            failCount++;
          }
        }
      }

      if (successCount > 0) {
        toast({
          title: "Week's Notifications Sent",
          description: `Successfully notified ${successCount} cleaner(s) for upcoming bookings${failCount > 0 ? `. ${failCount} failed.` : '.'}`
        });
      } else {
        toast({ title: "Error", description: "Failed to send notifications", variant: "destructive" });
      }
    } finally {
      setBulkNotifyingWeek(false);
    }
  };

  // Prepare weekly client reminders
  const handlePrepareWeeklyReminders = () => {
    const now = new Date();
    const weekEnd = addDays(now, 7);
    
    // Get all upcoming bookings for the next 7 days with clients
    const upcomingWeekBookings = sortedBookings.filter(b => {
      const scheduledDate = new Date(b.scheduled_at);
      const customer = b.customer;
      // Filter for clients with phone numbers
      const isEligible = customer && customer.phone;
      return scheduledDate >= now && 
             scheduledDate <= weekEnd && 
             isEligible &&
             !['cancelled', 'completed'].includes(b.status);
    });

    if (upcomingWeekBookings.length === 0) {
      toast({ title: "No Clients to Notify", description: "No upcoming bookings with eligible clients found for this week.", variant: "destructive" });
      return;
    }

    setWeeklyReminderClients(upcomingWeekBookings);
    setWeeklyReminderDialogOpen(true);
  };

  // Send weekly client reminders
  const handleSendWeeklyReminders = async () => {
    if (weeklyReminderClients.length === 0) return;
    
    setSendingWeeklyReminders(true);
    let successCount = 0;
    let failCount = 0;

    try {
      for (const booking of weeklyReminderClients) {
        try {
          const scheduledDate = new Date(booking.scheduled_at);
          const customerName = booking.customer ? `${booking.customer.first_name}` : 'there';
          // scheduled_at is an INSTANT, and the whole composed message goes to
          // send-openphone-sms — the server only relays text, so there is no
          // fallback to save this one. The lint rule missed it because
          // format(x, 'EEEE, MMMM d') is a display pattern, not a date key.
          const formattedDate = formatInOrgTz(scheduledDate, orgTz, { weekday: 'long', month: 'long', day: 'numeric' });
          const formattedTime = formatInOrgTz(scheduledDate, orgTz, { hour: 'numeric', minute: '2-digit', hour12: true });
          
          // AI-style friendly reminder message
          const message = `Hey ${customerName}! 👋 Quick reminder: Your ${booking.service?.name || 'cleaning'} is scheduled for ${formattedDate} at ${formattedTime}.\n\n` +
            `Any special entry instructions? (Key under mat, gate code, etc.) Just reply to let us know!\n\n` +
            `Looking forward to making your space shine! ✨`;

          const response = await supabase.functions.invoke('send-openphone-sms', {
            body: {
              to: booking.customer!.phone,
              message,
              organizationId: organization?.id,
            }
          });

          // Handle SMS-specific errors
          if ((await handleSmsError(response))) {
            failCount++;
            continue;
          }
          
          // Update booking with reminder sent tag
          await supabase.from('bookings').update({
            notes: (booking.notes ? booking.notes + '\n' : '') + `[Reminder Sent: ${format(new Date(), 'MMM d, h:mm a')}]`
          }).eq('id', booking.id);
          
          successCount++;
        } catch (error) {
          console.error(`Failed to send reminder for booking #${booking.booking_number}:`, error);
          failCount++;
        }
      }

      if (successCount > 0) {
        toast({ 
          title: "Reminders Sent!", 
          description: `Successfully sent ${successCount} reminder(s)${failCount > 0 ? `. ${failCount} failed.` : '.'}`
        });
      } else {
        toast({ title: "Error", description: "Failed to send reminders", variant: "destructive" });
      }
    } finally {
      setSendingWeeklyReminders(false);
      setWeeklyReminderDialogOpen(false);
    }
  };

  const getExportRows = () => {
    const headers = ['Booking #', 'Customer', 'Service', 'Date', 'Time', 'Staff', 'Status', 'Payment', 'Amount'];
    const rows = filteredBookings.map(b => [
      String(b.booking_number),
      b.customer ? `${b.customer.first_name} ${b.customer.last_name}` : 'Unknown',
      b.service?.name || (b.total_amount === 0 ? 'Re-clean' : 'Service'),
      formatInTimezone(b.scheduled_at, orgTz, { year: 'numeric', month: '2-digit', day: '2-digit' }).replace(/(\d+)\/(\d+)\/(\d+)/, '$3-$1-$2'),
      formatInTimezone(b.scheduled_at, orgTz, { hour: 'numeric', minute: '2-digit', hour12: true }),
      getBookingCleaners(b).map(c => c.name).join(', ') || 'Unassigned',
      statusLabels[b.status] || b.status,
      getPaymentStatusInfo(b).label,
      `$${b.total_amount}`
    ]);
    return { headers, rows };
  };

  const handleExport = async (type: 'csv' | 'json' | 'xlsx' | 'pdf' | 'print') => {
    setExporting(true);
    try {
      const { headers, rows } = getExportRows();
      const filename = `bookings-${orgDateKey(new Date(), orgTz)}`;

      if (type === 'csv') {
        // Customer names and addresses carry commas and quotes. Wrapping every
        // cell without doubling inner quotes broke on the quotes instead.
        const csvContent = matrixToCsv([headers, ...rows]);
        const { exportFile } = await import('@/lib/exportFile');
        await exportFile(`${filename}.csv`, csvContent, 'text/csv');
      } else if (type === 'json') {
        const jsonContent = JSON.stringify(filteredBookings, null, 2);
        const { exportFile } = await import('@/lib/exportFile');
        await exportFile(`${filename}.json`, jsonContent, 'application/json');
      } else if (type === 'xlsx') {
        // xlsx (SheetJS) is write-only here. The outstanding CVEs
        // (GHSA-4r6h-8v6p-xvw6 prototype pollution, GHSA-5pgg-2g8v-p4x9
        // ReDoS) only trigger on XLSX.read() of attacker-controlled input.
        // We only call writeFile() with server-constructed data, so the
        // audit warnings do not apply to this usage. See PR discussion.
        const XLSX = await import('xlsx');
        const wsData = [headers, ...rows];
        const ws = XLSX.utils.aoa_to_sheet(wsData);
        ws['!cols'] = headers.map(() => ({ wch: 18 }));
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Bookings');
        const xlsxBuffer = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
        const xlsxBlob = new Blob([xlsxBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        const { exportFile } = await import('@/lib/exportFile');
        await exportFile(`${filename}.xlsx`, xlsxBlob, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      } else if (type === 'pdf') {
        const { default: jsPDF } = await import('jspdf');
        const autoTable = (await import('jspdf-autotable')).default;
        const doc = new jsPDF({ orientation: 'landscape' });
        doc.setFontSize(18);
        doc.setTextColor(40, 40, 40);
        doc.text('TidyWise: Bookings Report', 14, 18);
        doc.setFontSize(10);
        doc.setTextColor(120, 120, 120);
        doc.text(`Generated ${format(new Date(), 'MMMM d, yyyy h:mm a')}  •  ${filteredBookings.length} bookings`, 14, 26);
        autoTable(doc, {
          head: [headers],
          body: rows,
          startY: 32,
          theme: 'grid',
          headStyles: { fillColor: [37, 99, 235], fontSize: 9 },
          bodyStyles: { fontSize: 8 },
          alternateRowStyles: { fillColor: [245, 247, 250] },
          margin: { left: 14, right: 14 },
        });
        const pdfBlob = doc.output('blob');
        const { exportFile } = await import('@/lib/exportFile');
        await exportFile(`${filename}.pdf`, pdfBlob, 'application/pdf');
      } else if (type === 'print') {
        const printWin = window.open('', '_blank');
        if (!printWin) { toast({ title: "Error", description: "Popup blocked. Please allow popups.", variant: "destructive" }); return; }
        const escHtml = (s: unknown) => String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
        const tableRows = rows.map(r => `<tr>${r.map(c => `<td style="padding:6px 10px;border:1px solid #ddd;font-size:13px">${escHtml(c)}</td>`).join('')}</tr>`).join('');
        printWin.document.write(`<!DOCTYPE html><html><head><title>Bookings</title><style>body{font-family:Arial,sans-serif;margin:24px}table{border-collapse:collapse;width:100%}th{background:#2563eb;color:#fff;padding:8px 10px;font-size:13px;text-align:left}h1{font-size:20px;margin-bottom:4px}p{color:#888;font-size:13px;margin-bottom:16px}@media print{body{margin:0}}</style></head><body><h1>TidyWise: Bookings Report</h1><p>Generated ${format(new Date(), 'MMMM d, yyyy h:mm a')} • ${filteredBookings.length} bookings</p><table><thead><tr>${headers.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${tableRows}</tbody></table></body></html>`);
        printWin.document.close();
        printWin.focus();
        printWin.print();
      }
      if (type !== 'print') toast({ title: "Export completed", description: `Exported ${filteredBookings.length} bookings` });
    } catch (error) {
      toast({ title: "Error", description: "Failed to export", variant: "destructive" });
    } finally {
      setExporting(false);
    }
  };

  const handleSendReviewRequest = async (booking: BookingWithDetails) => {
    if (!booking.customer?.phone) {
      toast({ title: "Error", description: "No customer phone number found", variant: "destructive" });
      return;
    }

    if (booking.status !== 'completed') {
      toast({ title: "Cannot Send Review", description: "Review requests can only be sent for completed bookings", variant: "destructive" });
      return;
    }

    if (!organization?.id) {
      toast({ title: "Error", description: "Organization not found", variant: "destructive" });
      return;
    }

    setSendingReviewRequest(booking.id);
    
    try {
      const response = await supabase.functions.invoke('send-review-request-sms', {
        body: {
          bookingId: booking.id,
          customerId: (booking as any).customer_id || booking.customer?.id,
          customerPhone: booking.customer.phone,
          customerName: `${booking.customer.first_name} ${booking.customer.last_name}`,
          serviceName: booking.service?.name || 'Cleaning Service',
          organizationId: organization.id,
        }
      });

      // Handle SMS-specific errors
      if ((await handleSmsError(response))) {
        return;
      }
      toast({ title: "Review Request Sent", description: `SMS sent to ${booking.customer.phone}` });
    } catch (error: any) {
      console.error('Failed to send review request:', error);
      toast({ title: "Error", description: error.message || "Failed to send review request", variant: "destructive" });
    } finally {
      setSendingReviewRequest(null);
    }
  };

  // NOTE: there used to be an early `if (error) return (...)` here showing
  // a bare "Failed to load bookings" message with no way to recover. It
  // unconditionally pre-empted the fuller error state below (heading +
  // Retry button, wired to queryClient.invalidateQueries), making that
  // Retry button permanently unreachable dead code. Removed so the real
  // error UI (rendered inside the tab content below) actually gets a
  // chance to run, and so the rest of the page (tabs, stats) doesn't go
  // fully blank on a fetch error.

  return (
    <AdminLayout
      title="Bookings"
      subtitle="Manage your appointments"
    >
      <div className="portal-v2">
      <AttentionStrip href="/dashboard/bookings" onReasonClick={() => setActiveTab('all')} />
      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
        <TabsList className="bg-secondary/50">
          <TabsTrigger value="all" className="gap-2">
            <Calendar className="w-4 h-4" />
            All Bookings
          </TabsTrigger>
          <TabsTrigger value="drafts" className="gap-2">
            <Clock className="w-4 h-4" />
            Drafts
            {draftBookings.length > 0 && (
              <Badge variant="secondary" className="ml-1 h-5 px-1.5 text-xs">
                {draftBookings.length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="quotes" className="gap-2">
            <Star className="w-4 h-4" />
            Quotes
          </TabsTrigger>
          <TabsTrigger value="cleaner-wages" className="gap-2">
            <Settings2 className="w-4 h-4" />
            Cleaner Wages
          </TabsTrigger>
        </TabsList>

        <TabsContent value="all" className="space-y-6">
        {/* Stats Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 animate-fade-in">
            <div className="group relative bg-gradient-to-br from-card to-secondary/30 rounded-2xl p-5 border border-border/50 shadow-sm hover:shadow-lg transition-all duration-300 overflow-hidden">
              <div className="absolute inset-0 bg-gradient-to-br from-primary/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
              <div className="relative">
                <div className="flex items-center gap-3 mb-2">
                  <div className="p-2 bg-primary/10 rounded-xl">
                    <Calendar className="w-5 h-5 text-primary" />
                  </div>
                  <span className="text-sm font-medium text-muted-foreground">Total</span>
                </div>
                <p className="text-3xl font-bold text-foreground">{stats.total}</p>
                <p className="text-xs text-muted-foreground mt-1">all time</p>
              </div>
            </div>
            
            <div className="group relative bg-gradient-to-br from-card to-warning/10 rounded-2xl p-5 border border-border/50 shadow-sm hover:shadow-lg transition-all duration-300 overflow-hidden">
              <div className="absolute inset-0 bg-gradient-to-br from-warning/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
              <div className="relative">
                <div className="flex items-center gap-3 mb-2">
                  <div className="p-2 bg-warning/10 rounded-xl">
                    <Clock className="w-5 h-5 text-warning" />
                  </div>
                  <span className="text-sm font-medium text-muted-foreground">Owed to you</span>
                </div>
                <p className="text-3xl font-bold text-foreground">{fmt(stats.owed)}</p>
                <p className="text-xs text-muted-foreground mt-1">
                  {stats.owedCount === 1 ? '1 completed job' : `${stats.owedCount} completed jobs`}
                </p>
              </div>
            </div>
            
            <div className="group relative bg-gradient-to-br from-card to-info/10 rounded-2xl p-5 border border-border/50 shadow-sm hover:shadow-lg transition-all duration-300 overflow-hidden">
              <div className="absolute inset-0 bg-gradient-to-br from-info/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
              <div className="relative">
                <div className="flex items-center gap-3 mb-2">
                  <div className="p-2 bg-info/10 rounded-xl">
                    <User className="w-5 h-5 text-info" />
                  </div>
                  <span className="text-sm font-medium text-muted-foreground">Scheduled</span>
                </div>
                <p className="text-3xl font-bold text-foreground">{stats.confirmed}</p>
                <p className="text-xs text-muted-foreground mt-1">all time</p>
              </div>
            </div>
            
            <div className="group relative bg-gradient-to-br from-card to-success/10 rounded-2xl p-5 border border-border/50 shadow-sm hover:shadow-lg transition-all duration-300 overflow-hidden">
              <div className="absolute inset-0 bg-gradient-to-br from-success/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
              <div className="relative">
                <div className="flex items-center gap-3 mb-2">
                  <div className="p-2 bg-success/10 rounded-xl">
                    <CheckCircle className="w-5 h-5 text-success" />
                  </div>
                  <span className="text-sm font-medium text-muted-foreground">Completed</span>
                </div>
                <p className="text-3xl font-bold text-foreground">{stats.completed}</p>
                <p className="text-xs text-muted-foreground mt-1">all time</p>
              </div>
            </div>
          </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-2 md:gap-4 mb-4 md:mb-6 animate-fade-in" style={{ animationDelay: '0.1s' }}>
        <div className="relative flex-1">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search by name, service, or booking #..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-11 h-11 bg-card border-border/50 rounded-xl focus:ring-2 focus:ring-primary/20 transition-all"
          />
        </div>
        <div className="flex gap-3 flex-wrap">
          {/* Date Range Filter */}
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" className="h-11 gap-2 rounded-xl border-border/50 hover:bg-secondary/50">
                <CalendarRange className="w-4 h-4" />
                {dateRange?.from ? (
                  dateRange.to ? (
                    <span className="text-sm">
                      {format(dateRange.from, 'MMM d')} - {format(dateRange.to, 'MMM d')}
                    </span>
                  ) : (
                    <span className="text-sm">{format(dateRange.from, 'MMM d, yyyy')}</span>
                  )
                ) : (
                  <span>Date Range</span>
                )}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start" side="bottom" avoidCollisions>
              <CalendarComponent
                mode="range"
                selected={dateRange}
                onSelect={setDateRange}
                numberOfMonths={typeof window !== 'undefined' && window.innerWidth < 640 ? 1 : 2}
                initialFocus
              />
              {dateRange && (
                <div className="p-3 border-t">
                  <Button 
                    variant="ghost" 
                    size="sm" 
                    className="w-full gap-2"
                    onClick={() => setDateRange(undefined)}
                  >
                    <X className="w-4 h-4" />
                    Clear Date Filter
                  </Button>
                </div>
              )}
            </PopoverContent>
          </Popover>

          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[160px] h-11 bg-card border-border/50 rounded-xl">
              <Filter className="w-4 h-4 mr-2 text-muted-foreground" />
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent className="bg-popover border-border rounded-xl">
              <SelectItem value="all">All Bookings</SelectItem>
              <SelectItem value="pending">Upcoming Cleans</SelectItem>
              <SelectItem value="completed">Completed</SelectItem>
            </SelectContent>
          </Select>
          <Button 
            variant="outline" 
            className="h-11 gap-2 rounded-xl text-info border-info/20 hover:bg-info/10"
            onClick={handleBulkNotifyWeekCleaners}
            disabled={bulkNotifyingWeek}
          >
            {bulkNotifyingWeek ? <Loader2 className="w-4 h-4 animate-spin" /> : <Bell className="w-4 h-4" />}
            Notify Week's Cleaners
          </Button>
          <Button 
            variant="outline" 
            className="h-11 gap-2 rounded-xl text-success border-success/20 hover:bg-success/10"
            onClick={handlePrepareWeeklyReminders}
          >
            <Phone className="w-4 h-4" />
            Remind Clients
          </Button>
          <Button 
            variant="outline" 
            className="h-11 gap-2 rounded-xl border-primary/30 text-primary hover:bg-primary/10"
            onClick={() => setBulkEditOpen(true)}
          >
            <Edit className="w-4 h-4" />
            Bulk Edit
          </Button>
          <MobileActionSheet
            trigger={
              <Button variant="outline" className="h-11 gap-2 rounded-xl border-border/50 hover:bg-secondary/50 min-h-[44px]" disabled={exporting}>
                {exporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                Export
              </Button>
            }
            title="Export Bookings"
            items={[
              { label: 'Export as CSV', icon: <Download className="w-4 h-4" />, onClick: () => handleExport('csv') },
              { label: 'Export as JSON', icon: <Download className="w-4 h-4" />, onClick: () => handleExport('json') },
              { label: 'Export as Excel', icon: <FileSpreadsheet className="w-4 h-4" />, onClick: () => handleExport('xlsx') },
              { label: 'Export as PDF', icon: <FileText className="w-4 h-4" />, onClick: () => handleExport('pdf') },
              { label: 'Print View', icon: <Printer className="w-4 h-4" />, onClick: () => handleExport('print') },
            ]}
          />
          {selectedBookings.size > 0 && (
            <>
              <Button 
                variant="outline" 
                className="h-11 gap-2 rounded-xl border-primary/30 text-primary hover:bg-primary/10"
                onClick={() => setBulkEditOpen(true)}
              >
                <Edit className="w-4 h-4" />
                Bulk Edit ({selectedBookings.size})
              </Button>
              <Button 
                variant="outline" 
                className="h-11 gap-2 rounded-xl"
                onClick={() => setBulkAssignDialogOpen(true)}
              >
                <User className="w-4 h-4" />
                Assign Cleaner ({selectedBookings.size})
              </Button>
              <Button 
                variant="outline" 
                className="h-11 gap-2 rounded-xl text-info border-info/20 hover:bg-info/10"
                onClick={handleBulkNotifyCleaners}
                disabled={bulkNotifyingCleaners}
              >
                {bulkNotifyingCleaners ? <Loader2 className="w-4 h-4 animate-spin" /> : <Phone className="w-4 h-4" />}
                Notify Cleaners ({selectedBookings.size})
              </Button>
              <Button 
                variant="destructive" 
                className="h-11 gap-2 rounded-xl"
                onClick={handleBulkDelete}
                disabled={bulkDeleting}
              >
                {bulkDeleting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                Delete ({selectedBookings.size})
              </Button>
            </>
          )}
        </div>
      </div>

      <div className="bg-card rounded-2xl border border-border/50 shadow-sm overflow-hidden animate-fade-in" style={{ animationDelay: '0.2s' }}>
        {isLoading ? (
          <div className="flex items-center justify-center h-64">
            <div className="flex flex-col items-center gap-3">
              <Loader2 className="w-10 h-10 animate-spin text-primary" />
              <p className="text-muted-foreground">Loading bookings...</p>
            </div>
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center h-64 text-center p-8">
            <div className="w-16 h-16 bg-destructive/10 rounded-full flex items-center justify-center mb-4">
              <XCircle className="w-8 h-8 text-destructive" />
            </div>
            <h3 className="text-lg font-semibold text-foreground mb-2">Failed to load bookings</h3>
            <p className="text-muted-foreground mb-6 max-w-sm">There was a problem fetching your bookings. Please try refreshing the page.</p>
            <Button variant="outline" onClick={() => queryClient.invalidateQueries({ queryKey: ['bookings'] })}>
              Retry
            </Button>
          </div>
        ) : filteredBookings.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-center p-8">
            <div className="w-16 h-16 bg-secondary/50 rounded-full flex items-center justify-center mb-4">
              <Calendar className="w-8 h-8 text-muted-foreground" />
            </div>
            <h3 className="text-lg font-semibold text-foreground mb-2">No bookings found</h3>
            <p className="text-muted-foreground mb-6 max-w-sm">
              {searchTerm || statusFilter !== 'all' 
                ? "Try adjusting your search or filter criteria"
                : "Get started by creating your first booking"
              }
            </p>
            <Button 
              onClick={() => setAddDialogOpen(true)}
              className="gap-2 bg-gradient-to-r from-primary to-accent hover:brightness-110 transition-all"
            >
              <Plus className="w-4 h-4" />
              Create Booking
            </Button>
          </div>
        ) : isMobile ? (
          /* ========== MOBILE CARD VIEW ========== */
          <div
            className="divide-y divide-border overflow-y-auto"
            {...pullHandlers}
          >
            <PullToRefreshIndicator pullDistance={pullDistance} refreshing={refreshing} />
          {filteredBookings.map((booking, index) => {
              const paymentInfo = getPaymentStatusInfo(booking);
              const scheduledDate = new Date(booking.scheduled_at);
              const isCleaned = booking.status === 'completed';
              const isCancelled = booking.status === 'cancelled';
              const isPaid = booking.payment_status === 'paid';
              
              return (
                <div
                  key={booking.id}
                  className="p-3 active:bg-muted/30 transition-colors"
                  onClick={() => setActionSheetBooking(booking)}
                >
                  {/* Top row: booking number + amount */}
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="font-mono text-xs font-bold text-primary">
                      #{booking.booking_number}
                    </span>
                    <span className="font-bold text-sm text-foreground">{maskAmount(booking.total_amount)}</span>
                  </div>
                  
                  {/* Client name */}
                  <p className="text-sm font-medium text-foreground mb-1">
                    {booking.customer 
                      ? maskName(`${booking.customer.first_name} ${booking.customer.last_name}`)
                      : 'Unknown'
                    }
                  </p>
                  
                  {/* Service + date */}
                  <div className="flex items-center gap-2 text-xs text-muted-foreground mb-2">
                    <span>{booking.service?.name || (booking.total_amount === 0 ? 'Re-clean' : 'Service')}</span>
                    <span>•</span>
                    <span>{formatInTimezone(scheduledDate, orgTz, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true })}</span>
                  </div>
                  
                  {/* Staff */}
                  <div className="text-xs text-muted-foreground mb-2">
                    {(() => {
                      const team = booking.booking_team_assignments?.filter(a => a.staff?.name) || [];
                      if (team.length > 1) {
                        return <span>{team.map(a => maskName(a.staff!.name)).join(', ')}</span>;
                      }
                      return (
                        <span className={cn(!booking.staff?.name && "italic")}>
                          {booking.staff?.name ? maskName(booking.staff.name) : 'Unassigned'}
                        </span>
                      );
                    })()}
                  </div>
                  
                  {/* Badges row */}
                  <div className="flex items-center gap-2">
                    {/* Clean status badge */}
                    <div className={cn(
                      "inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-medium",
                      isCancelled
                        ? "bg-destructive/15 text-destructive"
                        : isCleaned
                          ? "bg-success/10 text-success"
                          : "bg-destructive/10 text-destructive"
                    )}>
                      {isCancelled ? (
                        <>
                          <XCircle className="w-3 h-3" />
                          cancelled
                        </>
                      ) : isCleaned ? (
                        <>
                          <CheckCircle className="w-3 h-3" />
                          completed
                        </>
                      ) : (
                        <>
                          <span className="w-1.5 h-1.5 rounded-full bg-info" />
                          scheduled
                        </>
                      )}
                    </div>
                    {/* Payment badge */}
                    <div className={cn(
                      "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium",
                      isPaid
                        ? "bg-success/10 text-success"
                        : "bg-warning/10 text-warning"
                    )}>
                      {isPaid ? (
                        <>
                          <CheckCircle className="w-3 h-3" />
                          Paid
                        </>
                      ) : (
                        <>
                          <span>○</span>
                          {paymentInfo.label}
                        </>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          /* ========== DESKTOP TABLE VIEW ========== */
          <div className="overflow-x-auto" data-no-swipe>
            <Table>
              <TableHeader>
                <TableRow className="bg-secondary/30 hover:bg-secondary/30">
                  <TableHead className="w-[50px]">
                    <Checkbox 
                      checked={selectedBookings.size === filteredBookings.length && filteredBookings.length > 0}
                      onCheckedChange={toggleSelectAll}
                    />
                  </TableHead>
                  <TableHead className="font-semibold">Booking</TableHead>
                  <TableHead className="font-semibold">Customer</TableHead>
                  <TableHead className="font-semibold">Service</TableHead>
                  <TableHead className="font-semibold">Schedule</TableHead>
                  <TableHead className="font-semibold">Staff</TableHead>
                  <TableHead className="font-semibold">Status</TableHead>
                  <TableHead className="font-semibold">Payment</TableHead>
                  <TableHead className="font-semibold text-right">Amount</TableHead>
                  <TableHead className="w-[50px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredBookings.map((booking, index) => {
                  const statusStyle = statusConfig[booking.status] || statusConfig.pending;
                  const paymentInfo = getPaymentStatusInfo(booking);
                  
                  const now = new Date();
                  const scheduledDate = new Date(booking.scheduled_at);
                  const daysUntil = differenceInDays(scheduledDate, now);
                  const hoursUntil = differenceInHours(scheduledDate, now);
                  const isUpcoming = scheduledDate > now;
                  const needsReminder = isUpcoming && 
                    ['pending', 'confirmed'].includes(booking.status) &&
                    daysUntil >= 1 && daysUntil <= 7;
                  const urgentReminder = isUpcoming && 
                    ['pending', 'confirmed'].includes(booking.status) &&
                    hoursUntil > 0 && hoursUntil <= 48;
                  
                  return (
                    <TableRow 
                      key={booking.id} 
                      className={cn(
                        "group transition-colors hover:bg-secondary/20",
                        selectedBookings.has(booking.id) && "bg-primary/5"
                      )}
                      style={{ animationDelay: `${index * 0.03}s` }}
                    >
                      <TableCell>
                        <Checkbox 
                          checked={selectedBookings.has(booking.id)}
                          onCheckedChange={() => toggleSelectBooking(booking.id)}
                        />
                      </TableCell>
                      <TableCell>
                        <span className="font-mono text-sm font-bold text-primary">
                          #{booking.booking_number}
                        </span>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2 md:gap-3">
                          <div className="w-7 h-7 md:w-9 md:h-9 rounded-full bg-gradient-to-br from-primary/20 to-accent/20 flex items-center justify-center">
                            <span className="text-xs md:text-sm font-semibold text-primary">
                              {isTestMode ? 'J' : (booking.customer?.first_name?.trim()?.[0]?.toUpperCase() || '?')}
                            </span>
                          </div>
                          <div>
                            <p className="text-sm md:text-base font-medium text-foreground">
                              {booking.customer 
                                ? maskName(`${booking.customer.first_name} ${booking.customer.last_name}`)
                                : 'Unknown'
                              }
                            </p>
                            <p className="text-[10px] md:text-xs text-muted-foreground">
                              {maskEmail(booking.customer?.email || 'No email')}
                            </p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <span className="font-medium">{booking.service?.name || (booking.total_amount === 0 ? 'Re-clean' : 'Service')}</span>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <div className="flex flex-col">
                            <span className="font-medium text-foreground">
                              {formatInTimezone(scheduledDate, orgTz, { month: 'short', day: 'numeric', year: 'numeric' })}
                            </span>
                            <span className="text-xs text-muted-foreground">
                              {formatInTimezone(scheduledDate, orgTz, { hour: 'numeric', minute: '2-digit', hour12: true })}
                            </span>
                          </div>
                          {(needsReminder || urgentReminder) && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className={cn(
                                "h-7 w-7 rounded-full",
                                urgentReminder
                                  ? "bg-warning/15 text-warning hover:bg-warning/25"
                                  : "bg-info/10 text-info hover:bg-info/20"
                              )}
                              onClick={() => handleSendReminder(booking)}
                              disabled={sendingReminder === booking.id}
                              title={urgentReminder ? `Urgent: ${hoursUntil}h until clean` : `${daysUntil} days until clean - send reminder`}
                            >
                              {sendingReminder === booking.id ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              ) : (
                                <Phone className="w-3.5 h-3.5" />
                              )}
                            </Button>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        {(() => {
                          const team = booking.booking_team_assignments?.filter(a => a.staff?.name) || [];
                          if (team.length > 1) {
                            return (
                              <div className="flex flex-col gap-0.5">
                                {team.map(a => (
                                  <span key={a.staff_id} className="text-sm text-foreground">
                                    {maskName(a.staff!.name)}
                                  </span>
                                ))}
                              </div>
                            );
                          }
                          return (
                            <span className={cn(
                              "text-sm",
                              booking.staff?.name ? "text-foreground" : "text-muted-foreground italic"
                            )}>
                              {booking.staff?.name ? maskName(booking.staff.name) : 'Unassigned'}
                            </span>
                          );
                        })()}
                      </TableCell>
                      <TableCell>
                        <div className={cn(
                          "inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium",
                          statusStyle.bg, statusStyle.text
                        )}>
                          <span className={cn("w-1.5 h-1.5 rounded-full", statusStyle.dot)} />
                          {statusLabels[booking.status] || booking.status.replace('_', ' ')}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className={cn(
                          "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium",
                          paymentInfo.bg, paymentInfo.text
                        )}>
                          <span>{paymentInfo.icon}</span>
                          {paymentInfo.label}
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <span className="font-bold text-foreground">{maskAmount(booking.total_amount)}</span>
                      </TableCell>
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button 
                              variant="ghost" 
                              size="icon" 
                              className="h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity"
                            >
                              <MoreHorizontal className="w-4 h-4" />
                            </Button>
                          </DropdownMenuTrigger>
                           <DropdownMenuContent align="end" side="bottom" avoidCollisions collisionPadding={8} className="w-[280px] md:w-[420px] bg-popover border-border rounded-xl p-0 max-h-[70vh] overflow-y-auto">
                            <div className="grid grid-cols-1 md:grid-cols-2 md:divide-x divide-border">
                              {/* Left column: Booking */}
                              <div className="p-1">
                                <DropdownMenuLabel className="text-xs text-muted-foreground px-2">Booking</DropdownMenuLabel>
                                <DropdownMenuItem
                                  className="gap-2 cursor-pointer"
                                  onClick={() => {
                                    setActiveBooking(booking);
                                    setViewDialogOpen(true);
                                  }}
                                >
                                  <Eye className="w-4 h-4" /> View Details
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  className="gap-2 cursor-pointer"
                                  onClick={() => {
                                    setEditingBooking(booking);
                                    setAddDialogOpen(true);
                                  }}
                                >
                                  <Edit className="w-4 h-4" /> Edit
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  className="gap-2 cursor-pointer"
                                  onClick={() => handleDuplicate(booking)}
                                >
                                  <Copy className="w-4 h-4" /> Duplicate
                                </DropdownMenuItem>
                                <DropdownMenuItem 
                                  className="gap-2 cursor-pointer" 
                                  onClick={() => {
                                    handleStatusChange(booking.id, 'completed');
                                    setActiveBooking(booking);
                                    setAdjustPaymentOpen(true);
                                  }}
                                  disabled={booking.status === 'completed'}
                                >
                                  Mark Complete & Adjust Pay
                                </DropdownMenuItem>
                                <DropdownMenuItem 
                                  className="gap-2 cursor-pointer text-amber-600" 
                                  onClick={async () => {
                                    await handleStatusChange(booking.id, 'confirmed');
                                    toast({ title: "Marked Scheduled", description: `Booking #${booking.booking_number} moved back to scheduled.` });
                                  }}
                                  disabled={booking.status === 'confirmed'}
                                >
                                  <XCircle className="w-4 h-4" /> Mark Scheduled
                                </DropdownMenuItem>
                                <DropdownMenuItem 
                                  className="gap-2 cursor-pointer" 
                                  onClick={() => {
                                    setActiveBooking(booking);
                                    setAdjustPaymentOpen(true);
                                  }}
                                >
                                  <DollarSign className="w-4 h-4" /> Adjust Cleaner Pay
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  className="gap-2 cursor-pointer text-rose-600 focus:text-rose-600"
                                  onClick={() => setCancelBookingTarget(booking)}
                                  disabled={booking.status === 'cancelled'}
                                >
                                  <XCircle className="w-4 h-4" /> Mark Cancelled
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                  className="gap-2 text-destructive cursor-pointer focus:text-destructive"
                                  onClick={() => handleDelete(booking)}
                                >
                                  <Trash2 className="w-4 h-4" /> Delete
                                </DropdownMenuItem>
                              </div>

                              {/* Right column: Payments & Communication */}
                              <div className="p-1">
                                <DropdownMenuLabel className="text-xs text-muted-foreground px-2">Payments & Comms</DropdownMenuLabel>
                                <DropdownMenuItem 
                                  className="gap-2 cursor-pointer text-emerald-600" 
                                  onClick={async () => {
                                    await updateBooking.mutateAsync({
                                      id: booking.id,
                                      payment_status: 'paid' as any
                                    });
                                    toast({ title: "Marked Paid", description: `Booking #${booking.booking_number} marked as paid.` });
                                  }}
                                  disabled={booking.payment_status === 'paid'}
                                >
                                  <CreditCard className="w-4 h-4" /> 
                                  {booking.payment_status === 'paid' ? 'Already Paid' : 'Mark Paid'}
                                </DropdownMenuItem>
                                {booking.payment_status === 'paid' && (
                                  <DropdownMenuItem 
                                    className="gap-2 cursor-pointer text-orange-600" 
                                    onClick={async () => {
                                      await updateBooking.mutateAsync({
                                        id: booking.id,
                                        payment_status: 'pending' as any
                                      });
                                      toast({ title: "Marked Unpaid", description: `Booking #${booking.booking_number} marked as unpaid.` });
                                    }}
                                  >
                                    <XCircle className="w-4 h-4" /> 
                                    Mark Unpaid
                                  </DropdownMenuItem>
                                )}
                                {canShowPaymentFlows && (
                                  <DropdownMenuItem
                                    className="gap-2 cursor-pointer text-teal-600"
                                    onClick={() => {
                                      setAdditionalChargesBooking(booking);
                                      setAdditionalChargesOpen(true);
                                    }}
                                  >
                                    <PlusCircle className="w-4 h-4" /> Additional Charge
                                  </DropdownMenuItem>
                                )}
                                {canShowPaymentFlows && (
                                  <DropdownMenuItem
                                    className="gap-2 cursor-pointer text-amber-600"
                                    onClick={() => setChargeConfirmBooking(booking)}
                                    disabled={
                                      chargingCard === booking.id ||
                                      booking.payment_status === 'paid' ||
                                      !booking.customer?.email
                                    }
                                  >
                                    {chargingCard === booking.id ? (
                                      <Loader2 className="w-4 h-4 animate-spin" />
                                    ) : (
                                      <DollarSign className="w-4 h-4" />
                                    )}
                                    {booking.payment_status === 'paid' ? 'Already Paid' : 'Charge Card Now'}
                                  </DropdownMenuItem>
                                )}
                                {canShowPaymentFlows && !(booking as any).payment_intent_id && booking.payment_status !== 'paid' && (
                                  <DropdownMenuItem
                                    className="gap-2 cursor-pointer"
                                    onClick={() => setPlaceHoldConfirmBooking(booking)}
                                    disabled={placingHold === booking.id || !booking.customer?.email}
                                  >
                                    {placingHold === booking.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <CreditCard className="w-4 h-4" />}
                                    Place Hold
                                  </DropdownMenuItem>
                                )}
                                {!!(booking as any).payment_intent_id && booking.payment_status !== 'paid' && (
                                  <DropdownMenuItem
                                    className="gap-2 cursor-pointer"
                                    onClick={() => setCaptureConfirmBooking(booking)}
                                    disabled={capturingPayment === booking.id}
                                  >
                                    {capturingPayment === booking.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <CreditCard className="w-4 h-4" />}
                                    Capture Hold
                                  </DropdownMenuItem>
                                )}
                                <DropdownMenuItem
                                  className="gap-2 cursor-pointer"
                                  onClick={() => handleCancelHold(booking)}
                                  disabled={cancelingHold === booking.id || booking.payment_status === 'paid' || booking.payment_status === 'refunded' || !(booking as any).payment_intent_id}
                                >
                                  {cancelingHold === booking.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <XCircle className="w-4 h-4" />}
                                  {cancelingHold === booking.id
                                    ? 'Releasing…'
                                    : booking.payment_status === 'refunded'
                                      ? 'Hold Released'
                                      : !(booking as any).payment_intent_id
                                        ? 'No Hold'
                                        : 'Release Hold'}
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  className="gap-2 cursor-pointer"
                                  onClick={() => { setRefundDialogBooking(booking); setRefundType('full'); setRefundAmount(''); }}
                                  disabled={booking.payment_status === 'refunded' || (booking.payment_status !== 'paid' && !(booking as any).payment_intent_id)}
                                >
                                  <RotateCcw className="w-4 h-4" /> Refund
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  className="gap-2 cursor-pointer"
                                  onClick={() => { setPaymentHistoryBooking(booking); setPaymentHistoryOpen(true); }}
                                >
                                  <Clock className="w-4 h-4" /> Payment History
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                                <DropdownMenuLabel className="text-xs text-muted-foreground font-normal">Communication</DropdownMenuLabel>
                                <DropdownMenuItem 
                                  className="gap-2 cursor-pointer text-blue-600" 
                                  onClick={() => handleSendReminder(booking)}
                                  disabled={sendingReminder === booking.id || !booking.customer?.phone}
                                >
                                  {sendingReminder === booking.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Phone className="w-4 h-4" />}
                                  Send Reminder
                                </DropdownMenuItem>
                                <DropdownMenuItem 
                                  className="gap-2 cursor-pointer text-purple-600" 
                                  onClick={() => handleSendCleanerNotification(booking)}
                                  disabled={sendingCleanerNotification === booking.id || !booking.staff?.phone}
                                >
                                  {sendingCleanerNotification === booking.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Phone className="w-4 h-4" />}
                                  Notify Cleaner
                                </DropdownMenuItem>
                                {!booking.staff && (
                                  <DropdownMenuItem 
                                    className="gap-2 cursor-pointer text-green-600" 
                                    onClick={() => handleOpenCleanerPicker(booking)}
                                    disabled={notifyingOpenJob === booking.id}
                                  >
                                    {notifyingOpenJob === booking.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Bell className="w-4 h-4" />}
                                    Notify Cleaners
                                  </DropdownMenuItem>
                                )}
                                <DropdownMenuItem 
                                  className="gap-2 cursor-pointer text-amber-600" 
                                  onClick={() => handleSendReviewRequest(booking)}
                                  disabled={sendingReviewRequest === booking.id || !booking.customer?.phone || booking.status !== 'completed'}
                                >
                                  {sendingReviewRequest === booking.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Star className="w-4 h-4" />}
                                  Send Review
                                </DropdownMenuItem>
                                {canShowPaymentFlows && (
                                  <DropdownMenuItem
                                    className="gap-2 cursor-pointer text-emerald-600"
                                    onClick={() => handleSendTipRequest(booking)}
                                    disabled={sendingTipRequest === booking.id || !booking.customer?.phone || booking.status !== 'completed'}
                                  >
                                    {sendingTipRequest === booking.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Heart className="w-4 h-4" />}
                                    Send Tip Link
                                  </DropdownMenuItem>
                                )}
                                {canShowPaymentFlows && (
                                  <DropdownMenuItem
                                    className="gap-2 cursor-pointer text-blue-600"
                                    onClick={() => {
                                      setDepositDialogBooking(booking);
                                      setDepositAmount('');
                                    }}
                                    disabled={!booking.customer?.phone}
                                  >
                                    <Banknote className="w-4 h-4" />
                                    Send Deposit Link
                                  </DropdownMenuItem>
                                )}
                                <DropdownMenuSeparator />
                                <DropdownMenuLabel className="text-xs text-muted-foreground font-normal">Staff</DropdownMenuLabel>
                                <DropdownMenuItem 
                                  className="gap-2 cursor-pointer text-indigo-600" 
                                  onClick={() => setAssignCleanerBooking(booking)}
                                >
                                  <UserPlus className="w-4 h-4" />
                                  Assign Cleaner
                                </DropdownMenuItem>
                              </div>
                            </div>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      {/* ========== MOBILE ACTION BOTTOM SHEET ========== */}
      <BookingActionSheet
        booking={actionSheetBooking}
        onClose={() => setActionSheetBooking(null)}
        openSections={openSections}
        onToggleSection={(key, open) => setOpenSections(prev => ({ ...prev, [key]: open }))}
        statusConfig={statusConfig}
        statusLabels={statusLabels}
        getPaymentStatusInfo={getPaymentStatusInfo}
        maskAmount={maskAmount}
        maskName={maskName}
        onViewDetails={(b) => { setActionSheetBooking(null); setActiveBooking(b); setViewDialogOpen(true); }}
        onMarkPaid={async (b) => { await updateBooking.mutateAsync({ id: b.id, payment_status: 'paid' as any }); toast({ title: "Marked Paid", description: `Booking #${b.booking_number} marked as paid.` }); setActionSheetBooking(null); }}
        onMarkComplete={(b) => { handleStatusChange(b.id, 'completed'); setActionSheetBooking(null); }}
        onEdit={(b) => { setActionSheetBooking(null); setEditingBooking(b); setAddDialogOpen(true); }}
        onDuplicate={(b) => { setActionSheetBooking(null); handleDuplicate(b); }}
        onMarkCompleteAdjustPay={(b) => { handleStatusChange(b.id, 'completed'); setActiveBooking(b); setAdjustPaymentOpen(true); setActionSheetBooking(null); }}
        onMarkScheduled={async (b) => { await handleStatusChange(b.id, 'confirmed'); toast({ title: "Marked Scheduled" }); setActionSheetBooking(null); }}
        onMarkCancelled={(b) => { setActionSheetBooking(null); setCancelBookingTarget(b); }}
        onAdjustCleanerPay={(b) => { setActiveBooking(b); setAdjustPaymentOpen(true); setActionSheetBooking(null); }}
        onDelete={(b) => { setActionSheetBooking(null); handleDelete(b); }}
        onMarkUnpaid={async (b) => { await updateBooking.mutateAsync({ id: b.id, payment_status: 'pending' as any }); toast({ title: "Marked Unpaid" }); setActionSheetBooking(null); }}
        onAdditionalCharge={(b) => { setAdditionalChargesBooking(b); setAdditionalChargesOpen(true); setActionSheetBooking(null); }}
        onChargeCard={(b) => { setChargeConfirmBooking(b); setActionSheetBooking(null); }}
        onPlaceHold={(b) => { setPlaceHoldConfirmBooking(b); setActionSheetBooking(null); }}
        onCaptureHold={(b) => { setCaptureConfirmBooking(b); setActionSheetBooking(null); }}
        onReleaseHold={(b) => { handleCancelHold(b); setActionSheetBooking(null); }}
        onRefund={(b) => { setRefundDialogBooking(b); setRefundType('full'); setRefundAmount(''); setActionSheetBooking(null); }}
        onPaymentHistory={(b) => { setPaymentHistoryBooking(b); setPaymentHistoryOpen(true); setActionSheetBooking(null); }}
        onSendReminder={(b) => { handleSendReminder(b); setActionSheetBooking(null); }}
        onNotifyCleaner={(b) => { handleSendCleanerNotification(b); setActionSheetBooking(null); }}
        onNotifyOpenJob={(b) => { handleOpenCleanerPicker(b); setActionSheetBooking(null); }}
        onSendReview={(b) => { handleSendReviewRequest(b); setActionSheetBooking(null); }}
        onSendTipLink={(b) => { handleSendTipRequest(b); setActionSheetBooking(null); }}
        onSendDepositLink={(b) => { setDepositDialogBooking(b); setDepositAmount(''); setActionSheetBooking(null); }}
        onAssignCleaner={(b) => { setAssignCleanerBooking(b); setActionSheetBooking(null); }}
        chargingCard={chargingCard}
        placingHold={placingHold}
        capturingPayment={capturingPayment}
        cancelingHold={cancelingHold}
        sendingReminder={sendingReminder}
        sendingCleanerNotification={sendingCleanerNotification}
        notifyingOpenJob={notifyingOpenJob}
        sendingReviewRequest={sendingReviewRequest}
        sendingTipRequest={sendingTipRequest}
      />
        </TabsContent>

        <TabsContent value="drafts" className="space-y-6">
          <div className="bg-card rounded-xl border border-border/50 shadow-sm p-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-lg font-semibold">Draft Bookings</h3>
                <p className="text-muted-foreground text-sm mt-1">
                  These are bookings saved as drafts with pending payment status. Complete the booking or payment to move them to active bookings.
                </p>
              </div>
              {selectedDrafts.size > 0 && (
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => setBulkDraftDeleteOpen(true)}
                  disabled={bulkDraftDeleting}
                >
                  {bulkDraftDeleting ? (
                    <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                  ) : (
                    <Trash2 className="w-4 h-4 mr-1" />
                  )}
                  Delete Selected ({selectedDrafts.size})
                </Button>
              )}
            </div>
            {draftBookings.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                No draft bookings found.
              </div>
            ) : (
              <div className="space-y-3">
                {/* Select All row */}
                <div className="flex items-center gap-3 px-4 py-2 border-b border-border/50">
                  <Checkbox
                    checked={draftBookings.length > 0 && selectedDrafts.size === draftBookings.length}
                    onCheckedChange={(checked) => {
                      if (checked) {
                        setSelectedDrafts(new Set(draftBookings.map(b => b.id)));
                      } else {
                        setSelectedDrafts(new Set());
                      }
                    }}
                  />
                  <span className="text-sm text-muted-foreground font-medium">Select All ({draftBookings.length})</span>
                </div>
                {draftBookings.map((booking) => (
                  <div key={booking.id} className={cn(
                    "flex items-start sm:items-center gap-3 p-4 rounded-lg border border-border/50 transition-colors",
                    selectedDrafts.has(booking.id) ? "bg-primary/5 border-primary/30" : "bg-secondary/30"
                  )}>
                    <Checkbox
                      checked={selectedDrafts.has(booking.id)}
                      onCheckedChange={(checked) => {
                        setSelectedDrafts(prev => {
                          const next = new Set(prev);
                          if (checked) { next.add(booking.id); } else { next.delete(booking.id); }
                          return next;
                        });
                      }}
                    />
                    <div className="flex-1 min-w-0 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        <p className="font-medium truncate">
                          #{booking.booking_number} - {booking.customer?.first_name} {booking.customer?.last_name}
                        </p>
                        <p className="text-sm text-muted-foreground">
                          {booking.service?.name} • {formatInTimezone(booking.scheduled_at, orgTz, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true })}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge variant="outline" className="bg-warning/10 text-warning">
                          ${booking.total_amount?.toFixed(2)} unpaid
                        </Badge>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setActiveBooking(booking);
                            setViewDialogOpen(true);
                          }}
                        >
                          <Eye className="w-4 h-4 mr-1" />
                          View
                        </Button>
                        <Button
                          size="sm"
                          onClick={() => {
                            setEditingBooking(booking);
                            setAddDialogOpen(true);
                          }}
                        >
                          <Edit className="w-4 h-4 mr-1" />
                          Edit
                        </Button>
                        <Button
                          size="sm"
                          variant="destructive"
                          onClick={() => handleDelete(booking)}
                        >
                          <Trash2 className="w-4 h-4 mr-1" />
                          Delete
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </TabsContent>

        {/* Bulk Draft Delete Confirmation */}
        <AlertDialog
          open={bulkDraftDeleteOpen}
          onOpenChange={(open) => {
            // Don't let an outside-click dismiss the dialog while the bulk
            // delete loop is running — the dialog would re-open mid-iteration
            // if the user clicked again, queueing a second pass.
            if (bulkDraftDeleting && !open) return;
            setBulkDraftDeleteOpen(open);
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete {selectedDrafts.size} Draft{selectedDrafts.size > 1 ? 's' : ''}?</AlertDialogTitle>
              <AlertDialogDescription>
                Are you sure you want to delete {selectedDrafts.size} selected draft{selectedDrafts.size > 1 ? 's' : ''}? This cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={bulkDraftDeleting}>Cancel</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                disabled={bulkDraftDeleting}
                onClick={async (e) => {
                  e.preventDefault();
                  setBulkDraftDeleting(true);
                  try {
                    // Re-verify each selection is still a draft against current
                    // booking state. Between the user opening this dialog and
                    // confirming, another admin (or a webhook) may have moved
                    // some of these out of draft state — deleting them would
                    // silently destroy real booking data.
                    const draftIds = new Set(draftBookings.map(b => b.id));
                    const stillDraft: string[] = [];
                    const noLongerDraft: string[] = [];
                    for (const id of selectedDrafts) {
                      if (draftIds.has(id)) stillDraft.push(id);
                      else noLongerDraft.push(id);
                    }

                    for (const id of stillDraft) {
                      await deleteBooking.mutateAsync(id);
                    }
                    setSelectedDrafts(new Set());
                    setBulkDraftDeleteOpen(false);

                    if (noLongerDraft.length > 0) {
                      toast({
                        title: stillDraft.length > 0 ? "Partially deleted" : "Nothing deleted",
                        description: `${stillDraft.length} deleted. ${noLongerDraft.length} skipped. They're no longer drafts.`,
                        variant: noLongerDraft.length > stillDraft.length ? "destructive" : "default",
                      });
                    } else {
                      toast({
                        title: "Deleted",
                        description: `${stillDraft.length} draft${stillDraft.length === 1 ? '' : 's'} deleted successfully`,
                      });
                    }
                  } catch (error) {
                    toast({ title: "Error", description: "Failed to delete some drafts", variant: "destructive" });
                  } finally {
                    setBulkDraftDeleting(false);
                  }
                }}
              >
                {bulkDraftDeleting ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : null}
                Yes, Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <TabsContent value="quotes" className="space-y-6">
          <QuotesTabContent />
        </TabsContent>

        <TabsContent value="cleaner-wages">
          <BulkEditCleanerWages />
        </TabsContent>
      </Tabs>

      <AddBookingDialog
        open={addDialogOpen}
        onOpenChange={(open) => {
          setAddDialogOpen(open);
          if (!open) setPrefillCustomerId(null);
        }}
        booking={editingBooking}
        onDuplicate={handleDuplicate}
        defaultCustomerId={prefillCustomerId}
      />
      
      <BookingDetailsDialog
        open={viewDialogOpen}
        onOpenChange={setViewDialogOpen}
        booking={activeBooking}
      />

      <AdjustPaymentDialog
        open={adjustPaymentOpen}
        onOpenChange={setAdjustPaymentOpen}
        booking={activeBooking}
      />

      {/* Charge Confirmation Dialog */}
      <AlertDialog open={!!chargeConfirmBooking} onOpenChange={(open) => !open && setChargeConfirmBooking(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm Charge</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to charge <strong>{fmt(chargeConfirmBooking?.total_amount)}</strong> to{' '}
              <strong>{chargeConfirmBooking?.customer?.first_name} {chargeConfirmBooking?.customer?.last_name}</strong>'s card?
              <br /><br />
              This will immediately charge their saved payment method.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-warning text-warning-foreground hover:bg-warning/90"
              onClick={() => {
                if (chargeConfirmBooking) {
                  handleChargeCard(chargeConfirmBooking);
                  setChargeConfirmBooking(null);
                }
              }}
            >
              Yes, Charge Now
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Place Hold Confirmation Dialog */}
      <AlertDialog open={!!placeHoldConfirmBooking} onOpenChange={(open) => !open && setPlaceHoldConfirmBooking(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm Place Hold</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to place a hold of <strong>{fmt(placeHoldConfirmBooking?.total_amount)}</strong> on{' '}
              <strong>{placeHoldConfirmBooking?.customer?.first_name} {placeHoldConfirmBooking?.customer?.last_name}</strong>'s card?
              <br /><br />
              This will authorize the amount but not charge the card until you capture the payment.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-primary hover:bg-primary/90"
              onClick={() => {
                if (placeHoldConfirmBooking) {
                  handlePlaceHold(placeHoldConfirmBooking);
                  setPlaceHoldConfirmBooking(null);
                }
              }}
            >
              Yes, Place Hold
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Capture Hold Confirmation Dialog */}
      <AlertDialog open={!!captureConfirmBooking} onOpenChange={(open) => !open && setCaptureConfirmBooking(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm Capture Payment</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to capture <strong>{fmt(captureConfirmBooking?.total_amount)}</strong> from the hold on{' '}
              <strong>{captureConfirmBooking?.customer?.first_name} {captureConfirmBooking?.customer?.last_name}</strong>'s card?
              <br /><br />
              This will finalize the payment hold and transfer the funds.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-primary hover:bg-primary/90"
              onClick={() => {
                if (captureConfirmBooking) {
                  handleCapturePayment(captureConfirmBooking);
                  setCaptureConfirmBooking(null);
                }
              }}
            >
              Yes, Capture Payment
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Refund Dialog */}
      <AlertDialog open={!!refundDialogBooking} onOpenChange={(open) => {
        if (!open) {
          setRefundDialogBooking(null);
          setRefundType('full');
          setRefundAmount('');
        }
      }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Process Refund</AlertDialogTitle>
            <AlertDialogDescription>
              Refund payment for Booking #{refundDialogBooking?.booking_number},{' '}
              <strong>{refundDialogBooking?.customer?.first_name} {refundDialogBooking?.customer?.last_name}</strong>
              <br />
              Original amount: <strong>{fmt(refundDialogBooking?.total_amount)}</strong>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="py-4 space-y-4">
            {!(refundDialogBooking as any)?.payment_intent_id && (
              <div className="rounded-md bg-warning/10 border border-warning/20 p-3 text-sm text-warning">
                ⚠️ No Stripe payment found for this booking. This will be a <strong>manual record-only</strong> update. No money will be returned via Stripe. To process an actual Stripe refund, the booking must have been charged through the app first.
              </div>
            )}
            <RadioGroup value={refundType} onValueChange={(v) => setRefundType(v as 'full' | 'partial')}>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="full" id="refund-full" />
                <Label htmlFor="refund-full">Full Refund (${refundDialogBooking?.total_amount?.toFixed(2)})</Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="partial" id="refund-partial" />
                <Label htmlFor="refund-partial">Partial Refund</Label>
              </div>
            </RadioGroup>
            {refundType === 'partial' && (
              <div className="space-y-2">
                <Label htmlFor="refund-amount">Refund Amount ($)</Label>
                <Input
                  id="refund-amount"
                  type="number"
                  step="0.01"
                  min="0.01"
                  max={refundDialogBooking?.total_amount}
                  value={refundAmount}
                  onChange={(e) => setRefundAmount(e.target.value)}
                  placeholder="0.00"
                />
              </div>
            )}
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={processingRefund}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-primary hover:bg-primary/90"
              disabled={processingRefund}
              onClick={(e) => {
                e.preventDefault();
                if (refundDialogBooking) {
                  handleProcessRefund(refundDialogBooking);
                }
              }}
            >
              {processingRefund ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin mr-2" />
                  Processing...
                </>
              ) : (
                `Refund ${refundType === 'full' ? `${fmt(refundDialogBooking?.total_amount)}` : refundAmount ? `${fmt(parseFloat(refundAmount))}` : '...'}`
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Payment History Dialog */}
      <PaymentHistoryLogDialog
        open={paymentHistoryOpen}
        onOpenChange={setPaymentHistoryOpen}
        booking={paymentHistoryBooking}
      />

      {/* Bulk Assign Cleaner Dialog */}
      <AlertDialog open={bulkAssignDialogOpen} onOpenChange={setBulkAssignDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Assign Cleaner to {selectedBookings.size} Booking{selectedBookings.size > 1 ? 's' : ''}</AlertDialogTitle>
            <AlertDialogDescription>
              Select a cleaner to assign to the selected bookings.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="py-4">
            <Select value={selectedStaffId} onValueChange={setSelectedStaffId}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select a cleaner..." />
              </SelectTrigger>
              <SelectContent>
                {staffList.map((staff) => (
                  <SelectItem key={staff.id} value={staff.id}>
                    {staff.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setSelectedStaffId('')}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={!selectedStaffId || bulkAssigning}
              onClick={handleBulkAssign}
            >
              {bulkAssigning ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin mr-2" />
                  Assigning...
                </>
              ) : (
                'Assign Cleaner'
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Additional Charges Dialog */}
      {additionalChargesBooking && (
        <AdditionalChargesDialog
          open={additionalChargesOpen}
          onOpenChange={setAdditionalChargesOpen}
          bookingId={additionalChargesBooking.id}
          bookingNumber={additionalChargesBooking.booking_number}
          organizationId={organization?.id || ''}
          currentTotal={additionalChargesBooking.total_amount}
          customerEmail={additionalChargesBooking.customer?.email}
          onTotalUpdated={() => {
            // Refetch handled by invalidation in dialog
          }}
        />
      )}

      {/* Deposit Request Dialog */}
      <AlertDialog open={!!depositDialogBooking} onOpenChange={(open) => { if (!open) setDepositDialogBooking(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Send Deposit Link</AlertDialogTitle>
            <AlertDialogDescription>
              Send a deposit payment link to {depositDialogBooking?.customer?.first_name} {depositDialogBooking?.customer?.last_name} for Booking #{depositDialogBooking?.booking_number}.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="py-4 space-y-4">
            <div>
              <Label className="text-sm font-medium">Deposit Amount ($)</Label>
              <Input
                type="number"
                min="1"
                step="0.01"
                placeholder="Enter deposit amount..."
                value={depositAmount}
                onChange={(e) => setDepositAmount(e.target.value)}
                className="mt-2"
              />
            </div>
            <div className="text-xs text-muted-foreground">
              Customer will receive an SMS with a secure payment link for this amount.
              <br />Phone: {depositDialogBooking?.customer?.phone || 'N/A'}
            </div>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => { setDepositDialogBooking(null); setDepositAmount(''); }}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={sendingDepositRequest || !depositAmount || parseFloat(depositAmount) <= 0}
              onClick={handleSendDepositRequest}
              className="bg-primary hover:bg-primary/90"
            >
              {sendingDepositRequest ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin mr-2" />
                  Sending...
                </>
              ) : (
                `Send $${depositAmount ? parseFloat(depositAmount).toFixed(2) : '0.00'} Deposit Link`
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Assign Cleaner / Team Dialog */}
      <AlertDialog open={!!assignCleanerBooking} onOpenChange={(open) => { if (!open) { setAssignCleanerBooking(null); setAssignTeamIds(new Set()); } }}>
        <AlertDialogContent className="max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle>Assign Cleaner or Team</AlertDialogTitle>
            <AlertDialogDescription>
              Select one or more cleaners for Booking #{assignCleanerBooking?.booking_number}, {assignCleanerBooking?.customer?.first_name} {assignCleanerBooking?.customer?.last_name}. Pick multiple to assign as a team.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="py-2 max-h-[50vh] overflow-y-auto space-y-1">
            {staffList.filter(s => s.is_active).map((staff) => {
              const checked = assignTeamIds.has(staff.id);
              return (
                <label
                  key={staff.id}
                  className="flex items-center gap-3 p-3 rounded-lg border border-border hover:bg-accent cursor-pointer transition-colors"
                >
                  <Checkbox
                    checked={checked}
                    onCheckedChange={(v) => {
                      setAssignTeamIds(prev => {
                        const next = new Set(prev);
                        if (v) next.add(staff.id); else next.delete(staff.id);
                        return next;
                      });
                    }}
                  />
                  <span className="flex-1 text-sm font-medium">{staff.name}</span>
                  {checked && assignTeamIds.size > 1 && Array.from(assignTeamIds)[0] === staff.id && (
                    <Badge variant="secondary" className="text-xs">Primary</Badge>
                  )}
                </label>
              );
            })}
            {staffList.filter(s => s.is_active).length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-4">No active cleaners available</p>
            )}
          </div>
          {assignTeamIds.size > 1 && (
            <p className="text-xs text-muted-foreground">
              {assignTeamIds.size} cleaners selected. Assigned as a team. The first selection is the primary cleaner.
            </p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => { setAssignCleanerBooking(null); setAssignTeamIds(new Set()); }}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={assigningCleaner || assignTeamIds.size === 0}
              onClick={async () => {
                if (!assignCleanerBooking || assignTeamIds.size === 0) return;
                setAssigningCleaner(true);
                try {
                  const ids = Array.from(assignTeamIds);
                  const primaryId = ids[0];
                  const orgId = (assignCleanerBooking as any).organization_id;

                  // Update primary staff on the booking
                  await updateBooking.mutateAsync({
                    id: assignCleanerBooking.id,
                    staff_id: primaryId,
                  });

                  // Reset team assignments
                  await supabase
                    .from('booking_team_assignments')
                    .delete()
                    .eq('booking_id', assignCleanerBooking.id);

                  // Insert each team member. pay_share is DOLLARS, not a
                  // fraction — split the booking's expected pay across the
                  // assigned cleaners (null → payroll uses cleaner_pay_expected).
                  const expected = Number((assignCleanerBooking as any).cleaner_pay_expected);
                  const payShare = Number.isFinite(expected) && expected > 0
                    ? Math.round((expected / ids.length) * 100) / 100
                    : null;
                  for (let i = 0; i < ids.length; i++) {
                    await supabase.from('booking_team_assignments').insert({
                      booking_id: assignCleanerBooking.id,
                      staff_id: ids[i],
                      is_primary: i === 0,
                      pay_share: payShare,
                      organization_id: orgId,
                    });
                  }

                  queryClient.invalidateQueries({ queryKey: ['bookings'] });
                  queryClient.invalidateQueries({ queryKey: ['booking-team-assignments'] });
                  queryClient.invalidateQueries({ queryKey: ['all-team-assignments'] });

                  toast({
                    title: ids.length > 1 ? "Team Assigned" : "Cleaner Assigned",
                    description: `${ids.length} ${ids.length > 1 ? 'cleaners' : 'cleaner'} assigned to booking #${assignCleanerBooking.booking_number}`,
                  });
                  setAssignCleanerBooking(null);
                  setAssignTeamIds(new Set());
                } catch (error) {
                  toast({ title: "Error", description: "Failed to assign cleaner(s)", variant: "destructive" });
                } finally {
                  setAssigningCleaner(false);
                }
              }}
              className="bg-primary hover:bg-primary/90"
            >
              {assigningCleaner ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin mr-2" />
                  Assigning...
                </>
              ) : (
                assignTeamIds.size > 1 ? `Assign Team (${assignTeamIds.size})` : 'Assign Cleaner'
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {/* Cleaner Picker Dialog */}
      <AlertDialog open={cleanerPickerOpen} onOpenChange={setCleanerPickerOpen}>
        <AlertDialogContent className="max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle>Select Cleaners to Notify</AlertDialogTitle>
            <AlertDialogDescription>
              Choose which cleaners should receive the notification for job #{cleanerPickerBooking?.booking_number}.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="max-h-64 overflow-y-auto space-y-2 py-2">
            <div className="flex items-center gap-2 pb-2 border-b">
              <Checkbox
                checked={selectedCleanerIds.size === staffList.filter(s => s.is_active).length && selectedCleanerIds.size > 0}
                onCheckedChange={(checked) => {
                  if (checked) {
                    setSelectedCleanerIds(new Set(staffList.filter(s => s.is_active).map(s => s.id)));
                  } else {
                    setSelectedCleanerIds(new Set());
                  }
                }}
              />
              <Label className="text-sm font-medium cursor-pointer">Select All</Label>
            </div>
            {staffList.filter(s => s.is_active).map((staff) => (
              <div key={staff.id} className="flex items-center gap-2">
                <Checkbox
                  checked={selectedCleanerIds.has(staff.id)}
                  onCheckedChange={(checked) => {
                    setSelectedCleanerIds(prev => {
                      const next = new Set(prev);
                      if (checked) next.add(staff.id);
                      else next.delete(staff.id);
                      return next;
                    });
                  }}
                />
                <Label className="text-sm cursor-pointer flex-1">{staff.name}</Label>
                {!staff.phone && <Badge variant="outline" className="text-xs text-muted-foreground">No phone</Badge>}
              </div>
            ))}
            {staffList.filter(s => s.is_active).length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-4">No active cleaners found.</p>
            )}
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleNotifySelectedCleaners}
              disabled={selectedCleanerIds.size === 0}
            >
              <Bell className="w-4 h-4 mr-2" />
              Notify {selectedCleanerIds.size} Cleaner{selectedCleanerIds.size !== 1 ? 's' : ''}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <BulkEditBookingsDialog
        open={bulkEditOpen}
        onOpenChange={setBulkEditOpen}
        bookings={bookings}
        selectedBookingIds={selectedBookings.size > 0 ? selectedBookings : undefined}
        staffList={staffList}
        services={servicesList as any}
      />

      {/* Cancel booking dialog */}
      <CancelBookingDialog
        open={!!cancelBookingTarget}
        bookingNumber={cancelBookingTarget?.booking_number}
        onOpenChange={(open) => !open && setCancelBookingTarget(null)}
        onConfirm={handleConfirmCancel}
      />

      {/* Single booking delete confirmation */}
      <AlertDialog open={!!deleteConfirmBooking} onOpenChange={(open) => !open && setDeleteConfirmBooking(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Booking #{deleteConfirmBooking?.booking_number}?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete the booking for{' '}
              <strong>{deleteConfirmBooking?.customer?.first_name} {deleteConfirmBooking?.customer?.last_name}</strong>.
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setDeleteConfirmBooking(null)}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Bulk delete confirmation */}
      <AlertDialog open={bulkDeleteConfirmOpen} onOpenChange={setBulkDeleteConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {bulkDeleteCount} bookings?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete {bulkDeleteCount} selected bookings. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={bulkDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmBulkDelete}
              disabled={bulkDeleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {bulkDeleting ? <><Loader2 className="w-4 h-4 animate-spin mr-2" />Deleting...</> : 'Delete All'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      </div>
    </AdminLayout>
  );
}
