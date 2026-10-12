import { useState } from 'react';
import { AdminLayout } from '@/components/admin/AdminLayout';
import { QueryError } from '@/components/QueryError';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus, Search, FileText } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useOrgId } from '@/hooks/useOrgId';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { useIsMobile } from '@/hooks/use-mobile';
import { SwipeableRow } from '@/components/mobile/SwipeableRow';
import { cn } from '@/lib/utils';
import { mustAffectRows } from '@/lib/mustAffectRows';
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

const STATUS_MAP: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  draft: { label: 'Draft', variant: 'secondary' },
  quote_sent: { label: 'Quote Sent', variant: 'default' },
  converted: { label: 'Converted', variant: 'outline' },
  declined: { label: 'Declined', variant: 'destructive' },
};

const EMPTY_ESTIMATE = {
  client_name: '',
  client_address: '',
  client_email: '',
  client_phone: '',
  estimated_total: '',
  notes: '',
  status: 'draft',
};

export default function EstimatesPage() {
  const { organizationId } = useOrgId();
  const queryClient = useQueryClient();
  const isMobile = useIsMobile();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_ESTIMATE);

  const { data: estimates = [], isLoading, error: estimatesError } = useQuery({
    queryKey: ['estimates', organizationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('estimates')
        .select('*')
        .eq('organization_id', organizationId!)
        .order('updated_at', { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!organizationId,
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      if (!organizationId) throw new Error('No organization found');
      await mustAffectRows(
        supabase.from('estimates').delete().eq('id', id).eq('organization_id', organizationId),
        'Estimate not deleted. It may belong to a different business.',
        { table: 'estimates' },
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['estimates'] });
      toast.success('Estimate deleted');
      setDeleteId(null);
    },
    onError: (error: Error) => toast.error(error.message || 'Failed to delete estimate'),
  });

  const filtered = estimates.filter((e: any) => {
    const matchesSearch = !search || 
      e.client_name?.toLowerCase().includes(search.toLowerCase()) ||
      e.client_address?.toLowerCase().includes(search.toLowerCase());
    const matchesStatus = statusFilter === 'all' || e.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const openEditor = (estimate?: {
    id: string;
    client_name: string | null;
    client_address: string | null;
    client_email: string | null;
    client_phone: string | null;
    estimated_total: number | null;
    notes: string | null;
    status: string;
  }) => {
    if (estimate) {
      setEditingId(estimate.id);
      setForm({
        client_name: estimate.client_name || '',
        client_address: estimate.client_address || '',
        client_email: estimate.client_email || '',
        client_phone: estimate.client_phone || '',
        estimated_total: estimate.estimated_total == null ? '' : String(estimate.estimated_total),
        notes: estimate.notes || '',
        status: estimate.status || 'draft',
      });
    } else {
      setEditingId(null);
      setForm(EMPTY_ESTIMATE);
    }
    setEditorOpen(true);
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!organizationId) throw new Error('No organization found');
      const total = form.estimated_total.trim() === '' ? null : Number(form.estimated_total);
      if (total != null && !Number.isFinite(total)) throw new Error('Enter a valid total');
      const payload = {
        client_name: form.client_name.trim() || null,
        client_address: form.client_address.trim() || null,
        client_email: form.client_email.trim() || null,
        client_phone: form.client_phone.trim() || null,
        estimated_total: total,
        notes: form.notes.trim() || null,
        status: form.status,
        organization_id: organizationId,
      };
      if (editingId) {
        const { organization_id: _org, ...changes } = payload;
        await mustAffectRows(
          supabase.from('estimates').update(changes).eq('id', editingId).eq('organization_id', organizationId),
          'Estimate not saved. It may belong to a different business.',
          { table: 'estimates' },
        );
        return;
      }
      const { error } = await supabase.from('estimates').insert(payload);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['estimates'] });
      toast.success(editingId ? 'Estimate updated' : 'Estimate created');
      setEditorOpen(false);
    },
    onError: (error: Error) => toast.error(error.message || 'Failed to save estimate'),
  });

  const handleNewEstimate = () => openEditor();

  const renderCard = (estimate: any) => {
    const status = STATUS_MAP[estimate.status] || STATUS_MAP.draft;
    const content = (
      <Card 
        className="cursor-pointer hover:shadow-md transition-shadow"
        onClick={() => openEditor(estimate)}
      >
        <CardContent className="p-4">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <p className="font-medium truncate">{estimate.client_name || 'Untitled Estimate'}</p>
              <p className="text-sm text-muted-foreground truncate">{estimate.client_address || 'No address'}</p>
              <p className="text-xs text-muted-foreground mt-1">
                {format(new Date(estimate.created_at), 'MMM d, yyyy')}
              </p>
            </div>
            <div className="flex flex-col items-end gap-1 shrink-0">
              <Badge variant={status.variant}>{status.label}</Badge>
              <p className="text-sm font-semibold">
                ${Number(estimate.estimated_total || 0).toFixed(2)}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    );

    if (isMobile) {
      return (
        <SwipeableRow
          key={estimate.id}
          rightActions={[
            { label: 'Edit', variant: 'default', onAction: () => openEditor(estimate) },
            { label: 'Delete', variant: 'destructive', onAction: () => setDeleteId(estimate.id) },
          ]}
        >
          {content}
        </SwipeableRow>
      );
    }

    return <div key={estimate.id}>{content}</div>;
  };

  return (
    <AdminLayout title="Estimates">
<div className="portal-v2 portal-v2-scroll">
      <div className="space-y-4 p-4 md:p-6">
        {/* Header */}
        <div className="flex items-center justify-between gap-2">
          <h1 className="text-xl md:text-2xl font-bold">Estimates</h1>
          <Button onClick={handleNewEstimate} size={isMobile ? 'sm' : 'default'}>
            <Plus className="w-4 h-4 mr-1" />
            New Estimate
          </Button>
        </div>

        {/* Filters */}
        <div className="flex flex-col sm:flex-row gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search estimates..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
          <div className="flex gap-1 overflow-x-auto">
            {['all', 'draft', 'quote_sent', 'converted', 'declined'].map((s) => (
              <Button
                key={s}
                size="sm"
                variant={statusFilter === s ? 'default' : 'outline'}
                onClick={() => setStatusFilter(s)}
                className="shrink-0"
              >
                {s === 'all' ? 'All' : STATUS_MAP[s]?.label || s}
              </Button>
            ))}
          </div>
        </div>

        {/* List */}
        {isLoading ? (
          <div className="text-center py-12 text-muted-foreground">Loading...</div>
        ) : estimatesError ? (
          <QueryError subject="estimates" onRetry={() => window.location.reload()} />
        ) : filtered.length === 0 ? (
          <div className="text-center py-12">
            <FileText className="w-12 h-12 mx-auto text-muted-foreground/50 mb-3" />
            <p className="text-muted-foreground">No estimates yet</p>
            <Button className="mt-4" onClick={handleNewEstimate}>
              <Plus className="w-4 h-4 mr-1" /> Create your first estimate
            </Button>
          </div>
        ) : (
          <div className="space-y-2">
            {filtered.map(renderCard)}
          </div>
        )}
      </div>

      <AlertDialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Estimate</AlertDialogTitle>
            <AlertDialogDescription>This action cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => deleteId && deleteMutation.mutate(deleteId)}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={editorOpen} onOpenChange={setEditorOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingId ? 'Edit estimate' : 'New estimate'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="est-name">Client name</Label>
              <Input id="est-name" value={form.client_name} onChange={(e) => setForm({ ...form, client_name: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="est-address">Address</Label>
              <Input id="est-address" value={form.client_address} onChange={(e) => setForm({ ...form, client_address: e.target.value })} />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="est-email">Email</Label>
                <Input id="est-email" type="email" value={form.client_email} onChange={(e) => setForm({ ...form, client_email: e.target.value })} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="est-phone">Phone</Label>
                <Input id="est-phone" value={form.client_phone} onChange={(e) => setForm({ ...form, client_phone: e.target.value })} />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="est-total">Estimated total</Label>
                <Input id="est-total" inputMode="decimal" value={form.estimated_total} onChange={(e) => setForm({ ...form, estimated_total: e.target.value })} />
              </div>
              <div className="space-y-1">
                <Label>Status</Label>
                <Select value={form.status} onValueChange={(status) => setForm({ ...form, status })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="draft">Draft</SelectItem>
                    <SelectItem value="quote_sent">Quote Sent</SelectItem>
                    <SelectItem value="converted">Converted</SelectItem>
                    <SelectItem value="declined">Declined</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1">
              <Label htmlFor="est-notes">Notes</Label>
              <Textarea id="est-notes" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditorOpen(false)}>Cancel</Button>
            <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
              {saveMutation.isPending ? 'Saving…' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
</AdminLayout>
  );
}
