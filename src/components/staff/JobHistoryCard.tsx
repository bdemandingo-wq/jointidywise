import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { format } from 'date-fns';
import { Calendar, MapPin, Clock, DollarSign, CheckCircle } from 'lucide-react';
import { OrgTimestamp } from '@/components/OrgTimestamp';

interface Booking {
  id: string;
  booking_number: number;
  scheduled_at: string;
  duration: number;
  status: string;
  address: string | null;
  city: string | null;
  state: string | null;
  total_amount: number;
  cleaner_actual_payment: number | null;
  customer: {
    first_name: string;
    last_name: string;
  } | null;
  service: {
    name: string;
  } | null;
}

interface Props {
  booking: Booking;
}

export function JobHistoryCard({ booking }: Props) {
  const getStatusBadge = (status: string) => {
    const config: Record<string, { variant: 'default' | 'secondary' | 'outline' | 'destructive'; label: string }> = {
      completed: { variant: 'default', label: 'Completed' },
      cancelled: { variant: 'destructive', label: 'Cancelled' },
      no_show: { variant: 'secondary', label: 'No Show' },
    };
    const { variant, label } = config[status] || { variant: 'secondary', label: status };
    return <Badge variant={variant}>{label}</Badge>;
  };

  return (
    <Card className="hover:shadow-sm transition-shadow opacity-90">
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between">
          <div>
            <CardTitle className="text-lg flex items-center gap-2">
              #{booking.booking_number}
              {booking.status === 'completed' && (
                <CheckCircle className="w-4 h-4 text-green-500" />
              )}
            </CardTitle>
            <p className="text-sm text-muted-foreground">{booking.service?.name || (booking.total_amount === 0 ? 'Re-clean' : 'Service')}</p>
          </div>
          {getStatusBadge(booking.status)}
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {/* Your Earnings */}
        {booking.cleaner_actual_payment && booking.cleaner_actual_payment > 0 && (
          <div className="p-2 rounded-lg bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm text-green-700 dark:text-green-300">
                <DollarSign className="w-4 h-4" />
                <span>You Earned</span>
              </div>
              <span className="font-bold text-green-700 dark:text-green-300">
                ${booking.cleaner_actual_payment.toFixed(2)}
              </span>
            </div>
          </div>
        )}

        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Calendar className="w-4 h-4" />
          <span>{format(new Date(booking.scheduled_at), 'EEE, MMM d, yyyy')}</span>
        </div>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Clock className="w-4 h-4" />
          <span>
            <OrgTimestamp value={booking.scheduled_at} /> ({booking.duration} min)
          </span>
        </div>
        {booking.customer && (
          <p className="text-sm text-muted-foreground">
            {booking.customer.first_name} {booking.customer.last_name}
          </p>
        )}
        {booking.address && (
          <div className="flex items-start gap-2 text-sm text-muted-foreground">
            <MapPin className="w-4 h-4 mt-0.5" />
            <span>
              {booking.address}
              {booking.city ? `, ${booking.city}` : ''}
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
