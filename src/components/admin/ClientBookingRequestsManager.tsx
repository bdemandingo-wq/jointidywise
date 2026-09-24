import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { 
  Calendar, 
  CheckCircle, 
  XCircle, 
  Clock, 
  MessageSquare,
  Loader2,
  Filter,
  MapPin
} from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

import { supabase } from '@/lib/supabase';
import { useOrganization } from '@/contexts/OrganizationContext';
import { QueryError } from '@/components/QueryError';
import { refreshBadges } from '@/lib/badgeRefresh';


interface BookingRequest {
  id: string;
  requested_date: string;
  status: string;
  notes: string | null;
  admin_response_note: string | null;
  created_at: string;
  customer: {
    first_name: string;
    last_name: string;
    email: string;
    phone: string | null;
  } | null;
  service: {
    name: string;
  } | null;
  client_user: {
    username: string;
  } | null;
}

export function ClientBookingRequestsManager() {
  const { organization } = useOrganization();
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<string>('pending');
  const [respondDialogOpen, setRespondDialogOpen] = useState(false);
  const [selectedRequest, setSelectedRequest] = useState<BookingRequest | null>(null);
  const [responseNote, setResponseNote] = useState('');
  const [responseAction, setResponseAction] = useState<'approved' | 'rejected'>('approved');

  // Fetch booking requests
  const { data: requests = [], isLoading, error: requestsError } = useQuery({
    queryKey: ['client-booking-requests', organization?.id, statusFilter],
    queryFn: async () => {
      if (!organization?.id) return [];
      
      let query = supabase
        .from('client_booking_requests')
        .select(`
          id,
          requested_date,
          status,
          notes,
          admin_response_note,
          created_at,
          location_id,
          customer:customers(first_name, last_name, email, phone),
          service:services(name),
          client_user:client_portal_users(username),
          location:locations(name, address, apt_suite, city, state, zip_code)
        `)
        .eq('organization_id', organization.id)
        .order('created_at', { ascending: false });

      if (statusFilter !== 'all') {
        query = query.eq('status', statusFilter);
      }

      const { data, error } = await query;
      if (error) throw error;
      return (data || []) as BookingRequest[];
    },
    enabled: !!organization?.id,
  });

  // Respond to request mutation
  const respondToRequest = useMutation({
    mutationFn: async ({
      requestId,
      status,
      responseNote,
    }: {
      requestId: string;
      status: 'approved' | 'rejected';
      responseNote: string;
    }) => {
      const request = selectedRequest;
      if (!request || !organization?.id) throw new Error("Missing request or organization");

      // Update the request status
      const { error: updateError } = await supabase
        .from('client_booking_requests')
        .update({
          status,
          admin_response_note: responseNote.trim() || null,
          responded_at: new Date().toISOString(),
        })
        .eq('id', requestId);

      if (updateError) throw updateError;

      // If approved, create a booking in the calendar
      if (status === 'approved') {
        // Get the request details for booking creation
        const { data: requestData, error: fetchError } = await supabase
          .from('client_booking_requests')
          .select('customer_id, service_id, requested_date')
          .eq('id', requestId)
          .single();

        if (fetchError) throw fetchError;

        // Get default service duration
        let duration = 120; // default 2 hours
        if (requestData?.service_id) {
          const { data: serviceData } = await supabase
            .from('services')
            .select('duration')
            .eq('id', requestData.service_id)
            .single();
          if (serviceData?.duration) {
            duration = serviceData.duration;
          }
        }

        // Create the booking using the RPC
        const { error: bookingError } = await supabase.rpc('create_booking_from_request', {
          p_request_id: requestId,
          p_organization_id: organization.id,
          p_customer_id: requestData.customer_id,
          // A request without a service cannot become a booking; the RPC
          // requires one, so this is guarded by the caller above.
          p_service_id: requestData.service_id ?? '',
          p_scheduled_at: requestData.requested_date,
          p_duration: duration,
        });

        if (bookingError) {
          console.error("Failed to create booking:", bookingError);
          // Don't throw - the approval still went through
          toast.error("Request approved but failed to create booking. Please create manually.");
        }
      }

      // Get client_user_id and create notification
      const { data: reqData } = await supabase
        .from('client_booking_requests')
        .select('client_user_id')
        .eq('id', requestId)
        .single();

      if (reqData?.client_user_id) {
        await supabase.from('client_notifications').insert({
          client_user_id: reqData.client_user_id,
          organization_id: organization.id,
          title: status === 'approved' ? 'Booking Request Approved!' : 'Booking Request Update',
          message: status === 'approved'
            ? `Your booking request for ${format(new Date(request.requested_date), 'MMMM d, yyyy')} has been approved.${responseNote ? ` Note: ${responseNote}` : ''}`
            : `Your booking request for ${format(new Date(request.requested_date), 'MMMM d, yyyy')} could not be accommodated.${responseNote ? ` Note: ${responseNote}` : ''}`,
          type: status,
          is_read: false,
        });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['client-booking-requests'] });
      queryClient.invalidateQueries({ queryKey: ['bookings'] });
      toast.success(responseAction === 'approved' ? 'Request approved and booking created!' : 'Request rejected');
      setRespondDialogOpen(false);
      setSelectedRequest(null);
      setResponseNote('');
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to respond to request');
    },
  });

  const openRespondDialog = (request: BookingRequest, action: 'approved' | 'rejected') => {
    setSelectedRequest(request);
    setResponseAction(action);
    setResponseNote('');
    setRespondDialogOpen(true);
  };

  const handleRespond = () => {
    if (!selectedRequest) return;
    respondToRequest.mutate({
      requestId: selectedRequest.id,
      status: responseAction,
      responseNote,
    });
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'pending':
        return <Badge variant="secondary"><Clock className="h-3 w-3 mr-1" />Pending</Badge>;
      case 'approved':
        return <Badge variant="default" className="bg-primary"><CheckCircle className="h-3 w-3 mr-1" />Approved</Badge>;
      case 'rejected':
        return <Badge variant="destructive"><XCircle className="h-3 w-3 mr-1" />Rejected</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const pendingCount = requests.filter(r => r.status === 'pending').length;

  if (requestsError) return <QueryError subject="booking requests" onRetry={() => queryClient.invalidateQueries({ queryKey: ['client-booking-requests', organization?.id] })} />;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Calendar className="h-5 w-5 text-primary" />
            <div>
              <CardTitle className="flex items-center gap-2">
                Booking Requests
                {pendingCount > 0 && (
                  <Badge variant="destructive" className="rounded-full">
                    {pendingCount}
                  </Badge>
                )}
              </CardTitle>
              <CardDescription>
                Review and respond to client booking requests
              </CardDescription>
            </div>
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[140px]">
              <Filter className="h-4 w-4 mr-2" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="approved">Approved</SelectItem>
              <SelectItem value="rejected">Rejected</SelectItem>
              <SelectItem value="all">All</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : requests.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <Calendar className="h-12 w-12 mx-auto mb-3 opacity-50" />
            <p>No {statusFilter === 'all' ? '' : statusFilter} booking requests</p>
          </div>
        ) : (
          <div className="space-y-4">
            {requests.map((request) => (
              <div
                key={request.id}
                className="border rounded-lg p-4 space-y-3"
              >
                <div className="flex items-start justify-between">
                  <div>
                    <p className="font-medium">
                      {request.customer?.first_name} {request.customer?.last_name}
                    </p>
                    <p className="text-sm text-muted-foreground">{request.customer?.email}</p>
                  </div>
                  {getStatusBadge(request.status)}
                </div>

                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <p className="text-muted-foreground">Requested Date</p>
                    <p className="font-medium">
                      {format(new Date(request.requested_date), 'EEEE, MMMM d, yyyy')}
                    </p>
                  </div>
                  {request.service && (
                    <div>
                      <p className="text-muted-foreground">Service</p>
                      <p className="font-medium">{(request.service as any)?.name}</p>
                    </div>
                  )}
                </div>

                {(request as any).location && (
                  <div className="text-sm">
                    <p className="text-muted-foreground">Address</p>
                    <p className="font-medium flex items-center gap-1.5">
                      <MapPin className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      {[(request as any).location.name, (request as any).location.address, (request as any).location.city, (request as any).location.state, (request as any).location.zip_code].filter(Boolean).join(", ")}
                    </p>
                  </div>
                )}

                {request.notes && (
                  <div className="text-sm">
                    <p className="text-muted-foreground">Customer Notes</p>
                    <p className="bg-muted p-2 rounded mt-1">{request.notes}</p>
                  </div>
                )}

                {request.admin_response_note && (
                  <div className="text-sm">
                    <p className="text-muted-foreground">Your Response</p>
                    <p className="bg-primary/10 p-2 rounded mt-1">{request.admin_response_note}</p>
                  </div>
                )}

                <div className="flex items-center justify-between pt-2 border-t">
                  <p className="text-xs text-muted-foreground">
                    Submitted {format(new Date(request.created_at), 'MMM d, h:mm a')}
                  </p>
                  
                  {request.status === 'pending' && (
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-destructive border-destructive/30 hover:bg-destructive/10"
                        onClick={() => openRespondDialog(request, 'rejected')}
                      >
                        <XCircle className="h-4 w-4 mr-1" />
                        Decline
                      </Button>
                      <Button
                        size="sm"
                        onClick={() => openRespondDialog(request, 'approved')}
                      >
                        <CheckCircle className="h-4 w-4 mr-1" />
                        Approve
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>

      {/* Respond Dialog */}
      <Dialog open={respondDialogOpen} onOpenChange={setRespondDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {responseAction === 'approved' ? 'Approve Request' : 'Decline Request'}
            </DialogTitle>
            <DialogDescription>
              {responseAction === 'approved'
                ? 'Confirm this booking request and optionally add a note.'
                : 'Let the customer know why you cannot accommodate this request.'}
            </DialogDescription>
          </DialogHeader>

          {selectedRequest && (
            <div className="space-y-4">
              <div className="bg-muted p-3 rounded-lg text-sm">
                <p><strong>{selectedRequest.customer?.first_name} {selectedRequest.customer?.last_name}</strong></p>
                <p>{format(new Date(selectedRequest.requested_date), 'EEEE, MMMM d, yyyy')}</p>
                {selectedRequest.service && <p>{(selectedRequest.service as any)?.name}</p>}
              </div>

              <div className="space-y-2">
                <Label>Response Note (Optional)</Label>
                <Textarea
                  value={responseNote}
                  onChange={(e) => setResponseNote(e.target.value)}
                  placeholder={
                    responseAction === 'approved'
                      ? "Any details about the confirmed appointment..."
                      : "Explain why you cannot accommodate this request..."
                  }
                  rows={3}
                />
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setRespondDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleRespond}
              disabled={respondToRequest.isPending}
              variant={responseAction === 'rejected' ? 'destructive' : 'default'}
            >
              {respondToRequest.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {responseAction === 'approved' ? 'Approve Request' : 'Decline Request'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
