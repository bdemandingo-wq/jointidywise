import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { extrasToLabels, type ExtraOption } from '@/lib/bookingExtras';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Calendar, MapPin, Clock, User, Phone, Navigation, DollarSign, ClipboardCheck, Car, Loader2, FileText, Users, KeyRound, PawPrint, ParkingCircle, Info, Sparkles } from 'lucide-react';
import { useOrgTimezone } from '@/hooks/useOrgTimezone';
import { readEdgeFunctionError } from '@/lib/edgeFunctionError';
import { formatInTimezone } from '@/lib/timezoneUtils';
import { orgDateKey } from '@/lib/orgDateRange';
import { BookingPhotoUpload } from './BookingPhotoUpload';
import { BookingChecklist } from './BookingChecklist';
import { GpsCheckin } from './GpsCheckin';
import { PropertyInspectionUpload } from './PropertyInspectionUpload';
import { useMapsNavigation } from '@/hooks/useMapsNavigation';
import { useCleanerTracking } from '@/hooks/useCleanerTracking';
import { supabase } from '@/lib/supabase';
import { resolveCleanerPay, describeCleanerPay, type WageBooking, type WageStaff } from '@/lib/wageCalculation';
import { CustomerNotesBlock } from '@/components/CustomerNotesBlock';
import { toast } from 'sonner';

interface PropertyNote {
  notes: string | null;
  access_instructions: string | null;
  gate_code: string | null;
  alarm_code: string | null;
  has_pets: boolean;
  pet_notes: string | null;
  parking_notes: string | null;
}

// Pay inputs come from the shared resolver's contract so this card cannot
// drift from payroll. percentage_rate is deliberately absent — see the note
// at the top of lib/wageCalculation.ts.
type StaffInfo = WageStaff;

interface Booking extends WageBooking {
  id: string;
  organization_id?: string | null;
  booking_number: number;
  scheduled_at: string;
  status: string;
  address: string | null;
  city: string | null;
  state: string | null;
  zip_code: string | null;
  notes?: string | null;
  /** The customer's own words, from the booking they submitted. Read-only. */
  customer_notes?: string | null;
  /** Add-on slugs; labels resolve per-org. See lib/bookingExtras. */
  extras?: unknown;
  customer: {
    first_name: string;
    last_name: string;
    phone: string | null;
  } | null;
  service: {
    name: string;
  } | null;
  team_pay_share?: number | null;
  team_members?: string[];
}

interface Props {
  booking: Booking;
  staffInfo: StaffInfo & { id?: string };
  /** The business this job belongs to. Passed explicitly rather than read from
   *  OrganizationContext: a cleaner staffed at two businesses can have a context
   *  org that is not the one whose jobs are on screen. */
  organizationId: string | null;
  /** Slug -> label map for add-ons, from the org's own price list. */
  orgExtras?: ExtraOption[];
  // Batched by the parent (StaffPortal) to avoid a per-card N+1 on load.
  photoReqs: { required: boolean; min: number };
  photoCount: number;
  propertyNote: PropertyNote | null;
  onTheWaySent: boolean;
  onUpdateStatus?: (bookingId: string, status: 'pending' | 'confirmed' | 'in_progress' | 'completed' | 'cancelled' | 'no_show') => void;
  isUpdating?: boolean;
}

export function MyJobCard({ booking, staffInfo, organizationId, orgExtras, photoReqs, propertyNote, photoCount: initialPhotoCount, onTheWaySent: initialOnTheWaySent, onUpdateStatus, isUpdating }: Props) {
  const { timezone: orgTimezone } = useOrgTimezone(organizationId);
  const extraLabels = extrasToLabels(booking.extras, orgExtras);
  const [checklistOpen, setChecklistOpen] = useState(false);
  const [isSendingOnTheWay, setIsSendingOnTheWay] = useState(false);
  const [onTheWaySent, setOnTheWaySent] = useState(initialOnTheWaySent);
  const [isMarkingArrived, setIsMarkingArrived] = useState(false);
  const [photoCount, setPhotoCount] = useState<number>(initialPhotoCount);

  // photoReqs, propertyNote, and the initial photoCount / onTheWaySent are now
  // supplied by the parent's batched query (StaffPortal) instead of a per-card
  // fetch. Photo count is re-counted on demand after an upload — a single query
  // on user action, not on mount.
  const refreshPhotoCount = async () => {
    const { count } = await supabase
      .from('booking_photos')
      .select('id', { count: 'exact', head: true })
      .eq('booking_id', booking.id);
    setPhotoCount(count ?? 0);
  };


  const destAddress = [booking.address, booking.city, booking.state, booking.zip_code].filter(Boolean).join(', ');

  const { startTracking, stopTracking, isTracking, hasArrived, markArrived } = useCleanerTracking({
    bookingId: booking.id,
    staffId: staffInfo.id || '',
    organizationId: booking.organization_id || '',
    destinationAddress: destAddress || undefined,
    destinationLat: (booking as { latitude?: number | null }).latitude,
    destinationLng: (booking as { longitude?: number | null }).longitude,
  });

  // Stop tracking when booking moves to in_progress or completed
  useEffect(() => {
    if (isTracking && (booking.status === 'in_progress' || booking.status === 'completed')) {
      stopTracking();
    }
  }, [booking.status, isTracking, stopTracking]);

  const handleArrivedClick = async () => {
    setIsMarkingArrived(true);
    try {
      await markArrived();
      toast.success('Arrival sent. Client and admin notified.');
    } catch {
      toast.error('Could not send arrival notification. Please try again.');
    } finally {
      setIsMarkingArrived(false);
    }
  };

  const handleOnTheWayClick = async () => {
    /* Was `|| !booking.customer?.phone` — a customer with no number on file
       stopped the cleaner dead AND meant the owner never got the alert. The
       missing-phone case is handled further down, where it skips only the
       customer text. */
    if (!staffInfo.id) {
      toast.error('Your staff profile is still loading — try again in a moment.');
      return;
    }

    setIsSendingOnTheWay(true);
    try {
      // Check GPS permission state before attempting tracking
      let trackingResult: Awaited<ReturnType<typeof startTracking>> = null;
      let gpsPermissionDenied = false;

      try {
        if (navigator.permissions) {
          const permStatus = await navigator.permissions.query({ name: 'geolocation' as PermissionName });
          if (permStatus.state === 'denied') {
            gpsPermissionDenied = true;
            toast('Please enable location access in your phone settings to share your location with the client.', {
              duration: 6000,
            });
          }
        }
      } catch {
        // permissions API not supported, continue anyway
      }

      // Only attempt GPS if not denied
      if (!gpsPermissionDenied) {
        try {
          trackingResult = await startTracking();
        } catch (gpsError) {
          console.warn('GPS tracking failed, proceeding with SMS only:', gpsError);
        }
      }

      // No ETA despite a good GPS fix means the destination could not be
      // resolved — no stored coordinates, and geocode-address is US-only. That
      // is the ORG's data problem, not the cleaner's: they cannot act on it and
      // telling them would be noise. Surfaced to the admin instead, best-effort
      // so it can never interfere with the send.
      if (trackingResult && trackingResult.etaMinutes == null && booking.organization_id) {
        void supabase.from('admin_system_notifications').insert({
          organization_id: booking.organization_id,
          type: 'staff_activity',
          title: '📍 No ETA sent to customer',
          message: `Couldn't work out a travel time for booking #${booking.booking_number ?? booking.id.slice(0, 8)}. The address has no saved coordinates and couldn't be looked up. The customer got an on-the-way text with no ETA. Adding the address via the map picker fixes it for future jobs.`,
          link: `/dashboard/bookings`,
          metadata: { booking_id: booking.id, staff_id: staffInfo.id, reason: 'geocode_failed' },
        }).then(({ error: notifyErr }) => {
          if (notifyErr) console.warn('[on-the-way] could not record missing-ETA notice:', notifyErr);
        });
      }

      /* No early return for a customer without a phone any more. The owner's
         alert is sent from the same call, and bailing out here meant a gap in
         the CUSTOMER's record silenced the OWNER's text too. The send skips
         only the customer leg now. */
      const customerPhone = booking.customer?.phone;


      const { data, error } = await supabase.functions.invoke('send-on-the-way-sms', {
        body: {
          bookingId: booking.id,
          staffId: staffInfo.id,
          etaMinutes: trackingResult?.etaMinutes || undefined,
          trackingToken: trackingResult?.trackingToken || undefined,
        }
      });

      if (error) throw error;

      if (data?.success) {
        toast.success(
          trackingResult
            ? 'Customer notified with live tracking link!'
            : 'Customer notified that you\'re on the way!'
        );
        setOnTheWaySent(true);
      } else {
        // The text failed, but the cleaner IS on the way — record the state so
        // they aren't locked out of starting the job by a messaging problem.
        toast.error(data?.error || 'Couldn\'t text the customer, but you\'re marked as on the way.');
        setOnTheWaySent(true);
      }
    } catch (error) {
      console.error('Error sending on the way SMS:', error);
      // Read the function's own reason. supabase-js turns every non-2xx into
      // "Edge Function returned a non-2xx status code", and the previous
      // hardcoded string discarded the real one just as thoroughly — a cleaner
      // standing outside a house was told "Failed to send notification"
      // whether the org had no SMS configured, the customer had no mobile
      // number, or OpenPhone rejected the send.
      toast.error(await readEdgeFunctionError(error, 'Failed to send notification'));
      // Same rule as the 2xx-with-failure branch above: the text failed, but the
      // cleaner IS on the way. Before this, a non-2xx left them stuck on "On my
      // way" while a 2xx failure let them through — the harder failure was the
      // one that blocked them. Whether the send failed with a 200 or a 500 is
      // not something the cleaner did, and it must not gate starting the job.
      setOnTheWaySent(true);
    } finally {
      setIsSendingOnTheWay(false);
    }
  };
  
  // Pay shown here is resolved by the one shared resolver, so this card, the
  // Earnings tab and admin Payroll can never show three different numbers for
  // the same job. Do not compute pay inline — change lib/wageCalculation.ts.
  const payResult = resolveCleanerPay(booking, staffInfo, booking.team_pay_share);
  const pay = {
    amount: payResult.calculatedPay,
    type: describeCleanerPay(payResult),
    isExact: payResult.isExact,
  };

  const getStatusBadge = (status: string) => {
    const variants: Record<string, { variant: 'default' | 'secondary' | 'outline' | 'destructive'; label: string }> = {
      pending: { variant: 'secondary', label: 'Pending' },
      confirmed: { variant: 'default', label: 'Confirmed' },
      in_progress: { variant: 'default', label: 'In Progress' },
      completed: { variant: 'outline', label: 'Completed' },
      cancelled: { variant: 'destructive', label: 'Cancelled' },
    };
    const config = variants[status] || { variant: 'secondary', label: status };
    return <Badge variant={config.variant}>{config.label}</Badge>;
  };

  const { openDirections, platform } = useMapsNavigation();
  
  const hasAddress = Boolean(booking.address);

  /*
    Day-of gate for On The Way / Start Job / GPS Check-In — a calendar-date
    comparison, not a time-of-day check.

    It used to say "local device time" and mean it. That gate decides whether a
    cleaner can start their shift at all, so a phone in a different zone than
    the business either locked them out of a job they were standing at, or
    unlocked tomorrow's a few hours early. The job's date and time are already
    rendered with formatInTimezone(orgTimezone) further down this same file, so
    the card was showing the org's day and gating on the device's.
  */
  const isScheduledToday =
    orgDateKey(new Date(booking.scheduled_at), orgTimezone) === orgDateKey(new Date(), orgTimezone);
  const NOT_TODAY_TOOLTIP = 'Available on the day of the job';

  // A confirmed or pending job whose scheduled date is in the past.
  // These are missed jobs — show "Past due" and hide action buttons.
  const isPastDue =
    (booking.status === 'confirmed' || booking.status === 'pending') &&
    new Date(booking.scheduled_at) < new Date() &&
    !isScheduledToday;

  /**
   * Forward-only job flow: On The Way → I've Arrived → Start → Complete.
   *
   * Only two links were enforced before — Arrived required On The Way, and
   * Complete required Start — while Start required nothing but the calendar
   * date. So the usable sequence was [nothing] → Start → Complete, and a
   * cleaner could finish a job having never said they were coming.
   *
   * ADMIN OVERRIDE, deliberately not a new flag: an admin setting the booking
   * to in_progress from the admin app skips this gate entirely and reveals
   * Complete, because Complete keys off status alone. A cleaner whose phone
   * dies mid-shift is unblocked by their admin with no schema change. This
   * message is what makes that route discoverable rather than folklore.
   */
  const START_NEEDS_ARRIVAL =
    "Tap \"On The Way\" then \"I've Arrived\" first. If you can't, ask your admin to start this job for you.";

  const handleDirectionsClick = () => {
    openDirections({
      address: booking.address,
      city: booking.city,
      state: booking.state,
      label: `Job #${booking.booking_number}`,
    });
  };

  return (
    <Card className="hover:shadow-md transition-shadow">
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between">
          <div>
            <CardTitle className="text-lg">#{booking.booking_number}</CardTitle>
            <p className="text-sm text-muted-foreground">{booking.service?.name || (booking.total_amount === 0 ? 'Re-clean' : 'Service')}</p>
          </div>
          {isPastDue
            ? <Badge variant="destructive">Past due</Badge>
            : getStatusBadge(booking.status)}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Pay Display - Exact vs Estimated */}
        {pay.amount > 0 && (
          <div className={`p-3 rounded-lg border ${
            pay.isExact 
              ? 'bg-primary/10 border-primary/20' 
              : 'bg-info/10 border-info/20'
          }`}>
            <div className="flex items-center justify-between">
              <div className={`flex items-center gap-2 text-sm ${
                pay.isExact ? 'text-primary' : 'text-info'
              }`}>
                <DollarSign className="w-4 h-4" />
                <span>{pay.isExact ? 'Your Pay' : 'Estimated Pay'}</span>
              </div>
              <span className={`font-bold text-lg ${
                pay.isExact ? 'text-primary' : 'text-info'
              }`}>
                ${pay.amount.toFixed(2)}
              </span>
            </div>
            <p className={`text-xs mt-1 ${
              pay.isExact ? 'text-primary/70' : 'text-info/70'
            }`}>
              {pay.type}
            </p>
          </div>
        )}

        <div className="flex items-center gap-2 text-sm">
          <Calendar className="w-4 h-4 text-muted-foreground" />
          <span>{formatInTimezone(booking.scheduled_at, orgTimezone, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}</span>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <Clock className="w-4 h-4 text-muted-foreground" />
          <span>
            {formatInTimezone(booking.scheduled_at, orgTimezone, { hour: 'numeric', minute: '2-digit', hour12: true })} ({booking.duration} min)
          </span>
        </div>
        {booking.customer && (
          <div className="flex items-center gap-2 text-sm">
            <User className="w-4 h-4 text-muted-foreground" />
            <span>
              {booking.customer.first_name} {booking.customer.last_name}
            </span>
          </div>
        )}
        {/* Always show address section - show message if missing */}
        <div className="flex items-start gap-2 text-sm">
          <MapPin className="w-4 h-4 text-muted-foreground mt-0.5" />
          {booking.address ? (
            <span>
              {booking.address}
              {booking.city ? `, ${booking.city}` : ''}
              {booking.state ? ` ${booking.state}` : ''}
              {booking.zip_code ? ` ${booking.zip_code}` : ''}
            </span>
          ) : (
            <span className="text-muted-foreground italic">No address provided</span>
          )}
        </div>

        {/* Notes section */}
        {booking.notes && (
          <div className="p-3 rounded-lg bg-warning/10 border border-warning/20">
            <div className="flex items-start gap-2">
              <FileText className="w-4 h-4 text-warning mt-0.5 flex-shrink-0" />
              <div>
                <p className="text-xs font-medium text-warning mb-1">Special Instructions</p>
                <p className="text-sm text-warning whitespace-pre-wrap">{booking.notes}</p>
              </div>
            </div>
          </div>
        )}

        {/* The customer's own note, after ours — never merged with it. Renders
            nothing when absent, which is most bookings. */}
        <CustomerNotesBlock value={booking.customer_notes} variant="staff" />

        {/* Add-ons the customer ordered. Written to bookings.extras by both
            booking forms and, until now, never shown to the person doing the
            work — a customer could pay for laundry and appliances and the
            cleaner would arrive with no idea either was ordered. */}
        {extraLabels.length > 0 && (
          <div className="p-3 rounded-lg bg-primary/5 border border-primary/20 space-y-1.5">
            <p className="text-xs font-semibold text-primary flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5" />Add-ons ordered
            </p>
            <div className="flex flex-wrap gap-1.5">
              {extraLabels.map((label) => (
                <Badge key={label} variant="secondary" className="text-xs">{label}</Badge>
              ))}
            </div>
          </div>
        )}

        {/* Property Notes */}
        {propertyNote && (propertyNote.access_instructions || propertyNote.gate_code || propertyNote.alarm_code || propertyNote.has_pets || propertyNote.parking_notes || propertyNote.notes) && (
          <div className="p-3 rounded-lg bg-info/10 border border-info/20 space-y-1.5">
            <p className="text-xs font-semibold text-info flex items-center gap-1.5"><Info className="w-3.5 h-3.5" />Property Notes</p>
            {propertyNote.notes && <p className="text-sm text-info">{propertyNote.notes}</p>}
            {propertyNote.access_instructions && (
              <p className="text-xs text-info"><span className="font-medium">Access:</span> {propertyNote.access_instructions}</p>
            )}
            {propertyNote.gate_code && (
              <p className="text-xs text-info flex items-center gap-1"><KeyRound className="w-3 h-3" /><span className="font-medium">Gate:</span> {propertyNote.gate_code}</p>
            )}
            {propertyNote.alarm_code && (
              <p className="text-xs text-info"><span className="font-medium">Alarm:</span> {propertyNote.alarm_code}</p>
            )}
            {propertyNote.has_pets && (
              <p className="text-xs text-info flex items-center gap-1"><PawPrint className="w-3 h-3" /><span className="font-medium">Pets:</span> {propertyNote.pet_notes || 'Pets on premises'}</p>
            )}
            {propertyNote.parking_notes && (
              <p className="text-xs text-info flex items-center gap-1"><ParkingCircle className="w-3 h-3" /><span className="font-medium">Parking:</span> {propertyNote.parking_notes}</p>
            )}
          </div>
        )}

        {/* Team Members */}
        {booking.team_members && booking.team_members.length > 0 && (
          <div className="p-3 rounded-lg bg-info/10 border border-info/20">
            <div className="flex items-start gap-2">
              <Users className="w-4 h-4 text-info mt-0.5 flex-shrink-0" />
              <div>
                <p className="text-xs font-medium text-info mb-1">Team Clean ({booking.team_members.length} members)</p>
                <p className="text-sm text-info">
                  {booking.team_members.join(' • ')}
                </p>
              </div>
            </div>
          </div>
        )}

        {isTracking && (
          <div className="p-2.5 rounded-lg bg-info/10 border border-info/20 text-xs text-info">
            📍 Sharing your live location — keep this screen open so the client can see you on the way.
          </div>
        )}

        {booking.status === 'in_progress' && (
          <div className="p-2.5 rounded-lg bg-warning/10 border border-warning/20 text-xs text-warning">
            ⚠️ Heads up: your location will stop recording once you mark this job complete.
          </div>
        )}

        {isPastDue && (
          <p className="text-xs text-muted-foreground pt-2">
            This job is past its scheduled date. Ask your admin to close it out.
          </p>
        )}

        {!isPastDue && <div className="flex flex-wrap gap-2 pt-2">

          {/* On The Way — always rendered for a confirmed job.
              It used to require booking.customer?.phone, welding two different
              things together: marking yourself on the way is a STATE CHANGE
              about the cleaner; texting the customer is a NOTIFICATION. With
              Start now gated behind this, requiring a phone would have made a
              job for a phoneless customer impossible to begin. The SMS is
              skipped when there's no number; the state change always happens. */}
          {booking.status === 'confirmed' && (
            <div className="flex flex-col gap-1">
              <Button
                variant={onTheWaySent ? "secondary" : "default"}
                size="sm"
                className="gap-2 bg-info hover:bg-info/90"
                onClick={handleOnTheWayClick}
                disabled={isSendingOnTheWay || onTheWaySent || !isScheduledToday}
                title={!isScheduledToday ? NOT_TODAY_TOOLTIP : undefined}
              >
                {isSendingOnTheWay ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Car className="w-4 h-4" />
                )}
                {onTheWaySent ? 'Sent!' : 'On The Way'}
              </Button>
              {!isScheduledToday && (
                <p className="text-[11px] text-muted-foreground">{NOT_TODAY_TOOLTIP}</p>
              )}
            </div>
          )}

          {/* I've Arrived - manual arrival (no background GPS on iOS, so the
              cleaner confirms; also fires if geofence already detected it) */}
          {onTheWaySent && booking.status === 'confirmed' && (
            <Button
              variant={hasArrived ? "secondary" : "default"}
              size="sm"
              className="gap-2 bg-success hover:bg-success/90"
              onClick={handleArrivedClick}
              disabled={isMarkingArrived || hasArrived}
            >
              {isMarkingArrived ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <MapPin className="w-4 h-4" />
              )}
              {hasArrived ? 'Arrived ✓' : "I've Arrived"}
            </Button>
          )}
          {hasAddress && (
            <Button
              variant="outline"
              size="sm"
              className="gap-2"
              onClick={handleDirectionsClick}
            >
              <Navigation className="w-4 h-4" />
              Directions
            </Button>
          )}
          {/* GPS Check-In when starting job */}
          {staffInfo.id && booking.status === 'confirmed' && booking.organization_id && (
            <GpsCheckin
              bookingId={booking.id}
              staffId={staffInfo.id}
              organizationId={booking.organization_id}
              bookingAddress={destAddress || null}
              type="check_in"
              disabled={!isScheduledToday || !hasArrived}
              disabledReason={!isScheduledToday ? NOT_TODAY_TOOLTIP : START_NEEDS_ARRIVAL}
            />
          )}
          {/* GPS Check-Out when completing job */}
          {staffInfo.id && booking.status === 'in_progress' && booking.organization_id && (
            <GpsCheckin
              bookingId={booking.id}
              staffId={staffInfo.id}
              organizationId={booking.organization_id}
              bookingAddress={destAddress || null}
              type="check_out"
            />
          )}
          {/* Airbnb Inspection Report */}
          {staffInfo.id && booking.status === 'in_progress' && booking.organization_id && (
            <PropertyInspectionUpload
              bookingId={booking.id}
              staffId={staffInfo.id}
              organizationId={booking.organization_id}
            />
          )}
          {staffInfo.id && (booking.status === 'in_progress' || booking.status === 'confirmed') && (
            <Dialog open={checklistOpen} onOpenChange={setChecklistOpen}>
              <DialogTrigger asChild>
                <Button variant="outline" size="sm" className="gap-2">
                  <ClipboardCheck className="w-4 h-4" />
                  Checklist
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle>Job #{booking.booking_number} Checklist</DialogTitle>
                </DialogHeader>
                <BookingChecklist
                  bookingId={booking.id}
                  staffId={staffInfo.id}
                  organizationId={booking.organization_id || ''}
                  onComplete={() => setChecklistOpen(false)}
                />
              </DialogContent>
            </Dialog>
          )}
          {staffInfo.id && booking.status === 'in_progress' && (
            <div className="flex flex-col gap-1 w-full">
              <BookingPhotoUpload
                bookingId={booking.id}
                staffId={staffInfo.id}
                organizationId={booking.organization_id || ''}
                onPhotoUploaded={refreshPhotoCount}
              />
              {photoReqs.required && (
                <p className="text-xs text-muted-foreground">
                  {photoCount} photo{photoCount === 1 ? '' : 's'} uploaded (optional)
                </p>
              )}

            </div>
          )}
          {booking.status === 'confirmed' && onUpdateStatus && (
            <div className="flex flex-col gap-1 flex-1">
              <Button
                size="sm"
                className="w-full"
                onClick={() => onUpdateStatus(booking.id, 'in_progress')}
                disabled={isUpdating || !isScheduledToday}
                title={!isScheduledToday ? NOT_TODAY_TOOLTIP : undefined}
              >
                Start Job
              </Button>
              {!isScheduledToday && (
                <p className="text-[11px] text-muted-foreground">{NOT_TODAY_TOOLTIP}</p>
              )}
            </div>
          )}
          {booking.status === 'in_progress' && onUpdateStatus && (
            <Button
              size="sm"
              className="flex-1"
              onClick={() => onUpdateStatus(booking.id, 'completed')}
              disabled={isUpdating}
            >
              Complete Job
            </Button>
          )}

        </div>}
      </CardContent>
    </Card>
  );
}
