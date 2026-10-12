import { useState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
} from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { CustomerSearchInput } from '@/components/admin/CustomerSearchInput';
import { LeadSearchInput } from '@/components/admin/LeadSearchInput';
import { Search, X, User } from 'lucide-react';
import { cn } from '@/lib/utils';
import { QueryError } from '@/components/QueryError';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { Switch } from '@/components/ui/switch';
import { 
  Plus, Trash2, Loader2, ChevronUp, ChevronLeft, ChevronRight, ChevronDown,
  Tag, CreditCard, MessageSquare, Eye, Building, Bell, Calendar, Mail, Phone
} from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { PaymentMethodsSheet } from './invoice/PaymentMethodsSheet';
import { PaymentRemindersSheet } from './invoice/PaymentRemindersSheet';
import { DueDateSheet } from './invoice/DueDateSheet';
import { SendScheduleSheet } from './invoice/SendScheduleSheet';
import { InvoiceDocument } from './invoice/InvoiceDocument';
import { useInvoiceBusinessInfo } from '@/hooks/useInvoiceBusinessInfo';
import { useOrgTimezone } from '@/hooks/useOrgTimezone';
import { orgDateKey, orgAddDays, formatInOrgTz } from '@/lib/orgDateRange';
import { formatInvoiceNumber } from '@/lib/invoiceUtils';
import { readEdgeFunctionError } from '@/lib/edgeFunctionError';
import {
  clearLocalInvoiceDraft,
  invoiceAmountError,
  offlinePaymentLabel,
  readLocalInvoiceDraft,
  writeLocalInvoiceDraft,
  type LocalInvoiceDraft,
  type OfflinePaymentMethod,
} from '@/lib/invoiceDraft';
import { markInvoicePaidOffline } from '@/lib/invoicePayment';
import { MarkPaidButton } from './invoice/MarkPaidButton';
import { fmt } from '@/lib/activeCurrency';
import { mustAffectRows } from '@/lib/mustAffectRows';

interface LineItem {
  id?: string;
  service_id: string;
  description: string;
  quantity: number;
  unit_price: number;
  total: number;
}

interface InvoiceFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  invoice: any | null;
  customers: any[];
  leads: any[];
  services: any[];
  defaultTaxPercent: number;
  organizationId: string;
}

export function InvoiceFormDialog({
  open,
  onOpenChange,
  invoice,
  customers,
  leads,
  services,
  defaultTaxPercent,
  organizationId,
}: InvoiceFormDialogProps) {
  const businessInfo = useInvoiceBusinessInfo();
  const queryClient = useQueryClient();
  const isEditing = invoice?.id && invoice.id.length > 10;

  // Section open states
  const [customerOpen, setCustomerOpen] = useState(true);
  const [detailsOpen, setDetailsOpen] = useState(true);
  const [itemsOpen, setItemsOpen] = useState(true);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [additionalOpen, setAdditionalOpen] = useState(false);

  // Sheet states
  // Invoice due dates are calendar dates in the BUSINESS's calendar — a
  // payment deadline the customer sees, not a device-local one.
  const { timezone: orgTimezone } = useOrgTimezone();
  const [paymentMethodsOpen, setPaymentMethodsOpen] = useState(false);
  const [remindersOpen, setRemindersOpen] = useState(false);
  const [dueDateOpen, setDueDateOpen] = useState(false);
  const [sendScheduleOpen, setSendScheduleOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [draftState, setDraftState] = useState<'idle' | 'saving' | 'saved' | 'local'>('idle');
  const persistedRef = useRef<{ id: string; invoiceNumber: number } | null>(null);
  const sealedRef = useRef(false);
  const saveQueue = useRef<Promise<unknown>>(Promise.resolve());
  const fieldsRef = useRef<Record<string, unknown>>({});

  const [formData, setFormData] = useState({
    customer_id: '',
    lead_id: '',
    customer_type: 'customer' as 'customer' | 'lead',
    address: '',
    tax_percent: defaultTaxPercent.toString(),
    discount_percent: '0',
    notes: '',
    due_date: orgDateKey(orgAddDays(new Date(), 7, orgTimezone), orgTimezone),
    due_label: 'In 7 days',
    send_immediately: true,
    scheduled_send_at: null as string | null,
    scheduled_time: '09:00',
    is_recurring: false,
    recurring_interval: 'monthly',
    email_copy: true,
    cc_emails: [] as string[],
  });

  const [lineItems, setLineItems] = useState<LineItem[]>([]);
  const [showDiscount, setShowDiscount] = useState(false);
  const [showTax, setShowTax] = useState(false);
  const [ccInput, setCcInput] = useState('');

  // Fetch payment settings for display
  const { data: paymentSettings, error: paymentSettingsError } = useQuery({
    queryKey: ['invoice-settings', organizationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('organization_invoice_settings')
        .select('*')
        .eq('organization_id', organizationId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!organizationId && open,
  });

  // Check if Stripe is configured
  const { data: stripeSettings, error: stripeSettingsError, isPending: stripeLoading } = useQuery({
    queryKey: ['org-stripe-check', organizationId],
    queryFn: async () => {
      const { data: rows, error } = await supabase
        .rpc('get_org_stripe_settings_safe', { p_organization_id: organizationId });
      if (error) throw error;
      return rows?.[0] ?? null;
    },
    enabled: !!organizationId && open,
  });

  const isStripeConfigured = !!stripeSettings?.is_connected;

  // Fetch payment reminders for display
  const { data: reminders = [], error: remindersError } = useQuery({
    queryKey: ['payment-reminders', organizationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('invoice_payment_reminders')
        .select('*')
        .eq('organization_id', organizationId)
        .eq('is_active', true)
        .order('days_after_due');
      if (error) throw error;
      return data;
    },
    enabled: !!organizationId && open,
  });

  // Reset form when dialog opens with new data
  useEffect(() => {
    if (!open) {
      setHydrated(false);
      return;
    }
    sealedRef.current = false;
    if (invoice?.id && String(invoice.id).length > 10) {
      persistedRef.current = { id: invoice.id, invoiceNumber: invoice.invoice_number };
    } else {
      persistedRef.current = null;
    }
    if (open) {
      if (invoice?.id && String(invoice.id).length > 10) {
        setFormData({
          customer_id: invoice.customer_id || '',
          lead_id: invoice.lead_id || '',
          customer_type: invoice.lead_id ? 'lead' : 'customer',
          address: invoice.address || '',
          tax_percent: (invoice.tax_percent || defaultTaxPercent).toString(),
          discount_percent: (invoice.discount_percent || 0).toString(),
          notes: invoice.notes || '',
          due_date: invoice.due_date || orgDateKey(orgAddDays(new Date(), 7, orgTimezone), orgTimezone),
          due_label: invoice.due_date ? formatInOrgTz(new Date(invoice.due_date + 'T12:00:00Z'), orgTimezone, { month: 'short', day: 'numeric', year: 'numeric' }) : 'Upon receipt',
          send_immediately: !invoice.scheduled_send_at,
          scheduled_send_at: invoice.scheduled_send_at || null,
          scheduled_time: '09:00',
          is_recurring: invoice.is_recurring || false,
          recurring_interval: invoice.recurring_interval || 'monthly',
          email_copy: invoice.send_copy_to_self ?? true,
          cc_emails: Array.isArray(invoice.cc_emails) ? invoice.cc_emails : [],
        });
        if (invoice.invoice_items?.length > 0) {
          setLineItems(invoice.invoice_items.map((item: any) => ({
            id: item.id,
            service_id: item.service_id || '__custom__',
            description: item.description,
            quantity: item.quantity,
            unit_price: item.unit_price,
            total: item.total,
          })));
        } else {
          setLineItems([]);
        }
        setShowDiscount((invoice.discount_percent || 0) > 0);
        setShowTax((invoice.tax_percent || 0) > 0);
      } else {
        const blank = {
          customer_id: '',
          lead_id: '',
          customer_type: 'customer' as const,
          address: '',
          tax_percent: defaultTaxPercent.toString(),
          discount_percent: '0',
          notes: '',
          due_date: orgDateKey(orgAddDays(new Date(), 7, orgTimezone), orgTimezone),
          due_label: 'In 7 days',
          send_immediately: true,
          scheduled_send_at: null,
          scheduled_time: '09:00',
          is_recurring: false,
          recurring_interval: 'monthly',
          email_copy: true,
          cc_emails: [] as string[],
        };
        const local = readLocalInvoiceDraft(organizationId);
        if (local) {
          setFormData({ ...blank, ...(local.formData as typeof blank) });
          setLineItems(local.lineItems as LineItem[]);
          setShowDiscount(local.showDiscount);
          setShowTax(local.showTax);
          toast.message('Restored an unsaved invoice from this device.');
        } else {
          setFormData(blank);
          setLineItems([]);
          setShowDiscount(false);
          setShowTax(defaultTaxPercent > 0);
        }
      }
    }
    setHydrated(true);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- orgTimezone is stable per session; form resets on open/invoice/tax change, not timezone change
  }, [open, invoice, defaultTaxPercent, organizationId]);

  // Calculate totals (coerce for numeric safety)
  const subtotal = lineItems.reduce((sum, item) => {
    const q = Number(item.quantity) || 0;
    const p = Number(item.unit_price) || 0;
    return sum + q * p;
  }, 0);
  const discountPercent = parseFloat(formData.discount_percent) || 0;
  const discountAmount = subtotal * (discountPercent / 100);
  const subtotalAfterDiscount = subtotal - discountAmount;
  const taxPercent = parseFloat(formData.tax_percent) || 0;
  const taxAmount = subtotalAfterDiscount * (taxPercent / 100);
  const totalAmount = subtotalAfterDiscount + taxAmount;
  const amountError = invoiceAmountError({
    items: lineItems.map((item) => ({
      description: item.description || '',
      quantity: Number(item.quantity),
      unitPrice: Number(item.unit_price),
    })),
    discountPercent: Number.isFinite(parseFloat(formData.discount_percent)) ? parseFloat(formData.discount_percent) : 0,
    taxPercent: showTax && Number.isFinite(parseFloat(formData.tax_percent)) ? parseFloat(formData.tax_percent) : 0,
    total: totalAmount,
  });

  const addLineItem = () => {
    const defaultHours = Number((paymentSettings as any)?.default_billable_hours) || 1;
    setLineItems([...lineItems, { service_id: '__custom__', description: '', quantity: defaultHours, unit_price: 0, total: 0 }]);
  };

  const removeLineItem = (index: number) => {
    setLineItems(lineItems.filter((_, i) => i !== index));
  };

  const updateLineItem = (index: number, field: keyof LineItem, value: any) => {
    const updated = [...lineItems];
    updated[index] = { ...updated[index], [field]: value };

    if (field === 'service_id' && value && value !== '__custom__') {
      const service = services.find(s => s.id === value);
      if (service) {
        updated[index].description = service.name;
        updated[index].unit_price = Number(service.price) || 0;
      }
    }

    // Always recompute total to avoid stale $0.00 displays
    const q = Number(updated[index].quantity) || 0;
    const p = Number(updated[index].unit_price) || 0;
    updated[index].total = q * p;

    setLineItems(updated);
  };

  const addCcEmail = () => {
    const email = ccInput.trim().toLowerCase();
    if (!email) return;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      toast.error('Please enter a valid email address');
      return;
    }
    if (formData.cc_emails.includes(email)) {
      setCcInput('');
      return;
    }
    setFormData({ ...formData, cc_emails: [...formData.cc_emails, email] });
    setCcInput('');
  };

  const removeCcEmail = (email: string) => {
    setFormData({ ...formData, cc_emails: formData.cc_emails.filter(e => e !== email) });
  };

  // Get selected customer/lead info
  const selectedCustomer = formData.customer_type === 'customer' 
    ? customers.find(c => c.id === formData.customer_id)
    : leads.find(l => l.id === formData.lead_id);

  const describedItems = lineItems.filter((item) => item.description.trim());
  const canSave = !!selectedCustomer && describedItems.length > 0 && !amountError;
  const canSaveRef = useRef(canSave);
  canSaveRef.current = canSave;

  const localDraft = (): LocalInvoiceDraft => ({
    version: 1,
    savedAt: Date.now(),
    formData: { ...formData },
    lineItems,
    showDiscount,
    showTax,
  });
  const localDraftRef = useRef(localDraft());
  localDraftRef.current = localDraft();

  fieldsRef.current = {
    formData,
    lineItems: describedItems,
    subtotal,
    taxPercent,
    taxAmount,
    discountPercent,
    discountAmount,
    totalAmount,
    showTax,
    showDiscount,
    selectedCustomer,
    organizationId,
  };

  const persistDraftRef = useRef<() => Promise<{ id: string; invoiceNumber: number }>>(async () => {
    throw new Error('Draft save is not ready');
  });

  persistDraftRef.current = async () => {
    if (sealedRef.current && persistedRef.current) return persistedRef.current;
    const fields = fieldsRef.current as {
      formData: typeof formData;
      lineItems: LineItem[];
      subtotal: number;
      taxPercent: number;
      taxAmount: number;
      discountPercent: number;
      discountAmount: number;
      totalAmount: number;
      showTax: boolean;
      showDiscount: boolean;
      selectedCustomer: typeof selectedCustomer;
      organizationId: string;
    };
    const blocked = invoiceAmountError({
      items: fields.lineItems.map((item) => ({
        description: item.description || '',
        quantity: Number(item.quantity),
        unitPrice: Number(item.unit_price),
      })),
      discountPercent: fields.showDiscount ? fields.discountPercent : 0,
      taxPercent: fields.showTax ? fields.taxPercent : 0,
      total: fields.totalAmount,
    });
    if (blocked) throw new Error(blocked);
    if (!fields.selectedCustomer) throw new Error('Please select a customer or lead');
    if (fields.lineItems.length === 0) throw new Error('Please add at least one item to the invoice');

    const invoiceData = {
      organization_id: fields.organizationId,
      customer_id: fields.formData.customer_type === 'customer' && fields.formData.customer_id ? fields.formData.customer_id : null,
      lead_id: fields.formData.customer_type === 'lead' && fields.formData.lead_id ? fields.formData.lead_id : null,
      address: fields.formData.address || null,
      subtotal: fields.subtotal,
      tax_percent: fields.showTax ? fields.taxPercent : 0,
      tax_amount: fields.showTax ? fields.taxAmount : 0,
      discount_percent: fields.showDiscount ? fields.discountPercent : 0,
      discount_amount: fields.showDiscount ? fields.discountAmount : 0,
      total_amount: fields.totalAmount,
      notes: fields.formData.notes || null,
      due_date: fields.formData.due_label === 'Upon receipt' ? null : fields.formData.due_date,
      is_recurring: fields.formData.is_recurring,
      recurring_interval: fields.formData.is_recurring ? fields.formData.recurring_interval : null,
      scheduled_send_at: fields.formData.send_immediately ? null : fields.formData.scheduled_send_at,
      send_copy_to_self: fields.formData.email_copy,
      cc_emails: fields.formData.cc_emails,
      status: 'draft' as const,
    };

    let invoiceId: string;
    let invoiceNumber: number;
    const existing = persistedRef.current;
    if (existing) {
      const { status: _status, ...updateData } = invoiceData;
      await mustAffectRows(
        supabase.from('invoices').update(updateData).eq('id', existing.id),
        'Invoice not saved. It may belong to a different business.',
        { table: 'invoices' },
      );
      invoiceId = existing.id;
      invoiceNumber = existing.invoiceNumber;
      const { error: itemsDeleteError } = await supabase
        .from('invoice_items')
        .delete()
        .eq('invoice_id', invoiceId);
      if (itemsDeleteError) throw itemsDeleteError;
    } else {
      const { data, error } = await supabase
        .from('invoices')
        .insert(invoiceData)
        .select('id, invoice_number')
        .single();
      if (error) throw error;
      invoiceId = data.id;
      invoiceNumber = data.invoice_number;
      // Remember the id before line items, so a later failure updates this row
      // instead of inserting a second invoice and orphaning what was typed.
      persistedRef.current = { id: invoiceId, invoiceNumber };
    }

    const itemsToInsert = fields.lineItems.map((item, index) => ({
      invoice_id: invoiceId,
      organization_id: fields.organizationId,
      service_id: item.service_id && item.service_id !== '__custom__' ? item.service_id : null,
      description: item.description,
      quantity: item.quantity,
      unit_price: item.unit_price,
      total: item.total,
      sort_order: index,
    }));
    const { error: itemsError } = await supabase.from('invoice_items').insert(itemsToInsert);
    if (itemsError) throw itemsError;
    return { id: invoiceId, invoiceNumber };
  };

  function persistDraft() {
    const run = () => persistDraftRef.current();
    const next = saveQueue.current.then(run, run);
    saveQueue.current = next.then(() => undefined, () => undefined);
    return next;
  }

  const draftKey = JSON.stringify({ formData, lineItems, showDiscount, showTax });
  useEffect(() => {
    if (!open || !hydrated || sealedRef.current) return;
    if (!isEditing) writeLocalInvoiceDraft(organizationId, localDraftRef.current);
    if (!canSaveRef.current) return;
    setDraftState('saving');
    const timer = window.setTimeout(() => {
      void persistDraft()
        .then(() => setDraftState('saved'))
        .catch(() => setDraftState('local'));
    }, 1200);
    return () => window.clearTimeout(timer);
  // persistDraft reads refs; draftKey is the change signal.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, hydrated, draftKey, organizationId]);

  async function finishAndClose() {
    sealedRef.current = true;
    if (!isEditing) clearLocalInvoiceDraft(organizationId);
    queryClient.invalidateQueries({ queryKey: ['invoices'] });
    onOpenChange(false);
  }

  async function requestClose(next: boolean) {
    if (next) {
      onOpenChange(true);
      return;
    }
    if (!sealedRef.current && canSaveRef.current) {
      try {
        await persistDraft();
        if (!isEditing) clearLocalInvoiceDraft(organizationId);
        queryClient.invalidateQueries({ queryKey: ['invoices'] });
      } catch {
        if (!isEditing) writeLocalInvoiceDraft(organizationId, localDraftRef.current);
      }
    } else if (!sealedRef.current && !isEditing) {
      const draft = localDraftRef.current;
      const hasContent = Boolean(
        draft.formData.customer_id || draft.formData.lead_id || draft.formData.notes || draft.formData.address
        || (Array.isArray(draft.lineItems) && draft.lineItems.some((item) => {
          const row = item as LineItem;
          return row.description || Number(row.unit_price) > 0;
        })),
      );
      if (hasContent) writeLocalInvoiceDraft(organizationId, draft);
    }
    onOpenChange(false);
  }

  const saveMutation = useMutation({
    mutationFn: async (sendMethod: 'email' | 'sms' | 'both') => {
      const saved = await persistDraft();
      const fields = fieldsRef.current as {
        formData: typeof formData;
        lineItems: LineItem[];
        totalAmount: number;
        taxAmount: number;
        showTax: boolean;
        selectedCustomer: NonNullable<typeof selectedCustomer>;
        organizationId: string;
      };
      if (!isStripeConfigured) {
        throw new Error('Draft saved. Stripe is not connected, so this invoice was not emailed. Mark it paid for cash, check, or Zelle.');
      }
      const customer = fields.selectedCustomer;
      const customerEmail = customer.email;
      const customerName = fields.formData.customer_type === 'customer'
        ? `${customer.first_name} ${customer.last_name}`
        : customer.name;
      const customerPhone = customer.phone;
      const wantsEmail = sendMethod === 'email' || sendMethod === 'both';
      const wantsSms = sendMethod === 'sms' || sendMethod === 'both';
      if (wantsEmail && !customerEmail) throw new Error('Customer has no email address. The draft was kept.');
      if (wantsSms && !customerPhone) throw new Error('Customer has no phone number. The draft was kept.');

      const { error: sendError } = await supabase.functions.invoke('create-stripe-invoice', {
        body: {
          invoiceId: saved.id,
          organizationId: fields.organizationId,
          customerEmail: wantsEmail ? customerEmail : null,
          customerName,
          customerPhone: wantsSms ? customerPhone : null,
          sendEmail: wantsEmail,
          sendSms: wantsSms,
          items: fields.lineItems.map((item) => ({
            description: item.description,
            quantity: item.quantity,
            unitPrice: item.unit_price,
          })),
          totalAmount: fields.totalAmount,
          taxAmount: fields.showTax ? fields.taxAmount : 0,
          dueDate: fields.formData.due_label === 'Upon receipt' ? null : fields.formData.due_date,
          notes: fields.formData.notes || null,
          ccEmails: wantsEmail ? fields.formData.cc_emails : [],
        },
      });
      if (sendError) {
        const reason = await readEdgeFunctionError(sendError, 'Could not email or text this invoice.');
        throw new Error(`${reason} The draft was kept.`);
      }
      return { invoiceNumber: saved.invoiceNumber, sendMethod };
    },
    onSuccess: async (result) => {
      const method = result.sendMethod === 'both' ? 'via email & SMS' : result.sendMethod === 'email' ? 'via email' : 'via SMS';
      toast.success(`Invoice #${result.invoiceNumber} sent ${method}`);
      await finishAndClose();
    },
    onError: (error: Error) => toast.error(error.message || 'Failed to save invoice'),
  });

  async function saveAsDraft() {
    try {
      const saved = await persistDraft();
      toast.success(`Invoice #${saved.invoiceNumber} saved as draft`);
      await finishAndClose();
    } catch (error) {
      writeLocalInvoiceDraft(organizationId, localDraftRef.current);
      toast.error(error instanceof Error ? error.message : 'Could not save the draft. It is still on this device.');
    }
  }

  async function markPaid(method: OfflinePaymentMethod) {
    try {
      const saved = await persistDraft();
      const stored = await markInvoicePaidOffline(saved.id, method);
      const label = offlinePaymentLabel(method);
      toast.success(
        stored === 'stored'
          ? `Invoice #${saved.invoiceNumber} marked paid (${label})`
          : `Invoice #${saved.invoiceNumber} marked paid (${label}). The payment method was not stored because the database column is not applied yet.`,
      );
      await finishAndClose();
    } catch (error) {
      writeLocalInvoiceDraft(organizationId, localDraftRef.current);
      toast.error(error instanceof Error ? error.message : 'Could not mark this invoice paid. The draft was kept.');
    }
  }

  const handlePreview = () => {
    if (!selectedCustomer || lineItems.length === 0) {
      toast.error('Please add a customer and at least one item');
      return;
    }
    setPreviewOpen(true);
  };

  const handleSend = (method: 'email' | 'sms' | 'both') => {
    saveMutation.mutate(method);
  };

  const SectionHeader = ({ 
    title, 
    isOpen, 
    onToggle 
  }: { 
    title: string; 
    isOpen: boolean; 
    onToggle: () => void;
  }) => (
    <CollapsibleTrigger 
      onClick={onToggle}
      className="flex items-center justify-between w-full py-4 px-4 bg-muted/50 hover:bg-muted transition-colors"
    >
      <span className="font-semibold text-foreground">{title}</span>
      <ChevronUp className={`h-5 w-5 text-muted-foreground transition-transform ${isOpen ? '' : 'rotate-180'}`} />
    </CollapsibleTrigger>
  );

  const InfoRow = ({ 
    label, 
    value, 
    action,
    actionLabel,
    onClick 
  }: { 
    label: string; 
    value?: string; 
    action?: () => void;
    actionLabel?: string;
    onClick?: () => void;
  }) => (
    <button
      type="button"
      onClick={onClick || action}
      disabled={!onClick && !action}
      className="flex items-center justify-between py-3 px-4 border-b border-border last:border-b-0 w-full text-left hover:bg-muted/30 transition-colors disabled:hover:bg-transparent"
    >
      <span className="text-muted-foreground">{label}</span>
      <div className="flex items-center gap-2">
        {action ? (
          <span className="text-primary font-medium">{actionLabel}</span>
        ) : (
          <span className="text-foreground">{value}</span>
        )}
        {onClick && <ChevronRight className="w-4 h-4 text-muted-foreground" />}
      </div>
    </button>
  );

  // Get enabled payment methods for display
  const enabledMethods = [];
  if (paymentSettings?.accept_cards !== false) {
    enabledMethods.push({ 
      name: 'Debit/Credit Cards', 
      fee: `${paymentSettings?.card_fee_percent ?? 2.9}% + ${fmt((paymentSettings?.card_fee_fixed ?? 0.30))}`,
      icon: CreditCard
    });
  }
  if (paymentSettings?.accept_ach !== false) {
    enabledMethods.push({ name: 'Bank Transfer (ACH)', fee: 'Free', icon: Building });
  }

  return (
    <>
      <Dialog open={open} onOpenChange={requestClose}>
        <DialogContent className="max-w-lg p-0 gap-0 max-h-[100vh] flex flex-col overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between p-4 border-b">
            <button 
              onClick={() => void requestClose(false)}
              className="text-muted-foreground hover:text-foreground"
            >
              <ChevronLeft className="h-6 w-6" />
            </button>
            <h2 className="text-lg font-semibold">{isEditing ? 'Edit Invoice' : 'New Invoice'}</h2>
            <div className="w-6" />
          </div>

          {/* Scrollable Content */}
          <div className="flex-1 overflow-y-auto pb-36">
            {(paymentSettingsError || stripeSettingsError || remindersError || businessInfo.error) && (
              <div className="px-4 pt-3">
                <QueryError subject="invoice settings" />
              </div>
            )}
            {/* Customer Details Section */}
            <Collapsible open={customerOpen} onOpenChange={setCustomerOpen}>
              <SectionHeader title="Customer Details" isOpen={customerOpen} onToggle={() => setCustomerOpen(!customerOpen)} />
              <CollapsibleContent>
                <div className="px-4 py-3 space-y-4">
                  {/* Customer Type Toggle */}
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant={formData.customer_type === 'customer' ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => setFormData({ ...formData, customer_type: 'customer', customer_id: '', lead_id: '' })}
                    >
                      Customer
                    </Button>
                    <Button
                      type="button"
                      variant={formData.customer_type === 'lead' ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => setFormData({ ...formData, customer_type: 'lead', customer_id: '', lead_id: '' })}
                    >
                      Lead
                    </Button>
                  </div>

                  {/* Customer/Lead Selection */}
                  {formData.customer_type === 'customer' ? (
                    <CustomerSearchInput
                      customers={[...customers].sort((a, b) => 
                        `${a.first_name} ${a.last_name}`.localeCompare(`${b.first_name} ${b.last_name}`)
                      )}
                      selectedCustomerId={formData.customer_id}
                      onSelectCustomer={(id) => {
                        if (!id) {
                          setFormData({ ...formData, customer_id: '', address: '' });
                          return;
                        }
                        const customer = customers.find(c => c.id === id);
                        setFormData({ 
                          ...formData, 
                          customer_id: id,
                          address: customer?.address || formData.address,
                        });
                      }}
                      placeholder="Search customers..."
                    />
                  ) : (
                    <LeadSearchInput
                      leads={[...leads].sort((a, b) => (a.name || '').localeCompare(b.name || ''))}
                      selectedLeadId={formData.lead_id}
                      onSelectLead={(id) => {
                        if (!id) {
                          setFormData({ ...formData, lead_id: '', address: '' });
                          return;
                        }
                        const lead = leads.find(l => l.id === id);
                        setFormData({ 
                          ...formData, 
                          lead_id: id,
                          address: lead?.address || formData.address,
                        });
                      }}
                      placeholder="Search leads..."
                    />
                  )}

                  {/* Selected Customer Info */}
                  {selectedCustomer && (
                    <div className="space-y-1 text-sm bg-muted/50 rounded-lg p-3">
                      <p className="font-semibold text-foreground">
                        {formData.customer_type === 'customer' 
                          ? `${selectedCustomer.first_name} ${selectedCustomer.last_name}`
                          : selectedCustomer.name}
                      </p>
                      {selectedCustomer.email && (
                        <p className="text-muted-foreground">{selectedCustomer.email}</p>
                      )}
                      {selectedCustomer.phone && (
                        <p className="text-muted-foreground">{selectedCustomer.phone}</p>
                      )}
                      {(selectedCustomer.address || formData.address) && (
                        <>
                          <p className="text-muted-foreground">{selectedCustomer.address || formData.address}</p>
                          {selectedCustomer.city && selectedCustomer.state && (
                            <p className="text-muted-foreground">
                              {selectedCustomer.city}, {selectedCustomer.state} {selectedCustomer.zip_code}
                            </p>
                          )}
                        </>
                      )}
                    </div>
                  )}
                </div>
              </CollapsibleContent>
            </Collapsible>

            {/* Invoice Details Section */}
            <Collapsible open={detailsOpen} onOpenChange={setDetailsOpen}>
              <SectionHeader title="Invoice Details" isOpen={detailsOpen} onToggle={() => setDetailsOpen(!detailsOpen)} />
              <CollapsibleContent>
                <InfoRow 
                  label="Invoice Number" 
                  value={invoice?.invoice_number ? `#${String(invoice.invoice_number).padStart(4, '0')}` : 'Auto-generated'} 
                />
                <div className="flex items-center justify-between py-3 px-4 border-b">
                  <span className="text-muted-foreground">Make this a recurring invoice</span>
                  <Switch 
                    checked={formData.is_recurring}
                    onCheckedChange={(checked) => setFormData({ ...formData, is_recurring: checked })}
                  />
                </div>
                {formData.is_recurring && (
                  <div className="px-4 py-3 border-b">
                    <label className="text-sm text-muted-foreground mb-2 block">Repeat every</label>
                    <Select 
                      value={formData.recurring_interval} 
                      onValueChange={(v) => setFormData({ ...formData, recurring_interval: v })}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="weekly">Week</SelectItem>
                        <SelectItem value="biweekly">2 Weeks</SelectItem>
                        <SelectItem value="monthly">Month</SelectItem>
                        <SelectItem value="quarterly">Quarter</SelectItem>
                        <SelectItem value="yearly">Year</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                )}
                <InfoRow 
                  label="Send" 
                  value={formData.send_immediately ? 'Immediately' : `Scheduled: ${formData.scheduled_send_at ? format(new Date(formData.scheduled_send_at), 'MMM d, yyyy') : 'Not set'}`}
                  onClick={() => setSendScheduleOpen(true)}
                />
                <InfoRow 
                  label="Due" 
                  value={formData.due_label}
                  onClick={() => setDueDateOpen(true)}
                />
                <div className="px-4 py-3 border-b">
                  <label className="text-sm font-medium text-muted-foreground mb-2 block">Note</label>
                  <Textarea
                    value={formData.notes}
                    onChange={(e) => setFormData({ ...formData, notes: e.target.value.slice(0, 250) })}
                    placeholder="Add a quick note for your client (optional)"
                    className="resize-none border-border"
                    rows={2}
                  />
                  <div className="text-right text-xs text-muted-foreground mt-1">
                    {formData.notes.length}/250
                  </div>
                </div>
                <div className="px-4 py-3 border-b">
                  <label className="text-sm font-medium text-muted-foreground mb-2 block">
                    CC recipients (optional)
                  </label>
                  <div className="flex gap-2">
                    <Input
                      type="email"
                      value={ccInput}
                      onChange={(e) => setCcInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ',') {
                          e.preventDefault();
                          addCcEmail();
                        }
                      }}
                      placeholder="name@example.com"
                    />
                    <Button type="button" variant="outline" onClick={addCcEmail}>
                      Add
                    </Button>
                  </div>
                  {formData.cc_emails.length > 0 && (
                    <div className="flex flex-wrap gap-2 mt-2">
                      {formData.cc_emails.map((email) => (
                        <span
                          key={email}
                          className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-muted text-xs"
                        >
                          {email}
                          <button
                            type="button"
                            onClick={() => removeCcEmail(email)}
                            className="text-muted-foreground hover:text-foreground"
                            aria-label={`Remove ${email}`}
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                  <p className="text-xs text-muted-foreground mt-1">
                    These addresses will be CC'd when the invoice is emailed.
                  </p>
                </div>
              </CollapsibleContent>
            </Collapsible>

            {/* Billable Items Section */}
            <Collapsible open={itemsOpen} onOpenChange={setItemsOpen}>
              <SectionHeader title="Billable Items" isOpen={itemsOpen} onToggle={() => setItemsOpen(!itemsOpen)} />
              <CollapsibleContent>
                <div className="px-4 py-3 space-y-3">
                  {/* Line Items */}
                  {lineItems.map((item, index) => (
                    <div key={index} className="p-3 border rounded-lg bg-card space-y-3">
                      <div className="flex items-start justify-between">
                        <Select 
                          value={item.service_id} 
                          onValueChange={(v) => updateLineItem(index, 'service_id', v)}
                        >
                          <SelectTrigger className="w-48">
                            <SelectValue placeholder="Select service..." />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__custom__">Custom Item</SelectItem>
                            {services.map((s) => (
                              <SelectItem key={s.id} value={s.id}>
                                {s.name} - ${s.price}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-destructive"
                          onClick={() => removeLineItem(index)}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                      <Input
                        value={item.description}
                        onChange={(e) => updateLineItem(index, 'description', e.target.value)}
                        placeholder="Description"
                        className="w-full"
                      />
                      <div className="flex gap-2 items-center">
                        <div className="flex-1">
                          <label className="text-xs text-muted-foreground">Qty</label>
                          <Input
                            type="number"
                            min="0"
                            placeholder="1"
                            value={item.quantity === 0 ? '' : item.quantity}
                            onChange={(e) => updateLineItem(index, 'quantity', e.target.value === '' ? 0 : parseInt(e.target.value, 10) || 0)}
                          />
                        </div>
                        <div className="flex-1">
                          <label className="text-xs text-muted-foreground">Price</label>
                          <Input
                            type="number"
                            min="0"
                            step="0.01"
                            placeholder="0.00"
                            value={item.unit_price === 0 ? '' : item.unit_price}
                            onChange={(e) => updateLineItem(index, 'unit_price', e.target.value === '' ? 0 : parseFloat(e.target.value) || 0)}
                          />
                        </div>
                        <div className="flex-1">
                          <label className="text-xs text-muted-foreground">Total</label>
                          <div className="h-10 flex items-center font-medium">
                            ${((Number(item.quantity) || 0) * (Number(item.unit_price) || 0)).toFixed(2)}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}

                  {/* Add Item Button */}
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full border-dashed border-primary text-primary hover:bg-primary/5"
                    onClick={addLineItem}
                  >
                    <Plus className="w-4 h-4 mr-2" />
                    Add item
                  </Button>

                  {/* Add Discount */}
                  {!showDiscount ? (
                    <button
                      type="button"
                      className="flex items-center gap-2 text-primary font-medium hover:underline"
                      onClick={() => setShowDiscount(true)}
                    >
                      <Tag className="w-4 h-4" />
                      Add a discount
                    </button>
                  ) : (
                    <div className="flex items-center gap-2 p-3 bg-muted/50 rounded-lg">
                      <Tag className="w-4 h-4 text-muted-foreground" />
                      <span className="text-sm">Discount %</span>
                      <Input
                        type="number"
                        step="0.01"
                        value={formData.discount_percent}
                        onChange={(e) => setFormData({ ...formData, discount_percent: e.target.value })}
                        className="w-20 h-8"
                      />
                      <Button 
                        variant="ghost" 
                        size="sm"
                        onClick={() => {
                          setShowDiscount(false);
                          setFormData({ ...formData, discount_percent: '0' });
                        }}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  )}

                  {/* Add Tax */}
                  {!showTax ? (
                    <button
                      type="button"
                      className="flex items-center gap-2 text-primary font-medium hover:underline"
                      onClick={() => setShowTax(true)}
                    >
                      <span className="text-lg font-bold">$</span>
                      Add tax
                    </button>
                  ) : (
                    <div className="flex items-center gap-2 p-3 bg-muted/50 rounded-lg">
                      <span className="text-lg font-bold text-muted-foreground">$</span>
                      <span className="text-sm">Tax %</span>
                      <Input
                        type="number"
                        step="0.01"
                        value={formData.tax_percent}
                        onChange={(e) => setFormData({ ...formData, tax_percent: e.target.value })}
                        className="w-20 h-8"
                      />
                      <Button 
                        variant="ghost" 
                        size="sm"
                        onClick={() => {
                          setShowTax(false);
                          setFormData({ ...formData, tax_percent: '0' });
                        }}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  )}
                </div>
              </CollapsibleContent>
            </Collapsible>

            {/* Payment Options Section */}
            <Collapsible open={paymentOpen} onOpenChange={setPaymentOpen}>
              <SectionHeader title="Payment Options" isOpen={paymentOpen} onToggle={() => setPaymentOpen(!paymentOpen)} />
              <CollapsibleContent>
                <div className="border-b">
                  <button
                    type="button"
                    className="flex items-center justify-between w-full py-3 px-4 hover:bg-muted/30 transition-colors"
                    onClick={() => setPaymentMethodsOpen(true)}
                  >
                    <div>
                      <p className="font-medium text-left">Accepted Methods</p>
                      <div className="text-sm text-muted-foreground mt-1 space-y-0.5">
                        {enabledMethods.map((method, i) => (
                          <div key={i} className="flex items-center gap-2">
                            <method.icon className="w-3 h-3" />
                            <span>{method.name}</span>
                            <span className="text-xs text-primary">{method.fee}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-primary text-sm font-medium">Edit</span>
                      <ChevronRight className="w-4 h-4 text-muted-foreground" />
                    </div>
                  </button>
                </div>
                
                <button
                  type="button"
                  className="flex items-center justify-between w-full py-3 px-4 hover:bg-muted/30 transition-colors border-b"
                  onClick={() => setRemindersOpen(true)}
                >
                  <div>
                    <p className="font-medium text-left flex items-center gap-2">
                      <Bell className="w-4 h-4" />
                      Payment Reminders
                    </p>
                    <div className="text-sm text-muted-foreground mt-1">
                      {reminders.length > 0 ? (
                        reminders.map((r: any) => (
                          <p key={r.id}>{r.days_after_due} days after due date</p>
                        ))
                      ) : (
                        <p>No reminders set</p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-primary text-sm font-medium">Edit</span>
                    <ChevronRight className="w-4 h-4 text-muted-foreground" />
                  </div>
                </button>
              </CollapsibleContent>
            </Collapsible>

            {/* Additional Options Section - Removed email copy toggle (SMS-only platform) */}
          </div>

          {/* Sticky Footer */}
          <div className="absolute bottom-0 left-0 right-0 bg-background border-t p-4 space-y-3">
            {/* Price Breakdown */}
            {(showDiscount || showTax) && lineItems.length > 0 && (
              <div className="text-sm space-y-1 pb-2 border-b">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Subtotal</span>
                  <span>{fmt(subtotal)}</span>
                </div>
                {showDiscount && discountAmount > 0 && (
                  <div className="flex justify-between text-green-600">
                    <span>Discount ({discountPercent}%)</span>
                    <span>-${discountAmount.toFixed(2)}</span>
                  </div>
                )}
                {showTax && taxAmount > 0 && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Tax ({taxPercent}%)</span>
                    <span>{fmt(taxAmount)}</span>
                  </div>
                )}
              </div>
            )}
            
            <div className="flex items-center justify-between">
              <span className="text-lg font-semibold">Total due</span>
              <span className={`text-lg font-semibold ${amountError ? 'text-destructive' : ''}`}>{fmt(totalAmount)}</span>
            </div>
            {amountError && <p className="text-sm text-destructive">{amountError}</p>}
            {!stripeLoading && !isStripeConfigured && (
              <p className="text-xs text-muted-foreground">
                Stripe is not connected. Save the draft, or mark it paid by cash, check, or Zelle. Email and SMS send stay off until Payments is connected.
              </p>
            )}
            {draftState !== 'idle' && (
              <p className="text-xs text-muted-foreground">
                {draftState === 'saving' && 'Saving draft…'}
                {draftState === 'saved' && 'Draft saved'}
                {draftState === 'local' && 'Not saved to the server yet. A copy is on this device.'}
              </p>
            )}
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                className="flex-1"
                onClick={() => void saveAsDraft()}
                disabled={saveMutation.isPending || !canSave}
              >
                Save as draft
              </Button>
              <MarkPaidButton
                className="flex-1"
                disabled={saveMutation.isPending || !canSave}
                onPick={(method) => void markPaid(method)}
              />
            </div>
            <div className="flex gap-3">
              <Button
                variant="outline"
                className="flex-1"
                onClick={handlePreview}
                disabled={saveMutation.isPending || lineItems.length === 0}
              >
                <Eye className="w-4 h-4 mr-2" />
                Preview
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    className="flex-1"
                    disabled={saveMutation.isPending || !canSave || stripeLoading || !isStripeConfigured}
                    title={stripeLoading ? 'Checking whether Stripe is connected…' : !isStripeConfigured ? 'Connect Stripe to email or text this invoice. Cash, check, and Zelle use Mark as paid.' : undefined}
                  >
                    {saveMutation.isPending ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Sending...
                      </>
                    ) : (
                      <>
                        <MessageSquare className="w-4 h-4 mr-2" />
                        Send
                        <ChevronDown className="w-4 h-4 ml-2" />
                      </>
                    )}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48">
                  <DropdownMenuItem
                    onClick={() => handleSend('email')}
                    disabled={!selectedCustomer?.email}
                  >
                    <Mail className="w-4 h-4 mr-2" />
                    Send via Email
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => handleSend('sms')}
                    disabled={!selectedCustomer?.phone}
                  >
                    <Phone className="w-4 h-4 mr-2" />
                    Send via SMS
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => handleSend('both')}
                    disabled={!selectedCustomer?.email || !selectedCustomer?.phone}
                  >
                    <MessageSquare className="w-4 h-4 mr-2" />
                    Send Both
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Sheets */}
      <PaymentMethodsSheet
        open={paymentMethodsOpen}
        onOpenChange={setPaymentMethodsOpen}
        organizationId={organizationId}
      />
      <PaymentRemindersSheet
        open={remindersOpen}
        onOpenChange={setRemindersOpen}
        organizationId={organizationId}
      />
      <DueDateSheet
        open={dueDateOpen}
        onOpenChange={setDueDateOpen}
        value={formData.due_date}
        timeZone={orgTimezone}
        onChange={(date, label) => setFormData({ ...formData, due_date: date || orgDateKey(new Date(), orgTimezone), due_label: label })}
      />
      <SendScheduleSheet
        open={sendScheduleOpen}
        onOpenChange={setSendScheduleOpen}
        sendImmediately={formData.send_immediately}
        scheduledDate={formData.scheduled_send_at}
        scheduledTime={formData.scheduled_time}
        onChange={(immediately, date, time) => setFormData({ 
          ...formData, 
          send_immediately: immediately, 
          scheduled_send_at: date,
          scheduled_time: time 
        })}
      />

      {/* Invoice Preview Dialog */}
      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
            {selectedCustomer && (
              <div className="p-2">
                <InvoiceDocument
                  businessName={businessInfo.businessName}
                  businessEmail={businessInfo.businessEmail}
                  businessPhone={businessInfo.businessPhone}
                  businessAddressLines={businessInfo.businessAddressLines}
                  logoUrl={businessInfo.logoUrl}
                  primaryColor={businessInfo.primaryColor}
                  headerLayout={businessInfo.headerLayout}
                  footerMessage={businessInfo.footerMessage}
                  invoiceNumber={isEditing ? formatInvoiceNumber(invoice.invoice_number) : 'INV-NEW'}
                  invoiceDate={new Date().toISOString()}
                  dueDate={formData.due_date || orgDateKey(orgAddDays(new Date(), 7, orgTimezone), orgTimezone)}
                  customerName={formData.customer_type === 'customer' ? `${selectedCustomer.first_name} ${selectedCustomer.last_name}` : selectedCustomer.name}
                  customerEmail={selectedCustomer.email}
                  customerPhone={selectedCustomer.phone}
                  customerAddressLines={formData.address ? formData.address.split('\n').filter(Boolean) : []}
                  lineItems={lineItems.filter((item) => item.description).map((item) => ({
                    description: item.description,
                    quantity: item.quantity,
                    unitPrice: item.unit_price,
                    total: item.total,
                  }))}
                  subtotal={subtotal}
                  total={totalAmount}
                  notes={formData.notes}
                  isPaid={false}
                />
              </div>
            )}
        </DialogContent>
      </Dialog>
    </>
  );
}
