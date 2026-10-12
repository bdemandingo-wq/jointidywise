import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { AdminLayout } from '@/components/admin/AdminLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  Search, Plus, Mail, Phone, MessageSquare, Megaphone, Edit, Trash2, CreditCard, Upload, Users,
  UserX, RefreshCw, MapPin, Download, AlertTriangle, ArrowUpDown, WifiOff,
  ArrowUp, ArrowDown, CalendarDays, DollarSign, FileText, Eye, UserPlus,
  ChevronDown, ChevronUp, GitMerge,
} from 'lucide-react';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuTrigger, DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { useCustomers, useDeleteCustomer } from '@/hooks/useBookings';
import { AddCustomerDialog } from '@/components/admin/AddCustomerDialog';
import { EditCustomerDialog } from '@/components/admin/EditCustomerDialog';
import { PaymentHistoryDialog } from '@/components/admin/PaymentHistoryDialog';
import { MobileContactProfile } from '@/components/admin/MobileContactProfile';
import { ImportDialog, FieldMapping } from '@/components/admin/ImportDialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useTestMode } from '@/contexts/TestModeContext';
import { useOrganization } from '@/contexts/OrganizationContext';
import { supabase } from '@/lib/supabase';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useIsMobile } from '@/hooks/use-mobile';
import { useVirtualizer } from '@tanstack/react-virtual';
import { SwipeableRow } from '@/components/mobile/SwipeableRow';
import { hapticImpact } from '@/lib/haptics';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { SEOHead } from '@/components/SEOHead';
import { useSubscription } from '@/hooks/useSubscription';
import { useAuth } from '@/hooks/useAuth';
import { fmt } from '@/lib/activeCurrency';

const CUSTOMER_FIELDS: FieldMapping[] = [
  { dbField: 'first_name', label: 'First Name', required: true },
  { dbField: 'last_name', label: 'Last Name', required: true },
  { dbField: 'email', label: 'Email', type: 'email' },
  { dbField: 'phone', label: 'Phone' },
  { dbField: 'address', label: 'Address' },
  { dbField: 'city', label: 'City' },
  { dbField: 'state', label: 'State' },
  { dbField: 'zip_code', label: 'Zip Code' },
  { dbField: 'notes', label: 'Notes' },
];

const CUSTOMER_SAMPLE = `first_name,last_name,email,phone,address,city,state,zip_code
John,Doe,john@example.com,555-1234,123 Main St,New York,NY,10001
Jane,Smith,jane@example.com,555-5678,456 Oak Ave,Los Angeles,CA,90001`;

type SortField = 'name' | 'status' | 'created_at' | 'revenue' | 'last_booking';
type SortDir = 'asc' | 'desc';
type TabFilter = 'all' | 'customers' | 'leads' | 'non_recurring';

interface BookingStats {
  customer_id: string;
  total_bookings: number;
  total_revenue: number;
  last_booking_date: string | null;
}

export default function CustomersPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [searchTerm, setSearchTerm] = useState(() => searchParams.get('q') || '');
  const [tabFilter, setTabFilter] = useState<TabFilter>(
    searchParams.get('filter') === 'non_recurring' ? 'non_recurring' : 'all'
  );

  useEffect(() => {
    setTabFilter(searchParams.get('filter') === 'non_recurring' ? 'non_recurring' : 'all');
  }, [searchParams]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [addDialogOpen, setAddDialogOpen] = useState(false);

  // Handle deep-link: ?newCustomer=true (e.g. from widget quick action)
  useEffect(() => {
    if (searchParams.get('newCustomer') === 'true') {
      setAddDialogOpen(true);
      const next = new URLSearchParams(searchParams);
      next.delete('newCustomer');
      setSearchParams(next, { replace: true });
    }
  }, [searchParams, setSearchParams]);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [paymentHistoryOpen, setPaymentHistoryOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [bulkActionDialogOpen, setBulkActionDialogOpen] = useState(false);
  const [bulkAction, setBulkAction] = useState<'delete' | 'inactive' | 'remove_campaigns' | null>(null);
  const [customerToDelete, setCustomerToDelete] = useState<{ id: string; name: string } | null>(null);
  const [selectedCustomer, setSelectedCustomer] = useState<any>(null);
  const [sortField, setSortField] = useState<SortField>('name');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [messageDialogOpen, setMessageDialogOpen] = useState(false);
  const [messageCustomer, setMessageCustomer] = useState<{ id: string; name: string; phone: string } | null>(null);
  const [messageText, setMessageText] = useState('');
  const [messageSending, setMessageSending] = useState(false);

  const { data: customers = [], isLoading, error: customersError, refetch: refetchCustomers, fetchStatus: customersFetchStatus } = useCustomers();
  /*
    React Query PAUSES a query when it believes the device is offline, rather
    than failing it. A paused query has no data, no error, and isLoading
    false — so it fell through to EmptyState exactly as a thrown error did,
    and said "No customers yet". Found by looking: forcing the read to fail
    in the browser produced fetchStatus "paused", not an error, and the empty
    state stayed on screen. This app is built to work offline
    (PersistQueryClientProvider), so this is the likelier of the two failures
    rather than an edge case.

    Only meaningful with nothing cached to show: when the persisted cache has
    rows they render and the pause is invisible, which is the intended
    offline behaviour.
  */
  const customersOffline = customersFetchStatus === 'paused' && customers.length === 0;
  const deleteCustomer = useDeleteCustomer();
  const { maskName, maskEmail, maskPhone, maskAddress, isTestMode, maskAmount } = useTestMode();
  const { organization, isAdmin } = useOrganization();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const isMobile = useIsMobile();
  const { maxCustomers, hasFullAccess } = useSubscription();
  const { setShowSubscriptionDialog } = useAuth();
  const atCustomerLimit = !hasFullAccess && customers.length >= maxCustomers;
  const [batchMode, setBatchMode] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [mobileProfileOpen, setMobileProfileOpen] = useState(false);
  const listRef = useRef<HTMLDivElement | null>(null);
  const longPressTimer = useRef<number | null>(null);
  const customersQueryKey = useMemo(() => ['customers', organization?.id], [organization?.id]);

  // Fetch booking stats per customer
  const { data: bookingStats = [], error: bookingStatsError } = useQuery({
    queryKey: ['customer-booking-stats', organization?.id],
    queryFn: async () => {
      if (!organization?.id) return [];
      const { data, error } = await supabase
        .from('bookings')
        .select('customer_id, total_amount, scheduled_at')
        .eq('organization_id', organization.id)
        .neq('status', 'cancelled')
        // PostgREST already capped an unordered select at 1000 rows, so totals
        // for a huge history were incomplete and unstable. Keep the newest
        // 1000, with id as a unique tiebreaker.
        .order('scheduled_at', { ascending: false })
        .order('id', { ascending: false })
        .limit(1000);
      if (error) throw error;

      const statsMap = new Map<string, BookingStats>();
      for (const b of data || []) {
        if (!b.customer_id) continue;
        const existing = statsMap.get(b.customer_id);
        if (existing) {
          existing.total_bookings++;
          existing.total_revenue += Number(b.total_amount) || 0;
          if (!existing.last_booking_date || b.scheduled_at > existing.last_booking_date) {
            existing.last_booking_date = b.scheduled_at;
          }
        } else {
          statsMap.set(b.customer_id, {
            customer_id: b.customer_id,
            total_bookings: 1,
            total_revenue: Number(b.total_amount) || 0,
            last_booking_date: b.scheduled_at,
          });
        }
      }
      return Array.from(statsMap.values());
    },
    enabled: !!organization?.id,
    staleTime: 1000 * 60 * 5,
  });

  const statsMap = useMemo(() => {
    const m = new Map<string, BookingStats>();
    bookingStats.forEach(s => m.set(s.customer_id, s));
    return m;
  }, [bookingStats]);

  // Available campaigns for "Add to Campaign" per-row action
  const { data: availableCampaigns = [], error: availableCampaignsError } = useQuery({
    queryKey: ['available-campaigns', organization?.id],
    queryFn: async () => {
      if (!organization?.id) return [];
      const { data, error } = await supabase
        .from('automated_campaigns')
        .select('id, name, type, body, is_active')
        .eq('organization_id', organization.id)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data || [];
    },
    enabled: !!organization?.id,
    staleTime: 1000 * 60 * 2,
  });

  const handleAddToCampaign = useCallback(async (customer: any, campaign: { id: string; name: string; type: string; body: string }) => {
    if (!organization?.id) {
      toast.error('Organization context missing');
      return;
    }
    if (!customer.phone) {
      toast.error('Customer has no phone number on file');
      return;
    }
    // The (campaign_id, customer_id) unique constraint has been dropped so that
    // campaign_sms_sends can retain full per-message send history. That
    // constraint was also the only thing stopping a double-click here from
    // enrolling the same person twice, so the check is now explicit.
    const { data: existingEnrolment, error: existingErr } = await supabase
      .from('campaign_sms_sends')
      .select('id')
      .eq('organization_id', organization.id)
      .eq('campaign_id', campaign.id)
      .eq('customer_id', customer.id)
      .in('status', ['pending', 'queued', 'scheduled'])
      .limit(1)
      .maybeSingle();
    if (existingErr) {
      toast.error(`Could not verify campaign enrollment: ${existingErr.message}`);
      return;
    }
    if (existingEnrolment) {
      toast.info(`${customer.first_name} is already queued for "${campaign.name}"`);
      return;
    }

    const { error } = await supabase.from('campaign_sms_sends').insert({
      organization_id: organization.id,
      campaign_id: campaign.id,
      campaign_type: campaign.type,
      customer_id: customer.id,
      phone_number: customer.phone,
      message_content: campaign.body,
      status: 'pending',
    });
    if (error) {
      toast.error(`Failed to add to campaign: ${error.message}`);
      return;
    }
    toast.success(`Added ${customer.first_name} to "${campaign.name}"`);
    queryClient.invalidateQueries({ queryKey: ['campaign-conversions', organization.id] });
    queryClient.invalidateQueries({ queryKey: ['customer-campaign-enrollments', organization.id] });
  }, [organization?.id, queryClient]);

  // Active campaign enrollments per customer (pending sends = actively enrolled)
  const { data: enrollmentsByCustomer = new Map<string, { id: string; name: string }[]>(), error: enrollmentsError } = useQuery({
    queryKey: ['customer-campaign-enrollments', organization?.id],
    queryFn: async () => {
      if (!organization?.id) return new Map<string, { id: string; name: string }[]>();
      const { data, error } = await supabase
        .from('campaign_sms_sends')
        .select('customer_id, campaign_id, status, automated_campaigns:campaign_id ( id, name )')
        .eq('organization_id', organization.id)
        .not('customer_id', 'is', null)
        .in('status', ['pending', 'queued', 'scheduled'])
        .limit(400);
      if (error) throw error;
      const m = new Map<string, { id: string; name: string }[]>();
      for (const row of (data as any[]) || []) {
        if (!row.customer_id || !row.automated_campaigns) continue;
        const arr = m.get(row.customer_id) || [];
        if (!arr.find(c => c.id === row.automated_campaigns.id)) {
          arr.push({ id: row.automated_campaigns.id, name: row.automated_campaigns.name });
        }
        m.set(row.customer_id, arr);
      }
      return m;
    },
    enabled: !!organization?.id,
    staleTime: 1000 * 60 * 2,
  });

  useEffect(() => {
    const err = bookingStatsError || availableCampaignsError || enrollmentsError;
    if (err) toast.error('Failed to load data');
  }, [bookingStatsError, availableCampaignsError, enrollmentsError]);

  const handleBulkAddToCampaign = useCallback(async (campaign: { id: string; name: string; type: string; body: string }) => {
    if (!organization?.id || selectedIds.size === 0) return;
    const selected = customers.filter(c => selectedIds.has(c.id) && c.phone);
    const skipped = selectedIds.size - selected.length;
    if (selected.length === 0) {
      toast.error('None of the selected customers have a phone number');
      return;
    }
    // Same reasoning as the single-customer path: with the unique constraint
    // gone, re-running a bulk add would silently queue everyone a second time.
    // Filter out anyone who already has an open enrollment for this campaign.
    const { data: alreadyQueued, error: alreadyQueuedErr } = await supabase
      .from('campaign_sms_sends')
      .select('customer_id')
      .eq('organization_id', organization.id)
      .eq('campaign_id', campaign.id)
      .in('customer_id', selected.map(c => c.id))
      .in('status', ['pending', 'queued', 'scheduled']);
    if (alreadyQueuedErr) {
      toast.error(`Could not verify campaign enrollments: ${alreadyQueuedErr.message}`);
      return;
    }
    const alreadyQueuedIds = new Set((alreadyQueued || []).map(r => r.customer_id).filter(Boolean));
    const toEnroll = selected.filter(c => !alreadyQueuedIds.has(c.id));
    if (toEnroll.length === 0) {
      toast.info(`All selected customers are already queued for "${campaign.name}"`);
      return;
    }

    const rows = toEnroll.map(c => ({
      organization_id: organization.id,
      campaign_id: campaign.id,
      campaign_type: campaign.type,
      customer_id: c.id,
      phone_number: c.phone,
      message_content: campaign.body,
      status: 'pending' as const,
    }));
    const { error } = await supabase.from('campaign_sms_sends').insert(rows);
    if (error) {
      toast.error(`Failed to add to campaign: ${error.message}`);
      return;
    }
    toast.success(
      `Added ${toEnroll.length} customer${toEnroll.length === 1 ? '' : 's'} to "${campaign.name}"` +
      (skipped > 0 ? ` (${skipped} skipped, no phone)` : '') +
      (alreadyQueuedIds.size > 0 ? ` (${alreadyQueuedIds.size} already queued)` : '')
    );
    setSelectedIds(new Set());
    queryClient.invalidateQueries({ queryKey: ['customer-campaign-enrollments', organization.id] });
    queryClient.invalidateQueries({ queryKey: ['campaign-conversions', organization.id] });
  }, [organization?.id, selectedIds, customers, queryClient]);



  // Duplicate detection: same email or phone
  const duplicates = useMemo(() => {
    const emailMap = new Map<string, string[]>();
    const phoneMap = new Map<string, string[]>();
    const dupeIds = new Set<string>();

    customers.forEach(c => {
      const email = c.email?.toLowerCase().trim();
      if (email) {
        if (!emailMap.has(email)) emailMap.set(email, []);
        emailMap.get(email)!.push(c.id);
      }
      const phone = c.phone?.replace(/\D/g, '');
      if (phone && phone.length >= 7) {
        if (!phoneMap.has(phone)) phoneMap.set(phone, []);
        phoneMap.get(phone)!.push(c.id);
      }
    });

    emailMap.forEach(ids => { if (ids.length > 1) ids.forEach(id => dupeIds.add(id)); });
    phoneMap.forEach(ids => { if (ids.length > 1) ids.forEach(id => dupeIds.add(id)); });

    return dupeIds;
  }, [customers]);

  const handleImportCustomers = async (records: Record<string, any>[]) => {
    if (!organization?.id) throw new Error('No organization found');
    const customersToInsert = records.map(record => ({
      first_name: record.first_name || '',
      last_name: record.last_name || '',
      email: record.email || '',
      phone: record.phone || null,
      address: record.address || null,
      city: record.city || null,
      state: record.state || null,
      zip_code: record.zip_code || null,
      notes: record.notes || null,
      organization_id: organization.id,
    }));
    const { error } = await supabase.from('customers').insert(customersToInsert);
    if (error) throw error;
    queryClient.invalidateQueries({ queryKey: ['customers'] });
  };

  const handleDeleteClick = (customer: { id: string; first_name: string; last_name: string }) => {
    setCustomerToDelete({ id: customer.id, name: `${customer.first_name} ${customer.last_name}` });
    setDeleteDialogOpen(true);
  };

  const handleConfirmDelete = async () => {
    if (!customerToDelete) return;
    try {
      const id = customerToDelete.id;
      // Clean up related records in parallel before deleting the customer
      await Promise.all([
        supabase.from('quotes').delete().eq('customer_id', id),
        (supabase.from('property_notes' as any) as any).delete().eq('customer_id', id),
        supabase.from('referrals').delete().eq('referrer_customer_id', id),
        supabase.from('customer_loyalty').delete().eq('customer_id', id),
      ]);
      await deleteCustomer.mutateAsync(id);
      setDeleteDialogOpen(false);
      setCustomerToDelete(null);
    } catch (error: any) {
      console.error('Failed to delete customer:', error);
      toast.error(error.message || 'Failed to delete customer');
    }
  };

  const handleBulkAction = async () => {
    if (!bulkAction || selectedIds.size === 0) return;
    const ids = Array.from(selectedIds);
    try {
      if (bulkAction === 'inactive') {
        const { error } = await supabase.from('customers').update({ customer_status: 'inactive' }).in('id', ids);
        if (error) throw error;
        toast.success(`Moved ${ids.length} customers to Inactive`);
      } else if (bulkAction === 'remove_campaigns') {
        const { error } = await supabase.from('customers').update({ marketing_status: 'opted_out' }).in('id', ids);
        if (error) throw error;
        toast.success(`Removed ${ids.length} customers from campaigns`);
      } else if (bulkAction === 'delete') {
        // Delete quotes for all selected customers in one call, then
        // delete the customers themselves in parallel.
        await supabase.from('quotes').delete().in('customer_id', ids);
        await Promise.all(ids.map(id => deleteCustomer.mutateAsync(id)));
        toast.success(`Deleted ${ids.length} customers`);
      }
      queryClient.invalidateQueries({ queryKey: ['customers'] });
      setSelectedIds(new Set());
      setBulkActionDialogOpen(false);
      setBulkAction(null);
    } catch (error: any) {
      toast.error(error.message || 'Failed to update customers');
    }
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === filteredCustomers.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredCustomers.map(c => c.id)));
    }
  };

  const toggleSelect = (id: string) => {
    const newSelected = new Set(selectedIds);
    if (newSelected.has(id)) newSelected.delete(id); else newSelected.add(id);
    setSelectedIds(newSelected);
  };

  /**
   * Effective status: fill in an unset value, never overrule a decision.
   *
   * This used to promote ANY customer with bookings or revenue to 'active',
   * which meant it also overruled 'inactive'. Marking someone inactive —
   * what the bulk action at the top of this file does by writing
   * customer_status = 'inactive' — therefore had no visible effect on anyone
   * with a single booking to their name. The write landed; the badge still
   * read "Customer"; they stayed in the Customers tab. The action looked
   * broken because its result was computed away on the next render.
   *
   * The schema settles which of the three values is a decision. The column
   * comment on customers.customer_status reads:
   *
   *     'lead (no bookings), active (has bookings), inactive (manually set)'
   *
   * `lead` is also the column DEFAULT, so a 'lead' row may mean "nobody has
   * ever touched this" rather than "someone judged this a lead". `active` is
   * maintained by a database trigger (auto_activate_customer_on_booking).
   * Only `inactive` is stated to be a human's choice, and nothing computes
   * it — so it is the one value that must survive a recompute.
   *
   * Hence the asymmetry below: an explicit 'inactive' or 'active' is
   * returned as stored, and the derivation only runs for 'lead', where it
   * acts as a safety net for rows the trigger predates or missed.
   *
   * The derivation is deliberately left as-is rather than tightened. The DB
   * trigger was narrowed in a later migration to promote only on a COMPLETED
   * booking, while this still promotes on any non-cancelled booking or any
   * revenue. Matching it is not possible here: the stats query selects
   * `customer_id, total_amount, scheduled_at` and no status column, so the
   * client cannot tell a completed booking from a scheduled one. Narrowing
   * the rule needs that query changed, and that is a separate change with
   * its own blast radius.
   */
  const getEffectiveStatus = useCallback((customer: any) => {
    // A human said so. Nothing computed gets to disagree.
    if (customer.customer_status === 'inactive') return 'inactive';
    if (customer.customer_status === 'active') return 'active';

    // 'lead' is the default, so it may simply be stale — derive from history.
    const stats = statsMap.get(customer.id);
    if (stats && (stats.total_bookings > 0 || stats.total_revenue > 0)) {
      return 'active';
    }
    return customer.customer_status || 'lead';
  }, [statsMap]);

  const filteredCustomers = useMemo(() => {
    let list = customers.filter((customer) => {
      const matchesSearch =
        `${customer.first_name} ${customer.last_name}`.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (customer.email ?? '').toLowerCase().includes(searchTerm.toLowerCase()) ||
        (customer.phone?.includes(searchTerm) ?? false);

      const effectiveStatus = getEffectiveStatus(customer);
      let matchesTab = true;
      if (tabFilter === 'customers') matchesTab = effectiveStatus === 'active';
      else if (tabFilter === 'leads') matchesTab = effectiveStatus === 'lead';
      else if (tabFilter === 'non_recurring') matchesTab = customer.is_recurring === false;

      return matchesSearch && matchesTab;
    });

    // Sort
    list = [...list].sort((a, b) => {
      let cmp = 0;
      const nameA = `${a.first_name} ${a.last_name}`.toLowerCase();
      const nameB = `${b.first_name} ${b.last_name}`.toLowerCase();
      const statsA = statsMap.get(a.id);
      const statsB = statsMap.get(b.id);

      switch (sortField) {
        case 'name': cmp = nameA.localeCompare(nameB); break;
        case 'status': cmp = (a.customer_status || '').localeCompare(b.customer_status || ''); break;
        case 'created_at': cmp = new Date(a.created_at).getTime() - new Date(b.created_at).getTime(); break;
        case 'revenue': cmp = (statsA?.total_revenue || 0) - (statsB?.total_revenue || 0); break;
        case 'last_booking': {
          const dateA = statsA?.last_booking_date ? new Date(statsA.last_booking_date).getTime() : 0;
          const dateB = statsB?.last_booking_date ? new Date(statsB.last_booking_date).getTime() : 0;
          cmp = dateA - dateB;
          break;
        }
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });

    return list;
  // eslint-disable-next-line react-hooks/exhaustive-deps -- getEffectiveStatus is a stable helper function that doesn't change between renders
  }, [customers, searchTerm, tabFilter, sortField, sortDir, statsMap]);

  const getInitials = (firstName: string, lastName: string) =>
    `${firstName[0] || ''}${lastName[0] || ''}`.toUpperCase();

  const getStatusBadge = (status: string) => {
    if (status === 'active') return <Badge className="bg-success/15 text-success border-success/30 text-xs">Customer</Badge>;
    if (status === 'inactive') return <Badge variant="secondary" className="text-xs">Inactive</Badge>;
    return <Badge className="bg-warning/15 text-warning border-warning/30 text-xs">Lead</Badge>;
  };

  const handleChangeStatus = useCallback(async (customer: any, newStatus: 'active' | 'lead' | 'inactive') => {
    if (!organization?.id) return;
    const current = customer.customer_status || 'lead';
    if (current === newStatus) return;
    const { error } = await supabase
      .from('customers')
      .update({ customer_status: newStatus })
      .eq('id', customer.id)
      .eq('organization_id', organization.id);
    if (error) {
      toast.error(`Failed to update status: ${error.message}`);
      return;
    }
    const label = newStatus === 'active' ? 'Customer' : newStatus === 'lead' ? 'Lead' : 'Inactive';
    toast.success(`${customer.first_name || 'Customer'} moved to ${label}`);
    queryClient.invalidateQueries({ queryKey: ['customers'] });
  }, [organization?.id, queryClient]);

  const StatusBadgeMenu = ({ customer }: { customer: any }) => {
    const effective = getEffectiveStatus(customer);
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" className="inline-flex items-center hover:brightness-90 transition-all" aria-label="Change status">
            {getStatusBadge(effective)}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-40">
          <DropdownMenuItem onClick={() => handleChangeStatus(customer, 'active')}>
            <Users className="w-3.5 h-3.5 mr-2 text-success" /> Customer
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => handleChangeStatus(customer, 'lead')}>
            <UserPlus className="w-3.5 h-3.5 mr-2 text-warning" /> Lead
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => handleChangeStatus(customer, 'inactive')}>
            <UserX className="w-3.5 h-3.5 mr-2 text-muted-foreground" /> Inactive
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  };

  const handleSort = (field: SortField) => {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortField(field); setSortDir('asc'); }
  };

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) return <ArrowUpDown className="w-3 h-3 ml-1 opacity-40" />;
    return sortDir === 'asc'
      ? <ArrowUp className="w-3 h-3 ml-1 text-primary" />
      : <ArrowDown className="w-3 h-3 ml-1 text-primary" />;
  };

  // Build the CSV body for a given list of customers. Both export paths
  // (filtered + selected) call this so column structure / completed-revenue
  // calc / customer-type resolution stay in one place.
  const buildCustomersCsv = async (
    list: Array<(typeof customers)[number]>,
  ): Promise<string> => {
    const ids = list.map((c) => c.id);

    const [completedResult, locationsResult] = await Promise.all([
      supabase
        .from('bookings')
        .select('customer_id, total_amount')
        .eq('organization_id', organization!.id)
        .eq('status', 'completed')
        .in('customer_id', ids),
      (supabase as unknown as {
        from: (t: string) => {
          select: (s: string) => {
            eq: (k: string, v: string) => {
              in: (k: string, v: string[]) => Promise<{
                data: Array<{
                  customer_id: string | null;
                  property_type: string | null;
                  created_at: string | null;
                  is_primary: boolean | null;
                }> | null;
              }>;
            };
          };
        };
      })
        .from('locations')
        .select('customer_id, property_type, created_at, is_primary')
        .eq('organization_id', organization!.id)
        .in('customer_id', ids),
    ]);

    const completedMap = new Map<string, number>();
    for (const b of (completedResult.data ?? []) as Array<{
      customer_id: string | null;
      total_amount: number | string | null;
    }>) {
      if (!b.customer_id) continue;
      completedMap.set(
        b.customer_id,
        (completedMap.get(b.customer_id) ?? 0) + (Number(b.total_amount) || 0),
      );
    }

    const locsByCustomer = new Map<string, Array<{
      property_type: string | null;
      created_at: string | null;
      is_primary: boolean | null;
    }>>();
    for (const l of locationsResult.data ?? []) {
      if (!l.customer_id) continue;
      const arr = locsByCustomer.get(l.customer_id) ?? [];
      arr.push(l);
      locsByCustomer.set(l.customer_id, arr);
    }
    const customerTypeFor = (id: string): string => {
      const locs = locsByCustomer.get(id);
      if (!locs || locs.length === 0) return '';
      locs.sort((a, b) => {
        const ap = a.is_primary ? 1 : 0;
        const bp = b.is_primary ? 1 : 0;
        if (ap !== bp) return bp - ap;
        return (b.created_at ?? '').localeCompare(a.created_at ?? '');
      });
      const raw = (locs[0].property_type ?? '').toLowerCase();
      if (!raw) return '';
      return raw === 'commercial' ? 'commercial' : 'residential';
    };

    const dateOnly = (iso: string | null | undefined): string =>
      iso ? iso.slice(0, 10) : '';

    const escape = (v: unknown): string => {
      if (v == null) return '';
      const s = String(v);
      if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
      return s;
    };

    const headers = [
      'First Name', 'Last Name', 'Email', 'Phone',
      'Street Address', 'City', 'State', 'ZIP',
      'Customer Type', 'Total Bookings', 'Total Revenue',
      'Last Booking Date', 'Created Date', 'Notes',
    ];

    const rows = list.map((c) => {
      const stats = statsMap.get(c.id);
      return [
        c.first_name ?? '',
        c.last_name ?? '',
        c.email ?? '',
        c.phone ?? '',
        c.address ?? '',
        c.city ?? '',
        c.state ?? '',
        c.zip_code ?? '',
        customerTypeFor(c.id),
        stats?.total_bookings ?? 0,
        (completedMap.get(c.id) ?? 0).toFixed(2),
        dateOnly(stats?.last_booking_date),
        dateOnly(c.created_at),
        c.notes ?? '',
      ].map(escape);
    });

    // U+FEFF BOM so Excel detects UTF-8 (preserves accents). \r\n line
    // endings — Excel on Windows expects them.
    return '﻿' + [headers.join(','), ...rows.map((r) => r.join(','))].join('\r\n');
  };

  const triggerCsvDownload = async (csv: string, filename: string): Promise<void> => {
    if (Capacitor.isNativePlatform()) {
      try {
        const result = await Filesystem.writeFile({
          path: filename,
          data: csv,
          directory: Directory.Cache,
          encoding: Encoding.UTF8,
        });
        await Share.share({ title: filename, url: result.uri, dialogTitle: 'Save CSV' });
      } catch (err) {
        console.error('CSV share error:', err);
        toast.error('Export failed');
      }
    } else {
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }
  };

  const exportToCsv = async () => {
    if (!organization?.id || !isAdmin) return;
    if (filteredCustomers.length === 0) {
      toast('No customers to export');
      return;
    }
    toast(`Exporting ${filteredCustomers.length} customers...`);
    const csv = await buildCustomersCsv(filteredCustomers);
    /* eslint-disable-next-line local/no-device-local-dates -- names an export file with the downloader's own day; no org context here and nothing downstream reads it */
    await triggerCsvDownload(csv, `tidywise-customers-${format(new Date(), 'yyyy-MM-dd')}.csv`);
    if (!Capacitor.isNativePlatform()) toast.success(`Exported ${filteredCustomers.length} customers to CSV`);
  };

  const exportSelectedToCsv = async () => {
    if (!organization?.id || !isAdmin) return;
    if (selectedIds.size === 0) {
      toast('No customers selected');
      return;
    }
    const selected = customers.filter((c) => selectedIds.has(c.id));
    if (selected.length === 0) {
      toast('No customers selected');
      return;
    }
    toast(`Exporting ${selected.length} customers...`);
    const csv = await buildCustomersCsv(selected);
    /* eslint-disable-next-line local/no-device-local-dates -- names an export file with the downloader's own day; no org context here and nothing downstream reads it */
    await triggerCsvDownload(csv, `tidywise-customers-selected-${format(new Date(), 'yyyy-MM-dd')}.csv`);
    if (!Capacitor.isNativePlatform()) toast.success(`Exported ${selected.length} selected customers to CSV`);
  };

  // Mobile helpers
  const startLongPress = (id: string) => {
    if (!isMobile) return;
    if (longPressTimer.current) window.clearTimeout(longPressTimer.current);
    longPressTimer.current = window.setTimeout(() => {
      setBatchMode(true);
      hapticImpact('medium');
      toggleSelect(id);
    }, 450);
  };
  const cancelLongPress = () => {
    if (longPressTimer.current) window.clearTimeout(longPressTimer.current);
    longPressTimer.current = null;
  };
  const onRefresh = async () => {
    hapticImpact('light');
    await queryClient.invalidateQueries({ queryKey: customersQueryKey });
  };

  const pullState = useRef({ startY: 0, pulling: false, dist: 0 });
  const [pullDistance, setPullDistance] = useState(0);

  useEffect(() => { if (!isMobile) { setBatchMode(false); setExpandedId(null); } }, [isMobile]);

  const onListTouchStart = (e: React.TouchEvent) => {
    if (!isMobile || !listRef.current || listRef.current.scrollTop > 0) return;
    pullState.current = { startY: e.touches[0].clientY, pulling: true, dist: 0 };
  };
  const onListTouchMove = (e: React.TouchEvent) => {
    if (!isMobile || !pullState.current.pulling) return;
    const dist = Math.max(0, Math.min(96, e.touches[0].clientY - pullState.current.startY));
    pullState.current.dist = dist;
    setPullDistance(dist);
  };
  const onListTouchEnd = async () => {
    if (!isMobile || !pullState.current.pulling) return;
    const dist = pullState.current.dist;
    pullState.current.pulling = false;
    setPullDistance(0);
    if (dist >= 64) await onRefresh();
  };

  const rowVirtualizer = useVirtualizer({
    count: filteredCustomers.length,
    getScrollElement: () => listRef.current,
    estimateSize: () => 96,
    overscan: 8,
  });

  // Keep the virtualizer's idea of the scroll position from outliving the list.
  //
  // When rows are deleted the spacer shrinks, so the browser silently clamps
  // scrollTop to the new maximum. That clamp does NOT reliably emit a scroll
  // event, so the virtualizer's cached scrollOffset stays where it was and
  // getVirtualItems() returns a window past the end of the list — the rendered
  // rows and the real scroll position disagree, and scrolling appears to stop.
  //
  // Clamping it ourselves produces a real scroll event when it matters, which
  // resyncs the virtualizer. Keyed on the row count, so it runs on any shrink,
  // not just the bulk-delete path — single deletes and filter changes shrink
  // the list too.
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const maxScroll = Math.max(0, el.scrollHeight - el.clientHeight);
    if (el.scrollTop > maxScroll) {
      el.scrollTop = maxScroll;
    }
    rowVirtualizer.measure();
  }, [filteredCustomers.length, rowVirtualizer]);

  const customerCount = customers.filter(c => getEffectiveStatus(c) === 'active').length;
  const leadCount = customers.filter(c => getEffectiveStatus(c) === 'lead').length;

  return (
    <AdminLayout
      title="Customers"
      subtitle={`${customers.length} total`}
      actions={
        <div className="flex gap-2">
      <SEOHead title="Customers | TidyWise" description="Manage your customer database" noIndex />
          {isAdmin && (
            <Button
              variant="outline"
              size="sm"
              className="gap-2"
              onClick={() => navigate('/dashboard/customers/duplicates')}
            >
              <GitMerge className="w-4 h-4" />
              <span className="hidden sm:inline">Find duplicates</span>
            </Button>
          )}
          {isAdmin && (
            <Button variant="outline" size="sm" className="gap-2" onClick={exportToCsv}>
              <Download className="w-4 h-4" />
              <span className="hidden sm:inline">Export CSV</span>
            </Button>
          )}
          <Button variant="outline" size="sm" className="gap-2" onClick={() => setImportDialogOpen(true)}>
            <Upload className="w-4 h-4" />
            <span className="hidden sm:inline">Import</span>
          </Button>
          <Button size="sm" className="gap-2" onClick={() => {
            if (atCustomerLimit) {
              toast.error(`Basic plan limited to ${maxCustomers} customers. Upgrade to add more.`);
              setShowSubscriptionDialog(true);
            } else {
              setAddDialogOpen(true);
            }
          }}>
            <Plus className="w-4 h-4" />
            <span className="hidden sm:inline">Add Customer</span>
          </Button>
        </div>
      }
    >
<div className="portal-v2 portal-v2-scroll">
      {atCustomerLimit && (
        <div className="mb-4 p-3 rounded-lg border border-destructive/30 bg-destructive/5 flex items-center justify-between gap-3">
          <p className="text-sm text-destructive">
            You've reached the Basic plan limit of {maxCustomers} customers. Upgrade to add unlimited customers.
          </p>
          <Button size="sm" variant="destructive" onClick={() => setShowSubscriptionDialog(true)}>
            Upgrade
          </Button>
        </div>
      )}
      {/* Tabs + Search + Bulk Actions */}
      <div className="space-y-4 mb-4">
        <Tabs value={tabFilter} onValueChange={(v) => setTabFilter(v as TabFilter)} className="w-full">
          <TabsList className="w-full sm:w-auto">
            <TabsTrigger value="all" className="flex-1 sm:flex-none gap-1.5">
              All <Badge variant="secondary" className="text-xs px-1.5 py-0">{customers.length}</Badge>
            </TabsTrigger>
            <TabsTrigger value="customers" className="flex-1 sm:flex-none gap-1.5">
              Customers <Badge variant="secondary" className="text-xs px-1.5 py-0">{customerCount}</Badge>
            </TabsTrigger>
            <TabsTrigger value="leads" className="flex-1 sm:flex-none gap-1.5">
              Leads <Badge variant="secondary" className="text-xs px-1.5 py-0">{leadCount}</Badge>
            </TabsTrigger>
            <TabsTrigger value="non_recurring" className="flex-1 sm:flex-none gap-1.5">
              Non-Recurring <Badge variant="secondary" className="text-xs px-1.5 py-0">{customers.filter(c => c.is_recurring === false).length}</Badge>
            </TabsTrigger>
          </TabsList>
        </Tabs>

        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[200px] max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search by name, phone, or email…"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10"
            />
          </div>

          {selectedIds.size > 0 && (
            <div className="flex gap-2 flex-wrap">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" className="gap-1.5">
                    Actions ({selectedIds.size})
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  <DropdownMenuItem onClick={() => { setBulkAction('inactive'); setBulkActionDialogOpen(true); }}>
                    <Users className="w-4 h-4 mr-2" /> Move to Inactive
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => { setBulkAction('remove_campaigns'); setBulkActionDialogOpen(true); }}>
                    <UserX className="w-4 h-4 mr-2" /> Remove from Campaigns
                  </DropdownMenuItem>
                  {isAdmin && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onClick={exportSelectedToCsv}>
                        <Download className="w-4 h-4 mr-2" /> Export Selected
                      </DropdownMenuItem>
                    </>
                  )}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    className="text-destructive"
                    onClick={() => { setBulkAction('delete'); setBulkActionDialogOpen(true); }}
                  >
                    <Trash2 className="w-4 h-4 mr-2" /> Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" className="gap-1.5">
                    <Megaphone className="w-4 h-4" /> Add to Campaign
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-64">
                  {availableCampaigns.length === 0 ? (
                    <DropdownMenuItem disabled>No campaigns available</DropdownMenuItem>
                  ) : (
                    availableCampaigns.map((c) => (
                      <DropdownMenuItem
                        key={c.id}
                        onClick={() => handleBulkAddToCampaign(c as { id: string; name: string; type: string; body: string })}
                      >
                        <Megaphone className="w-3.5 h-3.5 mr-2 text-muted-foreground" />
                        <span className="truncate">{c.name}</span>
                      </DropdownMenuItem>
                    ))
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )}
        </div>
      </div>

      {/* Mobile: Virtualized card list */}
      {isMobile ? (
        <div className="relative">
          <div
            className="sticky top-0 z-10 -mt-2 mb-2"
            style={{ transform: `translate3d(0, ${pullDistance ? pullDistance - 24 : 0}px, 0)` }}
          >
            <div className="flex items-center justify-center text-xs text-muted-foreground gap-2 py-2">
              <RefreshCw className={cn('h-4 w-4 transition-transform', pullDistance >= 64 ? 'rotate-180' : 'rotate-0')} aria-hidden="true" />
              <span>{pullDistance >= 64 ? 'Release to refresh' : 'Pull to refresh'}</span>
            </div>
          </div>

          <div
            ref={listRef}
            className="h-[calc(100dvh-16rem)] overflow-auto overscroll-contain"
            onTouchStart={onListTouchStart}
            onTouchMove={onListTouchMove}
            onTouchEnd={onListTouchEnd}
          >
            {isLoading ? (
              <div className="space-y-3">
                {Array.from({ length: 8 }).map((_, i) => (
                  <Card key={i} className="p-4 animate-pulse"><div className="h-4 w-1/2 bg-muted rounded" /><div className="mt-3 h-3 w-2/3 bg-muted rounded" /></Card>
                ))}
              </div>
            ) : customersOffline ? (
              <OfflineState />
            ) : customersError ? (
              <LoadFailedState onRetry={() => refetchCustomers()} />
            ) : filteredCustomers.length === 0 ? (
              <EmptyState onAdd={() => setAddDialogOpen(true)} />
            ) : (
              <div className="relative w-full" style={{ height: `${rowVirtualizer.getTotalSize()}px` }}>
                {rowVirtualizer.getVirtualItems().map((vRow) => {
                  const customer = filteredCustomers[vRow.index];
                  const isExpanded = expandedId === customer.id;
                  const isSelected = selectedIds.has(customer.id);
                  const cStats = statsMap.get(customer.id);
                  const isDupe = duplicates.has(customer.id);

                  return (
                    <div key={customer.id} className="absolute left-0 top-0 w-full" style={{ transform: `translate3d(0, ${vRow.start}px, 0)` }}>
                      <button
                          type="button"
                          className={cn('w-full text-left bg-card border border-border shadow-sm rounded-xl p-3 transition-transform active:scale-[0.99] will-change-transform mb-3')}
                          onPointerDown={() => startLongPress(customer.id)}
                          onPointerUp={cancelLongPress}
                          onPointerCancel={cancelLongPress}
                          onClick={() => {
                            cancelLongPress();
                            if (batchMode) { hapticImpact('light'); toggleSelect(customer.id); return; }
                            hapticImpact('light');
                            setSelectedCustomer(customer);
                            setMobileProfileOpen(true);
                          }}
                        >
                          <div className="flex items-start gap-3">
                            {batchMode && (
                              <div className="pt-1"><Checkbox checked={isSelected} onCheckedChange={() => toggleSelect(customer.id)} /></div>
                            )}
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center justify-between gap-2">
                                <div className="min-w-0 flex-1">
                                  <div className="flex items-center gap-1.5">
                                    <p className="font-medium text-sm truncate">{maskName(`${customer.first_name} ${customer.last_name}`)}</p>
                                    {isDupe && <AlertTriangle className="w-3.5 h-3.5 text-warning flex-shrink-0" />}
                                  </div>
                                  <p className="text-xs text-muted-foreground truncate">{maskPhone(customer.phone || '')}</p>
                                </div>
                                <div className="flex flex-col items-end gap-0.5 shrink-0">
                                  <StatusBadgeMenu customer={customer} />
                                  {isDupe && <Badge variant="outline" className="text-[10px] border-warning/40 text-warning">Possible Duplicate</Badge>}
                                </div>
                              </div>
                              {cStats && (
                                <div className="flex gap-3 mt-1.5 text-xs text-muted-foreground">
                                  <span>{cStats.total_bookings} bookings</span>
                                  <span>{maskAmount(cStats.total_revenue)}</span>
                                  {cStats.last_booking_date && <span>Last: {format(new Date(cStats.last_booking_date), 'MMM d')}</span>}
                                </div>
                              )}

                              {isExpanded && (
                                <div className="mt-3 space-y-2 animate-fade-in">
                                  {customer.address && (
                                    <div className="text-sm flex items-center gap-1 text-muted-foreground">
                                      <MapPin className="h-3.5 w-3.5 flex-shrink-0" />
                                      <span>{[customer.address, customer.city, customer.state, customer.zip_code].filter(Boolean).join(', ')}</span>
                                    </div>
                                  )}
                                  <div className="flex gap-2 pt-2">
                                    <Button type="button" variant="outline" size="sm" className="flex-1" onClick={e => { e.preventDefault(); e.stopPropagation(); hapticImpact('light'); setSelectedCustomer(customer); setEditDialogOpen(true); }}>
                                      <Edit className="h-4 w-4 mr-2" /> Edit
                                    </Button>
                                    <Button type="button" variant="outline" size="sm" className="flex-1" onClick={e => { e.preventDefault(); e.stopPropagation(); hapticImpact('light'); setSelectedCustomer(customer); setPaymentHistoryOpen(true); }}>
                                      <CreditCard className="h-4 w-4 mr-2" /> Payments
                                    </Button>
                                  </div>
                                </div>
                              )}
                            </div>
                          </div>
                        </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={() => { hapticImpact('medium'); setAddDialogOpen(true); }}
            className={cn('fixed right-4 bottom-[calc(4.25rem+env(safe-area-inset-bottom))] h-14 w-14 rounded-full bg-primary text-primary-foreground shadow-lg flex items-center justify-center transition-transform active:scale-[0.96] will-change-transform')}
            aria-label="Add customer"
          >
            <Plus className="h-6 w-6" aria-hidden="true" />
          </button>

          {batchMode && (
            <div className="fixed left-4 right-4 bottom-[calc(4.25rem+env(safe-area-inset-bottom))]">
              <Button type="button" variant="secondary" className="w-full" onClick={() => { hapticImpact('light'); setBatchMode(false); setSelectedIds(new Set()); }}>
                Exit batch mode
              </Button>
            </div>
          )}
        </div>
      ) : (
        /* Desktop Table */
        <>
          {customersOffline ? (
            <OfflineState />
          ) : customersError ? (
            <LoadFailedState onRetry={() => refetchCustomers()} />
          ) : !isLoading && filteredCustomers.length === 0 ? (
            <EmptyState onAdd={() => setAddDialogOpen(true)} />
          ) : (
            <div className="bg-card rounded-xl border border-border shadow-sm overflow-x-auto">
              <TooltipProvider>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[40px]">
                        <Checkbox
                          checked={selectedIds.size === filteredCustomers.length && filteredCustomers.length > 0}
                          onCheckedChange={toggleSelectAll}
                        />
                      </TableHead>
                      <TableHead className="min-w-[200px]">
                        <button className="flex items-center gap-0.5 hover:text-foreground transition-colors" onClick={() => handleSort('name')}>
                          Customer <SortIcon field="name" />
                        </button>
                      </TableHead>
                      <TableHead className="w-[120px]">
                        <button className="flex items-center gap-0.5 hover:text-foreground transition-colors" onClick={() => handleSort('status')}>
                          Status <SortIcon field="status" />
                        </button>
                      </TableHead>
                      <TableHead className="min-w-[200px]">Contact</TableHead>
                      <TableHead className="min-w-[180px]">Address</TableHead>
                      <TableHead className="w-[90px] text-center">
                        <button className="flex items-center gap-0.5 hover:text-foreground transition-colors mx-auto" onClick={() => handleSort('revenue')}>
                          Revenue <SortIcon field="revenue" />
                        </button>
                      </TableHead>
                      <TableHead className="w-[80px] text-center">Bookings</TableHead>
                      <TableHead className="w-[110px]">
                        <button className="flex items-center gap-0.5 hover:text-foreground transition-colors" onClick={() => handleSort('last_booking')}>
                          Last Job <SortIcon field="last_booking" />
                        </button>
                      </TableHead>
                      <TableHead className="w-[130px] text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {isLoading ? (
                      Array.from({ length: 6 }).map((_, i) => (
                        <TableRow key={i}>
                          <TableCell colSpan={9}>
                            <div className="h-8 animate-pulse rounded bg-muted" />
                          </TableCell>
                        </TableRow>
                      ))
                    ) : (
                      filteredCustomers.map((customer) => {
                        const cStats = statsMap.get(customer.id);
                        const isDupe = duplicates.has(customer.id);
                        return (
                          <TableRow key={customer.id} className="hover:bg-muted/30 group">
                            <TableCell>
                              <Checkbox checked={selectedIds.has(customer.id)} onCheckedChange={() => toggleSelect(customer.id)} />
                            </TableCell>
                            <TableCell>
                              <div className="flex items-center gap-3">
                                <Avatar className="h-9 w-9">
                                  <AvatarFallback className="bg-primary/10 text-primary font-medium text-sm">
                                    {getInitials(customer.first_name, customer.last_name)}
                                  </AvatarFallback>
                                </Avatar>
                                <div className="min-w-0">
                                  <div className="flex items-center gap-1.5">
                                    <p className="font-medium text-sm truncate">{maskName(`${customer.first_name} ${customer.last_name}`)}</p>
                                    {isDupe && (
                                      <Tooltip>
                                        <TooltipTrigger><AlertTriangle className="w-3.5 h-3.5 text-warning" /></TooltipTrigger>
                                        <TooltipContent>Possible duplicate (shared email or phone)</TooltipContent>
                                      </Tooltip>
                                    )}
                                  </div>
                                  <p className="text-xs text-muted-foreground">
                                    Since {format(new Date(customer.created_at), 'MMM d, yyyy')}
                                  </p>
                                </div>
                              </div>
                            </TableCell>
                            <TableCell>
                              <div className="flex flex-col gap-1">
                                <StatusBadgeMenu customer={customer} />
                                {isDupe && <Badge variant="outline" className="text-[10px] border-warning/40 text-warning">Duplicate</Badge>}
                                {(() => {
                                  const enrolled = enrollmentsByCustomer.get(customer.id) || [];
                                  if (enrolled.length === 0) return null;
                                  const label = enrolled.length === 1 ? enrolled[0].name : `${enrolled.length} campaigns`;
                                  return (
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <Badge variant="outline" className="text-[10px] border-primary/40 text-primary gap-1 max-w-[160px]">
                                          <Megaphone className="w-3 h-3 flex-shrink-0" />
                                          <span className="truncate">{label}</span>
                                        </Badge>
                                      </TooltipTrigger>
                                      <TooltipContent className="max-w-xs">
                                        <div className="text-xs font-medium mb-1">Active campaigns</div>
                                        <ul className="text-xs space-y-0.5">
                                          {enrolled.map(e => <li key={e.id}>• {e.name}</li>)}
                                        </ul>
                                      </TooltipContent>
                                    </Tooltip>
                                  );
                                })()}
                              </div>
                            </TableCell>
                            <TableCell>
                              <div className="space-y-1">
                                {customer.email ? (
                                  <a href={`mailto:${customer.email}`} className="flex items-center gap-2 text-sm hover:text-primary transition-colors">
                                    <Mail className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                                    <span className="truncate">{maskEmail(customer.email)}</span>
                                  </a>
                                ) : (
                                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                    <Mail className="w-3.5 h-3.5 flex-shrink-0" />
                                    <span className="truncate">No email</span>
                                  </div>
                                )}
                                {customer.phone && (
                                  <div className="flex items-center gap-2 text-sm">
                                    <a href={`tel:${customer.phone}`} className="flex items-center gap-2 hover:text-primary transition-colors">
                                      <Phone className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                                      {maskPhone(customer.phone)}
                                    </a>
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <button
                                          type="button"
                                          onClick={() => {
                                            setMessageCustomer({
                                              id: customer.id,
                                              name: `${customer.first_name || ''} ${customer.last_name || ''}`.trim(),
                                              phone: customer.phone ?? '',
                                            });
                                            setMessageText('');
                                            setMessageDialogOpen(true);
                                          }}
                                          className="inline-flex items-center hover:text-primary transition-colors"
                                          aria-label="Send message via OpenPhone"
                                        >
                                          <MessageSquare className="w-3.5 h-3.5 text-muted-foreground" />
                                        </button>
                                      </TooltipTrigger>
                                      <TooltipContent>Message via OpenPhone</TooltipContent>
                                    </Tooltip>
                                  </div>
                                )}
                              </div>
                            </TableCell>
                            <TableCell>
                              {customer.address ? (
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <div className="flex items-center gap-1 text-sm text-muted-foreground cursor-default max-w-[220px]">
                                      <MapPin className="h-3.5 w-3.5 flex-shrink-0" />
                                      <span className="truncate">{customer.address}{customer.city ? `, ${customer.city}` : ''}</span>
                                    </div>
                                  </TooltipTrigger>
                                  <TooltipContent side="bottom" className="max-w-xs">
                                    {[customer.address, customer.city, customer.state, customer.zip_code].filter(Boolean).join(', ')}
                                  </TooltipContent>
                                </Tooltip>
                              ) : (
                                <span className="text-muted-foreground text-sm">—</span>
                              )}
                            </TableCell>
                            <TableCell className="text-center">
                              <span className="text-sm font-medium">{isTestMode ? '$XXX' : `${fmt((cStats?.total_revenue || 0))}`}</span>
                            </TableCell>
                            <TableCell className="text-center">
                              <span className="text-sm">{isTestMode ? 'X' : (cStats?.total_bookings || 0)}</span>
                            </TableCell>
                            <TableCell>
                              <span className="text-sm text-muted-foreground">
                                {cStats?.last_booking_date
                                  ? format(new Date(cStats.last_booking_date), 'MMM d, yyyy')
                                  : '—'}
                              </span>
                            </TableCell>
                            <TableCell>
                              <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => { setSelectedCustomer(customer); setEditDialogOpen(true); }}>
                                      <Edit className="w-4 h-4" />
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent>Edit</TooltipContent>
                                </Tooltip>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => { setSelectedCustomer(customer); setPaymentHistoryOpen(true); }}>
                                      <DollarSign className="w-4 h-4" />
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent>Payment History</TooltipContent>
                                </Tooltip>
                                <DropdownMenu>
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <DropdownMenuTrigger asChild>
                                        <Button variant="ghost" size="icon" className="h-8 w-8">
                                          <Megaphone className="w-4 h-4" />
                                        </Button>
                                      </DropdownMenuTrigger>
                                    </TooltipTrigger>
                                    <TooltipContent>Add to Campaign</TooltipContent>
                                  </Tooltip>
                                  <DropdownMenuContent align="end" className="w-56">
                                    {availableCampaigns.length === 0 ? (
                                      <DropdownMenuItem disabled>No campaigns available</DropdownMenuItem>
                                    ) : (
                                      availableCampaigns.map((c) => (
                                        <DropdownMenuItem
                                          key={c.id}
                                          onClick={() => handleAddToCampaign(customer, c as { id: string; name: string; type: string; body: string })}
                                        >
                                          <Megaphone className="w-3.5 h-3.5 mr-2 text-muted-foreground" />
                                          <span className="truncate">{c.name}</span>
                                        </DropdownMenuItem>
                                      ))
                                    )}
                                  </DropdownMenuContent>
                                </DropdownMenu>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => handleDeleteClick(customer)}>
                                      <Trash2 className="w-4 h-4" />
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent>Delete</TooltipContent>
                                </Tooltip>
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })
                    )}
                  </TableBody>
                </Table>
              </TooltipProvider>
            </div>
          )}
        </>
      )}

      <AddCustomerDialog open={addDialogOpen} onOpenChange={setAddDialogOpen} />

      {selectedCustomer && (
        <>
          <EditCustomerDialog open={editDialogOpen} onOpenChange={setEditDialogOpen} customer={selectedCustomer} />
          <PaymentHistoryDialog open={paymentHistoryOpen} onOpenChange={setPaymentHistoryOpen} customerId={selectedCustomer.id} customerName={`${selectedCustomer.first_name} ${selectedCustomer.last_name}`} />
          {isMobile && (
            <MobileContactProfile
              open={mobileProfileOpen}
              onOpenChange={setMobileProfileOpen}
              customer={selectedCustomer}
              onEdit={() => { setMobileProfileOpen(false); setEditDialogOpen(true); }}
              onPaymentHistory={() => { setMobileProfileOpen(false); setPaymentHistoryOpen(true); }}
            />
          )}
        </>
      )}

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Customer</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete {customerToDelete?.name}? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={bulkActionDialogOpen} onOpenChange={setBulkActionDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {bulkAction === 'inactive' ? 'Move to Inactive' : bulkAction === 'delete' ? 'Delete Customers' : 'Remove from Campaigns'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {bulkAction === 'inactive'
                ? `Are you sure you want to mark ${selectedIds.size} customer(s) as Inactive?`
                : bulkAction === 'delete'
                ? `Are you sure you want to delete ${selectedIds.size} customer(s)? This cannot be undone.`
                : `Are you sure you want to remove ${selectedIds.size} customer(s) from all campaigns?`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleBulkAction} className={bulkAction === 'delete' ? 'bg-destructive text-destructive-foreground hover:bg-destructive/90' : ''}>
              Confirm
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <ImportDialog
        open={importDialogOpen}
        onOpenChange={setImportDialogOpen}
        title="Import Customers"
        entityName="customers"
        fields={CUSTOMER_FIELDS}
        onImport={handleImportCustomers}
        sampleData={CUSTOMER_SAMPLE}
      />

      <Dialog open={messageDialogOpen} onOpenChange={(open) => { if (!messageSending) setMessageDialogOpen(open); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Message {messageCustomer?.name || 'customer'}</DialogTitle>
            <DialogDescription>
              Sends via OpenPhone to {messageCustomer ? maskPhone(messageCustomer.phone) : ''}.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={messageText}
            onChange={(e) => setMessageText(e.target.value)}
            placeholder="Type your message…"
            rows={5}
            maxLength={1600}
            disabled={messageSending}
            autoFocus
          />
          <div className="text-xs text-muted-foreground text-right">{messageText.length}/1600</div>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button variant="outline" onClick={() => setMessageDialogOpen(false)} disabled={messageSending}>
              Cancel
            </Button>
            <Button
              onClick={async () => {
                if (!messageCustomer || !messageText.trim() || !organization?.id) return;
                setMessageSending(true);
                try {
                  const { data, error } = await supabase.functions.invoke('send-openphone-sms', {
                    body: {
                      to: messageCustomer.phone,
                      message: messageText.trim(),
                      organizationId: organization.id,
                    },
                  });
                  if (error) throw error;
                  if (data && data.success === false) {
                    toast.error(data.error || 'Failed to send message');
                    return;
                  }
                  toast.success(`Message sent to ${messageCustomer.name || 'customer'}`);
                  setMessageDialogOpen(false);
                  setMessageText('');
                } catch (err) {
                  toast.error(err instanceof Error ? err.message : 'Failed to send message');
                } finally {
                  setMessageSending(false);
                }
              }}
              disabled={messageSending || !messageText.trim()}
            >
              {messageSending ? 'Sending…' : 'Send'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
</AdminLayout>
  );
}

/**
 * The third branch this screen was missing.
 *
 * The list was `isLoading ? skeletons : length === 0 ? <EmptyState/> : rows`,
 * so a failed read fell through to EmptyState and told an org with thousands
 * of customers that it had none — with an inviting "Add Your First Customer"
 * button under it. useCustomers() throws correctly; the page simply never
 * destructured `error`.
 *
 * Deliberately shares no visual language with EmptyState: different icon,
 * different tone, no primary call to action. An empty list invites you to
 * add someone; a failed read must not, because the customers are already
 * there and adding another is the wrong thing to do about it.
 */
/**
 * Offline with nothing cached to show.
 *
 * Distinct from LoadFailedState because the honest advice differs: there is
 * nothing to retry against, and a "Try again" button that cannot work is a
 * worse answer than none. The list returns by itself when the connection
 * does, so this says that instead of offering a dead control.
 */
function OfflineState() {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-4" role="status">
      <div className="w-20 h-20 rounded-full bg-muted flex items-center justify-center mb-6">
        <WifiOff className="w-10 h-10 text-muted-foreground" />
      </div>
      <h3 className="text-lg font-semibold mb-2">You&rsquo;re offline</h3>
      <p className="text-muted-foreground text-sm text-center max-w-sm">
        Your customer list is still there. It will load as soon as you have a
        connection again.
      </p>
    </div>
  );
}

function LoadFailedState({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-4" role="alert">
      <div className="w-20 h-20 rounded-full bg-destructive/10 flex items-center justify-center mb-6">
        <AlertTriangle className="w-10 h-10 text-destructive" />
      </div>
      <h3 className="text-lg font-semibold mb-2">Couldn&rsquo;t load customers</h3>
      <p className="text-muted-foreground text-sm text-center max-w-sm mb-6">
        Your customer list is still there — this device just couldn&rsquo;t fetch it.
        Check your connection and try again.
      </p>
      <Button variant="outline" onClick={onRetry} className="gap-2">
        <RefreshCw className="w-4 h-4" />
        Try again
      </Button>
    </div>
  );
}

function EmptyState({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-4">
      <div className="w-20 h-20 rounded-full bg-primary/10 flex items-center justify-center mb-6">
        <UserPlus className="w-10 h-10 text-primary" />
      </div>
      <h3 className="text-lg font-semibold mb-2">No customers yet</h3>
      <p className="text-muted-foreground text-sm text-center max-w-sm mb-6">
        Start building your client list by adding your first customer or importing from a spreadsheet.
      </p>
      <Button onClick={onAdd} className="gap-2">
        <Plus className="w-4 h-4" />
        Add Your First Customer
      </Button>
    </div>
  );
}
