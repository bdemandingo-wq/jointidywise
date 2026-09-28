import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { extrasToLabels, type ExtraOption } from '@/lib/bookingExtras';
import { Button } from '@/components/ui/button';
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
import { Calendar, MapPin, Clock, User, CheckCircle2, DollarSign, TrendingUp, Loader2, FileText, Sparkles } from 'lucide-react';
import { useOrgTimezone } from '@/hooks/useOrgTimezone';
import { formatInTimezone } from '@/lib/timezoneUtils';
import { resolveCleanerPay, describeCleanerPay, type WageBooking, type WageStaff } from '@/lib/wageCalculation';
import { CustomerNotesBlock } from '@/components/CustomerNotesBlock';

type StaffInfo = WageStaff;

interface Booking extends WageBooking {
  id: string;
  booking_number: number;
  scheduled_at: string;
  status: string;
  address: string | null;
  city: string | null;
  state: string | null;
  square_footage?: string | null;
  bedrooms?: string | null;
  bathrooms?: string | null;
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
}

interface Props {
  booking: Booking;
  staffInfo: StaffInfo;
  /** See MyJobCard — the staff row's org, not the context's. */
  organizationId: string | null;
  /** Slug -> label map for add-ons, from the org's own price list. */
  orgExtras?: ExtraOption[];
  onAssign: (bookingId: string) => void;
  isAssigning: boolean;
  claimingBookingId?: string | null;
}

export function AvailableJobCard({ booking, staffInfo, organizationId, orgExtras, onAssign, isAssigning, claimingBookingId }: Props) {
  const { timezone: orgTimezone } = useOrgTimezone(organizationId);
  const extraLabels = extrasToLabels(booking.extras, orgExtras);
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const isClaimingThisJob = isAssigning && claimingBookingId === booking.id;

  // Same resolver as MyJobCard, so the estimate a cleaner sees before claiming
  // a job matches what they see after claiming it — and what payroll pays.
  // No pay_share: an unclaimed job has no team assignment row yet.
  const payResult = resolveCleanerPay(booking, staffInfo);
  const earnings = {
    amount: payResult.calculatedPay,
    type: describeCleanerPay(payResult),
  };

  const handleClaimClick = () => {
    setShowConfirmDialog(true);
  };

  const handleConfirmClaim = () => {
    setShowConfirmDialog(false);
    onAssign(booking.id);
  };

  return (
    <>
      <Card className="hover:shadow-md transition-shadow border-2 border-dashed border-success/20">
        <CardHeader className="pb-2">
          <div className="flex items-start justify-between">
            <div>
              <CardTitle className="text-lg">#{booking.booking_number}</CardTitle>
              <p className="text-sm text-muted-foreground">{booking.service?.name || (booking.total_amount === 0 ? 'Re-clean' : 'Service')}</p>
            </div>
            <Badge variant="outline" className="bg-success/10 text-success">
              Open
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {/* Potential Earnings - Highlighted */}
          <div className="p-3 rounded-lg bg-success/10 border border-success/20">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm text-success">
                <DollarSign className="w-4 h-4" />
                <span>Potential Earnings</span>
              </div>
              <div className="flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-success" />
                <span className="font-bold text-lg text-success">
                  ${earnings.amount.toFixed(2)}
                </span>
              </div>
            </div>
            <p className="text-xs text-success mt-1">{earnings.type}</p>
          </div>

          {/* Property Details */}
          <div className="flex flex-wrap gap-2 text-xs">
            {booking.square_footage && (
              <Badge variant="outline" className="bg-background">
                {booking.square_footage} sq ft
              </Badge>
            )}
            {booking.bedrooms && (
              <Badge variant="outline" className="bg-background">
                {booking.bedrooms} bed
              </Badge>
            )}
            {booking.bathrooms && (
              <Badge variant="outline" className="bg-background">
                {booking.bathrooms} bath
              </Badge>
            )}
          </div>

          <div className="flex items-center gap-2 text-sm">
            <Calendar className="w-4 h-4 text-muted-foreground" />
            <span>{formatInTimezone(booking.scheduled_at, orgTimezone, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}</span>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <Clock className="w-4 h-4 text-muted-foreground" />
            <span>
              {formatInTimezone(booking.scheduled_at, orgTimezone, { hour: 'numeric', minute: '2-digit', hour12: true, timeZoneName: 'short' })} ({booking.duration} min)
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
          {booking.address && (
            <div className="flex items-start gap-2 text-sm">
              <MapPin className="w-4 h-4 text-muted-foreground mt-0.5" />
              <span>
                {booking.address}
                {booking.city ? `, ${booking.city}` : ''}
                {booking.state ? `, ${booking.state}` : ''}
              </span>
            </div>
          )}
          {/* Add-ons, shown BEFORE claiming — a cleaner deciding whether to
              take a job should know it includes laundry and appliances first,
              not on arrival. */}
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
          <Button
            className="w-full mt-2 gap-2 bg-success hover:bg-success/90"
            onClick={handleClaimClick}
            disabled={isClaimingThisJob}
          >
            {isClaimingThisJob ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Claiming Job...
              </>
            ) : (
              <>
                <CheckCircle2 className="w-4 h-4" />
                Claim This Job
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      <AlertDialog open={showConfirmDialog} onOpenChange={setShowConfirmDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm Job Claim</AlertDialogTitle>
            <AlertDialogDescription className="space-y-3">
              <p>You are about to claim job #{booking.booking_number}.</p>
              <div className="p-4 rounded-lg bg-success/10 border border-success/20">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-success">Potential Pay</span>
                  <span className="font-bold text-xl text-success">
                    ${earnings.amount.toFixed(2)}
                  </span>
                </div>
              </div>
              <p className="text-sm">
                <strong>Date:</strong> {formatInTimezone(booking.scheduled_at, orgTimezone, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })} at {formatInTimezone(booking.scheduled_at, orgTimezone, { hour: 'numeric', minute: '2-digit', hour12: true, timeZoneName: 'short' })}
              </p>
              {booking.address && (
                <p className="text-sm">
                  <strong>Location:</strong> {booking.address}{booking.city ? `, ${booking.city}` : ''}{booking.state ? `, ${booking.state}` : ''}
                </p>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction 
              onClick={handleConfirmClaim}
              className="bg-success hover:bg-success/90"
            >
              Confirm & Claim Job
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
