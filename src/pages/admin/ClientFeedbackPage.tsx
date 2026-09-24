import { useState, useEffect } from 'react';
import { QueryError } from '@/components/QueryError';
import { AdminLayout } from '@/components/admin/AdminLayout';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
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
import { Plus, Edit, Trash2, Download, MessageSquare, CheckCircle, AlertCircle, Clock, Mail } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';
import { format, parseISO } from 'date-fns';
import { useTestMode } from '@/contexts/TestModeContext';
import { useOrganization } from '@/contexts/OrganizationContext';
import { SEOHead } from '@/components/SEOHead';
import { dispatchZapier } from '@/lib/zapier';
import { AttentionStrip } from '@/components/admin/AttentionStrip';
import { orgDateKey } from '@/lib/orgDateRange';
import { useOrgTimezone } from '@/hooks/useOrgTimezone';
import { refreshBadges } from '@/lib/badgeRefresh';


interface FeedbackEntry {
  id: string;
  customer_name: string;
  feedback_date: string;
  is_resolved: boolean;
  followup_needed: boolean;
  issue_description: string | null;
  resolution: string | null;
}

export default function ClientFeedbackPage() {
  // feedback_date is a DATE column: the business's calendar day.
  const { timezone: orgTimezone } = useOrgTimezone();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingEntry, setEditingEntry] = useState<FeedbackEntry | null>(null);
  const [filterResolved, setFilterResolved] = useState<string>('all');
  const queryClient = useQueryClient();
  const { isTestMode, maskName } = useTestMode();
  const { organization } = useOrganization();

  const { data: entries = [], isLoading, error: entriesError } = useQuery({
    queryKey: ['client-feedback', organization?.id],
    queryFn: async () => {
      if (!organization?.id) return [];
      const { data, error } = await supabase
        .from('client_feedback')
        .select('*')
        .eq('organization_id', organization.id)
        .order('feedback_date', { ascending: false });
      if (error) throw error;
      return data as FeedbackEntry[];
    },
    enabled: !!organization?.id,
  });

  // Look up customer emails by name so the Reply button can build a mailto.
  // client_feedback has no customer_id FK — only customer_name text — so
  // this is a best-effort match. Concat first+last to match the name format
  // used by submit_review_by_token.
  const { data: customerEmails = {}, error: customerEmailsError } = useQuery({
    queryKey: ['feedback-customer-emails', organization?.id],
    queryFn: async () => {
      if (!organization?.id) return {};
      const { data } = await supabase
        .from('customers')
        .select('first_name, last_name, email')
        .eq('organization_id', organization.id);
      if (!data) return {};
      const map: Record<string, string> = {};
      for (const c of data) {
        const name = `${c.first_name} ${c.last_name}`.trim();
        if (name && c.email) map[name] = c.email;
      }
      return map;
    },
    enabled: !!organization?.id,
    staleTime: 1000 * 60 * 10,
  });

  useEffect(() => {
    if (customerEmailsError) toast.error('Failed to load customer emails');
  }, [customerEmailsError]);

  const createMutation = useMutation({
    mutationFn: async (data: { customer_name: string; feedback_date: string; is_resolved: boolean; followup_needed: boolean; issue_description: string | null; resolution: string | null }) => {
      if (!organization?.id) {
        throw new Error('No organization found');
      }
      const { data: row, error } = await supabase
        .from('client_feedback')
        .insert([{ ...data, organization_id: organization.id }])
        .select()
        .single();
      if (error) throw error;
      dispatchZapier('review.received', organization.id, row as Record<string, unknown>);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['client-feedback'] });
      refreshBadges(queryClient);
      toast.success('Feedback added');
      setDialogOpen(false);
    },
    onError: (error: any) => toast.error(error.message),
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, ...data }: Partial<FeedbackEntry> & { id: string }) => {
      if (!organization?.id) throw new Error('No organization found');
      const { error } = await supabase.from('client_feedback').update(data).eq('id', id).eq('organization_id', organization.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['client-feedback'] });
      refreshBadges(queryClient);
      toast.success('Feedback updated');
      setDialogOpen(false);
      setEditingEntry(null);
    },
    onError: (error: any) => toast.error(error.message),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      if (!organization?.id) throw new Error('No organization found');
      const { error } = await supabase.from('client_feedback').delete().eq('id', id).eq('organization_id', organization.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['client-feedback'] });
      refreshBadges(queryClient);
      toast.success('Feedback deleted');
    },

    onError: (error: any) => toast.error(error.message),
  });

  const bulkResolveMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      if (!organization?.id || ids.length === 0) return;
      const { error } = await supabase
        .from('client_feedback')
        .update({ is_resolved: true, followup_needed: false })
        .in('id', ids)
        .eq('organization_id', organization.id);
      if (error) throw error;
    },
    onSuccess: (_d, ids) => {
      queryClient.invalidateQueries({ queryKey: ['client-feedback'] });
      queryClient.invalidateQueries({ queryKey: ['sb-feedback'] });
      toast.success(`Marked ${ids.length} item${ids.length === 1 ? '' : 's'} resolved`);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const bulkFollowupDoneMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      if (!organization?.id || ids.length === 0) return;
      const { error } = await supabase
        .from('client_feedback')
        .update({ followup_needed: false })
        .in('id', ids)
        .eq('organization_id', organization.id);
      if (error) throw error;
    },
    onSuccess: (_d, ids) => {
      queryClient.invalidateQueries({ queryKey: ['client-feedback'] });
      queryClient.invalidateQueries({ queryKey: ['sb-feedback'] });
      toast.success(`Cleared follow-up on ${ids.length} item${ids.length === 1 ? '' : 's'}`);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const filteredEntries = entries.filter(e => {
    if (filterResolved === 'resolved') return e.is_resolved;
    if (filterResolved === 'unresolved') return !e.is_resolved;
    if (filterResolved === 'followup') return e.followup_needed && !e.is_resolved;
    return true;
  });

  const stats = {
    total: entries.length,
    resolved: entries.filter(e => e.is_resolved).length,
    unresolved: entries.filter(e => !e.is_resolved).length,
    needsFollowup: entries.filter(e => e.followup_needed && !e.is_resolved).length,
  };

  const exportToExcel = async () => {
    const headers = ['Customer Name', 'Date', 'Resolved', 'Followup Needed', 'Issue', 'Resolution'];
    const rows = entries.map(e => [
      e.customer_name,
      e.feedback_date,
      e.is_resolved ? 'Yes' : 'No',
      e.followup_needed ? 'Yes' : 'No',
      e.issue_description || '',
      e.resolution || '',
    ]);

    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
    ].join('\n');

    const { exportFile } = await import('@/lib/exportFile');
    await exportFile(`client-feedback-${orgDateKey(new Date(), orgTimezone)}.csv`, csvContent, 'text/csv');
  };

  return (
    <AdminLayout
      title="Client Feedback"
      subtitle="Track and resolve customer issues"
      actions={
        <div className="flex gap-2">
      <SEOHead title="Client Feedback | TidyWise" description="View and manage client reviews and feedback" noIndex />
          <Button variant="outline" onClick={exportToExcel} className="gap-2">
            <Download className="w-4 h-4" />
            Export
          </Button>
          <Button onClick={() => setDialogOpen(true)} className="gap-2">
            <Plus className="w-4 h-4" />
            Add Feedback
          </Button>
        </div>
      }
    >
<div className="portal-v2 portal-v2-scroll">
      <AttentionStrip
        href="/dashboard/feedback"
        onReasonClick={(r) => setFilterResolved(r.key === 'followup' ? 'followup' : 'unresolved')}
      />
      {(stats.unresolved > 0 || stats.needsFollowup > 0) && (
        <Card className="mb-4 border-muted">
          <CardContent className="p-3 sm:p-4 flex flex-wrap items-center gap-2 text-sm">
            <span className="text-muted-foreground mr-2">
              This badge clears when feedback is resolved, follow-ups are complete, or you disable it in Notification Settings.
            </span>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setFilterResolved('unresolved')}
            >
              Show attention items
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={bulkFollowupDoneMutation.isPending || entries.filter(e => e.followup_needed && !e.is_resolved).length === 0}
              onClick={() => bulkFollowupDoneMutation.mutate(entries.filter(e => e.followup_needed && !e.is_resolved).map(e => e.id))}
            >
              Mark all follow-ups complete
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="text-destructive hover:text-destructive"
              disabled={bulkResolveMutation.isPending || filteredEntries.filter(e => !e.is_resolved).length === 0}
              onClick={() => {
                const ids = filteredEntries.filter(e => !e.is_resolved).map(e => e.id);
                if (ids.length === 0) return;
                if (confirm(`Mark ${ids.length} unresolved item${ids.length === 1 ? '' : 's'} as resolved? Only do this if you have actually addressed them. This is not a "dismiss reminder" action.`)) {
                  bulkResolveMutation.mutate(ids);
                }
              }}
            >
              Mark all visible resolved
            </Button>
          </CardContent>
        </Card>
      )}
      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <Card className="cursor-pointer hover:bg-secondary/50" onClick={() => setFilterResolved('all')}>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <MessageSquare className="w-4 h-4 text-blue-500" />
              <span className="text-sm text-muted-foreground">Total</span>
            </div>
            <p className="text-2xl font-bold">{stats.total}</p>
          </CardContent>
        </Card>
        <Card className="cursor-pointer hover:bg-secondary/50" onClick={() => setFilterResolved('resolved')}>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <CheckCircle className="w-4 h-4 text-green-500" />
              <span className="text-sm text-muted-foreground">Resolved</span>
            </div>
            <p className="text-2xl font-bold text-green-600">{stats.resolved}</p>
          </CardContent>
        </Card>
        <Card className="cursor-pointer hover:bg-secondary/50" onClick={() => setFilterResolved('unresolved')}>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <AlertCircle className="w-4 h-4 text-red-500" />
              <span className="text-sm text-muted-foreground">Unresolved</span>
            </div>
            <p className="text-2xl font-bold text-red-600">{stats.unresolved}</p>
          </CardContent>
        </Card>
        <Card className="cursor-pointer hover:bg-secondary/50" onClick={() => setFilterResolved('followup')}>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <Clock className="w-4 h-4 text-amber-500" />
              <span className="text-sm text-muted-foreground">Needs Follow-up</span>
            </div>
            <p className="text-2xl font-bold text-amber-600">{stats.needsFollowup}</p>
          </CardContent>
        </Card>
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Customer</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Follow-up</TableHead>
                <TableHead className="max-w-[300px]">Issue</TableHead>
                <TableHead className="max-w-[300px]">Resolution</TableHead>
                <TableHead className="w-[80px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-8">Loading...</TableCell>
                </TableRow>
              ) : entriesError ? (
                <TableRow>
                  <TableCell colSpan={7}>
                    <QueryError subject="client feedback" onRetry={() => window.location.reload()} />
                  </TableCell>
                </TableRow>
              ) : filteredEntries.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                    No feedback entries found
                  </TableCell>
                </TableRow>
              ) : (
                filteredEntries.map((entry) => (
                  <TableRow key={entry.id}>
                    <TableCell className="font-medium">
                      {isTestMode ? maskName(entry.customer_name) : entry.customer_name}
                    </TableCell>
                    <TableCell>{format(parseISO(entry.feedback_date), 'MMM d, yyyy')}</TableCell>
                    <TableCell>
                      <Badge variant={entry.is_resolved ? 'default' : 'destructive'}>
                        {entry.is_resolved ? 'Resolved' : 'Open'}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {entry.followup_needed && !entry.is_resolved ? (
                        <Badge variant="outline" className="text-amber-600 border-amber-300">
                          Yes
                        </Badge>
                      ) : (
                        <span className="text-muted-foreground">No</span>
                      )}
                    </TableCell>
                    <TableCell className="max-w-[300px]">
                      <p className="truncate text-sm" title={entry.issue_description || ''}>
                        {entry.issue_description || '-'}
                      </p>
                    </TableCell>
                    <TableCell className="max-w-[300px]">
                      <p className="truncate text-sm" title={entry.resolution || ''}>
                        {entry.resolution || '-'}
                      </p>
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        {(() => {
                          const email = customerEmails[entry.customer_name];
                          if (!email) return null;
                          const subject = encodeURIComponent('Re: your TidyWise feedback');
                          const quoted = entry.issue_description
                            ? `\n\n---\nYour feedback:\n${entry.issue_description}`
                            : '';
                          const body = encodeURIComponent(quoted);
                          return (
                            <a
                              href={`mailto:${email}?subject=${subject}&body=${body}`}
                              title={`Reply to ${email}`}
                            >
                              <Button variant="ghost" size="icon" className="h-8 w-8">
                                <Mail className="w-4 h-4" />
                              </Button>
                            </a>
                          );
                        })()}
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => {
                            setEditingEntry(entry);
                            setDialogOpen(true);
                          }}
                        >
                          <Edit className="w-4 h-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-destructive"
                          onClick={() => {
                            if (confirm('Delete this feedback?')) {
                              deleteMutation.mutate(entry.id);
                            }
                          }}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Add/Edit Dialog */}
      <FeedbackDialog
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) setEditingEntry(null);
        }}
        entry={editingEntry}
        onSave={(data) => {
          if (editingEntry) {
            updateMutation.mutate({ id: editingEntry.id, ...data });
          } else {
            createMutation.mutate(data as { customer_name: string; feedback_date: string; is_resolved: boolean; followup_needed: boolean; issue_description: string | null; resolution: string | null });
          }
        }}
      />
    </div>
</AdminLayout>
  );
}

function FeedbackDialog({
  open,
  onOpenChange,
  entry,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entry: FeedbackEntry | null;
  onSave: (data: Partial<FeedbackEntry>) => void;
}) {
  const { timezone: orgTimezone } = useOrgTimezone();
  const [formData, setFormData] = useState({
    customer_name: '',
    // The business's day, not whichever one the admin's device is in.
    feedback_date: orgDateKey(new Date(), orgTimezone),
    is_resolved: false,
    followup_needed: false,
    issue_description: '',
    resolution: '',
  });

  // Reset form when entry changes or dialog opens
  useEffect(() => {
    if (open) {
      setFormData({
        customer_name: entry?.customer_name || '',
        feedback_date: entry?.feedback_date || orgDateKey(new Date(), orgTimezone),
        is_resolved: entry?.is_resolved || false,
        followup_needed: entry?.followup_needed || false,
        issue_description: entry?.issue_description || '',
        resolution: entry?.resolution || '',
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- orgTimezone is stable per session; form resets on entry/open change
  }, [entry, open]);

  const handleSubmit = () => {
    if (!formData.customer_name) {
      toast.error('Customer name is required');
      return;
    }
    onSave({
      customer_name: formData.customer_name,
      feedback_date: formData.feedback_date,
      is_resolved: formData.is_resolved,
      followup_needed: formData.followup_needed,
      issue_description: formData.issue_description || null,
      resolution: formData.resolution || null,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{entry ? 'Edit' : 'Add'} Feedback</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Customer Name *</Label>
              <Input
                value={formData.customer_name}
                onChange={(e) => setFormData({ ...formData, customer_name: e.target.value })}
              />
            </div>
            <div>
              <Label>Date</Label>
              <Input
                type="date"
                value={formData.feedback_date}
                onChange={(e) => setFormData({ ...formData, feedback_date: e.target.value })}
              />
            </div>
          </div>
          <div className="flex gap-6">
            <div className="flex items-center gap-2">
              <Checkbox
                id="resolved"
                checked={formData.is_resolved}
                onCheckedChange={(checked) => setFormData({ ...formData, is_resolved: !!checked })}
              />
              <Label htmlFor="resolved">Resolved</Label>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                id="followup"
                checked={formData.followup_needed}
                onCheckedChange={(checked) => setFormData({ ...formData, followup_needed: !!checked })}
              />
              <Label htmlFor="followup">Followup Needed</Label>
            </div>
          </div>
          <div>
            <Label>Issue Description</Label>
            <Textarea
              value={formData.issue_description}
              onChange={(e) => setFormData({ ...formData, issue_description: e.target.value })}
              rows={3}
              placeholder="Describe the client's issue..."
            />
          </div>
          <div>
            <Label>Resolution</Label>
            <Textarea
              value={formData.resolution}
              onChange={(e) => setFormData({ ...formData, resolution: e.target.value })}
              rows={3}
              placeholder="How was the issue resolved?"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSubmit}>{entry ? 'Update' : 'Add'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
