import { useState, useMemo } from 'react';
import { BookingWithDetails } from '@/hooks/useBookings';
import { cn } from '@/lib/utils';
import { Clock, User, ChevronRight, Phone, Loader2, Edit, MapPin, Bell } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { supabase } from '@/lib/supabase';
import { useOrgTimezone } from '@/hooks/useOrgTimezone';
import { formatInTimezone, getDateInTimezone } from '@/lib/timezoneUtils';
import { toast } from 'sonner';
import { handleSmsError } from '@/lib/smsErrorHandler';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useNavigate } from 'react-router-dom';
import { EditCustomerDialog } from './EditCustomerDialog';
import { AddBookingDialog } from './AddBookingDialog';
import { useTestMode } from '@/contexts/TestModeContext';
import { useOrganization } from '@/contexts/OrganizationContext';
import { formatInOrgTz } from '@/lib/orgDateRange';

interface UpcomingBookingsProps {
  bookings: BookingWithDetails[];
}

const statusColors: Record<string, string> = {
  pending: 'bg-warning/20 text-warning border-warning/30',
  confirmed: 'bg-primary/20 text-primary border-primary/30',
  in_progress: 'bg-info/20 text-info border-info/30',
  completed: 'bg-success/20 text-success border-success/30',
  cancelled: 'bg-destructive/20 text-destructive border-destructive/30',
  no_show: 'bg-muted text-muted-foreground border-muted',
};

const statusLabels: Record<string, string> = {
  pending: 'pending payment',
  confirmed: 'scheduled',
  in_progress: 'in progress',
  completed: 'completed',
  cancelled: 'cancelled',
  no_show: 'no show',
};

// Service accent classes — token-driven, cycles through semantic palette
const serviceAccentClasses = [
  'bg-primary',
  'bg-success',
  'bg-info',
  'bg-warning',
  'bg-accent',
  'bg-secondary',
  'bg-destructive',
];

export function UpcomingBookings({ bookings }: UpcomingBookingsProps) {
  const navigate = useNavigate();
  const [selectedBooking, setSelectedBooking] = useState<BookingWithDetails | null>(null);
  const [sendingEmail, setSendingEmail] = useState(false);
  const [sendingClientNotif, setSendingClientNotif] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<BookingWithDetails['customer'] | null>(null);
  const [editingBooking, setEditingBooking] = useState<BookingWithDetails | null>(null);
  const { isTestMode, maskName, maskEmail, maskAddress, maskAmount } = useTestMode();
  const { organization } = useOrganization();
  const { timezone: orgTimezone } = useOrgTimezone();

  const upcomingBookings = useMemo(() => {
    const todayStr = getDateInTimezone(new Date(), orgTimezone);

    return bookings
      .filter(b => {
        const bookingDayStr = getDateInTimezone(b.scheduled_at, orgTimezone);
        return bookingDayStr >= todayStr && b.status !== 'cancelled';
      })
      .sort((a, b) => new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime())
      .slice(0, 5);
  }, [bookings, orgTimezone]);

  const getServiceAccentClass = (index: number) => {
    return serviceAccentClasses[index % serviceAccentClasses.length];
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

      // Send all SMS notifications in parallel rather than sequentially
      const results = await Promise.allSettled(
        staffToNotify.map(async (staffMember) => {
          const response = await supabase.functions.invoke('send-cleaner-notification', {
            body: {
              cleanerName: staffMember.name,
              cleanerPhone: staffMember.phone,
              customerName,
              customerPhone: booking.customer?.phone || 'Not provided',
              serviceName: booking.service?.name || 'Cleaning Service',
              appointmentDate: formatInTimezone(booking.scheduled_at, orgTimezone, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }),
              appointmentTime: formatInTimezone(booking.scheduled_at, orgTimezone, { hour: 'numeric', minute: '2-digit', hour12: true, timeZoneName: 'short' }),
              address: [booking.address, (booking as any).apt_suite ? `Unit ${(booking as any).apt_suite}` : null, booking.city, booking.state, booking.zip_code].filter(Boolean).join(', ') || 'Address not provided',
              bookingNumber: booking.booking_number,
              organizationId: organization?.id,
            },
          });
          if ((await handleSmsError(response))) throw new Error('SMS error');
        })
      );
      const successCount = results.filter(r => r.status === 'fulfilled').length;
      const failCount = results.filter(r => r.status === 'rejected').length;

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
    if (!booking.customer?.phone) {
      toast.error('No customer phone number found');
      return;
    }
    setSendingClientNotif(true);
    try {
      const scheduledDate = new Date(booking.scheduled_at);
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
        },
      });
      if ((await handleSmsError(response))) return;
      toast.success(`Reminder sent to ${booking.customer.first_name}`);
    } catch (err: any) {
      toast.error('Failed to notify client: ' + (err.message || 'Unknown error'));
    } finally {
      setSendingClientNotif(false);
    }
  };

  const handleCustomerClick = (booking: BookingWithDetails, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedBooking(booking);
  };

  const handleEditCustomer = () => {
    if (selectedBooking?.customer) {
      setEditingCustomer(selectedBooking.customer);
    }
  };

  const handleEditBooking = () => {
    if (selectedBooking) {
      setEditingBooking(selectedBooking);
      setSelectedBooking(null);
    }
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
    <>
      <div className="bg-card rounded-xl border border-border shadow-sm">
        <div className="flex items-center justify-between p-4 border-b border-border">
          <h3 className="text-lg font-semibold text-foreground">Upcoming Bookings</h3>
          <Button 
            variant="ghost" 
            size="sm" 
            className="gap-1 text-primary"
            onClick={() => navigate('/dashboard/bookings')}
          >
            View all <ChevronRight className="w-4 h-4" />
          </Button>
        </div>
        <div className="divide-y divide-border">
          {upcomingBookings.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground">
              No upcoming bookings
            </div>
          ) : (
            upcomingBookings.map((booking, index) => (
              <div
                key={booking.id}
                className="p-4 hover:bg-muted/30 transition-colors cursor-pointer"
                onClick={() => setSelectedBooking(booking)}
              >
                <div className="flex items-start gap-3">
                  <div
                    className={cn("w-1 h-full min-h-[60px] rounded-full", getServiceAccentClass(index))}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-medium truncate">{booking.service?.name || 'Service'}</p>
                      <Badge className={cn('capitalize text-xs', statusColors[booking.status])}>
                        {statusLabels[booking.status] || booking.status}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-4 mt-2 text-sm text-muted-foreground">
                        <button 
                          className="flex items-center gap-1 hover:text-primary transition-colors"
                          onClick={(e) => handleCustomerClick(booking, e)}
                        >
                          <User className="w-3.5 h-3.5" />
                          <span className="truncate">
                            {booking.customer 
                              ? maskName(`${booking.customer.first_name} ${booking.customer.last_name}`)
                              : 'Unknown'}
                        </span>
                      </button>
                      <div className="flex items-center gap-1">
                        <Clock className="w-3.5 h-3.5" />
                        <span>{formatInTimezone(booking.scheduled_at, orgTimezone, { hour: 'numeric', minute: '2-digit', hour12: true, timeZoneName: 'short' })}</span>
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      {formatInTimezone(booking.scheduled_at, orgTimezone, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}
                    </p>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

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
                  {selectedBooking.service?.name || 'Cleaning Service'}
                </span>
                <Badge className={cn('capitalize', statusColors[selectedBooking.status])}>
                  {statusLabels[selectedBooking.status] || selectedBooking.status}
                </Badge>
              </div>
              
              <div className="text-sm text-muted-foreground">
                Booking #{selectedBooking.booking_number}
              </div>
              
              <div className="space-y-3">
                <div className="flex items-center justify-between">
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
                  {selectedBooking.customer && (
                    <Button variant="outline" size="sm" onClick={handleEditCustomer}>
                      Edit
                    </Button>
                  )}
                </div>
                
                <div className="flex items-center gap-3 text-sm">
                  <Clock className="w-4 h-4 text-muted-foreground" />
                  <div>
                    <p className="font-medium">
                      {formatInTimezone(selectedBooking.scheduled_at, orgTimezone, { month: 'long', day: 'numeric', year: 'numeric' })} at{' '}
                      {formatInTimezone(selectedBooking.scheduled_at, orgTimezone, { hour: 'numeric', minute: '2-digit', hour12: true, timeZoneName: 'short' })}
                    </p>
                    <p className="text-muted-foreground">
                      Duration: {selectedBooking.duration} minutes
                    </p>
                  </div>
                </div>

                {getFullAddress(selectedBooking) && (
                  <div className="flex items-center gap-3 text-sm">
                    <MapPin className="w-4 h-4 text-muted-foreground" />
                    <p>{maskAddress(getFullAddress(selectedBooking))}</p>
                  </div>
                )}

                {selectedBooking.staff && (
                  <div className="flex items-center gap-3 text-sm">
                    <User className="w-4 h-4 text-muted-foreground" />
                    <div>
                      <p className="font-medium">Assigned: {maskName(selectedBooking.staff.name)}</p>
                      <p className="text-muted-foreground">{maskEmail(selectedBooking.staff.email)}</p>
                    </div>
                  </div>
                )}
              </div>

              <div className="pt-4 border-t">
                <span className="text-lg font-bold block mb-3">{maskAmount(selectedBooking.total_amount)}</span>
                <div className="grid grid-cols-3 gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1 text-xs flex-col h-auto py-2"
                    onClick={handleEditBooking}
                  >
                    <Edit className="w-4 h-4" />
                    Edit
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1 text-xs flex-col h-auto py-2"
                    onClick={() => sendClientNotification(selectedBooking)}
                    disabled={sendingClientNotif || !selectedBooking.customer?.phone}
                  >
                    {sendingClientNotif ? <Loader2 className="w-4 h-4 animate-spin" /> : <Bell className="w-4 h-4" />}
                    Notify Client
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1 text-xs flex-col h-auto py-2"
                    onClick={() => sendCleanerNotification(selectedBooking)}
                    disabled={sendingEmail || !selectedBooking.staff?.phone}
                  >
                    {sendingEmail ? <Loader2 className="w-4 h-4 animate-spin" /> : <Phone className="w-4 h-4" />}
                    Notify Cleaner
                  </Button>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Edit Customer Dialog */}
      <EditCustomerDialog 
        open={!!editingCustomer} 
        onOpenChange={(open) => !open && setEditingCustomer(null)}
        customer={editingCustomer}
      />

      {/* Edit Booking Dialog */}
      <AddBookingDialog 
        open={!!editingBooking} 
        onOpenChange={(open) => !open && setEditingBooking(null)}
        booking={editingBooking}
      />
    </>
  );
}
