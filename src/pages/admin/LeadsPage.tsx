import { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { AdminLayout } from '@/components/admin/AdminLayout';
import { PlanFeatureGate } from '@/components/admin/PlanFeatureGate';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Plus, Mail, Phone, UserPlus, MoreHorizontal, Trash2, Edit, Download, Filter, TrendingDown, ArrowRight, MapPin, LayoutGrid, Table2, CalendarDays, Link2, Send, Clock, AlertTriangle, RefreshCw } from 'lucide-react';
// Simple address input - no Google Places integration
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';
import { format, startOfMonth, endOfMonth, subMonths, isWithinInterval, formatDistanceToNow } from 'date-fns';
import { useTestMode } from '@/contexts/TestModeContext';
import { useOrganization } from '@/contexts/OrganizationContext';
import { LeadPipelineBoard } from '@/components/admin/LeadPipelineBoard';
import { SEOHead } from '@/components/SEOHead';
import { useLeadSmartSync } from '@/hooks/useLeadSmartSync';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { fmt } from '@/lib/activeCurrency';
import { dispatchZapier } from '@/lib/zapier';
import { LeadTagsEditor, LeadTagChip, normalizeTags, type LeadTag } from '@/components/admin/LeadTagsEditor';
import { AttentionStrip } from '@/components/admin/AttentionStrip';
import { useOrgTimezone } from '@/hooks/useOrgTimezone';
import { orgDateKey } from '@/lib/orgDateRange';
import { matrixToCsv } from '@/lib/orgDataExport';
import { OrgTimestamp } from '@/components/OrgTimestamp';



interface Lead {
  id: string;
  name: string;
  /* Nullable since 2026-08-23: phone-only leads are legitimate and used to be
     saved as noemail@gmail.com to satisfy a NOT NULL that no longer exists. */
  email: string | null;
  phone: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip_code: string | null;
  service_interest: string | null;
  message: string | null;
  notes: string | null;
  estimated_value: number | null;
  source: string;
  status: string;
  created_at: string;
  /**
   * Who last updated this row, set by a database trigger from auth.uid() —
   * not by the call sites, of which there are four and counting.
   *
   * Null on any write with no authenticated user behind it (service-role
   * inserts, backfills, anything pre-trigger). Null renders as no initials
   * rather than as a guess.
   *
   * Last toucher only. This is not history: an update overwrites it, and
   * nothing records what changed or what it was before.
   */
  updated_by?: string | null;
  tags?: LeadTag[] | unknown;
}

const STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  new: { label: 'New', color: 'bg-info' },
  follow_up: { label: 'Follow Up', color: 'bg-warning' },
  quoted: { label: 'Quoted', color: 'bg-info' },
  commercial: { label: 'Commercial', color: 'bg-warning' },
  converted: { label: 'Converted', color: 'bg-success' },
  lost: { label: 'Lost', color: 'bg-destructive' },
};

const SOURCE_OPTIONS = [
  { value: 'all', label: 'All Sources' },
  { value: 'website', label: 'Website' },
  { value: 'referral', label: 'Referral' },
  { value: 'google', label: 'Google' },
  { value: 'facebook', label: 'Facebook' },
  { value: 'other', label: 'Other' },
];

export default function LeadsPage() {
  // Leads are grouped and exported by the BUSINESS's month and day.
  const { timezone: orgTimezone } = useOrgTimezone();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingLead, setEditingLead] = useState<Lead | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [sourceFilter, setSourceFilter] = useState('all');
  const [showFunnel, setShowFunnel] = useState(false);
  const [viewMode, setViewMode] = useState<'table' | 'pipeline' | 'abandoned'>('pipeline');
  const [monthFilter, setMonthFilter] = useState('all');
  
  const queryClient = useQueryClient();
  const { isTestMode, maskName, maskEmail, maskPhone } = useTestMode();
  const { organization } = useOrganization();

  const { runSync, isSyncing, flaggedLeadIds } = useLeadSmartSync(organization?.id);

  // Auto-run smart sync when leads load (re-runs when the set of converted leads changes)
  const lastSyncedKeyRef = useRef<string>('');

  // Fetch abandoned booking link tracking data — only actual booking links
  const { data: abandonedLinks = [], isLoading: abandonedLoading, error: abandonedLinksError } = useQuery({
    queryKey: ['abandoned-booking-links', organization?.id],
    queryFn: async () => {
      if (!organization?.id) return [];
      const { data, error } = await supabase
        .from('booking_link_tracking' as any)
        .select('*')
        .eq('organization_id', organization.id)
        .eq('link_type', 'booking')
        .in('status', ['opened', 'sent', 'abandoned'])
        .is('booking_completed_at', null)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data || [];
    },
    enabled: !!organization?.id,
  });


  const { data: leads = [], isLoading, error: leadsError } = useQuery({
    queryKey: ['leads', organization?.id],
    queryFn: async () => {
      if (!organization?.id) return [];
      const { data, error } = await supabase
        .from('leads')
        .select('*')
        .eq('organization_id', organization.id)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data as Lead[];
    },
    enabled: !!organization?.id,
  });

  useEffect(() => {
    const err = abandonedLinksError || leadsError;
    if (err) toast.error('Failed to load data');
  }, [abandonedLinksError, leadsError]);

  // Auto-run smart sync when leads first load, and re-run whenever the set
  // of converted leads changes (so the flagged badges stay in sync without
  // requiring a hard refresh after data changes or a code update).
  useEffect(() => {
    if (isLoading || leads.length === 0) return;
    const key = leads
      .filter(l => l.status === 'converted')
      .map(l => `${l.id}:${l.email ?? ''}:${l.phone ?? ''}`)
      .sort()
      .join('|');
    if (key === lastSyncedKeyRef.current) return;
    lastSyncedKeyRef.current = key;
    runSync(leads, true); // silent
  }, [leads, isLoading, runSync]);

  const createMutation = useMutation({
    mutationFn: async (data: { name: string; email: string | null; phone?: string; address?: string; city?: string; state?: string; zip_code?: string; service_interest?: string; estimated_value?: number | null; message?: string; notes?: string; source: string; status: string }) => {
      if (!organization?.id) {
        throw new Error('No organization found');
      }
      const { data: lead, error } = await supabase
        .from('leads')
        .insert([{ ...data, organization_id: organization.id }])
        .select()
        .single();
      if (error) throw error;
      dispatchZapier('lead.created', organization.id, lead as Record<string, unknown>);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['leads'] });
      toast.success('Lead created');
      setDialogOpen(false);
    },
    onError: (error: any) => toast.error(error.message),
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, ...data }: Partial<Lead> & { id: string }) => {
      // .select('id') is load-bearing: without it PostgREST reports success even
      // when RLS filtered the row out, so a write that saved nothing shows a
      // "Lead updated" toast. Zero rows back == the write did not happen.
      const { data: rows, error } = await supabase
        .from('leads')
        .update(data as any)
        .eq('id', id)
        .select('id');
      if (error) throw error;
      if (!rows || rows.length === 0) {
        throw new Error(
          "Lead not saved. You may not have access to it in the business you're currently in. Try switching business and retry.",
        );
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['leads'] });
      toast.success('Lead updated');
      setDialogOpen(false);
      setEditingLead(null);
    },
    onError: (error: any) => toast.error(error.message),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      // Same silent-write hazard as the update above: no returned rows means RLS
      // filtered the delete out, not that it succeeded.
      const { data: rows, error } = await supabase
        .from('leads')
        .delete()
        .eq('id', id)
        .select('id');
      if (error) throw error;
      if (!rows || rows.length === 0) {
        throw new Error(
          "Lead not deleted. You may not have access to it in the business you're currently in.",
        );
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['leads'] });
      toast.success('Lead deleted');
    },
    onError: (error: any) => toast.error(error.message),
  });

  const markFollowUpsHandledMutation = useMutation({
    mutationFn: async () => {
      if (!organization?.id) return 0;
      const { data, error } = await supabase
        .from('leads')
        .update({ status: 'contacted', updated_at: new Date().toISOString() })
        .eq('organization_id', organization.id)
        .eq('status', 'follow_up')
        .select('id');
      if (error) throw error;
      return data?.length || 0;
    },
    onSuccess: (n) => {
      queryClient.invalidateQueries({ queryKey: ['leads'] });
      queryClient.invalidateQueries({ queryKey: ['sb-leads'] });
      toast.success(n ? `Marked ${n} follow-up${n === 1 ? '' : 's'} handled` : 'No follow-ups to clear');
    },
    onError: (e: any) => toast.error(e.message || 'Failed to mark follow-ups'),
  });

  const convertToCustomer = async (lead: Lead) => {
    if (!organization?.id) {
      toast.error('No organization found');
      return;
    }
    
    const nameParts = lead.name.split(' ');
    const firstName = nameParts[0] || '';
    const lastName = nameParts.slice(1).join(' ') || '';

    const { error: customerError } = await supabase.from('customers').insert({
      first_name: firstName,
      last_name: lastName,
      email: lead.email,
      phone: lead.phone,
      address: lead.address,
      city: lead.city,
      state: lead.state,
      zip_code: lead.zip_code,
      organization_id: organization.id,
    });

    if (customerError) {
      toast.error('Failed to create customer');
      return;
    }

    // Try to auto-populate estimated_value from matching customer bookings
    let estimatedValue: number | null = null;

    // Look up the newly created customer (or existing match) by email in this org
    // A phone-only lead has no email to match on, so fall back to the phone.
    // Matching on a null email would silently return the wrong customer.
    let matchedCustomer: { id: string } | null = null;
    if (lead.email || lead.phone) {
      const lookup = supabase
        .from('customers')
        .select('id')
        .eq('organization_id', organization.id)
        .limit(1);
      const { data } = lead.email
        ? await lookup.ilike('email', lead.email).maybeSingle()
        : await lookup.eq('phone', lead.phone!).maybeSingle();
      matchedCustomer = data ?? null;
    }

    if (matchedCustomer) {
      // Get the average or latest booking total for this customer
      const { data: bookings } = await supabase
        .from('bookings')
        .select('total_amount')
        .eq('customer_id', matchedCustomer.id)
        .eq('organization_id', organization.id)
        .in('status', ['completed', 'confirmed'])
        .order('scheduled_at', { ascending: false })
        .limit(10);

      if (bookings && bookings.length > 0) {
        // Use the average booking value as estimated value
        const total = bookings.reduce((sum, b) => sum + (b.total_amount || 0), 0);
        estimatedValue = Math.round(total / bookings.length);
      }
    }

    const { data: convertedRows, error: convertError } = await supabase
      .from('leads')
      .update({ 
        status: 'converted',
        ...(estimatedValue != null ? { estimated_value: estimatedValue } : {}),
      })
      .eq('id', lead.id)
      .select('id');

    // The customer row was already created above, so a silently-dropped status
    // write here leaves the lead looking unconverted forever. Surface it.
    if (convertError || !convertedRows || convertedRows.length === 0) {
      queryClient.invalidateQueries({ queryKey: ['leads'] });
      queryClient.invalidateQueries({ queryKey: ['customers'] });
      toast.error(
        convertError?.message ??
          'Customer created, but the lead could not be marked as converted.',
      );
      return;
    }

    queryClient.invalidateQueries({ queryKey: ['leads'] });
    queryClient.invalidateQueries({ queryKey: ['customers'] });
    toast.success(
      estimatedValue 
        ? `Lead converted to customer. Estimated value: ${fmt(estimatedValue)}`
        : 'Lead converted to customer'
    );
  };

  const monthOptions = useMemo(() => {
    const options = [{ value: 'all', label: 'All Months' }];
    for (let i = 0; i < 12; i++) {
      const d = subMonths(new Date(), i);
      // Labels for the last 12 months. The VALUE is a yyyy-MM key matched
      // against each lead's org month below, so it is built the same way.
      options.push({ value: orgDateKey(d, orgTimezone).slice(0, 7), label: format(d, 'MMMM yyyy') });
    }
    return options;
    // orgTimezone matters: useOrgTimezone returns a fallback on first render,
    // so memoising on [] would freeze these keys to the wrong zone's months.
  }, [orgTimezone]);

  const filteredLeads = useMemo(() => {
    return leads.filter((lead) => {
      const matchesSearch = lead.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (lead.email ?? '').toLowerCase().includes(searchTerm.toLowerCase());
      const matchesStatus = statusFilter === 'all' || lead.status === statusFilter;
      const matchesSource = sourceFilter === 'all' || lead.source === sourceFilter;
      let matchesMonth = true;
      if (monthFilter !== 'all') {
        // created_at is an instant; the month it belongs to is the org's. The
        // old form built a device-local month window and tested the instant
        // against it, so a lead created near a month edge landed in the wrong
        // month — and the counts per month did not add up to the total.
        matchesMonth = orgDateKey(new Date(lead.created_at), orgTimezone).startsWith(monthFilter);
      }
      return matchesSearch && matchesStatus && matchesSource && matchesMonth;
    });
  }, [leads, searchTerm, statusFilter, sourceFilter, monthFilter, orgTimezone]);

  // Build suggestion list of all tags previously used on any lead.
  const tagSuggestions = useMemo<LeadTag[]>(() => {
    const map = new Map<string, LeadTag>();
    for (const l of leads) {
      for (const t of normalizeTags((l as any).tags)) {
        const key = t.name.toLowerCase();
        if (!map.has(key)) map.set(key, t);
      }
    }
    return Array.from(map.values());
  }, [leads]);


  const stats = {
    total: leads.length,
    new: leads.filter(l => l.status === 'new').length,
    follow_up: leads.filter(l => l.status === 'follow_up').length,
    quoted: leads.filter(l => l.status === 'quoted').length,
    commercial: leads.filter(l => l.status === 'commercial').length,
    converted: leads.filter(l => l.status === 'converted').length,
    lost: leads.filter(l => l.status === 'lost').length,
  };

  const funnelData = useMemo(() => {
    const stages = ['new', 'follow_up', 'quoted', 'converted'];
    const counts = stages.map(s => leads.filter(l => l.status === s).length);
    const maxCount = Math.max(...counts, 1);
    
    return stages.map((stage, i) => ({
      stage,
      label: STATUS_CONFIG[stage]?.label || stage,
      count: counts[i],
      percentage: maxCount > 0 ? Math.round((counts[i] / maxCount) * 100) : 0,
      conversionRate: i > 0 && counts[i - 1] > 0 
        ? Math.round((counts[i] / counts[i - 1]) * 100) 
        : 100,
    }));
  }, [leads]);

  const sourceBreakdown = useMemo(() => {
    const sources: Record<string, { total: number; converted: number }> = {};
    leads.forEach(lead => {
      if (!sources[lead.source]) {
        sources[lead.source] = { total: 0, converted: 0 };
      }
      sources[lead.source].total++;
      if (lead.status === 'converted') {
        sources[lead.source].converted++;
      }
    });
    return Object.entries(sources).map(([source, data]) => ({
      source,
      ...data,
      rate: data.total > 0 ? Math.round((data.converted / data.total) * 100) : 0,
    })).sort((a, b) => b.total - a.total);
  }, [leads]);

  const exportLeadsExcel = async () => {
    const headers = ['Name', 'Email', 'Phone', 'Address', 'City', 'State', 'Zip', 'Service Interest', 'Source', 'Status', 'Notes', 'Message', 'Created'];
    const rows = filteredLeads.map(lead => [
      lead.name,
      lead.email || '',
      lead.phone || '',
      lead.address || '',
      lead.city || '',
      lead.state || '',
      lead.zip_code || '',
      lead.service_interest || '',
      lead.source,
      lead.status,
      lead.notes || '',
      lead.message || '',
      orgDateKey(new Date(lead.created_at), orgTimezone),
    ]);

    // Lead `message` is free text — quotes and line breaks are the norm, and
    // wrapping without doubling meant both corrupted the row.
    const csv = matrixToCsv([headers, ...rows]);
    const { exportFile } = await import('@/lib/exportFile');
    await exportFile(`leads-export-${orgDateKey(new Date(), orgTimezone)}.csv`, csv, 'text/csv');
    toast.success('Leads exported successfully');
  };

  return (
    <AdminLayout
      title="Leads"
      subtitle={`${leads.length} total leads`}
      actions={
        <div className="flex gap-2 flex-wrap">
      <SEOHead title="Leads | TidyWise" description="Track and manage your sales leads" noIndex />
          <div className="flex border rounded-md overflow-hidden">
            <Button
              variant={viewMode === 'pipeline' ? 'default' : 'ghost'}
              size="sm"
              className="gap-1.5 rounded-none"
              onClick={() => setViewMode('pipeline')}
            >
              <LayoutGrid className="w-4 h-4" />
              Pipeline
            </Button>
            <Button
              variant={viewMode === 'table' ? 'default' : 'ghost'}
              size="sm"
              className="gap-1.5 rounded-none"
              onClick={() => setViewMode('table')}
            >
              <Table2 className="w-4 h-4" />
              Table
            </Button>
            <Button
              variant={viewMode === 'abandoned' ? 'default' : 'ghost'}
              size="sm"
              className="gap-1.5 rounded-none"
              onClick={() => setViewMode('abandoned')}
            >
              <AlertTriangle className="w-4 h-4" />
              Abandoned ({abandonedLinks.filter((l: any) => l.link_opened_at && !l.booking_completed_at).length})
              <Table2 className="w-4 h-4" />
              Table
            </Button>
          </div>
          <Button
            variant="outline"
            className="gap-2"
            onClick={() => runSync(leads)}
            disabled={isSyncing}
          >
            <RefreshCw className={`w-4 h-4 ${isSyncing ? 'animate-spin' : ''}`} />
            Smart Sync
          </Button>
          <Button 
            variant={showFunnel ? "default" : "outline"} 
            className="gap-2" 
            onClick={() => setShowFunnel(!showFunnel)}
          >
            <TrendingDown className="w-4 h-4" />
            Funnel Report
          </Button>
          <Button variant="outline" className="gap-2" onClick={exportLeadsExcel}>
            <Download className="w-4 h-4" />
            Export Excel
          </Button>
          <Button className="gap-2" onClick={() => setDialogOpen(true)}>
            <Plus className="w-4 h-4" />
            Add Lead
          </Button>
        </div>
      }
    >
<div className="portal-v2 portal-v2-scroll">
      <PlanFeatureGate feature="leads">
      <AttentionStrip
        href="/dashboard/leads"
        onReasonClick={(r) => {
          if (r.key === 'new') setStatusFilter('new');
          else if (r.key === 'follow_up') setStatusFilter('follow_up');
        }}
        clearAction={{
          label: 'Mark all follow-ups handled',
          disabled: markFollowUpsHandledMutation.isPending,
          onClick: () => markFollowUpsHandledMutation.mutate(),
        }}
      />
      {/* Lead Funnel Report */}
      {showFunnel && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Lead Conversion Funnel</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {funnelData.map((stage, i) => (
                  <div key={stage.stage} className="relative">
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-medium">{stage.label}</span>
                      <span className="text-sm text-muted-foreground">
                        {stage.count} leads
                        {i > 0 && (
                          <span className="ml-2 text-xs">
                            ({stage.conversionRate}% from {funnelData[i-1].label})
                          </span>
                        )}
                      </span>
                    </div>
                    <div className="h-8 bg-muted rounded-md overflow-hidden">
                      <div 
                        className={`h-full ${STATUS_CONFIG[stage.stage].color} transition-all duration-500`}
                        style={{ width: `${stage.percentage}%` }}
                      />
                    </div>
                    {i < funnelData.length - 1 && (
                      <div className="flex justify-center py-1">
                        <ArrowRight className="w-4 h-4 text-muted-foreground rotate-90" />
                      </div>
                    )}
                  </div>
                ))}
              </div>
              <div className="mt-4 pt-4 border-t">
                <div className="flex justify-between items-center">
                  <span className="text-sm font-medium">Overall Conversion Rate</span>
                  <span className="text-lg font-bold text-success">
                    {stats.total > 0 ? Math.round((stats.converted / stats.total) * 100) : 0}%
                  </span>
                </div>
                <div className="flex justify-between items-center mt-1">
                  <span className="text-sm text-muted-foreground">Lost Leads</span>
                  <span className="text-sm text-destructive">{stats.lost}</span>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Leads by Source</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {sourceBreakdown.map((item) => (
                  <div key={item.source} className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                    <div>
                      <span className="font-medium capitalize">{item.source}</span>
                      <div className="text-sm text-muted-foreground">
                        {item.total} leads · {item.converted} converted
                      </div>
                    </div>
                    <Badge variant={item.rate >= 50 ? "default" : item.rate >= 25 ? "secondary" : "outline"}>
                      {item.rate}% rate
                    </Badge>
                  </div>
                ))}
                {sourceBreakdown.length === 0 && (
                  <p className="text-muted-foreground text-center py-4">No lead data yet</p>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-4 mb-6">
        <Card>
          <CardContent className="p-4">
            <p className="text-sm text-muted-foreground">Total</p>
            <p className="text-2xl font-bold">{stats.total}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-sm text-muted-foreground">New</p>
            <p className="text-2xl font-bold text-info">{stats.new}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-sm text-muted-foreground">Follow Up</p>
            <p className="text-2xl font-bold text-warning">{stats.follow_up}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-sm text-muted-foreground">Quoted</p>
            <p className="text-2xl font-bold text-info">{stats.quoted}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-sm text-muted-foreground">Commercial</p>
            <p className="text-2xl font-bold text-warning">{stats.commercial}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-sm text-muted-foreground">Converted</p>
            <p className="text-2xl font-bold text-success">{stats.converted}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-sm text-muted-foreground">Lost</p>
            <p className="text-2xl font-bold text-destructive">{stats.lost}</p>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-4 mb-4">
        <Input
          placeholder="Search leads..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="max-w-sm"
        />
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[150px]">
            <Filter className="w-4 h-4 mr-2" />
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            {Object.entries(STATUS_CONFIG).map(([value, { label }]) => (
              <SelectItem key={value} value={value}>{label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={sourceFilter} onValueChange={setSourceFilter}>
          <SelectTrigger className="w-[150px]">
            <Filter className="w-4 h-4 mr-2" />
            <SelectValue placeholder="Source" />
          </SelectTrigger>
          <SelectContent>
            {SOURCE_OPTIONS.map(({ value, label }) => (
              <SelectItem key={value} value={value}>{label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={monthFilter} onValueChange={setMonthFilter}>
          <SelectTrigger className="w-[180px]">
            <CalendarDays className="w-4 h-4 mr-2" />
            <SelectValue placeholder="Month" />
          </SelectTrigger>
          <SelectContent>
            {monthOptions.map(({ value, label }) => (
              <SelectItem key={value} value={value}>{label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {(statusFilter !== 'all' || sourceFilter !== 'all' || monthFilter !== 'all') && (
          <Button 
            variant="ghost" 
            size="sm"
            onClick={() => { setStatusFilter('all'); setSourceFilter('all'); setMonthFilter('all'); }}
          >
            Clear Filters
          </Button>
        )}
      </div>

      {/* Pipeline View */}
      {viewMode === 'pipeline' && (
        <LeadPipelineBoard
          leads={filteredLeads}
          onStatusChange={(leadId, newStatus) => updateMutation.mutate({ id: leadId, status: newStatus })}
          onEdit={(lead) => {
            setEditingLead(lead);
            setDialogOpen(true);
          }}
          onDelete={(id) => {
            if (confirm('Delete this lead?')) deleteMutation.mutate(id);
          }}
          onConvert={convertToCustomer}
          maskName={maskName}
          maskEmail={maskEmail}
          maskPhone={maskPhone}
        />
      )}

      {/* Table View */}
      {viewMode === 'table' && (
      <Card>
        <CardContent className="p-0 overflow-x-auto" data-no-swipe>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Contact</TableHead>
                <TableHead>Interest</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Notes</TableHead>
                <TableHead>Created</TableHead>
                <TableHead className="w-[80px]">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                    Loading...
                  </TableCell>
                </TableRow>
              ) : filteredLeads.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                    No leads found
                  </TableCell>
                </TableRow>
              ) : (
              filteredLeads.map((lead) => (
                  <TableRow key={lead.id} className="[&>td]:py-3 @[pointer:coarse]:min-h-[52px]">
                    <TableCell className="font-medium min-h-[44px]">
                      <div className="space-y-1">
                        <div>{maskName(lead.name)}</div>
                        {normalizeTags(lead.tags).length > 0 && (
                          <div className="flex flex-wrap gap-1">
                            {normalizeTags(lead.tags).map((t, i) => (
                              <LeadTagChip key={`${t.name}-${i}`} tag={t} />
                            ))}
                          </div>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="space-y-1">
                        <div className="flex items-center gap-1 text-sm">
                          <Mail className="w-3 h-3" /> {lead.email ? maskEmail(lead.email) : 'No email'}
                        </div>
                        {lead.phone && (
                          <div className="flex items-center gap-1 text-sm text-muted-foreground">
                            <Phone className="w-3 h-3" /> {maskPhone(lead.phone)}
                          </div>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>{lead.service_interest || '-'}</TableCell>
                    <TableCell className="capitalize">{lead.source}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5">
                        <Select
                          value={lead.status}
                          onValueChange={(status) => updateMutation.mutate({ id: lead.id, status })}
                        >
                          <SelectTrigger className="w-[120px] h-8">
                            <Badge className={STATUS_CONFIG[lead.status]?.color}>
                              {STATUS_CONFIG[lead.status]?.label}
                            </Badge>
                          </SelectTrigger>
                          <SelectContent>
                            {Object.entries(STATUS_CONFIG).map(([value, { label }]) => (
                              <SelectItem key={value} value={value}>
                                {label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        {lead.status === 'converted' && flaggedLeadIds.has(lead.id) && (
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger>
                                <AlertTriangle className="w-4 h-4 text-warning" />
                              </TooltipTrigger>
                              <TooltipContent>
                                <p>No booking found for this lead</p>
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="max-w-[200px]">
                      {lead.notes ? (
                        <span className="text-sm text-muted-foreground line-clamp-2" title={lead.notes}>
                          {lead.notes}
                        </span>
                      ) : (
                        <span className="text-muted-foreground/50 text-sm italic">No notes</span>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {format(new Date(lead.created_at), 'MMM d, yyyy')}
                    </TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-8 w-8">
                            <MoreHorizontal className="w-4 h-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            className="gap-2"
                            onClick={() => {
                              setEditingLead(lead);
                              setDialogOpen(true);
                            }}
                          >
                            <Edit className="w-4 h-4" /> Edit
                          </DropdownMenuItem>
                          {lead.status !== 'converted' && (
                            <DropdownMenuItem
                              className="gap-2"
                              onClick={() => convertToCustomer(lead)}
                            >
                              <UserPlus className="w-4 h-4" /> Convert to Customer
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuItem
                            className="gap-2 text-destructive"
                            onClick={() => {
                              if (confirm('Delete this lead?')) {
                                deleteMutation.mutate(lead.id);
                              }
                            }}
                          >
                            <Trash2 className="w-4 h-4" /> Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      )}

      {/* Abandoned Bookings View */}
      {viewMode === 'abandoned' && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-warning" />
              Abandoned Bookings
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0 overflow-x-auto" data-no-swipe>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Link Type</TableHead>
                  <TableHead>Link Sent</TableHead>
                  <TableHead>Link Opened</TableHead>
                  <TableHead>Time Elapsed</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {abandonedLoading ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">Loading...</TableCell>
                  </TableRow>
                ) : abandonedLinks.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">No abandoned bookings</TableCell>
                  </TableRow>
                ) : (
                  abandonedLinks.map((link: any) => {
                    const elapsed = link.link_opened_at
                      ? formatDistanceToNow(new Date(link.link_opened_at), { addSuffix: false })
                      : '-';
                    return (
                      <TableRow key={link.id}>
                        <TableCell className="font-medium">
                          {maskName(link.customer_name || 'Unknown')}
                          {link.customer_phone && (
                            <div className="text-xs text-muted-foreground">{maskPhone(link.customer_phone)}</div>
                          )}
                        </TableCell>
                        <TableCell className="text-sm">
                          <Badge variant="outline" className="gap-1">
                            📅 Booking Link
                          </Badge>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {link.link_sent_at ? <OrgTimestamp value={link.link_sent_at} /> : '-'}
                        </TableCell>
                        <TableCell className="text-sm">
                          {link.link_opened_at ? (
                            <span className="text-warning"><OrgTimestamp value={link.link_opened_at} /></span>
                          ) : (
                            <span className="text-muted-foreground">Not opened</span>
                          )}
                        </TableCell>
                        <TableCell className="text-sm">{elapsed}</TableCell>
                        <TableCell>
                          <Badge variant={link.link_opened_at ? 'destructive' : 'secondary'}>
                            {link.link_opened_at ? 'Abandoned' : 'Not Opened'}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Button
                            size="sm"
                            variant="outline"
                            className="gap-1.5"
                            onClick={async () => {
                              if (!organization?.id) return;
                              // Re-send booking link via SMS
                              try {
                                const { error } = await supabase.functions.invoke('send-card-link-sms', {
                                  body: {
                                    phone: link.customer_phone,
                                    email: link.customer_email || '',
                                    customerName: link.customer_name || 'Customer',
                                    organizationId: organization.id,
                                    amount: 0,
                                  },
                                });
                                if (error) throw error;
                                toast.success('Booking link re-sent!');
                              } catch {
                                toast.error('Failed to re-send link');
                              }
                            }}
                          >
                            <Send className="w-3.5 h-3.5" />
                            Re-send
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Add/Edit Dialog */}
      <LeadDialog
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) setEditingLead(null);
        }}
        lead={editingLead}
        saving={updateMutation.isPending || createMutation.isPending}
        tagSuggestions={tagSuggestions}
        onSave={(data) => {
          if (editingLead) {
            updateMutation.mutate({ id: editingLead.id, ...data } as any);
          } else {
            createMutation.mutate(data as any);
          }
        }}
      />

      
      </PlanFeatureGate>
    </div>
</AdminLayout>
  );
}

function LeadDialog({
  open,
  onOpenChange,
  lead,
  tagSuggestions,
  onSave,
  saving,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lead: Lead | null;
  tagSuggestions: LeadTag[];
  onSave: (data: { name: string; email: string | null; phone?: string; address?: string; city?: string; state?: string; zip_code?: string; service_interest?: string; estimated_value?: number | null; message?: string; notes?: string; source: string; status: string; tags?: LeadTag[] }) => void;
  saving: boolean;
}) {
  // Reset form data when lead changes
  useEffect(() => {
    setFormData({
      name: lead?.name || '',
      email: lead?.email || '',
      phone: lead?.phone || '',
      address: lead?.address || '',
      city: lead?.city || '',
      state: lead?.state || '',
      zip_code: lead?.zip_code || '',
      service_interest: lead?.service_interest || '',
      estimated_value: lead?.estimated_value != null ? String(lead.estimated_value) : '',
      message: lead?.message || '',
      notes: lead?.notes || '',
      source: lead?.source || 'website',
      status: lead?.status || 'new',
    });
    setTags(normalizeTags(lead?.tags));
  }, [lead]);

  const [formData, setFormData] = useState({
    name: lead?.name || '',
    email: lead?.email || '',
    phone: lead?.phone || '',
    address: lead?.address || '',
    city: lead?.city || '',
    state: lead?.state || '',
    zip_code: lead?.zip_code || '',
    service_interest: lead?.service_interest || '',
    estimated_value: lead?.estimated_value != null ? String(lead.estimated_value) : '',
    message: lead?.message || '',
    notes: lead?.notes || '',
    source: lead?.source || 'website',
    status: lead?.status || 'new',
  });
  const [tags, setTags] = useState<LeadTag[]>(normalizeTags(lead?.tags));
  const [nameError, setNameError] = useState(false);

  const handleSubmit = () => {
    // Was a bare `if (!formData.name) return;` — a blank name made the Update
    // button a no-op with no toast, no error, nothing. Imported leads
    // frequently have an empty name, so this was reachable in normal use.
    if (!formData.name.trim()) {
      setNameError(true);
      toast.error('Name is required. The lead was not saved.');
      return;
    }
    setNameError(false);
    const { estimated_value, email, ...rest } = formData;
    if (estimated_value.trim() && Number.isNaN(parseFloat(estimated_value))) {
      toast.error('Estimated value must be a number. The lead was not saved.');
      return;
    }
    onSave({
      ...rest,
      name: formData.name.trim(),
      // Empty string would defeat the email-based dedupe and campaign filters,
      // both of which test for null. Store the absence, not a blank.
      email: email.trim() || null,
      estimated_value: estimated_value.trim() ? parseFloat(estimated_value) : null,
      tags,
    });
  };


  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{lead ? 'Edit' : 'Add'} Lead</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2">
            <Label>Name *</Label>
            <Input
              value={formData.name}
              aria-invalid={nameError}
              className={nameError ? 'border-destructive focus-visible:ring-destructive' : undefined}
              onChange={(e) => {
                if (nameError) setNameError(false);
                setFormData({ ...formData, name: e.target.value });
              }}
            />
            {nameError && (
              <p className="mt-1 text-xs text-destructive">Enter a name before saving.</p>
            )}
          </div>
          <div>
            <Label>Email</Label>
            <Input
              type="email"
              value={formData.email}
              onChange={(e) => setFormData({ ...formData, email: e.target.value })}
            />
          </div>
          <div>
            <Label>Phone</Label>
            <Input
              value={formData.phone}
              onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
            />
          </div>
          <div className="col-span-2">
            <Label>Address</Label>
            <Input
              value={formData.address}
              onChange={(e) => setFormData({ ...formData, address: e.target.value })}
              placeholder="123 Main St"
            />
          </div>
          <div>
            <Label>City</Label>
            <Input
              value={formData.city}
              onChange={(e) => setFormData({ ...formData, city: e.target.value })}
            />
          </div>
          <div>
            <Label>State</Label>
            <Input
              value={formData.state}
              onChange={(e) => setFormData({ ...formData, state: e.target.value })}
            />
          </div>
          <div>
            <Label>Service Interest</Label>
            <Input
              value={formData.service_interest}
              onChange={(e) => setFormData({ ...formData, service_interest: e.target.value })}
            />
          </div>
          <div>
            <Label>Estimated Value ($)</Label>
            <Input
              type="number"
              min="0"
              step="0.01"
              value={formData.estimated_value}
              onChange={(e) => setFormData({ ...formData, estimated_value: e.target.value })}
              placeholder="0.00"
            />
          </div>
          <div>
            <Label>Source</Label>
            <Select value={formData.source} onValueChange={(v) => setFormData({ ...formData, source: v })}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="website">Website</SelectItem>
                <SelectItem value="referral">Referral</SelectItem>
                <SelectItem value="google">Google</SelectItem>
                <SelectItem value="facebook">Facebook</SelectItem>
                <SelectItem value="other">Other</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Status</Label>
            <Select value={formData.status} onValueChange={(v) => setFormData({ ...formData, status: v })}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="new">New</SelectItem>
                <SelectItem value="follow_up">Follow Up</SelectItem>
                <SelectItem value="quoted">Quoted</SelectItem>
                <SelectItem value="commercial">Commercial</SelectItem>
                <SelectItem value="converted">Converted</SelectItem>
                <SelectItem value="lost">Lost</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="col-span-2">
            <Label>Message</Label>
            <Textarea
              value={formData.message}
              onChange={(e) => setFormData({ ...formData, message: e.target.value })}
              rows={2}
              placeholder="Initial inquiry message..."
            />
          </div>
          <div className="col-span-2">
            <Label>Call Notes</Label>
            <Textarea
              value={formData.notes}
              onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
              rows={3}
              placeholder="How did the call go? Satisfaction, review status, recurring interest..."
            />
          </div>
          <div className="col-span-2">
            <Label className="mb-1.5 block">Tags</Label>
            <LeadTagsEditor value={tags} onChange={setTags} suggestions={tagSuggestions} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={saving}>
            {saving ? 'Saving…' : lead ? 'Update' : 'Create'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
