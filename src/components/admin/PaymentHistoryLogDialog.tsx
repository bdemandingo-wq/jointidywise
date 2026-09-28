import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Loader2, CreditCard, DollarSign, XCircle, Clock, CheckCircle } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { format } from 'date-fns';
import { BookingWithDetails } from '@/hooks/useBookings';
import { fmt } from '@/lib/activeCurrency';
import { OrgTimestamp } from '@/components/OrgTimestamp';

interface PaymentHistoryLogDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  booking: BookingWithDetails | null;
}

interface PaymentEvent {
  id: string;
  type: 'hold' | 'capture' | 'charge' | 'refund' | 'release' | 'status_change';
  description: string;
  amount?: number;
  status: 'success' | 'pending' | 'failed';
  timestamp: string;
  details?: string;
}

export function PaymentHistoryLogDialog({ open, onOpenChange, booking }: PaymentHistoryLogDialogProps) {
  const [events, setEvents] = useState<PaymentEvent[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open && booking) {
      fetchPaymentHistory();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- fetchPaymentHistory is recreated each render; runs when dialog opens
  }, [open, booking]);

  const fetchPaymentHistory = async () => {
    if (!booking) return;
    
    setLoading(true);
    try {
      // Build payment history from booking data
      const paymentEvents: PaymentEvent[] = [];
      
      // Add booking creation event
      paymentEvents.push({
        id: `created-${booking.id}`,
        type: 'status_change',
        description: 'Booking created',
        amount: booking.total_amount,
        status: 'success',
        timestamp: booking.created_at,
        details: `Service: ${booking.service?.name || 'Unknown'}`
      });

      // Check if there's a payment intent (hold was placed)
      const paymentIntentId = (booking as any).payment_intent_id;
      if (paymentIntentId) {
        paymentEvents.push({
          id: `hold-${booking.id}`,
          type: 'hold',
          description: 'Payment hold placed',
          amount: booking.total_amount,
          status: 'success',
          timestamp: booking.created_at,
          details: `Payment Intent: ${paymentIntentId.slice(0, 20)}...`
        });
      }

      // Check deposit paid
      if (booking.deposit_paid && booking.deposit_paid > 0) {
        paymentEvents.push({
          id: `deposit-${booking.id}`,
          type: 'charge',
          description: 'Deposit collected',
          amount: booking.deposit_paid,
          status: 'success',
          timestamp: booking.created_at,
          details: 'Initial deposit payment'
        });
      }

      // Check payment status for final payment
      if (booking.payment_status === 'paid') {
        paymentEvents.push({
          id: `paid-${booking.id}`,
          type: 'capture',
          description: paymentIntentId ? 'Payment captured from hold' : 'Payment completed',
          amount: booking.total_amount,
          status: 'success',
          timestamp: booking.updated_at,
          details: 'Full payment received'
        });
      } else if (booking.payment_status === 'refunded') {
        paymentEvents.push({
          id: `refund-${booking.id}`,
          type: 'release',
          description: 'Payment hold released/refunded',
          amount: booking.total_amount,
          status: 'success',
          timestamp: booking.updated_at,
          details: 'Funds returned to customer'
        });
      } else if (booking.payment_status === 'partial') {
        paymentEvents.push({
          id: `partial-${booking.id}`,
          type: 'hold',
          description: 'Partial payment/hold active',
          amount: booking.deposit_paid || 0,
          status: 'pending',
          timestamp: booking.updated_at,
          details: `Hold pending capture - $${booking.total_amount} authorized`
        });
      }

      // Check cleaner payment
      const cleanerPayment = (booking as any).cleaner_actual_payment;
      if (cleanerPayment && cleanerPayment > 0) {
        paymentEvents.push({
          id: `cleaner-${booking.id}`,
          type: 'charge',
          description: 'Cleaner payment processed',
          amount: cleanerPayment,
          status: 'success',
          timestamp: booking.updated_at,
          details: `Paid to: ${booking.staff?.name || 'Staff member'}`
        });
      }

      // Sort by timestamp descending
      paymentEvents.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
      
      setEvents(paymentEvents);
    } catch (error) {
      console.error('Failed to fetch payment history:', error);
    } finally {
      setLoading(false);
    }
  };

  const getEventIcon = (type: PaymentEvent['type']) => {
    switch (type) {
      case 'hold':
        return <Clock className="w-4 h-4" />;
      case 'capture':
        return <CheckCircle className="w-4 h-4" />;
      case 'charge':
        return <CreditCard className="w-4 h-4" />;
      case 'refund':
      case 'release':
        return <XCircle className="w-4 h-4" />;
      default:
        return <DollarSign className="w-4 h-4" />;
    }
  };

  const getEventColor = (type: PaymentEvent['type'], status: PaymentEvent['status']) => {
    if (status === 'failed') return 'bg-destructive/10 text-destructive';
    if (status === 'pending') return 'bg-warning/10 text-warning';

    switch (type) {
      case 'hold':
        return 'bg-warning/10 text-warning';
      case 'capture':
      case 'charge':
        return 'bg-success/10 text-success';
      case 'refund':
      case 'release':
        return 'bg-muted text-muted-foreground';
      default:
        return 'bg-info/10 text-info';
    }
  };

  const getStatusBadge = (status: PaymentEvent['status']) => {
    switch (status) {
      case 'success':
        return <Badge variant="outline" className="bg-success/10 text-success border-success/20">Success</Badge>;
      case 'pending':
        return <Badge variant="outline" className="bg-warning/10 text-warning border-warning/20">Pending</Badge>;
      case 'failed':
        return <Badge variant="outline" className="bg-destructive/10 text-destructive border-destructive/20">Failed</Badge>;
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CreditCard className="w-5 h-5 text-primary" />
            Payment History
            {booking && (
              <Badge variant="secondary" className="ml-2">
                #{booking.booking_number}
              </Badge>
            )}
          </DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
          </div>
        ) : events.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            <Clock className="w-12 h-12 mx-auto mb-4 opacity-50" />
            <p>No payment events found</p>
          </div>
        ) : (
          <ScrollArea className="max-h-[400px] pr-4">
            <div className="space-y-4">
              {events.map((event, index) => (
                <div 
                  key={event.id} 
                  className="relative flex gap-4 pb-4"
                >
                  {/* Timeline line */}
                  {index < events.length - 1 && (
                    <div className="absolute left-[19px] top-10 bottom-0 w-0.5 bg-border" />
                  )}
                  
                  {/* Icon */}
                  <div className={`flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center ${getEventColor(event.type, event.status)}`}>
                    {getEventIcon(event.type)}
                  </div>
                  
                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="font-medium text-foreground">{event.description}</p>
                        {event.details && (
                          <p className="text-sm text-muted-foreground mt-0.5">{event.details}</p>
                        )}
                      </div>
                      {event.amount !== undefined && event.amount > 0 && (
                        <span className="font-bold text-foreground whitespace-nowrap">
                          ${event.amount.toFixed(2)}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 mt-2">
                      {getStatusBadge(event.status)}
                      <span className="text-xs text-muted-foreground">
                        <OrgTimestamp value={event.timestamp} />
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
        )}

        {booking && (
          <div className="mt-4 pt-4 border-t border-border">
            <div className="flex justify-between items-center text-sm">
              <span className="text-muted-foreground">Current Status:</span>
              <Badge 
                variant="outline" 
                className={
                  booking.payment_status === 'paid'
                    ? 'bg-success/10 text-success border-success/20'
                    : booking.payment_status === 'refunded'
                      ? 'bg-muted text-muted-foreground border-border'
                      : 'bg-warning/10 text-warning border-warning/20'
                }
              >
                {booking.payment_status === 'paid' ? 'Paid' : 
                 booking.payment_status === 'refunded' ? 'Refunded' : 
                 booking.payment_status === 'partial' ? 'Hold Active' : 'Pending'}
              </Badge>
            </div>
            <div className="flex justify-between items-center text-sm mt-2">
              <span className="text-muted-foreground">Total Amount:</span>
              <span className="font-bold">{fmt(booking.total_amount)}</span>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
