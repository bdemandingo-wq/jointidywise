import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
} from '@/components/ui/drawer';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  Eye, Edit, Trash2, CreditCard, XCircle, Copy, Clock,
  DollarSign, Phone, Bell, Star, PlusCircle, RotateCcw,
  Heart, Banknote, UserPlus, ChevronDown, CheckCircle,
} from 'lucide-react';
import { BookingWithDetails } from '@/hooks/useBookings';
import { FarCheckinNotice } from '@/components/admin/FarCheckinNotice';
import { fmt } from '@/lib/activeCurrency';


interface BookingActionSheetProps {
  booking: BookingWithDetails | null;
  onClose: () => void;
  openSections: Record<string, boolean>;
  onToggleSection: (section: string, open: boolean) => void;
  statusConfig: Record<string, { bg: string; text: string; dot: string }>;
  statusLabels: Record<string, string>;
  getPaymentStatusInfo: (booking: BookingWithDetails) => { bg: string; text: string; icon: string; label: string };
  // Action handlers
  onViewDetails: (booking: BookingWithDetails) => void;
  onMarkPaid: (booking: BookingWithDetails) => void;
  onMarkComplete: (booking: BookingWithDetails) => void;
  onReopen?: (booking: BookingWithDetails) => void;
  onEdit: (booking: BookingWithDetails) => void;
  onDuplicate: (booking: BookingWithDetails) => void;
  onMarkCompleteAdjustPay: (booking: BookingWithDetails) => void;
  onMarkScheduled: (booking: BookingWithDetails) => void;
  onMarkCancelled: (booking: BookingWithDetails) => void;
  onAdjustCleanerPay: (booking: BookingWithDetails) => void;
  onDelete: (booking: BookingWithDetails) => void;
  onMarkUnpaid: (booking: BookingWithDetails) => void;
  onAdditionalCharge: (booking: BookingWithDetails) => void;
  onChargeCard: (booking: BookingWithDetails) => void;
  onPlaceHold: (booking: BookingWithDetails) => void;
  onCaptureHold: (booking: BookingWithDetails) => void;
  onReleaseHold: (booking: BookingWithDetails) => void;
  onRefund: (booking: BookingWithDetails) => void;
  onPaymentHistory: (booking: BookingWithDetails) => void;
  onSendReminder: (booking: BookingWithDetails) => void;
  onNotifyCleaner: (booking: BookingWithDetails) => void;
  onNotifyOpenJob: (booking: BookingWithDetails) => void;
  onSendReview: (booking: BookingWithDetails) => void;
  onSendTipLink: (booking: BookingWithDetails) => void;
  onSendDepositLink: (booking: BookingWithDetails) => void;
  onAssignCleaner: (booking: BookingWithDetails) => void;
  // Loading/disabled states
  chargingCard?: string | null;
  placingHold?: string | null;
  capturingPayment?: string | null;
  cancelingHold?: string | null;
  sendingReminder?: string | null;
  sendingCleanerNotification?: string | null;
  notifyingOpenJob?: string | null;
  sendingReviewRequest?: string | null;
  sendingTipRequest?: string | null;
}

// Color-coded action button helper
function ActionBtn({
  children,
  onClick,
  disabled,
  colorClass,
  variant = 'item',
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  colorClass?: string;
  variant?: 'item' | 'pill' | 'destructive';
}) {
  const base = 'w-full justify-start gap-2.5 text-[13px] font-semibold h-10 rounded-lg transition-all touch-manipulation';

  if (variant === 'pill') {
    return (
      <Button
        className={cn(base, 'text-white shadow-sm', colorClass)}
        onClick={onClick}
        disabled={disabled}
      >
        {children}
      </Button>
    );
  }
  if (variant === 'destructive') {
    return (
      <Button
        variant="ghost"
        className={cn(base, 'text-destructive hover:bg-destructive/10', disabled && 'opacity-40')}
        onClick={onClick}
        disabled={disabled}
      >
        {children}
      </Button>
    );
  }

  return (
    <Button
      variant="ghost"
      className={cn(base, colorClass, disabled && 'opacity-40 pointer-events-none')}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </Button>
  );
}

// Section wrapper with colored header
function ActionSection({
  label,
  sectionKey,
  isOpen,
  onToggle,
  children,
  iconColor,
}: {
  label: string;
  sectionKey: string;
  isOpen: boolean;
  onToggle: (key: string, open: boolean) => void;
  children: React.ReactNode;
  iconColor: string;
}) {
  return (
    <div className="rounded-xl border border-border/50 bg-muted/30 overflow-hidden">
      <Collapsible open={isOpen} onOpenChange={(open) => onToggle(sectionKey, open)}>
        <CollapsibleTrigger className="flex items-center justify-between w-full py-3 px-3.5 text-[13px] font-bold uppercase tracking-wide text-muted-foreground hover:bg-muted/50 transition-colors">
          <span>{label}</span>
          <ChevronDown className={cn('w-4 h-4 transition-transform', iconColor, isOpen && 'rotate-180')} />
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="px-2 pb-2 space-y-0.5">{children}</div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}

export function BookingActionSheet({
  booking,
  onClose,
  openSections,
  onToggleSection,
  statusConfig: statusCfg,
  statusLabels,
  getPaymentStatusInfo,
  onViewDetails, onMarkPaid, onMarkComplete, onReopen, onEdit, onDuplicate,
  onMarkCompleteAdjustPay, onMarkScheduled, onMarkCancelled, onAdjustCleanerPay, onDelete,
  onMarkUnpaid, onAdditionalCharge, onChargeCard, onPlaceHold, onCaptureHold,
  onReleaseHold, onRefund, onPaymentHistory, onSendReminder, onNotifyCleaner,
  onNotifyOpenJob, onSendReview, onSendTipLink, onSendDepositLink, onAssignCleaner,
  chargingCard, placingHold, capturingPayment, cancelingHold,
  sendingReminder, sendingCleanerNotification, notifyingOpenJob,
  sendingReviewRequest, sendingTipRequest,
}: BookingActionSheetProps) {
  // Payment actions here charge the org's own customers via the org's Stripe for
  // real-world cleaning services — exempt from Apple IAP, so shown on native too.
  const canShowPaymentFlows = true;

  if (!booking) return null;

  const statusStyle = statusCfg[booking.status] || statusCfg.pending;
  const paymentInfo = getPaymentStatusInfo(booking);

  // Status badge colors - bold solid pills.
  // The warning pills use text-warning-foreground rather than text-white: the
  // warning amber is dark in the light theme and light in the dark one, so a
  // fixed white sat at 1.65:1 in one of them whichever way the theme went. The
  // token flips with it. The others stay white — their fills are dark in both.
  const statusBadgeClass = {
    pending: 'bg-warning text-warning-foreground',
    confirmed: 'bg-info text-info-foreground',
    in_progress: 'bg-purple-500 text-white',
    completed: 'bg-success text-success-foreground',
    cancelled: 'bg-destructive text-destructive-foreground',
    no_show: 'bg-muted-foreground text-background',
    // See statusConfig/statusLabels in BookingsPage — all three maps must agree.
    // Omitting this made one status resolve to 'pending' via statusCfg and to
    // info-blue via this map, in the same component, at the same time.
    rescheduled: 'bg-info text-info-foreground',
  }[booking.status] || 'bg-info text-info-foreground';

  const paymentBadgeClass = {
    paid: 'bg-success text-success-foreground',
    pending: 'bg-destructive text-destructive-foreground',
    refunded: 'bg-muted-foreground text-background',
    partial: 'bg-warning text-warning-foreground',
  }[booking.payment_status] || 'bg-destructive text-destructive-foreground';

  const isDisabledHold = cancelingHold === booking.id || booking.payment_status === 'paid' || booking.payment_status === 'refunded' || !(booking as any).payment_intent_id;
  const isDisabledRefund = booking.payment_status === 'refunded' || (booking.payment_status !== 'paid' && !(booking as any).payment_intent_id);

  return (
    <Drawer open={!!booking} onOpenChange={(open) => !open && onClose()}>
      <DrawerContent
        className="max-h-[88vh] overflow-y-auto pb-[calc(1rem+env(safe-area-inset-bottom))] px-4 pt-0 bg-background border-t border-border/50"
      >
        <DrawerHeader className="pb-3 px-0">
          <DrawerTitle className="text-left space-y-2">
            {/* Booking number + amount */}
            <div className="flex items-center justify-between">
              <span className="font-mono text-sm text-primary font-bold">#{booking.booking_number}</span>
              <span className="text-lg font-bold text-foreground">{fmt(booking.total_amount)}</span>
            </div>
            {/* Customer name */}
            <p className="text-base font-semibold text-foreground">
              {booking.customer
                ? `${booking.customer.first_name} ${booking.customer.last_name}`
                : 'Unknown'}
            </p>
            {/* Status pills - bold solid */}
            <div className="flex items-center gap-2">
              <span className={cn('inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-bold uppercase tracking-wide', statusBadgeClass)}>
                {statusLabels[booking.status] || booking.status}
              </span>
              <span className={cn('inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-bold uppercase tracking-wide', paymentBadgeClass)}>
                {paymentInfo.label}
              </span>
            </div>
          </DrawerTitle>
        </DrawerHeader>

        <FarCheckinNotice bookingId={booking.id} />

        {/* ── Quick Actions ── */}
        <div className="py-3 grid grid-cols-1 gap-2">
          <Button
            className="w-full justify-start gap-2.5 h-11 bg-foreground/90 text-background hover:bg-foreground font-semibold text-[13px] rounded-lg shadow-sm"
            onClick={() => onViewDetails(booking)}
          >
            <Eye className="w-4 h-4" /> View Details
          </Button>
          <Button
            className="w-full justify-start gap-2.5 h-11 bg-success hover:bg-success/90 text-success-foreground font-semibold text-[13px] rounded-lg shadow-sm disabled:opacity-40"
            onClick={() => onMarkPaid(booking)}
            disabled={booking.payment_status === 'paid'}
          >
            <CreditCard className="w-4 h-4" />
            {booking.payment_status === 'paid' ? 'Already Paid' : 'Mark Paid'}
          </Button>
          <Button
            className="w-full justify-start gap-2.5 h-11 bg-teal-500 hover:bg-teal-600 text-white font-semibold text-[13px] rounded-lg shadow-sm disabled:opacity-40"
            onClick={() => onMarkCompleteAdjustPay(booking)}
            disabled={booking.status === 'completed'}
          >
            <CheckCircle className="w-4 h-4" /> Mark Complete & Adjust Pay
          </Button>
          <Button
            variant="outline"
            className="w-full justify-start gap-2.5 h-11 font-semibold text-[13px] rounded-lg disabled:opacity-40"
            onClick={() => onMarkComplete(booking)}
            disabled={booking.status === 'completed'}
          >
            <CheckCircle className="w-4 h-4" /> Mark Complete
          </Button>
          {onReopen && booking.status === 'completed' && (
            <Button
              variant="outline"
              className="w-full justify-start gap-2.5 h-11 font-semibold text-[13px] rounded-lg"
              onClick={() => onReopen(booking)}
            >
              <RotateCcw className="w-4 h-4" /> Reopen job
            </Button>
          )}

        </div>

        {/* ── Sections ── */}
        <div className="space-y-2.5 pb-2">
          {/* Booking Section */}
          <ActionSection label="Booking" sectionKey="booking" isOpen={!!openSections['booking']} onToggle={onToggleSection} iconColor="text-blue-400">
            <ActionBtn colorClass="text-blue-500 hover:bg-blue-500/10" onClick={() => onEdit(booking)}>
              <Edit className="w-4 h-4" /> Edit
            </ActionBtn>
            <ActionBtn colorClass="text-purple-500 hover:bg-purple-500/10" onClick={() => onDuplicate(booking)}>
              <Copy className="w-4 h-4" /> Duplicate
            </ActionBtn>
            <ActionBtn colorClass="text-teal-500 hover:bg-teal-500/10" onClick={() => onMarkCompleteAdjustPay(booking)} disabled={booking.status === 'completed'}>
              <CheckCircle className="w-4 h-4" /> Mark Complete & Adjust Pay
            </ActionBtn>
            <ActionBtn colorClass="text-orange-500 hover:bg-orange-500/10" onClick={() => onMarkScheduled(booking)} disabled={booking.status === 'confirmed'}>
              <XCircle className="w-4 h-4" /> Mark Scheduled
            </ActionBtn>
            <ActionBtn colorClass="text-emerald-500 hover:bg-emerald-500/10" onClick={() => onAdjustCleanerPay(booking)}>
              <DollarSign className="w-4 h-4" /> Adjust Cleaner Pay
            </ActionBtn>
            <ActionBtn variant="destructive" onClick={() => onMarkCancelled(booking)} disabled={booking.status === 'cancelled'}>
              <XCircle className="w-4 h-4" /> Mark Cancelled
            </ActionBtn>
            <ActionBtn variant="destructive" onClick={() => onDelete(booking)}>
              <Trash2 className="w-4 h-4" /> Delete
            </ActionBtn>
          </ActionSection>

          {/* Payments Section */}
          <ActionSection label="Payments" sectionKey="payments" isOpen={!!openSections['payments']} onToggle={onToggleSection} iconColor="text-emerald-400">
            {booking.payment_status === 'paid' && (
              <ActionBtn colorClass="text-orange-500 hover:bg-orange-500/10" onClick={() => onMarkUnpaid(booking)}>
                <XCircle className="w-4 h-4" /> Mark Unpaid
              </ActionBtn>
            )}
            {canShowPaymentFlows && (
              <ActionBtn colorClass="text-emerald-500 hover:bg-emerald-500/10" onClick={() => onAdditionalCharge(booking)}>
                <PlusCircle className="w-4 h-4" /> Additional Charge
              </ActionBtn>
            )}
            {canShowPaymentFlows && (
              <ActionBtn
                variant="pill"
                colorClass="bg-orange-500 hover:bg-orange-600"
                onClick={() => onChargeCard(booking)}
                disabled={chargingCard === booking.id || booking.payment_status === 'paid' || !booking.customer?.email}
              >
                <DollarSign className="w-4 h-4" /> Charge Card Now
              </ActionBtn>
            )}
            {canShowPaymentFlows && !(booking as any).payment_intent_id && booking.payment_status !== 'paid' && (
              <ActionBtn colorClass="text-yellow-500 hover:bg-yellow-500/10" onClick={() => onPlaceHold(booking)} disabled={placingHold === booking.id || !booking.customer?.email}>
                <CreditCard className="w-4 h-4" /> Place Hold
              </ActionBtn>
            )}
            {canShowPaymentFlows && !!(booking as any).payment_intent_id && booking.payment_status !== 'paid' && (
              <ActionBtn colorClass="text-blue-500 hover:bg-blue-500/10" onClick={() => onCaptureHold(booking)} disabled={capturingPayment === booking.id}>
                <CreditCard className="w-4 h-4" /> Capture Hold
              </ActionBtn>
            )}
            {canShowPaymentFlows && (
              <ActionBtn colorClass="text-muted-foreground" onClick={() => onReleaseHold(booking)} disabled={isDisabledHold}>
                <XCircle className="w-4 h-4" /> Release Hold
              </ActionBtn>
            )}
            {canShowPaymentFlows && (
              <ActionBtn colorClass="text-muted-foreground" onClick={() => onRefund(booking)} disabled={isDisabledRefund}>
                <RotateCcw className="w-4 h-4" /> Refund
              </ActionBtn>
            )}
            <ActionBtn colorClass="text-blue-500 hover:bg-blue-500/10" onClick={() => onPaymentHistory(booking)}>
              <Clock className="w-4 h-4" /> Payment History
            </ActionBtn>
          </ActionSection>

          {/* Communication Section */}
          <ActionSection label="Communication" sectionKey="communication" isOpen={!!openSections['communication']} onToggle={onToggleSection} iconColor="text-purple-400">
            <ActionBtn
              variant="pill"
              colorClass="bg-blue-500 hover:bg-blue-600"
              onClick={() => onSendReminder(booking)}
              disabled={sendingReminder === booking.id || !booking.customer?.phone}
            >
              <Phone className="w-4 h-4" /> Send Reminder
            </ActionBtn>
            <ActionBtn
              variant="pill"
              colorClass="bg-teal-500 hover:bg-teal-600"
              onClick={() => onNotifyCleaner(booking)}
              disabled={sendingCleanerNotification === booking.id || !booking.staff?.phone}
            >
              <Phone className="w-4 h-4" /> Notify Cleaner
            </ActionBtn>
            {!booking.staff && (
              <ActionBtn colorClass="text-emerald-500 hover:bg-emerald-500/10" onClick={() => onNotifyOpenJob(booking)} disabled={notifyingOpenJob === booking.id}>
                <Bell className="w-4 h-4" /> Notify Cleaners (Open Job)
              </ActionBtn>
            )}
            <ActionBtn colorClass="text-amber-400 hover:bg-amber-500/10" onClick={() => onSendReview(booking)} disabled={sendingReviewRequest === booking.id || !booking.customer?.phone || booking.status !== 'completed'}>
              <Star className="w-4 h-4" /> Send Review
            </ActionBtn>
            {canShowPaymentFlows && (
              <ActionBtn colorClass="text-pink-500 hover:bg-pink-500/10" onClick={() => onSendTipLink(booking)} disabled={sendingTipRequest === booking.id || !booking.customer?.phone || booking.status !== 'completed'}>
                <Heart className="w-4 h-4" /> Send Tip Link
              </ActionBtn>
            )}
            {canShowPaymentFlows && (
              <ActionBtn
                variant="pill"
                colorClass="bg-purple-500 hover:bg-purple-600"
                onClick={() => onSendDepositLink(booking)}
                disabled={!booking.customer?.phone}
              >
                <Banknote className="w-4 h-4" /> Send Deposit Link
              </ActionBtn>
            )}
          </ActionSection>

          {/* Staff Section */}
          <ActionSection label="Staff" sectionKey="staff" isOpen={!!openSections['staff']} onToggle={onToggleSection} iconColor="text-indigo-400">
            <ActionBtn colorClass="text-teal-500 hover:bg-teal-500/10" onClick={() => onAssignCleaner(booking)}>
              <UserPlus className="w-4 h-4" /> Assign Cleaner
            </ActionBtn>
          </ActionSection>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
