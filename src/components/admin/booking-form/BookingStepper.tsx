import { useState, useEffect } from 'react';
import { computeExpectedPay } from '@/lib/cleanerPay';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { 
  ChevronLeft, 
  ChevronRight, 
  User, 
  MapPin, 
  FileText, 
  Calendar, 
  CreditCard,
  Loader2,
  Save,
  Copy,
  MessageSquare,
  Check,
  Sparkles,
  AlertCircle,
  Menu as MenuIcon,
  Users,
  Mail
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { handleSmsError } from '@/lib/smsErrorHandler';
import { Sentry } from '@/lib/sentry';
import { toast } from 'sonner';
import { format, addWeeks, addMonths, isAfter } from 'date-fns';
import { supabase } from '@/lib/supabase';
import { formatFullAddress } from '@/lib/formatAddress';
import { useOrgId } from '@/hooks/useOrgId';
import { useOrgTimezone } from '@/hooks/useOrgTimezone';
import { selectedDateTimeToUTCISO, getTimeInTimezone, formatInTimezone, formatTimestampWithZone } from '@/lib/timezoneUtils';
import { orgAddDaysPreservingTime } from '@/lib/orgDateRange';
import { useCreateBooking, useUpdateBooking, useCreateCustomer, BookingWithDetails, useBookings } from '@/hooks/useBookings';
import { extras as extrasData } from '@/data/pricingData';
import { useBookingForm } from './BookingFormContext';
import { useSchedulingMode } from '@/hooks/useSchedulingMode';
import { CustomerStep } from './steps/CustomerStep';
import { PropertyStep } from './steps/PropertyStep';
import { ServiceStep } from './steps/ServiceStep';
import { ScheduleStep } from './steps/ScheduleStep';
import { PaymentStep } from './steps/PaymentStep';
import { useCleanerConflicts } from '@/hooks/useCleanerConflicts';
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
  horizontalListSortingStrategy,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { fmt } from '@/lib/activeCurrency';

const DEFAULT_STEPS = [
  { id: 'customer', label: 'Customer', icon: User },
  { id: 'property', label: 'Property', icon: MapPin },
  { id: 'service', label: 'Service', icon: FileText },
  { id: 'schedule', label: 'Schedule', icon: Calendar },
  { id: 'payment', label: 'Payment', icon: CreditCard },
];

const iconMap: Record<string, typeof User> = {
  User, MapPin, FileText, Calendar, CreditCard
};

interface StepItem {
  id: string;
  label: string;
  icon: typeof User;
}

interface SortableStepProps {
  step: StepItem;
  index: number;
  currentStep: number;
  totalSteps: number;
  onClick: () => void;
}

function SortableStep({ step, index, currentStep, totalSteps, onClick }: SortableStepProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: step.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const Icon = step.icon;
  const isActive = index === currentStep;
  const isCompleted = index < currentStep;

  return (
    <div ref={setNodeRef} style={style} className="flex items-center">
      <div className="flex items-center group">
        <button
          {...attributes}
          {...listeners}
          aria-label={`Reorder ${step.label}`}
          className={cn(
            "p-1 cursor-grab active:cursor-grabbing text-muted-foreground/70 hover:text-foreground transition-colors",
            isDragging && "text-foreground"
          )}
        >
          <MenuIcon className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={onClick}
          className={cn(
            "flex items-center gap-2 px-3 py-2 rounded-xl transition-all duration-200",
            isActive && "bg-primary text-primary-foreground shadow-lg",
            isCompleted && "bg-primary/10 text-primary",
            !isActive && !isCompleted && "text-muted-foreground hover:bg-secondary/50"
          )}
        >
          <div className={cn(
            "w-8 h-8 rounded-full flex items-center justify-center transition-all",
            isActive && "bg-primary-foreground/20",
            isCompleted && "bg-primary text-primary-foreground",
            !isActive && !isCompleted && "bg-secondary"
          )}>
            {isCompleted ? (
              <Check className="w-4 h-4" />
            ) : (
              <Icon className="w-4 h-4" />
            )}
          </div>
          <span className="hidden md:block text-sm font-medium">{step.label}</span>
        </button>
      </div>
      {index < totalSteps - 1 && (
        <div className={cn(
          "w-8 lg:w-12 h-0.5 mx-1",
          index < currentStep ? "bg-primary" : "bg-border"
        )} />
      )}
    </div>
  );
}

interface BookingStepperProps {
  booking?: BookingWithDetails | null;
  onClose: () => void;
  onDuplicate?: (booking: BookingWithDetails) => void;
}

export function BookingStepper({ booking, onClose, onDuplicate }: BookingStepperProps) {
  const [currentStep, setCurrentStep] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);
  const [sendingQuoteSms, setSendingQuoteSms] = useState(false);
  const [sendingConfirmationEmail, setSendingConfirmationEmail] = useState(false);
  const [sendingQuoteEmail, setSendingQuoteEmail] = useState(false);
  const [steps, setSteps] = useState<StepItem[]>(DEFAULT_STEPS);
  const [showRecurringDialog, setShowRecurringDialog] = useState(false);
  const [pendingBookingData, setPendingBookingData] = useState<any>(null);
  const [applyToFuture, setApplyToFuture] = useState(false);
  
  // Get all bookings to check for future recurring bookings
  const { data: allBookings = [] } = useBookings();
  const { timezone: orgTimezone } = useOrgTimezone();

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

  // Load step order from localStorage
  useEffect(() => {
    const savedOrder = localStorage.getItem('tidywise_booking_steps_order');
    if (savedOrder) {
      try {
        const stepIds: string[] = JSON.parse(savedOrder);
        const reordered = stepIds
          .map(id => DEFAULT_STEPS.find(s => s.id === id))
          .filter((s): s is StepItem => s !== undefined);
        
        // Add any missing steps
        DEFAULT_STEPS.forEach(step => {
          if (!reordered.find(r => r.id === step.id)) {
            reordered.push(step);
          }
        });
        
        setSteps(reordered);
      } catch (e) {
        console.error('Error parsing step order:', e);
      }
    }
  }, []);

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    if (over && active.id !== over.id) {
      setSteps((items) => {
        const oldIndex = items.findIndex(item => item.id === active.id);
        const newIndex = items.findIndex(item => item.id === over.id);
        const newOrder = arrayMove(items, oldIndex, newIndex);
        
        // Save to localStorage
        localStorage.setItem('tidywise_booking_steps_order', JSON.stringify(newOrder.map(s => s.id)));
        
        return newOrder;
      });
    }
  };

  const { organizationId } = useOrgId();
  const { data: schedulingConfig } = useSchedulingMode(organizationId);

  const createBooking = useCreateBooking();
  const updateBooking = useUpdateBooking();
  const createCustomer = useCreateCustomer();

  const {
    customerTab,
    setCustomerTab,
    selectedCustomerId,
    setSelectedCustomerId,
    newCustomer,
    address,
    aptSuite,
    city,
    state,
    zipCode,
    latitude,
    longitude,
    selectedServiceId,
    squareFootage,
    bedrooms,
    bathrooms,
    frequency,
    customFrequencyDays,
    recurringDaysOfWeek,
    selectedExtras,
    selectedDate,
    selectedTime,
    selectedStaffId,
    isTeamMode,
    selectedTeamMembers,
    teamMemberPay,
    notes,
    totalAmount,
    cleanerWage,
    cleanerWageType,
    cleanerOverrideHours,
    sendConfirmationEmail,
    setSendConfirmationEmail,
    sendConfirmationSms,
    setSendConfirmationSms,
    sendQuoteSms,
    setSendQuoteSms,
    sendQuoteEmail,
    setSendQuoteEmail,
    selectedService,
    selectedCustomer,
    customerEmail,
    customerName,
    extrasTotal,
    calculatedPrice,
    finalPrice,
    appliedDiscount,
    resetForm,
    staff,
    conflictOverride,
    selectedChecklistId,
    pricingError,
  } = useBookingForm();

  // Get customer phone for quote SMS
  const customerPhone = customerTab === 'existing' && selectedCustomer 
    ? selectedCustomer.phone 
    : newCustomer.phone;

  // Conflict detection for validation
  const { checkConflictsForStaff } = useCleanerConflicts(
    selectedDate,
    selectedTime,
    selectedService?.duration || 120,
    booking?.id
  );

  // Check if there are unresolved conflicts
  const hasUnresolvedConflicts = () => {
    if (conflictOverride) return false;
    
    if (isTeamMode && selectedTeamMembers.length > 0) {
      return selectedTeamMembers.some(staffId => {
        const conflicts = checkConflictsForStaff(staffId);
        return conflicts.length > 0;
      });
    } else if (selectedStaffId) {
      const conflicts = checkConflictsForStaff(selectedStaffId);
      return conflicts.length > 0;
    }
    
    return false;
  };

  // Send quote SMS handler - also creates a quote record.
  //
  // `resolvedCustomerId` is the id the caller has ALREADY created or selected.
  // executeSubmit passes it because buildBookingData ran first in the same
  // submit and may have just created this customer; a setState there cannot be
  // seen from this closure, so without the hand-off this function would create
  // the same person a second time and attach the quote to the duplicate.
  const handleSendQuoteSms = async (resolvedCustomerId?: string) => {
    if (!customerPhone) {
      toast.error('Customer phone number is required to send a quote');
      return;
    }
    
    const quoteAmount = totalAmount > 0 ? totalAmount : calculatedPrice;
    if (quoteAmount <= 0) {
      toast.error('Please configure service and pricing first');
      return;
    }

    setSendingQuoteSms(true);
    try {
      // First, ensure we have a customer ID (create new customer if needed).
      // A caller-supplied id short-circuits this entirely — see the note above.
      let customerId = resolvedCustomerId || selectedCustomerId;
      if (!customerId && customerTab === 'new' && newCustomer.first_name && newCustomer.last_name && newCustomer.email) {
        const customer = await createCustomer.mutateAsync(newCustomer);
        customerId = customer.id;
        setSelectedCustomerId(customer.id);
        setCustomerTab('existing');
      }

      // Send the SMS FIRST, and only record the quote as 'sent' once it has
      // actually gone out.
      //
      // This used to be the other way round: the row was inserted with
      // status 'sent' and the SMS attempted afterwards. A failed send left a
      // quote permanently claiming it had been sent, with no way to tell it
      // apart from a real one — the customer never got a price and the org
      // had no reason to look. handleSmsError() also catches edge functions
      // that return 200 with `success: false`, so that path silently produced
      // the same lie.
      //
      // Matches the ordering the two invoice send paths already use
      // (InvoicesPage.tsx sendInvoiceEmail, InvoiceViewDialog.tsx
      // handleSendEmail): invoke, bail on error, then write the status.
      const message = `Hi ${customerName}! Here's your quote for ${selectedService?.name || 'cleaning services'}:\n\n` +
        `📍 Address: ${formatFullAddress({ address, apt_suite: aptSuite, city })}\n` +
        `💰 Total: ${fmt(quoteAmount)}\n\n` +
        `This quote is valid for 7 days. Reply YES to confirm or call us with any questions!`;

      const response = await supabase.functions.invoke('send-openphone-sms', {
        body: {
          to: customerPhone,
          message,
          organizationId: organizationId ?? undefined,
        },
      });

      // Handle SMS-specific errors. handleSmsError has already shown a toast
      // naming the cause, so return without recording anything.
      if ((await handleSmsError(response))) {
        return;
      }

      // The customer has the quote. Now record it.
      // A DURATION from now, not a calendar boundary — "valid for 7 days" is
      // 7 days of elapsed time, and the stored value is a timestamp. No org
      // calendar is involved.
      const validUntil = new Date();
      /* eslint-disable-next-line local/no-device-local-dates -- ditto */
      validUntil.setDate(validUntil.getDate() + 7); // Valid for 7 days

      const { error: quoteError } = await supabase.from('quotes').insert({
        organization_id: organizationId,
        customer_id: customerId || null,
        service_id: selectedServiceId === 'reclean' ? null : selectedServiceId || null,
        address: address || null,
        city: city || null,
        state: state || null,
        zip_code: zipCode || null,
        bedrooms: bedrooms || null,
        bathrooms: bathrooms || null,
        square_footage: squareFootage || null,
        extras: selectedExtras || [],
        subtotal: quoteAmount,
        total_amount: quoteAmount,
        status: 'sent',
        valid_until: validUntil.toISOString(),
        notes: notes || null,
      });

      if (quoteError) {
        // Reordering moves the failure window rather than removing it: the SMS
        // is already delivered and cannot be recalled, so this must NOT rethrow
        // into the generic "Failed to send quote via SMS" handler below — that
        // would tell the owner the opposite of what happened and invite a
        // duplicate send to the same customer.
        console.error('Quote SMS sent but saving the quote failed:', quoteError);
        Sentry.captureException(quoteError, {
          tags: { area: 'quotes', phase: 'post-send-insert' },
          extra: { organizationId, customerId, quoteAmount },
        });
        toast.error(
          `Quote texted to ${customerName}, but saving it failed. It won't appear in Quotes. ` +
            `Don't resend; create it manually. (${quoteError.message})`,
          { duration: 12000 },
        );
        return;
      }

      toast.success('Quote saved and sent via SMS!');
    } catch (error: any) {
      console.error('Quote SMS error:', error);
      toast.error(error.message || 'Failed to send quote via SMS');
    } finally {
      setSendingQuoteSms(false);
    }
  };

  // Send confirmation email handler
  const handleSendConfirmationEmail = async () => {
    const email = customerTab === 'existing' && selectedCustomer ? selectedCustomer.email : newCustomer.email;
    if (!email) {
      toast.error('Customer email is required to send a confirmation email');
      return;
    }
    if (!organizationId) {
      toast.error('Organization context is missing');
      return;
    }

    const quoteAmount = totalAmount > 0 ? totalAmount : calculatedPrice;
    
    setSendingConfirmationEmail(true);
    try {
      /*
        WALL-CLOCK CARRIER. selectedDate is a picker token and selectedTime is
        the org's wall time, so building and formatting in the same zone cancels
        out: the strings below read "9:00 AM" on the picked day whatever zone
        the admin is in. The booking ITSELF is stored via
        selectedDateTimeToUTCISO(..., orgTimezone) — this only renders text.
      */
      /* eslint-disable local/no-device-local-dates -- wall-clock carrier, see above */
      const scheduledDate = new Date(selectedDate!);
      const [hours, minutes] = selectedTime.split(':').map(Number);
      scheduledDate.setHours(hours, minutes, 0, 0);
      /* eslint-enable local/no-device-local-dates */

      const { error } = await supabase.functions.invoke('send-booking-email', {
        body: {
          customerName,
          customerEmail: email,
          customerPhone: customerPhone || '',
          serviceName: selectedService?.name || 'Cleaning Service',
          homeSize: `${bedrooms || '?'} bed / ${bathrooms || '?'} bath`,
          appointmentDate: format(scheduledDate, 'MMMM d, yyyy'),
          appointmentTime: formatTimestampWithZone(selectedDateTimeToUTCISO(selectedDate!, selectedTime, orgTimezone), orgTimezone),
          address: address || '',
          aptSuite: aptSuite || '',
          city: city || '',
          state: state || '',
          zipCode: zipCode || '',
          extras: selectedExtras || [],
          totalPrice: quoteAmount,
          confirmationNumber: `BK-${Date.now().toString(36).toUpperCase()}`,
          organizationId,
        },
      });

      if (error) {
        // Try to read the actual error body from edge function
        let errorMsg = error?.message || 'Failed to send confirmation email';
        try {
          if (error?.context?.body) {
            const body = await error.context.json();
            errorMsg = body?.error || errorMsg;
          }
        } catch {}
        console.error('Confirmation email error:', errorMsg);
        if (errorMsg.includes('not verified') || errorMsg.includes('not configured')) {
          toast.error('Email domain not verified. Go to Settings → Email to set up your email domain.');
        } else {
          toast.error(errorMsg);
        }
        return;
      }
      toast.success('Confirmation email sent to customer');
    } catch (error: any) {
      console.error('Confirmation email error:', error);
      toast.error('Failed to send confirmation email');
    } finally {
      setSendingConfirmationEmail(false);
    }
  };

  // Send quote email handler
  const handleSendQuoteEmail = async () => {
    const email = customerTab === 'existing' && selectedCustomer ? selectedCustomer.email : newCustomer.email;
    if (!email) {
      toast.error('Customer email is required to send a quote email');
      return;
    }
    if (!organizationId) {
      toast.error('Organization context is missing');
      return;
    }

    const quoteAmount = totalAmount > 0 ? totalAmount : calculatedPrice;
    if (quoteAmount <= 0) {
      toast.error('Please configure service and pricing first');
      return;
    }

    setSendingQuoteEmail(true);
    try {
      const fullAddr = [address, city, state, zipCode].filter(Boolean).join(', ');
      const extrasTextList = selectedExtras && selectedExtras.length > 0 ? selectedExtras.join(', ') : 'None';

      const quoteHtml = `
        <h2>Your Cleaning Quote</h2>
        <p>Hi ${customerName},</p>
        <p>Thank you for your interest! Here's your personalized quote:</p>
        <table style="width:100%;border-collapse:collapse;margin:20px 0;">
          <tr><td style="padding:8px;border-bottom:1px solid #eee;color:#666;">Service</td><td style="padding:8px;border-bottom:1px solid #eee;font-weight:600;">${selectedService?.name || 'Cleaning Service'}</td></tr>
          ${fullAddr ? `<tr><td style="padding:8px;border-bottom:1px solid #eee;color:#666;">Address</td><td style="padding:8px;border-bottom:1px solid #eee;font-weight:600;">${fullAddr}</td></tr>` : ''}
          <tr><td style="padding:8px;border-bottom:1px solid #eee;color:#666;">Home Size</td><td style="padding:8px;border-bottom:1px solid #eee;font-weight:600;">${bedrooms || '?'} bed / ${bathrooms || '?'} bath</td></tr>
          <tr><td style="padding:8px;border-bottom:1px solid #eee;color:#666;">Extras</td><td style="padding:8px;border-bottom:1px solid #eee;font-weight:600;">${extrasTextList}</td></tr>
          <tr><td style="padding:8px;color:#666;">Estimated Total</td><td style="padding:8px;font-weight:bold;font-size:18px;color:#22c55e;">${fmt(quoteAmount)}</td></tr>
        </table>
        <p>This quote is valid for 7 days. Reply to this email to confirm your booking or if you have any questions!</p>
      `;

      const { error } = await supabase.functions.invoke('send-direct-email', {
        body: {
          organizationId,
          to: email,
          subject: `Your Cleaning Quote - ${fmt(quoteAmount)}`,
          body: quoteHtml,
        },
      });

      if (error) throw error;
      toast.success('Quote email sent to customer');
    } catch (error: any) {
      console.error('Quote email error:', error);
      const msg = error?.message || '';
      if (msg.includes('Email settings not configured') || msg.includes('not verified') || msg.includes('No Resend API key')) {
        toast.error('Email not configured. Go to Settings → Email to set up your email domain.');
      } else {
        toast.error(msg || 'Failed to send quote email');
      }
    } finally {
      setSendingQuoteEmail(false);
    }
  };

  const validateStep = (stepId: string): boolean => {
    switch (stepId) {
      case 'customer':
        if (customerTab === 'existing' && !selectedCustomerId) {
          toast.error('Please select a customer');
          return false;
        }
        if (customerTab === 'new' && (!newCustomer.first_name || !newCustomer.last_name || !newCustomer.email)) {
          toast.error('Please fill in customer name and email');
          return false;
        }
        return true;
      case 'property':
        return true;
      case 'service':
        if (!selectedServiceId) {
          toast.error('Please select a service');
          return false;
        }
        return true;
      case 'schedule':
        if (!selectedDate || !selectedTime) {
          toast.error('Please select a date and time');
          return false;
        }
        // Check for conflicts
        if (hasUnresolvedConflicts()) {
          toast.error('Please resolve the scheduling conflict or check the override box');
          return false;
        }
        return true;
      case 'payment':
        return true;
      default:
        return true;
    }
  };

  const handleNext = () => {
    if (validateStep(steps[currentStep].id)) {
      setCurrentStep(prev => Math.min(prev + 1, steps.length - 1));
    }
  };

  const handleBack = () => {
    setCurrentStep(prev => Math.max(prev - 1, 0));
  };

  const goToStep = (stepIndex: number) => {
    if (stepIndex < currentStep || validateStep(steps[currentStep].id)) {
      setCurrentStep(stepIndex);
    }
  };

  const buildBookingData = async (isDraft: boolean) => {
    let customerId = selectedCustomerId;

    if (customerTab === 'new') {
      // Merge property address into new customer if customer address fields are empty
      const customerData = { ...newCustomer };
      if (!customerData.address && address) customerData.address = address;
      if (!customerData.city && city) customerData.city = city;
      if (!customerData.state && state) customerData.state = state;
      if (!customerData.zip_code && zipCode) customerData.zip_code = zipCode;
      const customer = await createCustomer.mutateAsync(customerData);
      customerId = customer.id;
      // Write the new id back into form state so nothing creates this person
      // a SECOND time. Without it, selectedCustomerId stays empty and
      // customerTab stays 'new', so handleSendQuoteSms's own create-if-new
      // branch runs again later in this very same submit.
      //
      // This alone does NOT fix the same-submit case — handleSendQuoteSms
      // reads customerTab/selectedCustomerId from its render closure, which a
      // setState cannot update mid-flow. The explicit hand-off in
      // executeSubmit covers that. What this DOES fix is the retry: when a
      // submit fails partway and the admin presses save again on the still-open
      // dialog, the form is now pointing at the customer that already exists.
      setSelectedCustomerId(customer.id);
      setCustomerTab('existing');
    }

    // Sync property address back to existing customer record so it shows in Customers tab
    if (customerTab === 'existing' && customerId && address && organizationId) {
      await supabase
        .from('customers')
        .update({
          address: address || null,
          city: city || null,
          state: state || null,
          zip_code: zipCode || null,
          // Only overwrite when autocomplete actually resolved coordinates —
          // a hand-typed address must not blank out good ones.
          ...(latitude != null && longitude != null
            ? { latitude, longitude }
            : {}),
        })
        .eq('id', customerId)
        .eq('organization_id', organizationId);
    }

    // Convert selected date+time to UTC using the org timezone
    // This ensures "9:00 AM" means 9:00 AM in the org's timezone (e.g. EST),
    // not the browser's local timezone (e.g. PHT)
    const scheduledAtISO = selectedDateTimeToUTCISO(selectedDate!, selectedTime, orgTimezone);

    // Handle "reclean" special case - it's not a real service UUID
    const isReclean = selectedServiceId === 'reclean';

    // If org is in arrival-window mode, find the window matching selectedTime and persist bounds
    const matchedWindow = schedulingConfig?.mode === 'arrival_window'
      ? (schedulingConfig.windows || []).find((w) => w.enabled && w.start_time === selectedTime)
      : undefined;

    // NOTE: the coupon redemption itself (incrementing discounts.current_uses)
    // is NOT reserved here — buildBookingData() also runs as a preview step
    // for the "apply to future recurring bookings?" dialog, which the user
    // can cancel without ever actually saving. Reserving a redemption here
    // would burn it even when nothing gets saved. It's reserved in
    // executeSubmit() instead, immediately before the booking is actually
    // committed.
    return {
      customer_id: customerId || null,
      service_id: isReclean ? null : (selectedServiceId && selectedServiceId.length > 0 ? selectedServiceId : null),
      staff_id: selectedStaffId && selectedStaffId.length > 0 ? selectedStaffId : null,
      scheduled_at: scheduledAtISO,
      is_arrival_window: !!matchedWindow,
      arrival_window_start: matchedWindow?.start_time ?? null,
      arrival_window_end: matchedWindow?.end_time ?? null,
      duration: selectedService?.duration || 60,
      total_amount: finalPrice,
      discount_id: appliedDiscount?.id ?? null,
      discount_amount: appliedDiscount?.discountAmount ?? 0,
      status: isDraft ? 'pending' as const : 'confirmed' as const,
      payment_status: 'pending' as const,
      notes: notes || null,
      address: address || null,
      apt_suite: aptSuite || null,
      city: city || null,
      state: state || null,
      zip_code: zipCode || null,
      latitude,
      longitude,
      frequency: frequency,
      custom_frequency_days: customFrequencyDays,
      recurring_days_of_week: frequency === 'custom' ? (recurringDaysOfWeek || null) : null,
      bedrooms: bedrooms,
      bathrooms: bathrooms,
      square_footage: squareFootage || null,
      extras: selectedExtras,
      is_draft: isDraft,
      cleaner_wage: cleanerWage ? parseFloat(cleanerWage) : null,
      cleaner_wage_type: cleanerWageType,
      cleaner_override_hours: cleanerOverrideHours ? parseFloat(cleanerOverrideHours) : null,
      // Compute and persist cleaner_pay_expected — SINGLE SOURCE OF TRUTH for payroll
      cleaner_pay_expected: computeExpectedPay(
        cleanerWageType,
        cleanerWage,
        cleanerOverrideHours,
        selectedService?.duration || 60,
        finalPrice > 0 ? finalPrice : (totalAmount > 0 ? totalAmount : calculatedPrice),
      ),
    };
  };

  const createRecurringBookings = async (baseBookingData: any) => {
    if (frequency === 'one_time') return;

    const bookingsToCreate: any[] = [];
    const baseDate = new Date(baseBookingData.scheduled_at);
    const numBookings = 3;

    // A coupon is a one-time redemption applied (and counted against
    // max_uses) for the first booking only — baseBookingData carries the
    // discounted total_amount/discount_id/discount_amount, but these
    // auto-generated future occurrences must NOT inherit it, or one
    // coupon use would silently discount 4 bookings instead of 1.
    const undiscountedTotal = totalAmount > 0 ? totalAmount : calculatedPrice;

    // cleaner_pay_expected for a percentage-wage cleaner is a % of the
    // price actually charged — baseBookingData's value was computed off
    // the first booking's (possibly discounted) finalPrice, so it must
    // be recomputed here against the undiscounted total for these
    // occurrences, or a percentage-wage cleaner would be quietly
    // underpaid on every future occurrence. Flat/hourly wages don't
    // depend on price, so recomputing is a no-op for those types.
    const undiscountedCleanerPayExpected = computeExpectedPay(
      cleanerWageType,
      cleanerWage,
      cleanerOverrideHours,
      selectedService?.duration || 60,
      undiscountedTotal,
    );

    const weekdayMap: Record<string, number> = {
      Sun: 0,
      Mon: 1,
      Tue: 2,
      Wed: 3,
      Thu: 4,
      Fri: 5,
      Sat: 6,
    };

    const selectedWeekdays = (recurringDaysOfWeek || [])
      .filter((d) => Number.isInteger(d) && d >= 0 && d <= 6)
      .sort((a, b) => a - b);

    if (frequency === 'custom' && selectedWeekdays.length > 0) {
      let cursor = new Date(baseDate);
      let safetyCounter = 0;

      while (bookingsToCreate.length < numBookings && safetyCounter < 120) {
        // setDate(+1) added a fixed 24 hours to a real instant. The weekday is
        // then read in the ORG's zone, so across the org's DST transition a
        // recurring 9am job became 10am (or 8am) for the rest of the series —
        // and every booking created from this cursor carries that drift.
        cursor = orgAddDaysPreservingTime(cursor, 1, orgTimezone);
        safetyCounter += 1;

        const weekdayLabel = formatInTimezone(cursor, orgTimezone, { weekday: 'short' });
        const weekdayIndex = weekdayMap[weekdayLabel as keyof typeof weekdayMap];

        if (weekdayIndex !== undefined && selectedWeekdays.includes(weekdayIndex)) {
          bookingsToCreate.push({
            ...baseBookingData,
            scheduled_at: cursor.toISOString(),
            payment_intent_id: null,
            total_amount: undiscountedTotal,
            discount_id: null,
            discount_amount: 0,
            cleaner_pay_expected: undiscountedCleanerPayExpected,
          });
        }
      }
    } else {
      for (let i = 1; i <= numBookings; i++) {
        let nextDate: Date;
        if (frequency === 'custom' && customFrequencyDays) {
          // Same as the custom-weekday branch: a fixed N x 24h drifts the
          // series' time of day across the org's DST transition.
          nextDate = orgAddDaysPreservingTime(baseDate, customFrequencyDays * i, orgTimezone);
        } else if (frequency === 'weekly') {
          nextDate = addWeeks(baseDate, i);
        } else if (frequency === 'biweekly') {
          nextDate = addWeeks(baseDate, i * 2);
        } else {
          nextDate = addMonths(baseDate, i);
        }

        bookingsToCreate.push({
          ...baseBookingData,
          scheduled_at: nextDate.toISOString(),
          payment_intent_id: null,
          total_amount: undiscountedTotal,
          discount_id: null,
          discount_amount: 0,
          cleaner_pay_expected: undiscountedCleanerPayExpected,
        });
      }
    }

    for (const bookingData of bookingsToCreate) {
      await createBooking.mutateAsync(bookingData);
    }
  };

  // Check if this customer has future bookings that could be affected by changes
  const getFutureBookingsForCustomer = () => {
    if (!booking?.customer?.id) return [];
    const now = new Date();
    return allBookings.filter(b => 
      b.customer?.id === booking.customer?.id &&
      b.id !== booking.id &&
      isAfter(new Date(b.scheduled_at), now) &&
      !['cancelled', 'completed'].includes(b.status)
    );
  };

  // Detect what fields changed between original booking and current form state
  const getChangedFields = () => {
    if (!booking) return [];
    
    const changes: { field: string; oldValue: string; newValue: string; key: string }[] = [];
    
    // Staff change
    const oldStaffId = booking.staff?.id || '';
    if (selectedStaffId !== oldStaffId) {
      changes.push({
        field: 'Staff',
        oldValue: booking.staff?.name || 'Unassigned',
        newValue: staff?.find(s => s.id === selectedStaffId)?.name || 'Unassigned',
        key: 'staff_id'
      });
    }
    
    // Price change — compare against finalPrice (what will actually be
    // saved, post-discount), not raw totalAmount, so this doesn't
    // spuriously flag a "change" purely because booking.total_amount is
    // now correctly discounted while totalAmount never was.
    if (finalPrice !== booking.total_amount) {
      changes.push({
        field: 'Price',
        oldValue: `$${booking.total_amount?.toFixed(2) || '0.00'}`,
        newValue: `${fmt(finalPrice)}`,
        key: 'total_amount'
      });
    }
    
    // Time change (compare just the time portion in org timezone)
    const oldTimeStr = getTimeInTimezone(booking.scheduled_at, orgTimezone);
    if (selectedTime !== oldTimeStr) {
      const [newH, newM] = selectedTime.split(':').map(Number);
      const newPeriod = newH >= 12 ? 'PM' : 'AM';
      const newDisplayH = newH === 0 ? 12 : newH > 12 ? newH - 12 : newH;
      const [oldH, oldM] = oldTimeStr.split(':').map(Number);
      const oldPeriod = oldH >= 12 ? 'PM' : 'AM';
      const oldDisplayH = oldH === 0 ? 12 : oldH > 12 ? oldH - 12 : oldH;
      
      changes.push({
        field: 'Time',
        oldValue: `${oldDisplayH}:${oldM.toString().padStart(2, '0')} ${oldPeriod}`,
        newValue: `${newDisplayH}:${newM.toString().padStart(2, '0')} ${newPeriod}`,
        key: 'scheduled_time'
      });
    }
    
    // Service change
    const isReclean = selectedServiceId === 'reclean';
    const oldServiceId = booking.service?.id || '';
    if (!isReclean && selectedServiceId !== oldServiceId) {
      changes.push({
        field: 'Service',
        oldValue: booking.service?.name || 'None',
        newValue: selectedService?.name || 'None',
        key: 'service_id'
      });
    }
    
    return changes;
  };

  const handleSubmit = async (isDraft: boolean = false, skipRecurringCheck: boolean = false) => {
    // Final validation - validate all steps
    for (let i = 0; i < steps.length; i++) {
      if (!validateStep(steps[i].id) && !isDraft) {
        setCurrentStep(i);
        return;
      }
    }

    // Check if we're editing an existing booking and important fields changed
    // Empty string id means duplicate - treat as new booking
    const isExistingBooking = booking?.id && booking.id.length > 10;
    if (isExistingBooking && !skipRecurringCheck) {
      const changedFields = getChangedFields();
      const futureBookings = getFutureBookingsForCustomer();
      
      if (changedFields.length > 0 && futureBookings.length > 0) {
        const bookingData = await buildBookingData(isDraft);
        setPendingBookingData({ bookingData, isDraft, futureBookings, changedFields });
        setShowRecurringDialog(true);
        return;
      }
    }

    await executeSubmit(isDraft);
  };

  const executeSubmit = async (isDraft: boolean = false, updateFutureBookings: boolean = false) => {
    if (isDraft) {
      setSavingDraft(true);
    } else {
      setSubmitting(true);
    }

    try {
      const bookingData = pendingBookingData?.bookingData || await buildBookingData(isDraft);
      let persistedBookingId: string | undefined = booking?.id;

      // A coupon was previously validated and shown as applied on-screen
      // (the "Grand Total" already reflects it) but was never actually
      // persisted — total_amount was saved undiscounted, so "Charge Card"
      // later charged the customer the full price regardless. Reserve the
      // redemption atomically server-side (enforces max_uses, race-safe
      // for concurrent bookings) right before actually committing —
      // deliberately not in buildBookingData(), which also runs as a
      // cancellable preview step for the recurring-booking dialog above.
      // Only reserve a redemption when the coupon on this booking is new
      // (either this is a brand-new booking, or the admin swapped in a
      // different coupon while editing). Editing an existing booking that
      // already had this same coupon must NOT re-burn a use.
      const previousDiscountId = (booking as unknown as { discount_id?: string | null })?.discount_id ?? null;
      const isNewCouponReservation =
        bookingData.discount_id &&
        bookingData.discount_id !== previousDiscountId;
      if (isNewCouponReservation) {
        const { data: reserved, error: couponErr } = await supabase.rpc('increment_coupon_use', {
          p_discount_id: bookingData.discount_id,
        });
        if (couponErr || !reserved) {
          throw new Error(
            `This coupon is no longer valid (it may have just reached its usage limit). ` +
            `Remove it or try a different code, then save again.`
          );
        }
      }

      // Check for valid UUID - empty string means this is a duplicate (new booking)
      const isExistingBooking = booking?.id && booking.id.length > 10;

      if (isExistingBooking) {
        await updateBooking.mutateAsync({ id: booking.id, ...bookingData });
        persistedBookingId = booking.id;

        // ALWAYS sync team assignments on update to prevent stale/duplicate entries
        // Delete all existing team assignments for this booking first.
        // If this delete fails, we must NOT proceed to re-insert below —
        // doing so would leave the old pay-share rows in place alongside
        // the new ones, double-paying whoever was already assigned.
        const { error: teamAssignmentsDeleteError } = await supabase
          .from('booking_team_assignments')
          .delete()
          .eq('booking_id', booking.id);
        if (teamAssignmentsDeleteError) {
          throw new Error(
            `Could not update pay assignments for this booking (${teamAssignmentsDeleteError.message}). ` +
            `Booking details were saved, but pay-share was NOT changed. Please retry to avoid double-paying staff.`
          );
        }

        // Re-insert based on current form state
        if (isTeamMode && selectedTeamMembers.length > 1) {
          // Multiple staff → team mode assignments
          let teamPayTotal = 0;
          for (let i = 0; i < selectedTeamMembers.length; i++) {
            const staffId = selectedTeamMembers[i];
            let payShare = teamMemberPay[staffId] ?? 0;
            teamPayTotal += Number(payShare) || 0;
            const { error: teamAssignmentInsertError } = await supabase.from('booking_team_assignments').insert({
              booking_id: booking.id,
              staff_id: staffId,
              pay_share: payShare,
              is_primary: i === 0,
              organization_id: organizationId,
            });
            if (teamAssignmentInsertError) {
              throw new Error(
                `Pay assignment failed to save for one staff member (${teamAssignmentInsertError.message}). ` +
                `Please retry. Old assignments were already cleared.`
              );
            }
          }
          // The booking-level snapshot must equal the TEAM total, not the
          // single-cleaner wage figure — otherwise every surface that falls
          // back to cleaner_pay_expected shows one cleaner's pay for the
          // whole job (e.g. a $350 two-person job reading as $250).
          if (teamPayTotal > 0) {
            await supabase
              .from('bookings')
              .update({ cleaner_pay_expected: teamPayTotal })
              .eq('id', booking.id);
          }
        } else if (bookingData.staff_id) {

          // Single staff → one primary assignment.
          // pay_share must be the computed dollar total — reuse the value
          // already computed for cleaner_pay_expected, not the raw wage
          // (which is a rate/percent for hourly/percentage types). Null when
          // no wage → cleaner_actual_payment / the fallback stays source of truth.
          const { error: singleAssignmentInsertError } = await supabase.from('booking_team_assignments').insert({
            booking_id: booking.id,
            staff_id: bookingData.staff_id,
            pay_share: bookingData.cleaner_pay_expected,
            is_primary: true,
            organization_id: organizationId,
          });
          if (singleAssignmentInsertError) {
            throw new Error(
              `Pay assignment failed to save (${singleAssignmentInsertError.message}). ` +
              `Please retry. Old assignments were already cleared.`
            );
          }
        }

        // Update checklist if a checklist template was selected during edit
        if (selectedChecklistId) {
          try {
            // Check if a checklist already exists for this booking
            const { data: existingChecklist } = await supabase
              .from('booking_checklists')
              .select('id, template_id')
              .eq('booking_id', booking.id)
              .eq('organization_id', organizationId!)
              .order('created_at', { ascending: false })
              .limit(1)
              .maybeSingle();

            // Only update if no checklist exists or template changed
            if (!existingChecklist || existingChecklist.template_id !== selectedChecklistId) {
              // Delete old checklist items and checklist if exists
              if (existingChecklist) {
                await supabase
                  .from('booking_checklist_items')
                  .delete()
                  .eq('booking_checklist_id', existingChecklist.id);
                await supabase
                  .from('booking_checklists')
                  .delete()
                  .eq('id', existingChecklist.id);
              }

              // Create new checklist with selected template
              const { data: newChecklist, error: checklistError } = await supabase
                .from('booking_checklists')
                .insert({
                  booking_id: booking.id,
                  staff_id: bookingData.staff_id || null,
                  template_id: selectedChecklistId,
                  organization_id: organizationId,
                })
                .select()
                .single();

              if (!checklistError && newChecklist) {
                const { data: templateItems } = await supabase
                  .from('checklist_items')
                  .select('id, title, requires_photo, sort_order')
                  .eq('template_id', selectedChecklistId)
                  .order('sort_order');

                if (templateItems && templateItems.length > 0) {
                  await supabase
                    .from('booking_checklist_items')
                    .insert(
                      templateItems.map((item) => ({
                        booking_checklist_id: newChecklist.id,
                        checklist_item_id: item.id,
                        title: item.title,
                        is_completed: false,
                        organization_id: organizationId,
                      }))
                    );
                }
              }
            }
          } catch (checklistErr) {
            console.error('Failed to update checklist:', checklistErr);
          }
        }
        
        // If user chose to apply to future bookings, update those too
        if (updateFutureBookings && pendingBookingData?.futureBookings && pendingBookingData?.changedFields) {
          const futureBookings = pendingBookingData.futureBookings as BookingWithDetails[];
          const changedFields = pendingBookingData.changedFields as { key: string }[];
          
          for (const futureBooking of futureBookings) {
            const updateData: Record<string, any> = { id: futureBooking.id };
            
            for (const change of changedFields) {
              if (change.key === 'staff_id') {
                updateData.staff_id = bookingData.staff_id;
              }
              if (change.key === 'total_amount') {
                updateData.total_amount = bookingData.total_amount;
              }
              if (change.key === 'scheduled_time') {
                // Construct a new scheduled_at using the future booking's date but the new time, in org timezone
                const futureDateStr = formatInTimezone(futureBooking.scheduled_at, orgTimezone, { year: 'numeric', month: '2-digit', day: '2-digit' });
                // Parse MM/DD/YYYY from Intl format
                const dateParts = futureDateStr.split('/');
                const futureDate = new Date(parseInt(dateParts[2]), parseInt(dateParts[0]) - 1, parseInt(dateParts[1]));
                updateData.scheduled_at = selectedDateTimeToUTCISO(futureDate, selectedTime, orgTimezone);
              }
              if (change.key === 'service_id') {
                updateData.service_id = bookingData.service_id;
              }
            }
            
            await updateBooking.mutateAsync(updateData as { id: string } & Partial<typeof bookingData>);
          }
          toast.success(`Booking updated and ${changedFields.length} change(s) applied to ${futureBookings.length} future booking(s)`);
        } else {
          toast.success('Booking updated successfully');
        }
      } else {
        const finalBookingData = {
          ...bookingData,
          payment_status: 'pending' as const,
          payment_intent_id: undefined,
        };

        const newBooking = await createBooking.mutateAsync(finalBookingData);
        persistedBookingId = newBooking?.id;

        // Save team assignments based on mode
        if (newBooking?.id) {
          if (isTeamMode && selectedTeamMembers.length > 1) {
            // Multiple staff → full team mode
            let teamPayTotal = 0;
            for (let i = 0; i < selectedTeamMembers.length; i++) {

              const staffId = selectedTeamMembers[i];
              
              let payShare = teamMemberPay[staffId];
              
              if (payShare === undefined || payShare === 0) {
                const staffMember = staff?.find(s => s.id === staffId);
                const jobTotal = totalAmount > 0 ? totalAmount : calculatedPrice;
                const teamSize = selectedTeamMembers.length;
                const wageToUse = cleanerWage ? parseFloat(cleanerWage) : null;
                
                if (wageToUse) {
                  if (cleanerWageType === 'flat') {
                    payShare = wageToUse / teamSize;
                  } else if (cleanerWageType === 'percentage') {
                    payShare = (jobTotal * wageToUse / 100) / teamSize;
                  } else {
                    payShare = wageToUse * 2;
                  }
                } else if (staffMember?.percentage_rate) {
                  payShare = (jobTotal * staffMember.percentage_rate / 100) / teamSize;
                } else if (staffMember?.hourly_rate) {
                  payShare = staffMember.hourly_rate * 2;
                } else {
                  payShare = 0;
                }
              }

              teamPayTotal += Number(payShare) || 0;

              // Note: unlike the update path above, we don't throw on
              // failure here — the booking row itself was already
              // created, and retrying the whole submit would create a
              // SECOND duplicate booking rather than just retry this
              // insert. Surface it instead so pay tracking gets fixed
              // by hand rather than silently missing.
              const { error: newTeamAssignmentError } = await supabase.from('booking_team_assignments').insert({
                booking_id: newBooking.id,
                staff_id: staffId,
                pay_share: payShare,
                is_primary: i === 0,
                organization_id: organizationId,
              });
              if (newTeamAssignmentError) {
                console.error('Failed to save pay assignment for staff', staffId, newTeamAssignmentError);
                toast.error(`Booking saved, but pay assignment failed for one staff member. Please set it manually.`);
              }
            }
            // Booking-level snapshot must equal the TEAM total (see update path).
            if (teamPayTotal > 0) {
              await supabase
                .from('bookings')
                .update({ cleaner_pay_expected: teamPayTotal })
                .eq('id', newBooking.id);
            }
          } else if (bookingData.staff_id) {

            // Single staff → one primary assignment only.
            // pay_share must be the computed dollar total — reuse the value
            // already computed for cleaner_pay_expected, not the raw wage
            // (which is a rate/percent for hourly/percentage types). Null when
            // no wage → cleaner_actual_payment / the fallback stays source of truth.
            const { error: newSingleAssignmentError } = await supabase.from('booking_team_assignments').insert({
              booking_id: newBooking.id,
              staff_id: bookingData.staff_id,
              pay_share: bookingData.cleaner_pay_expected,
              is_primary: true,
              organization_id: organizationId,
            });
            if (newSingleAssignmentError) {
              console.error('Failed to save pay assignment', newSingleAssignmentError);
              toast.error('Booking saved, but the pay assignment failed to save. Please set it manually.');
            }
          }
        }

        // Create checklist with selected template if one was chosen
        if (selectedChecklistId && newBooking?.id) {
          try {
            // Create the booking checklist linked to the selected template
            const { data: newChecklist, error: checklistError } = await supabase
              .from('booking_checklists')
              .insert({
                booking_id: newBooking.id,
                staff_id: selectedStaffId || null,
                template_id: selectedChecklistId,
                organization_id: organizationId,
              })
              .select()
              .single();

            if (checklistError) throw checklistError;

            // Fetch the template's items
            const { data: templateItems } = await supabase
              .from('checklist_items')
              .select('id, title, requires_photo, sort_order')
              .eq('template_id', selectedChecklistId)
              .order('sort_order');

            if (templateItems && templateItems.length > 0) {
              // Insert checklist items from the template
              await supabase
                .from('booking_checklist_items')
                .insert(
                  templateItems.map((item) => ({
                    booking_checklist_id: newChecklist.id,
                    checklist_item_id: item.id,
                    title: item.title,
                    is_completed: false,
                    organization_id: organizationId,
                  }))
                );
            }
          } catch (checklistErr) {
            console.error('Failed to create checklist:', checklistErr);
            // Don't fail the booking creation, just log the error
          }
        }

        if (!isDraft && frequency !== 'one_time') {
          await createRecurringBookings(finalBookingData);
          const freqLabel = frequency === 'custom'
            ? (recurringDaysOfWeek && recurringDaysOfWeek.length > 0
              ? recurringDaysOfWeek
                  .map((d) => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d])
                  .join('/')
              : customFrequencyDays
                ? `every ${customFrequencyDays} days`
                : 'custom schedule')
            : frequency;
          toast.success(`Booking created with ${freqLabel} recurring schedule`);
        } else {
          toast.success(isDraft ? 'Draft quote saved' : 'Booking created successfully');
        }

        if (!isDraft) {
          supabase.functions.invoke('send-admin-sms-notification', {
            body: {
              customerName,
              serviceName: selectedService?.name,
              scheduledAt: bookingData.scheduled_at,
              totalAmount: totalAmount > 0 ? totalAmount : calculatedPrice,
              address: formatFullAddress({ address, apt_suite: aptSuite, city, state, zip_code: zipCode }) || address,
              organizationId: organizationId ?? undefined,
            }
          }).then(({ error }) => {
            if (error) {
              console.log('Admin SMS notification skipped (SMS may not be configured)');
            }
          }).catch((err) => {
            console.log('Admin SMS notification failed:', err);
          });

          if (sendConfirmationSms) {
            const customerPhone = customerTab === 'existing' && selectedCustomer ? selectedCustomer.phone : newCustomer.phone;
            if (customerPhone) {
              try {
                // Parse 24h time format (HH:mm)
                const [hours, minutes] = selectedTime.split(':').map(Number);

                /* eslint-disable local/no-device-local-dates -- wall-clock carrier, as above */
                const scheduledDate = new Date(selectedDate!);
                scheduledDate.setHours(hours, minutes, 0, 0);
                /* eslint-enable local/no-device-local-dates */

                const formattedDate = format(scheduledDate, 'MMMM d, yyyy');
                const formattedTime = formatTimestampWithZone(selectedDateTimeToUTCISO(selectedDate!, selectedTime, orgTimezone), orgTimezone);
                const serviceName = selectedService?.name || 'cleaning';
                const fullAddress = formatFullAddress({ address, apt_suite: aptSuite, city });

                const confirmationMessage =
                  `Hi ${customerName}! Your ${serviceName} appointment is confirmed for ${formattedDate} at ${formattedTime}.` +
                  `${fullAddress ? ` Address: ${fullAddress}.` : ''}` +
                  ` Reply to this message with any questions!`;

                // Use send-openphone-sms directly so manual confirmation sends are
                // not throttled by the send-booking-reminder cron fan-out pool.
                const response = await supabase.functions.invoke('send-openphone-sms', {
                  body: {
                    to: customerPhone,
                    message: confirmationMessage,
                    organizationId: organizationId ?? undefined,
                  },
                });
                // Handle SMS-specific errors
                if (!(await handleSmsError(response))) {
                  toast.success('Confirmation text sent to customer');
                }
              } catch (smsError: any) {
                console.error('SMS error:', smsError);
                toast.error('Failed to send confirmation text');
              }
            } else {
              toast.warning('No phone number available for SMS');
            }
          }

          // Auto-send confirmation email if checked
          if (sendConfirmationEmail) {
            const customerEmail = customerTab === 'existing' && selectedCustomer ? selectedCustomer.email : newCustomer.email;
            if (customerEmail) {
              try {
                await handleSendConfirmationEmail();
              } catch (emailError: any) {
                console.error('Auto confirmation email error:', emailError);
                toast.error('Failed to send confirmation email');
              }
            } else {
              toast.warning('No email address available for confirmation email');
            }
        }
      }

          // Auto-send quote SMS if checked
          if (sendQuoteSms) {
            if (customerPhone) {
              try {
                await handleSendQuoteSms(bookingData.customer_id ?? undefined);
              } catch (quoteError: any) {
                console.error('Auto quote SMS error:', quoteError);
                toast.error('Failed to send quote SMS');
              }
            } else {
              toast.warning('No phone number available for quote SMS');
            }
          }

          // Auto-send quote email if checked
          if (sendQuoteEmail) {
            const customerEmail = customerTab === 'existing' && selectedCustomer ? selectedCustomer.email : newCustomer.email;
            if (customerEmail) {
              try {
                await handleSendQuoteEmail();
              } catch (quoteError: any) {
                console.error('Auto quote email error:', quoteError);
                toast.error('Failed to send quote email');
              }
            } else {
              toast.warning('No email address available for quote email');
            }
          }
        }

      onClose();
      resetForm();
    } catch (error: any) {
      toast.error(error.message || 'Failed to save booking');
    } finally {
      setSubmitting(false);
      setSavingDraft(false);
      setPendingBookingData(null);
    }
  };

  const handleRecurringDialogConfirm = async (applyToFutureBookings: boolean) => {
    setShowRecurringDialog(false);
    await executeSubmit(pendingBookingData?.isDraft || false, applyToFutureBookings);
  };

  const handleDuplicate = () => {
    if (!booking) return;
    const duplicateBooking = {
      ...booking,
      id: undefined as string | undefined,
      booking_number: undefined as number | undefined,
      payment_intent_id: null as string | null,
      payment_status: 'pending' as const,
    };
    onDuplicate?.(duplicateBooking as BookingWithDetails);
    toast.success('Booking duplicated - adjust the date and save');
  };

  const renderSectionContent = (stepId: string) => {
    switch (stepId) {
      case 'customer': return <CustomerStep />;
      case 'property': return <PropertyStep />;
      case 'service': return <ServiceStep />;
      case 'schedule': return <ScheduleStep currentBookingId={booking?.id} />;
      case 'payment': return <PaymentStep />;
      default: return null;
    }
  };

  return (
    <>
      {/* Recurring Change Dialog */}
      <Dialog open={showRecurringDialog} onOpenChange={setShowRecurringDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Users className="w-5 h-5" />
              Apply Changes to Future Bookings?
            </DialogTitle>
            <DialogDescription>
              This customer has {pendingBookingData?.futureBookings?.length || 0} upcoming booking(s).
              Would you like to apply {pendingBookingData?.changedFields?.length === 1 ? 'this change' : 'these changes'} to all future bookings?
            </DialogDescription>
          </DialogHeader>
          <div className="py-4 space-y-3">
            <div className="space-y-2">
              {pendingBookingData?.changedFields?.map((change: { field: string; oldValue: string; newValue: string; key: string }, idx: number) => (
                <div key={idx} className="text-sm p-2 bg-secondary/50 rounded flex justify-between items-center">
                  <span className="font-medium">{change.field}:</span>
                  <span>
                    <span className="text-muted-foreground line-through mr-2">{change.oldValue}</span>
                    →
                    <span className="font-medium text-foreground ml-2">{change.newValue}</span>
                  </span>
                </div>
              ))}
            </div>
            <Separator />
            <p className="text-xs text-muted-foreground font-medium">Future bookings affected:</p>
            {pendingBookingData?.futureBookings?.slice(0, 3).map((fb: BookingWithDetails) => (
              <div key={fb.id} className="flex items-center justify-between text-sm p-2 bg-muted/50 rounded">
                <span>{format(new Date(fb.scheduled_at), 'MMM d, yyyy')}</span>
                <span className="text-muted-foreground">{fb.service?.name}</span>
              </div>
            ))}
            {(pendingBookingData?.futureBookings?.length || 0) > 3 && (
              <p className="text-xs text-muted-foreground">
                ...and {pendingBookingData.futureBookings.length - 3} more
              </p>
            )}
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => handleRecurringDialogConfirm(false)}>
              This Booking Only
            </Button>
            <Button onClick={() => handleRecurringDialogConfirm(true)}>
              Apply to All Future
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="flex flex-col lg:flex-row gap-4 lg:gap-6 h-full pb-32 lg:pb-0">
        {/* Main scrollable single-page form */}
        <div className="flex-1 min-w-0 space-y-3 lg:space-y-4 order-2 lg:order-1">
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={steps.map(s => s.id)}
              strategy={verticalListSortingStrategy}
            >
              {steps.map((section) => (
                <SortableSection key={section.id} section={section}>
                  {renderSectionContent(section.id)}
                </SortableSection>
              ))}
            </SortableContext>
          </DndContext>
        </div>

        {/* Persistent Sidebar: Booking summary + adjustments + actions */}
        <div className="lg:w-80 lg:sticky lg:top-0 lg:self-start space-y-3 lg:space-y-4 order-1 lg:order-2">
          {/* Booking Summary */}
          <div className="bg-gradient-to-br from-card via-card to-secondary/20 rounded-2xl border border-border/50 p-5 shadow-lg">
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2 rounded-xl bg-gradient-to-br from-primary/20 to-accent/20">
                <Sparkles className="w-5 h-5 text-primary" />
              </div>
              <h4 className="font-semibold">Booking Summary</h4>
            </div>

            <div className="space-y-2 text-sm">
              {selectedService && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Service</span>
                  <span className="font-medium text-right">{selectedService.name}</span>
                </div>
              )}
              {(bedrooms || bathrooms) && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Home</span>
                  <span className="font-medium">{bedrooms || '?'} bd / {bathrooms || '?'} ba</span>
                </div>
              )}
              {frequency && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Frequency</span>
                  <span className="font-medium capitalize">{frequency.replace('_', '-')}</span>
                </div>
              )}
              {selectedDate && selectedTime && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">When</span>
                  <span className="font-medium text-right">
                    {format(selectedDate, 'MMM d')} · {selectedTime}
                  </span>
                </div>
              )}
              {customerName && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Customer</span>
                  <span className="font-medium text-right truncate max-w-[9rem]">{customerName}</span>
                </div>
              )}
            </div>
          </div>

          {/* Payment Summary */}
          <div className="bg-card rounded-2xl border border-border/50 p-5 shadow-sm">
            <h4 className="font-semibold mb-3">Payment Summary</h4>
            <div className="space-y-2 text-sm">
              {selectedService && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{selectedService.name}</span>
                  <span className="font-medium">{fmt(calculatedPrice)}</span>
                </div>
              )}
              {extrasTotal > 0 && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Add-ons</span>
                  <span className="font-medium">+${extrasTotal.toFixed(2)}</span>
                </div>
              )}
              <Separator />
              <div className="flex justify-between text-lg font-bold">
                <span>Total</span>
                <span className="text-primary">{fmt(finalPrice)}</span>
              </div>
              {frequency !== 'one_time' && (
                <Badge variant="secondary" className="w-full justify-center mt-2">
                  {frequency === 'weekly' && 'Weekly Recurring'}
                  {frequency === 'biweekly' && 'Bi-Weekly Recurring'}
                  {frequency === 'monthly' && 'Monthly Recurring'}
                  {frequency === 'triweekly' && 'Tri-Weekly Recurring'}
                  {frequency === 'custom' && (
                    recurringDaysOfWeek && recurringDaysOfWeek.length > 0
                      ? `${recurringDaysOfWeek.map((d) => ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][d]).join('/')} Recurring`
                      : customFrequencyDays
                        ? `Every ${customFrequencyDays} Day${customFrequencyDays !== 1 ? 's' : ''} Recurring`
                        : 'Custom Recurring'
                  )}
                </Badge>
              )}
            </div>
          </div>

          {/* Adjustments */}
          <div className="bg-card rounded-2xl border border-border/50 p-5 shadow-sm space-y-3">
            <h4 className="font-semibold">Adjustments</h4>
            <div className="flex items-center gap-2">
              <Checkbox
                id="sendConfirmationSms"
                checked={sendConfirmationSms}
                onCheckedChange={(c) => setSendConfirmationSms(c as boolean)}
              />
              <Label htmlFor="sendConfirmationSms" className="text-sm cursor-pointer flex items-center gap-1.5">
                <MessageSquare className="w-4 h-4 text-muted-foreground" />
                Send confirmation text
              </Label>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                id="sendConfirmationEmail"
                checked={sendConfirmationEmail}
                onCheckedChange={(c) => setSendConfirmationEmail(c as boolean)}
              />
              <Label htmlFor="sendConfirmationEmail" className="text-sm cursor-pointer flex items-center gap-1.5">
                <Mail className="w-4 h-4 text-muted-foreground" />
                Send confirmation email
              </Label>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                id="sendQuoteSms"
                checked={sendQuoteSms}
                onCheckedChange={(c) => setSendQuoteSms(c as boolean)}
              />
              <Label htmlFor="sendQuoteSms" className="text-sm cursor-pointer flex items-center gap-1.5">
                <MessageSquare className="w-4 h-4 text-muted-foreground" />
                Quote SMS
              </Label>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                id="sendQuoteEmail"
                checked={sendQuoteEmail}
                onCheckedChange={(c) => setSendQuoteEmail(c as boolean)}
              />
              <Label htmlFor="sendQuoteEmail" className="text-sm cursor-pointer flex items-center gap-1.5">
                <Mail className="w-4 h-4 text-muted-foreground" />
                Quote Email
              </Label>
            </div>
          </div>

          {/* Actions */}
          <div className="space-y-2">
            {pricingError && (
              <p className="text-sm text-destructive text-center py-2">
                Could not load pricing — saving is disabled until pricing loads.
              </p>
            )}
            <Button
              onClick={() => handleSubmit(false)}
              disabled={submitting || savingDraft || !!pricingError}
              className="w-full h-12 bg-gradient-to-r from-primary to-accent hover:brightness-110 shadow-md transition-all"
            >
              {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {booking ? 'Update Booking' : 'Save Booking'}
            </Button>

            <Button
              variant="secondary"
              onClick={() => handleSubmit(true)}
              disabled={savingDraft || submitting || !!pricingError}
              className="w-full h-11"
            >
              {savingDraft && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              <Save className="mr-2 h-4 w-4" />
              Save As Draft
            </Button>

            <Button
              variant="outline"
              onClick={handleSendQuoteEmail}
              disabled={sendingQuoteEmail || !!pricingError}
              className="w-full h-11"
            >
              {sendingQuoteEmail && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              <Mail className="mr-2 h-4 w-4" />
              Save As Quote
            </Button>

            {booking && (
              <Button variant="ghost" onClick={handleDuplicate} className="w-full h-10">
                <Copy className="mr-2 h-4 w-4" />
                Duplicate
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Mobile sticky bottom action bar */}
      <div className="lg:hidden fixed bottom-0 inset-x-0 z-40 bg-background/95 backdrop-blur border-t border-border px-3 py-2 pb-[max(env(safe-area-inset-bottom),0.5rem)] flex items-center gap-2 shadow-lg">
        <div className="flex flex-col min-w-0">
          <span className="text-[10px] text-muted-foreground uppercase tracking-wide">Total</span>
          <span className="text-base font-bold text-primary leading-tight">{fmt(finalPrice)}</span>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => handleSubmit(true)}
          disabled={savingDraft || submitting}
          className="ml-auto h-10"
        >
          {savingDraft && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
          Draft
        </Button>
        <Button
          onClick={() => handleSubmit(false)}
          disabled={submitting || savingDraft}
          size="sm"
          className="h-10 px-4 bg-gradient-to-r from-primary to-accent"
        >
          {submitting && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
          {booking ? 'Update' : 'Save'}
        </Button>
      </div>
    </>
  );
}

// Sortable single-page section wrapper
interface SortableSectionProps {
  section: StepItem;
  children: React.ReactNode;
}

function SortableSection({ section, children }: SortableSectionProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: section.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
  };

  const Icon = section.icon;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "bg-card rounded-2xl border border-border/50 shadow-sm overflow-hidden",
        isDragging && "ring-2 ring-primary"
      )}
    >
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border/50 bg-secondary/20">
        <button
          {...attributes}
          {...listeners}
          aria-label={`Reorder ${section.label} section`}
          className="p-1 cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground transition-colors"
        >
          <MenuIcon className="w-4 h-4" />
        </button>
        <div className="p-1.5 rounded-lg bg-primary/10 text-primary">
          <Icon className="w-4 h-4" />
        </div>
        <h3 className="font-semibold text-sm">{section.label}</h3>
      </div>
      <div className="p-4 md:p-5">
        {children}
      </div>
    </div>
  );
}
