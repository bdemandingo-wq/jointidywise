import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AdminLayout } from '@/components/admin/AdminLayout';
import { SubscriptionGate } from '@/components/admin/SubscriptionGate';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Plus,
  FileText,
  Send,
  Trash2,
  Edit,
  Loader2,
  Eye,
  Copy,
  X,
  DollarSign,
  Clock,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';
import { format, addDays } from 'date-fns';
import { useOrgTimezone } from '@/hooks/useOrgTimezone';
import { orgDateKey, orgAddDays, formatInOrgTz } from '@/lib/orgDateRange';
import { useOrganization } from '@/contexts/OrganizationContext';
import { InvoiceViewDialog } from '@/components/admin/InvoiceViewDialog';
import { InvoiceFormDialog } from '@/components/admin/InvoiceFormDialog';
import { SEOHead } from '@/components/SEOHead';
import { buildInvoiceEmailPayload, formatInvoiceNumber, getInvoiceContact } from '@/lib/invoiceUtils';
import { offlinePaymentLabel, type OfflinePaymentMethod } from '@/lib/invoiceDraft';
import { markInvoicePaidOffline, undoInvoicePaid } from '@/lib/invoicePayment';
import { MarkPaidButton } from '@/components/admin/invoice/MarkPaidButton';
import { readEdgeFunctionError } from '@/lib/edgeFunctionError';
import { fmt } from '@/lib/activeCurrency';
import { mustAffectRows } from '@/lib/mustAffectRows';
import { confirmDialog } from "@/components/AppDialogs";

interface Invoice {
  id: string;
  invoice_number: number;
  organization_id: string | null;
  customer_id: string | null;
  lead_id: string | null;
  subtotal: number;
  tax_percent: number;
  tax_amount: number;
  discount_percent: number;
  discount_amount: number;
  total_amount: number;
  status: 'draft' | 'sent' | 'paid' | 'overdue' | 'cancelled';
  stripe_invoice_id: string | null;
  stripe_invoice_url: string | null;
  due_date: string | null;
  paid_at: string | null;
  sent_at: string | null;
  notes: string | null;
  address: string | null;
  cc_emails: string[] | null;
  created_at: string;
  customer?: {
    first_name: string;
    last_name: string;
    email: string;
    phone: string | null;
    address: string | null;
    city: string | null;
    state: string | null;
    zip_code: string | null;
  };
  lead?: {
    name: string;
    email: string;
    phone: string | null;
    address: string | null;
    city: string | null;
    state: string | null;
    zip_code: string | null;
  };
  invoice_items?: InvoiceItem[];
}

interface InvoiceItem {
  id: string;
  invoice_id: string;
  service_id: string | null;
  description: string;
  quantity: number;
  unit_price: number;
  total: number;
  sort_order: number;
  service?: { name: string };
}

const STATUS_CONFIG: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline'; icon: typeof FileText }> = {
  draft: { label: 'Draft', variant: 'secondary', icon: FileText },
  sent: { label: 'Sent', variant: 'default', icon: Clock },
  paid: { label: 'Paid', variant: 'default', icon: CheckCircle2 },
  overdue: { label: 'Overdue', variant: 'destructive', icon: AlertCircle },
  cancelled: { label: 'Cancelled', variant: 'outline', icon: X },
};

/**
 * Why Edit is unavailable. Only drafts are editable — an invoice the customer
 * has already received must not change under them. The reason names Duplicate
 * because that control is right there in the same row, so the message points
 * at a real next step instead of being a dead end.
 */
type InvoiceStatus = Invoice['status'];

/**
 * The only values ?filter= will honour — exactly the statuses the CHECK
 * constraint on `invoices` allows.
 *
 * notificationCatalog.ts also links here with filter=failed, filter=refunded and
 * filter=disputed. None of those is an invoice status and none has local data
 * behind it, so wiring them would produce a filter that can only ever be empty.
 * They are deliberately not accepted; an unrecognised value falls through to
 * "no filter" rather than to an empty list.
 * See docs/bugs/2026-07-30-invoice-overdue-and-filters.md.
 */
const VALID_STATUS_FILTERS: InvoiceStatus[] = ['draft', 'sent', 'paid', 'overdue', 'cancelled'];

function StatFilterCard({ icon, label, value, active, onClick }: {
  icon: React.ReactNode; label: string; value: number; active: boolean; onClick: () => void;
}) {
  return (
    <Card
      role="button"
      tabIndex={0}
      aria-pressed={active}
      onClick={onClick}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } }}
      className={`cursor-pointer transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${active ? 'ring-2 ring-primary' : ''}`}
    >
      <CardContent className="p-4">
        <div className="flex items-center gap-2">{icon}<span className="text-sm text-muted-foreground">{label}</span></div>
        <p className="text-2xl font-bold mt-1">{value}</p>
      </CardContent>
    </Card>
  );
}

function editBlockedReason(status: Invoice['status']): string {
  if (status === 'cancelled') return "Cancelled invoices can't be edited. Duplicate it instead.";
  if (status === 'paid') return "Paid invoices can't be edited. Duplicate it instead.";
  return "Sent invoices can't be edited. Duplicate it instead.";
}

export default function InvoicesPage() {
  const [formDialogOpen, setFormDialogOpen] = useState(false);
  const [viewDialogOpen, setViewDialogOpen] = useState(false);
  const [editingInvoice, setEditingInvoice] = useState<Invoice | null>(null);
  const [viewingInvoice, setViewingInvoice] = useState<Invoice | null>(null);
  const [sendingInvoice, setSendingInvoice] = useState<string | null>(null);
  const queryClient = useQueryClient();
  // Invoice due dates are calendar dates in the BUSINESS's calendar — a
  // payment deadline the customer sees, not a device-local one.
  const { timezone: orgTimezone } = useOrgTimezone();
  const { organization } = useOrganization();

  const { data: invoices = [], isLoading, error: invoicesError } = useQuery({
    queryKey: ['invoices', organization?.id],
    queryFn: async () => {
      if (!organization?.id) return [];
      const { data, error } = await supabase
        .from('invoices')
        .select(`
          *,
          customer:customers(first_name, last_name, email, phone, address, city, state, zip_code),
          lead:leads(name, email, phone, address, city, state, zip_code),
          invoice_items(*, service:services(name))
        `)
        .eq('organization_id', organization.id)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data as Invoice[];
    },
    enabled: !!organization?.id,
  });

  const { data: customers = [], error: customersError } = useQuery({
    queryKey: ['customers', organization?.id],
    queryFn: async () => {
      if (!organization?.id) return [];
      const { data, error } = await supabase
        .from('customers')
        .select('*')
        .eq('organization_id', organization.id)
        .order('first_name');
      if (error) throw error;
      return data;
    },
    enabled: !!organization?.id,
  });

  const { data: leads = [], error: leadsQueryError } = useQuery({
    queryKey: ['leads', organization?.id],
    queryFn: async () => {
      if (!organization?.id) return [];
      const { data, error } = await supabase
        .from('leads')
        .select('*')
        .eq('organization_id', organization.id)
        .order('name');
      if (error) throw error;
      return data;
    },
    enabled: !!organization?.id,
  });

  const { data: services = [], error: servicesError } = useQuery({
    queryKey: ['services', organization?.id],
    queryFn: async () => {
      if (!organization?.id) return [];
      const { data, error } = await supabase
        .from('services')
        .select('*')
        .eq('organization_id', organization.id)
        .eq('is_active', true)
        .order('name');
      if (error) throw error;
      return data;
    },
    enabled: !!organization?.id,
  });

  const { data: pricingSettings, error: pricingSettingsError } = useQuery({
    queryKey: ['pricing-settings', organization?.id],
    queryFn: async () => {
      if (!organization?.id) return null;
      const { data, error } = await supabase
        .from('organization_pricing_settings')
        .select('sales_tax_percent')
        .eq('organization_id', organization.id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!organization?.id,
  });

  const defaultTaxPercent = pricingSettings?.sales_tax_percent ?? 0;

  useEffect(() => {
    const err = invoicesError || customersError || leadsQueryError || servicesError || pricingSettingsError;
    if (err) toast.error('Failed to load data');
  }, [invoicesError, customersError, leadsQueryError, servicesError, pricingSettingsError]);

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await mustAffectRows(
        supabase.from('invoices').delete().eq('id', id),
        'Invoice not deleted. It may belong to a different business.',
        { table: 'invoices' },
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      toast.success('Invoice deleted');
    },
    onError: (error: any) => toast.error(error.message),
  });

  const cancelMutation = useMutation({
    mutationFn: async (id: string) => {
      await mustAffectRows(
        supabase.from('invoices').update({ status: 'cancelled' }).eq('id', id),
        'Invoice not cancelled. It may belong to a different business.',
        { table: 'invoices' },
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      toast.success('Invoice cancelled');
    },
    onError: (error: any) => toast.error(error.message),
  });

  // Marking paid is otherwise one-way: nothing else in the UI can move an
  // invoice out of 'paid'. Rather than putting a confirm() in front of a
  // routine action — which mostly trains people to dismiss the Cancel and
  // Delete confirms that matter — the action stays one click and becomes
  // undoable. That also addresses the real mistake, which is clicking the
  // wrong row rather than not meaning to click at all.
  const undoMarkPaidMutation = useMutation({
    mutationFn: async ({ id, previousStatus }: { id: string; previousStatus: Invoice['status'] }) => {
      await undoInvoicePaid(id, previousStatus);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      toast.success('Payment undone');
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const markPaidMutation = useMutation({
    // The previous status is captured at click time so undo restores what was
    // actually there — an overdue invoice must not come back as merely sent.
    mutationFn: async ({ id, method }: { id: string; previousStatus: Invoice['status']; method: OfflinePaymentMethod }) => {
      return markInvoicePaidOffline(id, method);
    },
    onSuccess: (stored, variables) => {
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      const label = offlinePaymentLabel(variables.method);
      toast.success(
        stored === 'stored' ? `Invoice marked as paid (${label})` : `Invoice marked as paid (${label}). The method was not stored because the database column is not applied yet.`,
        {
          // Longer than the default so there is time to notice and react.
          duration: 8000,
          action: {
            label: 'Undo',
            onClick: () => undoMarkPaidMutation.mutate(variables),
          },
        },
      );
    },
    onError: (error: any) => toast.error(error.message),
  });

  const sendInvoiceEmail = async (invoice: Invoice) => {
    const contact = getInvoiceContact(invoice);

    if (!contact.email) {
      toast.error('No email address found for this client');
      return;
    }

    setSendingInvoice(invoice.id);
    try {
      const { error } = await supabase.functions.invoke('send-invoice', {
        body: buildInvoiceEmailPayload(invoice, organization?.id || ''),
      });

      if (error) throw new Error(await readEdgeFunctionError(error, 'Failed to send invoice email'));

      if (invoice.status === 'draft') {
        await mustAffectRows(
          supabase
            .from('invoices')
            .update({ status: 'sent', sent_at: new Date().toISOString() })
            .eq('id', invoice.id),
          'Invoice was emailed but its status could not be updated to Sent.',
          { table: 'invoices' },
        );
      }

      toast.success(`Invoice emailed to ${contact.email}`);
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
    } catch (error: any) {
      console.error('Failed to send invoice email:', error);
      toast.error(error.message || 'Failed to send invoice email');
    } finally {
      setSendingInvoice(null);
    }
  };

  const duplicateInvoice = (invoice: Invoice) => {
    setEditingInvoice({
      ...invoice,
      id: '',
      invoice_number: 0,
      status: 'draft',
      stripe_invoice_id: null,
      stripe_invoice_url: null,
      sent_at: null,
      paid_at: null,
        due_date: orgDateKey(orgAddDays(new Date(), 7, orgTimezone), orgTimezone),
    });
    setFormDialogOpen(true);
  };

  // Deep links into this page were inert: nothing read the query string, so every
  // ?filter= and ?customer= link landed on the full unfiltered list.
  const [searchParams, setSearchParams] = useSearchParams();
  const rawFilter = searchParams.get('filter');
  const statusFilter = VALID_STATUS_FILTERS.includes(rawFilter as InvoiceStatus)
    ? (rawFilter as InvoiceStatus)
    : null;
  const customerFilter = searchParams.get('customer');

  const setStatusFilter = (next: InvoiceStatus | null) => {
    const params = new URLSearchParams(searchParams);
    if (next) params.set('filter', next); else params.delete('filter');
    setSearchParams(params, { replace: true });
  };
  const clearCustomerFilter = () => {
    const params = new URLSearchParams(searchParams);
    params.delete('customer');
    setSearchParams(params, { replace: true });
  };

  const visibleInvoices = useMemo(() => invoices.filter(i => {
    if (statusFilter && i.status !== statusFilter) return false;
    if (customerFilter && i.customer_id !== customerFilter) return false;
    return true;
  }), [invoices, statusFilter, customerFilter]);

  // Counters stay computed from the FULL set. A filter must not make the cards
  // agree with themselves — clicking "Paid" should not zero every other card.
  const stats = {
    total: invoices.length,
    draft: invoices.filter(i => i.status === 'draft').length,
    sent: invoices.filter(i => i.status === 'sent').length,
    paid: invoices.filter(i => i.status === 'paid').length,
    overdue: invoices.filter(i => i.status === 'overdue').length,
    totalPaid: invoices.filter(i => i.status === 'paid').reduce((sum, i) => sum + i.total_amount, 0),
    totalOutstanding: invoices.filter(i => ['sent', 'overdue'].includes(i.status)).reduce((sum, i) => sum + i.total_amount, 0),
  };

  return (
    <AdminLayout
      title="Invoices"
      subtitle={`${invoices.length} total invoices`}
      actions={
        <Button className="gap-2" onClick={() => {
          setEditingInvoice(null);
          setFormDialogOpen(true);
        }}>
          <Plus className="w-4 h-4" />
          New Invoice
        </Button>
      }
    >
<div className="portal-v2 portal-v2-scroll">
      <SEOHead title="Invoices | TidyWise" description="Create and manage invoices" noIndex />
      <SubscriptionGate feature="Invoices">
        <div className="grid grid-cols-2 gap-4 mb-6 md:grid-cols-4 lg:grid-cols-7">
          <StatFilterCard icon={<FileText className="w-4 h-4 text-primary" />} label="Total" value={stats.total} active={statusFilter === null} onClick={() => setStatusFilter(null)} />
          <StatFilterCard icon={<FileText className="w-4 h-4 text-muted-foreground" />} label="Draft" value={stats.draft} active={statusFilter === 'draft'} onClick={() => setStatusFilter(statusFilter === 'draft' ? null : 'draft')} />
          <StatFilterCard icon={<Clock className="w-4 h-4 text-primary" />} label="Sent" value={stats.sent} active={statusFilter === 'sent'} onClick={() => setStatusFilter(statusFilter === 'sent' ? null : 'sent')} />
          <StatFilterCard icon={<AlertCircle className="w-4 h-4 text-destructive" />} label="Overdue" value={stats.overdue} active={statusFilter === 'overdue'} onClick={() => setStatusFilter(statusFilter === 'overdue' ? null : 'overdue')} />
          <StatFilterCard icon={<CheckCircle2 className="w-4 h-4 text-primary" />} label="Paid" value={stats.paid} active={statusFilter === 'paid'} onClick={() => setStatusFilter(statusFilter === 'paid' ? null : 'paid')} />
          <Card><CardContent className="p-4"><div className="flex items-center gap-2"><DollarSign className="w-4 h-4 text-primary" /><span className="text-sm text-muted-foreground">Total Paid</span></div><p className="text-2xl font-bold mt-1">{`${fmt(stats.totalPaid)}`}</p></CardContent></Card>
          <Card><CardContent className="p-4"><div className="flex items-center gap-2"><AlertCircle className="w-4 h-4 text-primary" /><span className="text-sm text-muted-foreground">Outstanding</span></div><p className="text-2xl font-bold mt-1">{`${fmt(stats.totalOutstanding)}`}</p></CardContent></Card>
        </div>

        {(statusFilter || customerFilter) && (
          <div className="flex flex-wrap items-center gap-2 mb-4 text-sm">
            <span className="text-muted-foreground">Showing</span>
            {statusFilter && (
              <Badge variant="secondary" className="gap-1.5">
                {statusFilter}
                <button type="button" onClick={() => setStatusFilter(null)} aria-label="Clear status filter" className="hover:text-foreground">×</button>
              </Badge>
            )}
            {customerFilter && (
              <Badge variant="secondary" className="gap-1.5">
                one customer
                <button type="button" onClick={clearCustomerFilter} aria-label="Clear customer filter" className="hover:text-foreground">×</button>
              </Badge>
            )}
            <span className="text-muted-foreground">— {visibleInvoices.length} of {invoices.length}</span>
          </div>
        )}

        <Card className="hidden md:block">
          <CardContent className="p-0 overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Invoice #</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Due Date</TableHead>
                  <TableHead className="w-[180px]">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                      <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2" />
                      Loading invoices...
                    </TableCell>
                  </TableRow>
                ) : visibleInvoices.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                      {/* "No invoices yet" is only true of an unfiltered, empty list.
                          With a filter on it would tell an owner with 200 invoices
                          that they have none. */}
                      {invoices.length === 0
                        ? 'No invoices yet. Create your first invoice to get started.'
                        : 'No invoices match this filter.'}
                    </TableCell>
                  </TableRow>
                ) : (
                  visibleInvoices.map((invoice) => {
                    const contact = getInvoiceContact(invoice);
                    const statusConfig = STATUS_CONFIG[invoice.status];
                    const StatusIcon = statusConfig.icon;

                    return (
                      <TableRow key={invoice.id}>
                        <TableCell className="font-medium">{formatInvoiceNumber(invoice.invoice_number)}</TableCell>
                        <TableCell>
                          <div>
                            <p className="font-medium">{contact.name}</p>
                            <p className="text-sm text-muted-foreground">{contact.email}</p>
                          </div>
                        </TableCell>
                        <TableCell className="text-right font-medium">{fmt(invoice.total_amount)}</TableCell>
                        <TableCell>
                          <Badge variant={statusConfig.variant} className="gap-1">
                            <StatusIcon className="w-3 h-3" />
                            {statusConfig.label}
                          </Badge>
                        </TableCell>
                        <TableCell>{format(new Date(invoice.created_at), 'MMM d, yyyy')}</TableCell>
                        <TableCell>{invoice.due_date ? formatInOrgTz(new Date(invoice.due_date + 'T12:00:00Z'), orgTimezone, { month: 'short', day: 'numeric', year: 'numeric' }) : '-'}</TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1">
                            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => { setViewingInvoice(invoice); setViewDialogOpen(true); }} title="View invoice"><Eye className="w-4 h-4" /></Button>
                            {['draft', 'sent', 'overdue'].includes(invoice.status) && (
                              <MarkPaidButton
                                compact
                                disabled={markPaidMutation.isPending}
                                onPick={(method) => markPaidMutation.mutate({ id: invoice.id, previousStatus: invoice.status, method })}
                              />
                            )}
                            {['draft', 'sent', 'overdue'].includes(invoice.status) && (
                              <Button variant="ghost" size="icon" className="h-8 w-8 text-primary" onClick={() => sendInvoiceEmail(invoice)} disabled={sendingInvoice === invoice.id} title={invoice.status === 'draft' ? 'Send invoice email' : 'Resend invoice email'}>
                                {sendingInvoice === invoice.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                              </Button>
                            )}
                            {invoice.status === 'draft' ? (
                              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => { setEditingInvoice(invoice); setFormDialogOpen(true); }} title="Edit invoice"><Edit className="w-4 h-4" /></Button>
                            ) : (
                              // A disabled button fires no mouse events, so the title has to
                              // live on a wrapper or the explanation never appears — which
                              // would leave a greyed-out control with no stated reason.
                              <span title={editBlockedReason(invoice.status)} className="inline-flex">
                                <Button variant="ghost" size="icon" className="h-8 w-8" disabled><Edit className="w-4 h-4" /></Button>
                              </span>
                            )}
                            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => duplicateInvoice(invoice)} title="Duplicate invoice"><Copy className="w-4 h-4" /></Button>
                            {['draft', 'sent'].includes(invoice.status) && (
                              <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => { void confirmDialog('Cancel this invoice?').then((ok) => { if (ok) cancelMutation.mutate(invoice.id); }); }} title="Cancel invoice"><X className="w-4 h-4" /></Button>
                            )}
                            <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => { void confirmDialog('Delete this invoice permanently?').then((ok) => { if (ok) deleteMutation.mutate(invoice.id); }); }} title="Delete invoice"><Trash2 className="w-4 h-4" /></Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <div className="space-y-3 md:hidden">
          {isLoading ? (
            <Card><CardContent className="py-8 text-center text-muted-foreground"><Loader2 className="w-6 h-6 animate-spin mx-auto mb-2" />Loading invoices...</CardContent></Card>
          ) : visibleInvoices.length === 0 ? (
            <Card><CardContent className="py-8 text-center text-muted-foreground">
              {invoices.length === 0
                ? 'No invoices yet. Create your first invoice to get started.'
                : 'No invoices match this filter.'}
            </CardContent></Card>
          ) : (
            visibleInvoices.map((invoice) => {
              const contact = getInvoiceContact(invoice);
              const statusConfig = STATUS_CONFIG[invoice.status];

              return (
                <Card key={invoice.id}>
                  <CardContent className="p-4 space-y-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="font-semibold truncate">{formatInvoiceNumber(invoice.invoice_number)}</div>
                        <div className="text-lg font-bold">{fmt(invoice.total_amount)}</div>
                        <div className="text-sm text-muted-foreground truncate">{contact.name}</div>
                        <div className="text-xs text-muted-foreground">{format(new Date(invoice.created_at), 'MMM d, yyyy')}</div>
                        {invoice.due_date && <div className="text-xs text-muted-foreground">Due {formatInOrgTz(new Date(invoice.due_date + 'T12:00:00Z'), orgTimezone, { month: 'short', day: 'numeric', year: 'numeric' })}</div>}
                      </div>
                      <Badge variant={statusConfig.variant}>{statusConfig.label}</Badge>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <Button variant="outline" size="sm" onClick={() => { setViewingInvoice(invoice); setViewDialogOpen(true); }}><Eye className="w-4 h-4 mr-2" />View</Button>
                      {['draft', 'sent', 'overdue'].includes(invoice.status) && (
                        <MarkPaidButton
                          disabled={markPaidMutation.isPending}
                          onPick={(method) => markPaidMutation.mutate({ id: invoice.id, previousStatus: invoice.status, method })}
                        />
                      )}
                      {['draft', 'sent', 'overdue'].includes(invoice.status) && (
                        <Button variant="outline" size="sm" onClick={() => sendInvoiceEmail(invoice)} disabled={sendingInvoice === invoice.id}>
                          {sendingInvoice === invoice.id ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Send className="w-4 h-4 mr-2" />}
                          {invoice.status === 'draft' ? 'Send' : 'Resend'}
                        </Button>
                      )}
                      {invoice.status === 'draft' ? (
                        <Button variant="outline" size="sm" onClick={() => { setEditingInvoice(invoice); setFormDialogOpen(true); }}><Edit className="w-4 h-4 mr-2" />Edit</Button>
                      ) : (
                        <span title={editBlockedReason(invoice.status)} className="inline-flex">
                          <Button variant="outline" size="sm" disabled><Edit className="w-4 h-4 mr-2" />Edit</Button>
                        </span>
                      )}
                      <Button variant="outline" size="sm" onClick={() => duplicateInvoice(invoice)}><Copy className="w-4 h-4 mr-2" />Duplicate</Button>
                      {['draft', 'sent'].includes(invoice.status) && (
                        <Button variant="outline" size="sm" onClick={() => { void confirmDialog('Cancel this invoice?').then((ok) => { if (ok) cancelMutation.mutate(invoice.id); }); }}><X className="w-4 h-4 mr-2" />Cancel</Button>
                      )}
                      <Button variant="outline" size="sm" onClick={() => { void confirmDialog('Delete this invoice permanently?').then((ok) => { if (ok) deleteMutation.mutate(invoice.id); }); }}><Trash2 className="w-4 h-4 mr-2" />Delete</Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })
          )}
        </div>

        <InvoiceFormDialog
          open={formDialogOpen}
          onOpenChange={(open) => {
            setFormDialogOpen(open);
            if (!open) setEditingInvoice(null);
          }}
          invoice={editingInvoice}
          customers={customers}
          leads={leads}
          services={services}
          defaultTaxPercent={defaultTaxPercent}
          organizationId={organization?.id || ''}
        />

        <InvoiceViewDialog open={viewDialogOpen} onOpenChange={setViewDialogOpen} invoice={viewingInvoice} />
      </SubscriptionGate>
    </div>
</AdminLayout>
  );
}
