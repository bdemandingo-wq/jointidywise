import { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";

import { BookingWithDetails, useStaff, useUpdateBooking } from "@/hooks/useBookings";
import { useOrgId } from "@/hooks/useOrgId";
import { computeExpectedPay, syncCleanerPayShare } from "@/lib/cleanerPay";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/use-toast";
import { Loader2, DollarSign, Percent, Clock, Send, CreditCard, FileText } from "lucide-react";
import { Separator } from "@/components/ui/separator";
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
import { supabase } from "@/lib/supabase";
import { mustAffectRows, affectedRows } from '@/lib/mustAffectRows';
import { getTimeInTimezone } from "@/lib/timezoneUtils";
import { useOrgTimezone } from "@/hooks/useOrgTimezone";
import { orgDateKey, formatInOrgTz } from "@/lib/orgDateRange";
import { AdminLiveTracking } from "./AdminLiveTracking";
import { fmt } from '@/lib/activeCurrency';
import { CustomerNotesBlock } from '@/components/CustomerNotesBlock';
import { FarCheckinNotice } from '@/components/admin/FarCheckinNotice';

const STATUS_OPTIONS: Array<{ value: BookingWithDetails["status"]; label: string }> = [
  { value: "pending", label: "Pending Payment" },
  { value: "confirmed", label: "Scheduled" },
  { value: "in_progress", label: "In Progress" },
  { value: "completed", label: "Completed" },
  { value: "rescheduled", label: "Rescheduled" },
  { value: "cancelled", label: "Cancelled" },
  { value: "no_show", label: "No Show" },
];

const WAGE_TYPE_OPTIONS = [
  { value: "hourly", label: "/hr", icon: Clock },
  { value: "flat", label: "$", icon: DollarSign },
  { value: "percentage", label: "%", icon: Percent },
];

export function BookingDetailsDialog({
  open,
  onOpenChange,
  booking,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  booking: BookingWithDetails | null;
}) {
  const [sendingLink, setSendingLink] = useState(false);
  const [creatingQuote, setCreatingQuote] = useState(false);
  const { organizationId } = useOrgId();
  const { timezone: orgTimezone } = useOrgTimezone();

  if (!booking) return null;

  const handleSendCardLink = async () => {
    const phone = (booking.customer as any)?.phone as string | undefined;
    const email = booking.customer?.email;
    if (!phone && !email) {
      toast({
        title: "Error",
        description: "Customer needs a phone number or email to receive the card link",
        variant: "destructive",
      });
      return;
    }

    // Default to SMS when the customer has a phone number; otherwise email
    const channel: 'sms' | 'email' = phone ? 'sms' : 'email';

    setSendingLink(true);
    try {
      const { data, error } = await supabase.functions.invoke('send-card-collection-link', {
        body: {
          email: email ?? undefined,
          phone: phone ?? undefined,
          channel,
          customerName: `${booking.customer?.first_name ?? ''} ${booking.customer?.last_name ?? ''}`.trim() || 'Customer',
          organizationId: organizationId ?? undefined,
        },
      });

      if (error) {
        // Surface the real error body from the edge function
        let msg = error.message;
        try {
          const ctx = (error as any)?.context;
          if (ctx?.json) {
            const body = await ctx.json();
            if (body?.error) msg = typeof body.error === 'string' ? body.error : JSON.stringify(body.error);
          }
        } catch { /* ignore */ }
        throw new Error(msg);
      }

      const deliveredVia = (data as any)?.deliveredVia as 'sms' | 'email' | undefined;
      const fellBack = (data as any)?.fellBackToEmail;
      const target = deliveredVia === 'sms' ? phone : email;
      toast({
        title: fellBack ? 'Sent via email (SMS unavailable)' : 'Card link sent!',
        description: `Secure card setup link sent via ${deliveredVia === 'sms' ? 'SMS' : 'email'} to ${target}`,
      });
    } catch (error: any) {
      console.error('Error sending card link:', error);
      toast({
        title: "Failed to send",
        description: error.message || "Could not send card collection link",
        variant: "destructive",
      });
    } finally {
      setSendingLink(false);
    }
  };

  const handleCreateQuote = async () => {
    if (!booking.customer?.id) {
      toast({
        title: "Error",
        description: "Customer is required to create a quote",
        variant: "destructive",
      });
      return;
    }

    setCreatingQuote(true);
    try {
      const extras = (booking as any).extras || [];
      const { data: quote, error } = await supabase
        .from('quotes')
        .insert({
          organization_id: organizationId,
          customer_id: booking.customer.id,
          service_id: booking.service?.id || null,
          address: booking.address || null,
          city: booking.city || null,
          state: booking.state || null,
          zip_code: booking.zip_code || null,
          bedrooms: (booking as any).bedrooms || null,
          bathrooms: (booking as any).bathrooms || null,
          square_footage: (booking as any).square_footage || null,
          extras: extras,
          subtotal: (booking as any).subtotal || booking.total_amount,
          total_amount: booking.total_amount,
          notes: booking.notes || null,
          status: 'draft',
          // A quote's validity is a calendar date in the BUSINESS's calendar.
          // Slicing toISOString() gave the UTC date, a day early for anyone
          // east of UTC and for late-evening creation in the Americas.
          valid_until: orgDateKey(new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), orgTimezone),
        })
        .select()
        .single();

      if (error) throw error;

      // Delete the source booking so it doesn't appear on the calendar
      // Quotes should NOT have a corresponding booking until accepted
      const { error: deleteError } = await supabase
        .from('bookings')
        .delete()
        .eq('id', booking.id);

      if (deleteError) {
        console.error('Warning: Could not remove source booking:', deleteError);
      }

      toast({
        title: "Quote created!",
        description: `Quote #${quote.quote_number} created. The booking has been removed from the calendar. Go to Bookings → Quotes tab to manage it.`,
      });
      
      // Navigate to bookings page quotes tab
      window.location.href = '/dashboard/bookings';
    } catch (error: any) {
      console.error('Error creating quote:', error);
      toast({
        title: "Failed to create quote",
        description: error.message || "Could not create quote",
        variant: "destructive",
      });
    } finally {
      setCreatingQuote(false);
    }
  };

  const scheduled = new Date(booking.scheduled_at);
  const bookingAny = booking as any;

  // Calculate cleaner pay display
  const getCleanerPayDisplay = () => {
    if (!bookingAny.cleaner_wage) return "Not set";
    
    const wage = bookingAny.cleaner_wage;
    const wageType = bookingAny.cleaner_wage_type || 'hourly';
    
    if (wageType === 'flat') {
      return `$${wage} flat fee`;
    } else if (wageType === 'percentage') {
      const amount = (booking.total_amount * wage) / 100;
      return `${wage}% (${fmt(amount)})`;
    } else {
      const hours = bookingAny.cleaner_override_hours || (booking.duration / 60);
      const amount = wage * hours;
      return `$${wage}/hr × ${hours}hrs = ${fmt(amount)}`;
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Booking #{booking.booking_number}</DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-1 gap-4">
          <div className="rounded-lg border bg-card p-4">
            <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <dt className="text-xs text-muted-foreground">Customer</dt>
                <dd className="text-sm font-medium">
                  {booking.customer
                    ? `${booking.customer.first_name} ${booking.customer.last_name}`
                    : "Unknown"}
                </dd>
                <dd className="text-xs text-muted-foreground">{booking.customer?.email || "—"}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Service</dt>
                <dd className="text-sm font-medium">{booking.service?.name || (booking.total_amount === 0 ? 'Re-clean' : 'Service')}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Scheduled</dt>
                <dd className="text-sm font-medium">{format(scheduled, "MMM d, yyyy")}</dd>
                <dd className="text-xs text-muted-foreground">
                  {getTimeInTimezone(booking.scheduled_at, orgTimezone)}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Staff</dt>
                <dd className="text-sm font-medium">{booking.staff?.name || "Unassigned"}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Status</dt>
                <dd className="text-sm font-medium capitalize">{booking.status.replace("_", " ")}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Payment</dt>
                <dd className="text-sm font-medium capitalize">{booking.payment_status}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Total Amount</dt>
                <dd className="text-sm font-medium">${booking.total_amount}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Cleaner Pay</dt>
                <dd className="text-sm font-medium">{getCleanerPayDisplay()}</dd>
              </div>
              {bookingAny.cleaner_actual_payment && (
                <div className="sm:col-span-2">
                  <dt className="text-xs text-muted-foreground">Actual Paid to Cleaner</dt>
                  <dd className="text-sm font-bold text-green-600">${bookingAny.cleaner_actual_payment}</dd>
                </div>
              )}
            </dl>
          </div>

          <FarCheckinNotice bookingId={booking.id} />

          {booking.notes ? (
            <div className="rounded-lg border bg-card p-4">
              <p className="text-xs text-muted-foreground mb-1">Notes</p>
              <p className="text-sm whitespace-pre-wrap">{booking.notes}</p>
            </div>
          ) : null}

          {/* The customer's own words. Separate block, separate label — read-only.
              useBookings selects *, so this arrives without a query change. */}
          <CustomerNotesBlock value={(booking as { customer_notes?: unknown }).customer_notes} />

          <AdminLiveTracking
            bookingId={booking.id}
            address={[booking.address, booking.city, booking.state].filter(Boolean).join(', ')}
            bookingStatus={booking.status}
            destLat={(booking as { latitude?: number | null }).latitude}
            destLng={(booking as { longitude?: number | null }).longitude}
          />
        </div>

        <DialogFooter className="flex-col sm:flex-row gap-2">
          {booking.customer?.id && (
            <Button
              type="button"
              variant="outline"
              className="gap-2"
              onClick={handleCreateQuote}
              disabled={creatingQuote}
            >
              {creatingQuote ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <FileText className="h-4 w-4" />
              )}
              Create Quote
            </Button>
          )}
          {booking.customer?.email && (
            <Button
              type="button"
              variant="outline"
              className="gap-2"
              onClick={handleSendCardLink}
              disabled={sendingLink}
            >
              {sendingLink ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <CreditCard className="h-4 w-4" />
              )}
              Send Card Link
            </Button>
          )}
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function EditBookingDialog({
  open,
  onOpenChange,
  booking,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  booking: BookingWithDetails | null;
}) {
  const { organizationId } = useOrgId();
  const { data: staff = [], isLoading: staffLoading } = useStaff();
  const { timezone: orgTimezone } = useOrgTimezone();
  const updateBooking = useUpdateBooking();

  const initial = useMemo(() => {
    if (!booking) return null;
    const d = new Date(booking.scheduled_at);
    const bookingAny = booking as any;
    return {
      status: booking.status,
      // Prefill for the edit form. This rendered the instant in the ADMIN's
      // zone while the read-only view two hundred lines up already used
      // getTimeInTimezone(orgTimezone) — so opening Edit showed a different
      // time than the booking displayed, and saving would have written it.
      date: orgDateKey(d, orgTimezone),
      time: formatInOrgTz(d, orgTimezone, { hour: '2-digit', minute: '2-digit', hour12: false, hourCycle: 'h23' }),
      staffId: booking.staff?.id || "__unassigned__",
      notes: booking.notes || "",
      amount: String(booking.total_amount ?? ""),
      cleanerWage: bookingAny.cleaner_wage ? String(bookingAny.cleaner_wage) : "",
      cleanerWageType: bookingAny.cleaner_wage_type || "hourly",
      cleanerOverrideHours: bookingAny.cleaner_override_hours ? String(bookingAny.cleaner_override_hours) : "",
      cleanerActualPayment: bookingAny.cleaner_actual_payment ? String(bookingAny.cleaner_actual_payment) : "",
    };
  }, [booking, orgTimezone]);

  const [status, setStatus] = useState<BookingWithDetails["status"]>("pending");
  const [date, setDate] = useState<string>("");
  const [time, setTime] = useState<string>("");
  const [staffId, setStaffId] = useState<string>("");
  const [notes, setNotes] = useState<string>("");
  const [amount, setAmount] = useState<string>("");
  const [cleanerWage, setCleanerWage] = useState<string>("");
  const [cleanerWageType, setCleanerWageType] = useState<string>("hourly");
  const [cleanerOverrideHours, setCleanerOverrideHours] = useState<string>("");
  const [cleanerActualPayment, setCleanerActualPayment] = useState<string>("");
  const [showActualPayment, setShowActualPayment] = useState(false);
  const [confirmCancelOpen, setConfirmCancelOpen] = useState(false);

  useEffect(() => {
    if (!open || !initial) return;
    setStatus(initial.status);
    setDate(initial.date);
    setTime(initial.time);
    setStaffId(initial.staffId);
    setNotes(initial.notes);
    setAmount(initial.amount);
    setCleanerWage(initial.cleanerWage);
    setCleanerWageType(initial.cleanerWageType);
    setCleanerOverrideHours(initial.cleanerOverrideHours);
    setCleanerActualPayment(initial.cleanerActualPayment);
    setShowActualPayment(initial.status === 'completed' || !!initial.cleanerActualPayment);
  }, [open, initial]);

  // Show actual payment field when status changes to completed
  useEffect(() => {
    if (status === 'completed' && !showActualPayment) {
      setShowActualPayment(true);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- showActualPayment is read inside the guard; adding it would suppress the one-time reveal
  }, [status]);

  if (!booking) return null;

  const saving = updateBooking.isPending;

  // Calculate estimated cleaner pay
  const calculateEstimatedPay = () => {
    const wage = parseFloat(cleanerWage);
    if (!wage || isNaN(wage)) return null;
    
    const totalAmt = parseFloat(amount) || booking.total_amount;
    
    if (cleanerWageType === 'flat') {
      return wage;
    } else if (cleanerWageType === 'percentage') {
      return (totalAmt * wage) / 100;
    } else {
      const hours = parseFloat(cleanerOverrideHours) || (booking.duration / 60);
      return wage * hours;
    }
  };

  const estimatedPay = calculateEstimatedPay();

  const attemptSave = () => {
    if (status === "cancelled" && booking.status !== "cancelled") {
      setConfirmCancelOpen(true);
      return;
    }
    void handleSave();
  };

  const handleSave = async () => {
    try {
      const scheduledAtIso = date && time ? new Date(`${date}T${time}:00`).toISOString() : booking.scheduled_at;
      const parsedAmount = Number(amount);

      // Compute cleaner_pay_expected snapshot so payroll always reads the correct
      // value. cleanerWage/cleanerWageType (this modal's wage fields) is the
      // source of truth when set — it must win over any stale cleaner_actual_payment
      // override, otherwise a leftover manual override silently shadows a wage
      // change forever (payroll reads cleaner_pay_expected, never recomputing it).
      const wageDerivedPay = computeExpectedPay(
        cleanerWageType,
        cleanerWage,
        cleanerOverrideHours,
        booking.duration,
        Number.isFinite(parsedAmount) ? parsedAmount : booking.total_amount,
      );

      const computedExpectedPay = wageDerivedPay != null
        ? wageDerivedPay
        : (cleanerActualPayment ? parseFloat(cleanerActualPayment) : null);

      // When a wage is configured, it's authoritative — clear any stale
      // cleaner_actual_payment override so it can't resurface on a future
      // wage-only edit. The separate "Adjust Payment" dialog remains the
      // explicit way to set an actual-payment override when no wage applies.
      const nextActualPayment = wageDerivedPay != null
        ? null
        : (cleanerActualPayment ? parseFloat(cleanerActualPayment) : null);

      // Detect reschedule: scheduled_at changed OR admin set status to "rescheduled"
      const bookingAny = booking as any;
      const dateChanged = scheduledAtIso !== booking.scheduled_at;
      const becameRescheduled = status === 'rescheduled' && booking.status !== 'rescheduled';
      const isReschedule = dateChanged || becameRescheduled;

      const reschedulePayload: Record<string, any> = {};
      if (isReschedule) {
        // Preserve original (very first scheduled_at) only on first reschedule
        if (!bookingAny.original_scheduled_at) {
          reschedulePayload.original_scheduled_at = booking.scheduled_at;
        }
        reschedulePayload.previous_scheduled_at = booking.scheduled_at;
        reschedulePayload.rescheduled_at = new Date().toISOString();
        const { data: { user } } = await supabase.auth.getUser();
        if (user?.id) reschedulePayload.rescheduled_by = user.id;
      }

      // Auto-flag status as 'rescheduled' when admin only changed the date and left status as confirmed/pending
      const finalStatus =
        dateChanged && (status === 'pending' || status === 'confirmed') && !becameRescheduled
          ? 'rescheduled'
          : status;

      const nextStaffId = staffId && staffId !== '__unassigned__' ? staffId : null;

      await updateBooking.mutateAsync({
        id: booking.id,
        status: finalStatus,
        scheduled_at: scheduledAtIso,
        staff_id: nextStaffId,
        notes: notes || null,
        total_amount: Number.isFinite(parsedAmount) ? parsedAmount : booking.total_amount,
        cleaner_wage: cleanerWage ? parseFloat(cleanerWage) : null,
        cleaner_wage_type: cleanerWageType || null,
        cleaner_override_hours: cleanerOverrideHours ? parseFloat(cleanerOverrideHours) : null,
        cleaner_actual_payment: nextActualPayment,
        cleaner_pay_expected: computedExpectedPay,
        ...reschedulePayload,
      } as any);

      // Keep single-cleaner pay_share in sync — payroll reads it first. Passing
      // the new staff_id also MOVES the assignment when the cleaner changed
      // here: without it the row stayed with the previous cleaner while
      // bookings.staff_id pointed at the new one, so payroll paid both, and the
      // previous cleaner's pay_share was overwritten with the new cleaner's pay.
      await syncCleanerPayShare(booking.id, organizationId, computedExpectedPay, nextStaffId);

      toast({ title: "Saved", description: "Booking updated" });
      onOpenChange(false);
    } catch (e: any) {
      toast({
        title: "Error",
        description: e?.message || "Failed to update booking",
        variant: "destructive",
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit Booking #{booking.booking_number}</DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-1 gap-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Status</Label>
              <Select value={status} onValueChange={(v) => setStatus(v as any)}>
                <SelectTrigger>
                  <SelectValue placeholder="Select status" />
                </SelectTrigger>
                <SelectContent>
                  {STATUS_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Staff</Label>
              <Select value={staffId} onValueChange={setStaffId} disabled={staffLoading}>
                <SelectTrigger>
                  <SelectValue placeholder={staffLoading ? "Loading..." : "Unassigned"} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__unassigned__">Unassigned</SelectItem>
                  {staff.map((s: any) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Date</Label>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>

            <div className="space-y-2">
              <Label>Time</Label>
              <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
            </div>

            <div className="space-y-2 sm:col-span-2">
              <Label>Amount</Label>
              <Input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" />
            </div>

            <div className="space-y-2 sm:col-span-2">
              {/* Above the textarea, not below: it is context for what you are
                  about to write. Read-only — this is the customer's text and the
                  save path below writes `notes` only. */}
              <CustomerNotesBlock
                value={(booking as { customer_notes?: unknown } | null)?.customer_notes}
                className="mb-2"
              />
              <Label>Notes</Label>
              <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
            </div>
          </div>

          <Separator />

          {/* Cleaner Payment Section */}
          <div className="space-y-4">
            <h4 className="font-semibold text-sm flex items-center gap-2">
              <DollarSign className="w-4 h-4" />
              Cleaner Payment
            </h4>
            
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Wage</Label>
                <Input 
                  type="number" 
                  value={cleanerWage} 
                  onChange={(e) => setCleanerWage(e.target.value)} 
                  placeholder="25"
                  inputMode="decimal"
                />
              </div>

              <div className="space-y-2">
                <Label>Wage Type</Label>
                <Select value={cleanerWageType} onValueChange={setCleanerWageType}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {WAGE_TYPE_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        <span className="flex items-center gap-2">
                          <o.icon className="w-4 h-4" />
                          {o.label}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {cleanerWageType === 'hourly' && (
                <div className="space-y-2 sm:col-span-2">
                  <Label>Override Time (hours)</Label>
                  <Input 
                    type="number" 
                    value={cleanerOverrideHours} 
                    onChange={(e) => setCleanerOverrideHours(e.target.value)} 
                    placeholder={`Default: ${(booking.duration / 60).toFixed(1)} hrs`}
                    inputMode="decimal"
                  />
                </div>
              )}

              {estimatedPay !== null && (
                <div className="sm:col-span-2 p-3 bg-secondary/50 rounded-lg">
                  <p className="text-sm text-muted-foreground">Estimated Cleaner Pay</p>
                  <p className="text-lg font-bold text-primary">{fmt(estimatedPay)}</p>
                </div>
              )}
            </div>

            {showActualPayment && (
              <div className="space-y-2 p-4 border-2 border-primary/20 rounded-lg bg-primary/5">
                <Label className="text-primary font-semibold">Actual Amount Paid to Cleaner</Label>
                <p className="text-xs text-muted-foreground mb-2">
                  Adjust the final amount you actually paid the cleaner after the job was completed.
                </p>
                <div className="relative">
                  <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input 
                    type="number" 
                    value={cleanerActualPayment} 
                    onChange={(e) => setCleanerActualPayment(e.target.value)} 
                    placeholder={estimatedPay ? estimatedPay.toFixed(2) : "0.00"}
                    className="pl-9"
                    inputMode="decimal"
                  />
                </div>
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button type="button" onClick={attemptSave} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
            Save changes
          </Button>
        </DialogFooter>
      </DialogContent>

      <AlertDialog open={confirmCancelOpen} onOpenChange={setConfirmCancelOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel this booking?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to cancel this booking? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={saving}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={saving}
              onClick={async () => {
                setConfirmCancelOpen(false);
                await handleSave();
              }}
            >
              Confirm
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  );
}

export function AdjustPaymentDialog({
  open,
  onOpenChange,
  booking,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  booking: BookingWithDetails | null;
}) {
  const updateBooking = useUpdateBooking();
  const { organizationId } = useOrgId();

  // Single cleaner payment (used when no team assignments)
  const [singlePayment, setSinglePayment] = useState<string>("");
  // Per-cleaner payments keyed by staff_id (used for team bookings)
  const [teamPayments, setTeamPayments] = useState<Record<string, string>>({});
  // All team members from booking_team_assignments
  const [teamMembers, setTeamMembers] = useState<{ id: string; name: string; pay_share: number | null; is_primary: boolean }[]>([]);
  const [loadingTeam, setLoadingTeam] = useState(false);
  const [saving, setSaving] = useState(false);

  const bookingAny = booking as any;

  useEffect(() => {
    if (!open || !booking) return;

    // Reset single payment - prefer cleaner_pay_expected (single source of truth), fall back to cleaner_actual_payment
    const initialPay = bookingAny?.cleaner_pay_expected != null ? bookingAny.cleaner_pay_expected : bookingAny?.cleaner_actual_payment;
    setSinglePayment(initialPay != null ? String(initialPay) : "");
    setTeamMembers([]);
    setTeamPayments({});

    const fetchTeam = async () => {
      if (!organizationId) return;
      setLoadingTeam(true);

      const { data } = await supabase
        .from('booking_team_assignments')
        .select('staff_id, pay_share, is_primary, staff:staff(id, name)')
        .eq('booking_id', booking.id)
        .eq('organization_id', organizationId);

      if (data && data.length >= 2) {
        // Truly a team booking — show ALL members individually
        const members = data.map((a: any) => ({
          id: a.staff_id,
          name: a.staff?.name || 'Unknown',
          pay_share: a.pay_share,
          is_primary: a.is_primary ?? false,
        }));

        // Sort: primary first
        members.sort((a, b) => (b.is_primary ? 1 : 0) - (a.is_primary ? 1 : 0));
        setTeamMembers(members);

        const payments: Record<string, string> = {};
        members.forEach(m => {
          // For the primary, prefer cleaner_actual_payment from booking if pay_share is null
          if (m.is_primary && m.pay_share == null && bookingAny?.cleaner_actual_payment != null) {
            payments[m.id] = String(bookingAny.cleaner_actual_payment);
          } else {
            payments[m.id] = m.pay_share != null ? String(m.pay_share) : "";
          }
        });
        setTeamPayments(payments);
      } else if (data && data.length === 1) {
        // Only 1 assignment — treat as single cleaner, keep singlePayment
        setTeamMembers([]);
      }
      setLoadingTeam(false);
    };

    fetchTeam();
  // eslint-disable-next-line react-hooks/exhaustive-deps -- booking object fields (cleaner_actual_payment, cleaner_pay_expected) are read inside; re-running on every booking object change would reset user edits
  }, [open, booking?.id, organizationId]);

  if (!booking) return null;

  // True team = 2+ members in booking_team_assignments
  const isTeamBooking = teamMembers.length >= 2;

  const calculateEstimatedPay = () => {
    const wage = bookingAny?.cleaner_wage;
    if (!wage) return null;
    const wageType = bookingAny?.cleaner_wage_type || 'hourly';
    if (wageType === 'flat') return wage;
    if (wageType === 'percentage') return (booking.total_amount * wage) / 100;
    const hours = bookingAny?.cleaner_override_hours || (booking.duration / 60);
    return wage * hours;
  };

  const estimatedPay = calculateEstimatedPay();

  const handleSave = async () => {
    try {
      setSaving(true);

      if (isTeamBooking && organizationId) {
        // Save each cleaner's individual pay to booking_team_assignments.pay_share
        for (const member of teamMembers) {
          const amount = teamPayments[member.id];
          // Every member in teamMembers came from an existing assignment row, so
          // zero rows here means the write was filtered out — and this is what a
          // cleaner gets paid. Fail loudly rather than toast "Saved".
          await mustAffectRows(
            supabase
              .from('booking_team_assignments')
              .update({ pay_share: amount ? parseFloat(amount) : null })
              .eq('booking_id', booking.id)
              .eq('staff_id', member.id)
              .eq('organization_id', organizationId),
            `Pay for ${member.name ?? 'a team member'} could not be saved. No payment changes were applied. Please retry.`,
            { table: 'booking_team_assignments' },
          );
        }

        // Also save primary cleaner's pay to booking for payroll parity
        const primaryMember = teamMembers.find(m => m.is_primary);
        if (primaryMember) {
          const primaryAmount = teamPayments[primaryMember.id];
          const parsedAmount = primaryAmount ? parseFloat(primaryAmount) : null;
          await updateBooking.mutateAsync({
            id: booking.id,
            cleaner_actual_payment: parsedAmount,
            // CRITICAL: Also update cleaner_pay_expected so payroll uses the adjusted value
            cleaner_pay_expected: parsedAmount,
          });
        }
      } else {
        // Single cleaner — save directly on booking
        const parsedAmount = singlePayment ? parseFloat(singlePayment) : null;
        await updateBooking.mutateAsync({
          id: booking.id,
          cleaner_actual_payment: parsedAmount,
          // CRITICAL: Also update cleaner_pay_expected so payroll uses the adjusted value
          cleaner_pay_expected: parsedAmount,
        });

        // CRITICAL: Also update booking_team_assignments.pay_share if a single assignment exists
        // because payroll may read pay_share and it would override the booking-level value
        if (organizationId) {
          // affectedRows, not mustAffectRows: a single-cleaner booking legitimately
          // may have no assignment row at all, so 0 is a valid outcome here. The
          // count is still checked so a filtered-out write can't hide behind it.
          await affectedRows(
            supabase
              .from('booking_team_assignments')
              .update({ pay_share: parsedAmount })
              .eq('booking_id', booking.id)
              .eq('organization_id', organizationId),
          );
        }
      }

      toast({ title: "Saved", description: "Cleaner payments adjusted successfully" });
      onOpenChange(false);
    } catch (e: any) {
      toast({
        title: "Error",
        description: e?.message || "Failed to update payment",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Adjust Cleaner Payment</DialogTitle>
          <DialogDescription>
            Booking #{booking.booking_number}
            {isTeamBooking ? ` · ${teamMembers.length} cleaners` : booking.staff?.name ? ` · ${booking.staff.name}` : ''}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="p-4 bg-secondary/50 rounded-lg space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Service Total:</span>
              <span className="font-medium">${booking.total_amount}</span>
            </div>
            {estimatedPay !== null && !isTeamBooking && (
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Estimated Pay:</span>
                <span className="font-medium">{fmt(estimatedPay)}</span>
              </div>
            )}
          </div>

          {loadingTeam ? (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : isTeamBooking ? (
            // TEAM: one field per cleaner, all from booking_team_assignments
            <div className="space-y-3">
              <p className="text-sm font-semibold">Individual Cleaner Pay</p>
              {teamMembers.map(member => (
                <div key={member.id} className="space-y-1">
                  <Label className="text-sm font-medium">
                    {member.name}
                    {member.is_primary && (
                      <span className="ml-2 text-xs text-muted-foreground font-normal">(Primary)</span>
                    )}
                  </Label>
                  <div className="relative">
                    <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input
                      type="number"
                      value={teamPayments[member.id] ?? ""}
                      onChange={(e) => setTeamPayments(prev => ({ ...prev, [member.id]: e.target.value }))}
                      placeholder="0.00"
                      className="pl-9"
                      inputMode="decimal"
                    />
                  </div>
                </div>
              ))}
              <p className="text-xs text-muted-foreground">
                Enter the amount paid to each cleaner individually.
              </p>
            </div>
          ) : (
            // SINGLE CLEANER
            <div className="space-y-2">
              <Label className="font-semibold">
                Actual Amount Paid{booking.staff?.name ? ` (${booking.staff.name})` : ''}
              </Label>
              <div className="relative">
                <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  type="number"
                  value={singlePayment}
                  onChange={(e) => setSinglePayment(e.target.value)}
                  placeholder={estimatedPay ? estimatedPay.toFixed(2) : "0.00"}
                  className="pl-9 text-lg"
                  inputMode="decimal"
                  autoFocus
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Enter the final amount you paid to the cleaner for this job.
              </p>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button type="button" onClick={handleSave} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
            Save Payment
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
