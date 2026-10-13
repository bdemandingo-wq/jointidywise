import { useEffect, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { sendPushBestEffort } from '@/lib/pushNotify';
import { supabase } from '@/lib/supabase';
import { syncWidgetData } from '@/lib/syncWidgetData';
import { toast } from 'sonner';
import { useOrganization } from '@/contexts/OrganizationContext';
import type { Json } from '@/integrations/supabase/types';
import { dispatchZapier } from '@/lib/zapier';
import { buildBookingZapierPayload } from '@/lib/buildBookingZapierPayload';
import { STAFF_SELECTABLE_COLUMNS } from '@/lib/staffColumns';
import { mustAffectRows } from '@/lib/mustAffectRows';
import type { Tables } from '@/integrations/supabase/types';

export interface TeamAssignment {
  staff_id: string;
  pay_share: number | null;
  is_primary: boolean | null;
  staff: { id: string; name: string } | null;
}

export interface BookingWithDetails {
  id: string;
  booking_number: number;
  scheduled_at: string;
  duration: number;
  total_amount: number;
  deposit_paid: number | null;
  status: 'pending' | 'confirmed' | 'in_progress' | 'completed' | 'rescheduled' | 'cancelled' | 'no_show';
  payment_status: 'pending' | 'partial' | 'paid' | 'refunded';
  payment_intent_id: string | null;
  notes: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip_code: string | null;
  apt_suite: string | null;
  frequency: string | null;
  bedrooms: string | null;
  bathrooms: string | null;
  square_footage: string | null;
  extras: Json | null;
  is_draft: boolean;
  created_at: string;
  updated_at: string;
  staff_id: string | null;
  customer: {
    id: string;
    first_name: string;
    last_name: string;
    email: string;
    phone: string | null;
  } | null;
  service: {
    id: string;
    name: string;
    description: string | null;
    price: number;
    duration: number;
  } | null;
  staff: {
    id: string;
    name: string;
    email: string;
    phone: string | null;
    hourly_rate?: number | null;
  } | null;
  booking_team_assignments?: TeamAssignment[];
}

export interface CreateBookingData {
  customer_id?: string;
  service_id?: string;
  staff_id?: string | null;
  scheduled_at: string;
  duration: number;
  total_amount: number;
  deposit_paid?: number;
  status?: 'pending' | 'confirmed' | 'in_progress' | 'completed' | 'rescheduled' | 'cancelled' | 'no_show';
  payment_status?: 'pending' | 'partial' | 'paid' | 'refunded';
  payment_intent_id?: string;
  notes?: string | null;
  address?: string;
  city?: string;
  state?: string;
  zip_code?: string;
  apt_suite?: string;
  frequency?: string;
  bedrooms?: string;
  bathrooms?: string;
  square_footage?: string;
  extras?: Json;
  is_draft?: boolean;
  cleaner_wage?: number | null;
  cleaner_wage_type?: string | null;
  cleaner_override_hours?: number | null;
  cleaner_actual_payment?: number | null;
  cleaner_pay_expected?: number | null;
}

export interface UpdateBookingData {
  id: string;
  customer_id?: string;
  service_id?: string;
  staff_id?: string | null;
  scheduled_at?: string;
  duration?: number;
  total_amount?: number;
  deposit_paid?: number | null;
  status?: 'pending' | 'confirmed' | 'in_progress' | 'completed' | 'rescheduled' | 'cancelled' | 'no_show';
  payment_status?: 'pending' | 'partial' | 'paid' | 'refunded';
  payment_intent_id?: string | null;
  notes?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  zip_code?: string | null;
  apt_suite?: string | null;
  frequency?: string | null;
  bedrooms?: string | null;
  bathrooms?: string | null;
  square_footage?: string | null;
  extras?: Json | null;
  is_draft?: boolean;
  cleaner_wage?: number | null;
  cleaner_wage_type?: string | null;
  cleaner_override_hours?: number | null;
  cleaner_actual_payment?: number | null;
  cleaner_pay_expected?: number | null;
  cancellation_reason?: string | null;
  cancellation_category?: string | null;
  cancelled_at?: string | null;
}

export interface NewCustomerData {
  first_name: string;
  last_name: string;
  email: string;
  phone?: string;
  address?: string;
  city?: string;
  state?: string;
  zip_code?: string;
  /** From Google Places when the address came from autocomplete. */
  latitude?: number;
  longitude?: number;
}

const BOOKING_LIST_SELECT = `
  id, booking_number, scheduled_at, duration, total_amount, deposit_paid,
  status, payment_status, payment_intent_id, notes, customer_notes,
  address, city, state, zip_code, apt_suite, latitude, longitude,
  frequency, bedrooms, bathrooms, square_footage, extras, has_pets,
  is_draft, created_at, updated_at, staff_id, customer_id, service_id, organization_id,
  cleaner_wage, cleaner_wage_type, cleaner_override_hours, cleaner_actual_payment, cleaner_pay_expected,
  cleaners_needed, pay_per_cleaner, pay_type,
  cancellation_reason, cancellation_category, cancelled_at,
  subtotal, tax_amount, discount_amount, discount_id, recurring_booking_id,
  customer:customers(id, first_name, last_name, email, phone),
  service:services(id, name, description, price, duration),
  staff:staff(id, name, email, phone, hourly_rate),
  booking_team_assignments(staff_id, pay_share, is_primary, staff:staff(id, name))
`;

const CUSTOMER_LIST_SELECT = `
  id, first_name, last_name, email, phone, address, city, state, zip_code,
  created_at, updated_at, customer_status, notes, organization_id, is_recurring,
  marketing_status, credits, latitude, longitude, referral_code, user_id,
  opted_out_at, opted_out_method, opted_out_campaign_id,
  review_request_sent, review_request_sent_at,
  stripe_customer_id, stripe_payment_method_id
`;

const RECENT_WINDOW_MS = 120 * 24 * 60 * 60 * 1000;
const RECENT_PAGE = 200;
const ARCHIVE_PAGE = 500;
const ARCHIVE_CAP = 2000;

async function fetchBookingPage(
  organizationId: string,
  range: { gte?: string; lt?: string },
  ascending: boolean,
  limit: number,
): Promise<BookingWithDetails[]> {
  let query = supabase
    .from('bookings')
    .select(BOOKING_LIST_SELECT)
    .eq('organization_id', organizationId)
    .or('is_draft.is.null,is_draft.eq.false')
    .order('scheduled_at', { ascending })
    .order('id', { ascending })
    .limit(limit);
  if (range.gte) query = query.gte('scheduled_at', range.gte);
  if (range.lt) query = query.lt('scheduled_at', range.lt);
  const { data, error } = await query;
  if (error) {
    console.error('Error fetching bookings:', error);
    throw error;
  }
  return (data ?? []) as unknown as BookingWithDetails[];
}

/** Upcoming jobs plus the recent past. Two indexed reads, not the whole table. */
export async function fetchRecentOrgBookings(organizationId: string): Promise<BookingWithDetails[]> {
  const now = Date.now();
  const horizon = new Date(now - 36 * 60 * 60 * 1000).toISOString();
  const since = new Date(now - RECENT_WINDOW_MS).toISOString();
  const [upcoming, past] = await Promise.all([
    fetchBookingPage(organizationId, { gte: horizon }, true, RECENT_PAGE),
    fetchBookingPage(organizationId, { gte: since, lt: horizon }, false, RECENT_PAGE),
  ]);
  const seen = new Set(upcoming.map((b) => b.id));
  return upcoming.concat(past.filter((b) => !seen.has(b.id)));
}

/** Older than the recent window, capped so a long history cannot page forever. */
export async function fetchArchiveOrgBookings(organizationId: string): Promise<BookingWithDetails[]> {
  const since = new Date(Date.now() - RECENT_WINDOW_MS).toISOString();
  const all: BookingWithDetails[] = [];
  let from = 0;
  while (all.length < ARCHIVE_CAP) {
    const { data, error } = await supabase
      .from('bookings')
      .select(BOOKING_LIST_SELECT)
      .eq('organization_id', organizationId)
      .or('is_draft.is.null,is_draft.eq.false')
      .lt('scheduled_at', since)
      .order('scheduled_at', { ascending: false })
      .order('id', { ascending: false })
      .range(from, from + ARCHIVE_PAGE - 1);
    if (error) {
      console.error('Error fetching bookings:', error);
      throw error;
    }
    const page = (data ?? []) as unknown as BookingWithDetails[];
    all.push(...page);
    if (page.length < ARCHIVE_PAGE) break;
    from += ARCHIVE_PAGE;
  }
  return all.slice(0, ARCHIVE_CAP);
}

export const bookingsRecentKey = (organizationId: string) => ['bookings', organizationId, 'recent'] as const;

const DASHBOARD_UPCOMING_SELECT = `
  id, booking_number, scheduled_at, duration, total_amount, status, payment_status,
  address, city, state, zip_code, apt_suite,
  customer:customers(id, first_name, last_name, email, phone),
  service:services(id, name),
  staff:staff(id, name, phone)
`;

const DASHBOARD_CHART_SELECT = `
  id, scheduled_at, total_amount, status, payment_status,
  customer:customers(id)
`;

export function dashboardUpcomingKey(organizationId: string) {
  return ['bookings', 'dashboard-upcoming', organizationId] as const;
}

export async function fetchDashboardUpcoming(organizationId: string): Promise<BookingWithDetails[]> {
  const start = new Date(Date.now() - 36 * 60 * 60 * 1000).toISOString();
  const end = new Date(Date.now() + 21 * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from('bookings')
    .select(DASHBOARD_UPCOMING_SELECT)
    .eq('organization_id', organizationId)
    .or('is_draft.is.null,is_draft.eq.false')
    .gte('scheduled_at', start)
    .lte('scheduled_at', end)
    .order('scheduled_at', { ascending: true })
    .order('id', { ascending: true })
    .limit(80);
  if (error) throw error;
  return (data ?? []) as unknown as BookingWithDetails[];
}

export async function fetchDashboardChart(organizationId: string): Promise<BookingWithDetails[]> {
  const start = new Date(Date.now() - 400 * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from('bookings')
    .select(DASHBOARD_CHART_SELECT)
    .eq('organization_id', organizationId)
    .or('is_draft.is.null,is_draft.eq.false')
    .gte('scheduled_at', start)
    .order('scheduled_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(1500);
  if (error) throw error;
  return (data ?? []) as unknown as BookingWithDetails[];
}

export async function fetchDashboardCustomers(organizationId: string) {
  const start = new Date(Date.now() - 400 * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from('customers')
    .select('id, created_at')
    .eq('organization_id', organizationId)
    .is('merged_into', null)
    .gte('created_at', start)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(1000);
  if (error) throw error;
  return data ?? [];
}

export async function fetchOrgCustomers(organizationId: string) {
  const { data, error } = await supabase
    .from('customers')
    .select(CUSTOMER_LIST_SELECT)
    .eq('organization_id', organizationId)
    .is('merged_into', null)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(1000);

  if (error) {
    console.error('Error fetching customers:', error);
    throw error;
  }
  return data ?? [];
}

export function useBookings() {
  const { organization } = useOrganization();
  const organizationId = organization?.id;
  const queryClient = useQueryClient();

  // Realtime subscription to auto-refresh when external bookings arrive
  useEffect(() => {
    if (!organizationId) return;

    const channel = supabase
      .channel(`bookings-realtime-${organizationId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'bookings',
          filter: `organization_id=eq.${organizationId}`,
        },
        () => {
          queryClient.invalidateQueries({ queryKey: ['bookings'] });
          queryClient.invalidateQueries({ queryKey: ['customers'] });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [organizationId, queryClient]);

  const recent = useQuery({
    queryKey: organizationId ? bookingsRecentKey(organizationId) : ['bookings', 'none', 'recent'],
    queryFn: () => fetchRecentOrgBookings(organizationId as string),
    enabled: !!organizationId,
    staleTime: 1000 * 60 * 2,
    gcTime: 1000 * 60 * 60 * 24,
  });
  const archive = useQuery({
    queryKey: ['bookings', organizationId, 'archive'],
    queryFn: () => fetchArchiveOrgBookings(organizationId as string),
    enabled: !!organizationId && recent.isSuccess,
    staleTime: 1000 * 60 * 10,
    gcTime: 1000 * 60 * 30,
  });
  const data = useMemo(() => {
    const head = recent.data ?? [];
    const tail = archive.data ?? [];
    if (tail.length === 0) return head;
    const seen = new Set(head.map((b) => b.id));
    return head.concat(tail.filter((b) => !seen.has(b.id)));
  }, [recent.data, archive.data]);

  return {
    ...recent,
    data,
    isLoading: recent.isLoading && data.length === 0,
    error: recent.error ?? archive.error,
    refetch: async () => {
      const [nextRecent] = await Promise.all([recent.refetch(), archive.refetch()]);
      return nextRecent;
    },
  };
}

export function useDashboardUpcoming() {
  const { organization } = useOrganization();
  const organizationId = organization?.id;
  return useQuery({
    queryKey: organizationId ? dashboardUpcomingKey(organizationId) : ['bookings', 'dashboard-upcoming', 'none'],
    queryFn: () => fetchDashboardUpcoming(organizationId as string),
    enabled: !!organizationId,
    staleTime: 60_000,
    gcTime: 1000 * 60 * 60 * 24,
  });
}

export function useDashboardChart(ready = true) {
  const { organization } = useOrganization();
  const organizationId = organization?.id;
  return useQuery({
    queryKey: ['bookings', 'dashboard-chart', organizationId],
    queryFn: () => fetchDashboardChart(organizationId as string),
    // The chart is a year of rows. It waits until today's jobs are on screen
    // so it does not compete with the query the first paint is blocked on.
    enabled: !!organizationId && ready,
    staleTime: 5 * 60 * 1000,
    gcTime: 1000 * 60 * 60 * 24,
  });
}

export function useDashboardCustomers(ready = true) {
  const { organization } = useOrganization();
  const organizationId = organization?.id;
  return useQuery({
    queryKey: ['customers', 'dashboard', organizationId],
    queryFn: () => fetchDashboardCustomers(organizationId as string),
    enabled: !!organizationId && ready,
    staleTime: 5 * 60 * 1000,
    gcTime: 1000 * 60 * 60 * 24,
  });
}

export function useBookingsByDateRange(startDate: Date, endDate: Date) {
  const { organization } = useOrganization();
  const organizationId = organization?.id;

  return useQuery({
    queryKey: ['bookings', 'range', organizationId, startDate.toISOString(), endDate.toISOString()],
    queryFn: async () => {
      if (!organizationId) {
        return [];
      }
      const { data, error } = await supabase
        .from('bookings')
        .select(BOOKING_LIST_SELECT)
        .eq('organization_id', organizationId)
        .or('is_draft.is.null,is_draft.eq.false')
        .gte('scheduled_at', startDate.toISOString())
        .lte('scheduled_at', endDate.toISOString())
        .order('scheduled_at', { ascending: true })
        .order('id', { ascending: true });

      if (error) {
        console.error('Error fetching bookings:', error);
        throw error;
      }

      return data as BookingWithDetails[];
    },
    enabled: !!organizationId,
  });
}

/**
 * Fetch draft bookings only. Kept separate from `useBookings()` so drafts
 * do not leak into the scheduler, reports, dashboard, or calendar views —
 * they should only appear inside the Drafts tab on BookingsPage.
 */
export function useDraftBookings() {
  const { organization } = useOrganization();
  const organizationId = organization?.id;

  return useQuery({
    queryKey: ['bookings', 'drafts', organizationId],
    queryFn: async () => {
      if (!organizationId) return [];
      const { data, error } = await supabase
        .from('bookings')
        .select(BOOKING_LIST_SELECT)
        .eq('organization_id', organizationId)
        .eq('is_draft', true)
        .order('scheduled_at', { ascending: false })
        .order('id', { ascending: false });
      if (error) throw error;
      return (data || []) as BookingWithDetails[];
    },
    enabled: !!organizationId,
    staleTime: 1000 * 30,
  });
}

export function useCreateBooking() {
  const queryClient = useQueryClient();
  const { organization } = useOrganization();

  return useMutation({
    mutationFn: async (data: CreateBookingData) => {
      if (!organization?.id) {
        throw new Error('No organization found');
      }

      const { data: booking, error } = await supabase
        .from('bookings')
        .insert({ ...data, organization_id: organization.id })
        .select()
        .single();

      if (error) {
        console.error('Error creating booking:', error);
        throw error;
      }

      // Notify the assigned cleaner's bell (skip drafts)
      if ((data as any).staff_id && booking && !(booking as any).is_draft) {
        const when = booking.scheduled_at
          ? new Date(booking.scheduled_at).toLocaleString(undefined, {
              month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
            })
          : '';
        const { error: notifErr1 } = await supabase.from('cleaner_notifications').insert({
          staff_id: (data as any).staff_id,
          organization_id: organization.id,
          booking_id: booking.id,
          type: 'job_assigned',
          title: 'New job assigned',
          message: `Booking #${booking.booking_number}${when ? ` on ${when}` : ''} was assigned to you.`,
        });
        if (notifErr1) console.error('[cleaner-notify] insert failed:', notifErr1);
        sendPushBestEffort({
          organizationId: organization.id,
          staffId: (data as any).staff_id,
          title: 'New job assigned',
          body: `Booking #${booking.booking_number}${when ? ` on ${when}` : ''} was assigned to you.`,
          data: { bookingId: booking.id },
        });
      }

      // Unassigned booking → notify every active cleaner that a job is open to claim
      if (!(data as any).staff_id && booking && !(booking as any).is_draft) {
        const { data: activeStaff } = await supabase
          .from('staff')
          .select('id')
          .eq('organization_id', organization.id)
          .eq('is_active', true);
        if (activeStaff?.length) {
          const when = booking.scheduled_at
            ? new Date(booking.scheduled_at).toLocaleString(undefined, {
                month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
              })
            : '';
          const { error: notifErr2 } = await supabase.from('cleaner_notifications').insert(
            activeStaff.map((s) => ({
              staff_id: s.id,
              organization_id: organization.id,
              booking_id: booking.id,
              type: 'job_available',
              title: 'New job available',
              message: `Booking #${booking.booking_number}${when ? ` on ${when}` : ''} is open to claim.`,
            }))
          );
          if (notifErr2) console.error('[cleaner-notify] insert failed:', notifErr2);
          sendPushBestEffort({
            organizationId: organization.id,
            title: 'New job available',
            body: `Booking #${booking.booking_number}${when ? ` on ${when}` : ''} is open to claim.`,
            data: { bookingId: booking.id },
          });
        }
      }

      buildBookingZapierPayload(booking as any).then((payload) =>
        dispatchZapier('booking.created', organization.id, payload),
      );
      return booking;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bookings'] });
      queryClient.invalidateQueries({ queryKey: ['booking-team-assignments'] });
      queryClient.invalidateQueries({ queryKey: ['all-team-assignments'] });
      syncWidgetData(); // Update widget with latest booking
      // BookingStepper already toasts the create result (including the
      // recurring-schedule wording). A second toast here doubled it.
    },
    onError: (error: Error) => {
      toast.error(`Failed to create booking: ${error.message}`);
    },
  });
}

export function useUpdateBooking() {
  const queryClient = useQueryClient();
  const { organization } = useOrganization();
  const organizationId = organization?.id;

  return useMutation({
    mutationFn: async ({ id, suppressToast: _suppressToast, ...data }: UpdateBookingData & { suppressToast?: boolean }) => {
      if (!organizationId) throw new Error('No organization found');
      // Detect a new assignment so we can notify the cleaner (only when
      // staff_id actually changes — edit dialogs resend unchanged fields)
      let previousStaffId: string | null | undefined;
      if (data.staff_id !== undefined) {
        const { data: prev } = await supabase
          .from('bookings')
          .select('staff_id')
          .eq('id', id)
          .eq('organization_id', organizationId)
          .maybeSingle();
        previousStaffId = prev?.staff_id ?? null;
      }

      const { data: booking, error } = await supabase
        .from('bookings')
        .update(data)
        .eq('id', id)
        .eq('organization_id', organizationId)
        .select()
        .single();

      if (error) {
        console.error('Error updating booking:', error);
        throw error;
      }

      if (
        data.staff_id &&
        data.staff_id !== previousStaffId &&
        booking &&
        !(booking as any).is_draft
      ) {
        const when = booking.scheduled_at
          ? new Date(booking.scheduled_at).toLocaleString(undefined, {
              month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
            })
          : '';
        const { error: notifErr3 } = await supabase.from('cleaner_notifications').insert({
          staff_id: data.staff_id,
          organization_id: booking.organization_id,
          booking_id: booking.id,
          type: 'job_assigned',
          title: 'New job assigned',
          message: `Booking #${booking.booking_number}${when ? ` on ${when}` : ''} was assigned to you.`,
        });
        if (notifErr3) console.error('[cleaner-notify] insert failed:', notifErr3);
        // Same as PendingDocumentsReview: unroutable without an organisation.
        if (booking.organization_id) sendPushBestEffort({
          organizationId: booking.organization_id,
          staffId: data.staff_id,
          title: 'New job assigned',
          body: `Booking #${booking.booking_number}${when ? ` on ${when}` : ''} was assigned to you.`,
          data: { bookingId: booking.id },
        });
      }

      if (data.status === 'completed' && booking?.organization_id) {
        buildBookingZapierPayload(booking as any).then((payload) =>
          dispatchZapier('booking.completed', booking.organization_id, payload),
        );
      } else if (data.status === 'cancelled' && booking?.organization_id) {
        buildBookingZapierPayload(booking as any).then((payload) =>
          dispatchZapier('booking.cancelled', booking.organization_id, payload),
        );
      }

      return booking;
    },
    onSuccess: (_booking, variables) => {
      queryClient.invalidateQueries({ queryKey: ['bookings'] });
      queryClient.invalidateQueries({ queryKey: ['booking-team-assignments'] });
      queryClient.invalidateQueries({ queryKey: ['all-team-assignments'] });
      syncWidgetData(); // Update widget with latest booking
      if (!variables.suppressToast) {
        toast.success('Booking updated successfully');
      }
    },
    onError: (error: Error) => {
      toast.error(`Failed to update booking: ${error.message}`);
    },
  });
}

export function useDeleteBooking() {
  const queryClient = useQueryClient();
  const { organization } = useOrganization();
  const organizationId = organization?.id;

  return useMutation({
    mutationFn: async (id: string) => {
      if (!organizationId) throw new Error('No organization found');
      await mustAffectRows(
        supabase.from('bookings').delete().eq('id', id).eq('organization_id', organizationId),
        'Booking not deleted. It may belong to a different business.',
        { table: 'bookings' },
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bookings'] });
      syncWidgetData(); // Update widget with latest booking
      toast.success('Booking deleted successfully');
    },
    onError: (error: Error) => {
      toast.error(`Failed to delete booking: ${error.message}`);
    },
  });
}

export function useCustomers() {
  const { organization } = useOrganization();
  const organizationId = organization?.id;

  return useQuery({
    queryKey: ['customers', organizationId],
    queryFn: async () => {
      if (!organizationId) {
        return [];
      }
      // Hide merged-out customers everywhere — they live on as audit history
      // (merged_into = primary.id) but should never appear in lists, counts,
      // or exports.
      return fetchOrgCustomers(organizationId);
    },
    enabled: !!organizationId,
    staleTime: 1000 * 60 * 5, // 5 minutes - customers change less frequently
    gcTime: 1000 * 60 * 60 * 24,
  });
}

export function useCreateCustomer() {
  const queryClient = useQueryClient();
  const { organization } = useOrganization();

  return useMutation({
    mutationFn: async (data: NewCustomerData) => {
      if (!organization?.id) {
        throw new Error('No organization found');
      }

      // Create the customer
      const { data: customer, error } = await supabase
        .from('customers')
        .insert({ ...data, organization_id: organization.id })
        .select()
        .single();

      if (error) {
        console.error('Error creating customer:', error);
        throw error;
      }

      dispatchZapier('customer.created', organization.id, customer as Record<string, unknown>);


      // Auto-create a corresponding lead entry
      const leadData = {
        name: `${data.first_name} ${data.last_name}`.trim(),
        email: data.email,
        phone: data.phone || null,
        address: data.address || null,
        city: data.city || null,
        state: data.state || null,
        zip_code: data.zip_code || null,
        source: 'customer_import',
        status: 'new',
        organization_id: organization.id,
      };

      const { error: leadError } = await supabase
        .from('leads')
        .insert(leadData);

      if (leadError) {
        console.warn('Lead auto-creation failed:', leadError.message);
        // Don't throw - customer was created successfully
      }

      return customer;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customers'] });
      queryClient.invalidateQueries({ queryKey: ['leads'] });
      toast.success('Customer added and new lead created');
    },
    onError: (error: Error) => {
      toast.error(`Failed to create customer: ${error.message}`);
    },
  });
}

export function useDeleteCustomer() {
  const queryClient = useQueryClient();
  const { organization } = useOrganization();
  const organizationId = organization?.id;

  return useMutation({
    mutationFn: async (id: string) => {
      if (!organizationId) throw new Error('No organization found');
      await mustAffectRows(
        supabase.from('customers').delete().eq('id', id).eq('organization_id', organizationId),
        'Customer not deleted. It may belong to a different business.',
        { table: 'customers' },
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customers'] });
      toast.success('Customer deleted successfully');
    },
    onError: (error: Error) => {
      toast.error(`Failed to delete customer: ${error.message}`);
    },
  });
}

export function useServices() {
  const { organization } = useOrganization();
  const organizationId = organization?.id;

  return useQuery({
    queryKey: ['services', organizationId],
    queryFn: async () => {
      if (!organizationId) {
        return [];
      }
      const { data, error } = await supabase
        .from('services')
        .select('*')
        .eq('organization_id', organizationId)
        .eq('is_active', true)
        .order('name', { ascending: true });

      if (error) {
        console.error('Error fetching services:', error);
        throw error;
      }

      const { sortServices } = await import('@/lib/serviceOrder');
      return sortServices(data || []);
    },
    enabled: !!organizationId,
    staleTime: 1000 * 60 * 10, // 10 minutes - services rarely change
    gcTime: 1000 * 60 * 60, // Keep in cache for 1 hour
  });
}

export function useStaff() {
  const { organization } = useOrganization();
  const organizationId = organization?.id;
  const queryClient = useQueryClient();

  // Realtime, not a wider invalidation. A cleaner editing their bio or address
  // in CleanerProfile invalidates ['staff-profile'] in THEIR browser — query
  // caches are per-client, so nothing that happens there can reach an admin's
  // cache. With refetchOnWindowFocus disabled globally (App.tsx) and a 5-minute
  // staleTime, an admin would otherwise keep serving a stale roster until the
  // query aged out. This is the same pattern useBookings already uses.
  useEffect(() => {
    if (!organizationId) return;

    const channel = supabase
      .channel(`staff-realtime-${organizationId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'staff',
          filter: `organization_id=eq.${organizationId}`,
        },
        () => {
          // Now genuinely reaches both queries. Before the restructure this
          // matched only the active-staff list, so a row inserted by another
          // admin never refreshed the management page.
          queryClient.invalidateQueries({ queryKey: ['staff'] });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [organizationId, queryClient]);

  return useQuery({
    /*
      ['staff', 'active', orgId] — a SEGMENT under a shared prefix, not a
      sibling key.

      This was ['staff', orgId] while useAllStaff was ['staff-all', orgId].
      React-query prefix-matches on ARRAY ELEMENTS, so ['staff'] matched the
      first and never the second — 'staff' and 'staff-all' are simply different
      strings. Every invalidation had to name both, and the ones that named only
      ['staff'] silently refreshed nothing on StaffPage: adding a staff member
      (fixed in a6ac1263) and editing one (fixed here) both left the list stale.

      Under this shape ['staff'] correctly matches both, so a caller that cares
      about "staff changed" can say exactly that and be right.
    */
    queryKey: ['staff', 'active', organizationId],
    queryFn: async () => {
      if (!organizationId) {
        return [];
      }
      const { data, error } = await supabase
        .from('staff')
        .select(STAFF_SELECTABLE_COLUMNS)
        .eq('organization_id', organizationId)
        .eq('is_active', true)
        .order('name', { ascending: true });

      if (error) {
        console.error('Error fetching staff:', error);
        throw error;
      }

      // Explicit column list (see staffColumns.ts) loses PostgREST's generated
      // row typing, so re-assert it here.
      return (data ?? []) as unknown as Tables<'staff'>[];
    },
    enabled: !!organizationId,
    staleTime: 1000 * 60 * 5,
    gcTime: 1000 * 60 * 30,
  });
}

/** Fetches ALL staff (active + inactive) for admin management pages. */
export function useAllStaff() {
  const { organization } = useOrganization();
  const organizationId = organization?.id;

  return useQuery({
    // Sibling segment of ['staff','active',orgId] — see the note there for why
    // these live under a shared prefix rather than as ['staff'] / ['staff-all'].
    queryKey: ['staff', 'all', organizationId],
    queryFn: async () => {
      if (!organizationId) {
        return [];
      }
      const { data, error } = await supabase
        .from('staff')
        .select(STAFF_SELECTABLE_COLUMNS)
        .eq('organization_id', organizationId)
        .order('is_active', { ascending: false })
        .order('name', { ascending: true });

      if (error) {
        console.error('Error fetching all staff:', error);
        throw error;
      }

      return (data ?? []) as unknown as Tables<'staff'>[];
    },
    enabled: !!organizationId,
    staleTime: 1000 * 60 * 5,
    gcTime: 1000 * 60 * 30,
  });
}
