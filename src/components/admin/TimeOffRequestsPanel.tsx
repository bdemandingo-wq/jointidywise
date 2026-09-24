import { useEffect, useState } from 'react';
import { format, parseISO } from 'date-fns';
import { supabase } from '@/lib/supabase';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useOrgId } from '@/hooks/useOrgId';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Check, X, CalendarOff, Loader2 } from 'lucide-react';
import { QueryError } from '@/components/QueryError';
import { refreshBadges } from '@/lib/badgeRefresh';


interface Row {
  id: string;
  staff_id: string;
  start_date: string;
  end_date: string;
  reason: string | null;
  status: 'pending' | 'approved' | 'denied';
  admin_note: string | null;
  created_at: string;
  reviewed_at: string | null;
  staff?: { id: string; name: string; email: string | null } | null;
}

const statusStyle: Record<Row['status'], string> = {
  pending: 'bg-warning/15 text-warning-foreground border-warning/40',
  approved: 'bg-emerald-500/15 text-emerald-700 border-emerald-500/40',
  denied: 'bg-destructive/15 text-destructive border-destructive/40',
};

export function TimeOffRequestsPanel() {
  const { organizationId } = useOrgId();
  const qc = useQueryClient();
  const [notes, setNotes] = useState<Record<string, string>>({});

  const { data: rows = [], isLoading, error: rowsError } = useQuery({
    queryKey: ['admin-time-off', organizationId],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('time_off_requests')
        .select('*, staff:staff(id,name,email)')
        .eq('organization_id', organizationId)
        .order('status', { ascending: true })
        .order('start_date', { ascending: true });
      if (error) throw error;
      return (data ?? []) as Row[];
    },
    enabled: !!organizationId,
  });

  useEffect(() => {
    if (!organizationId) return;
    const ch = supabase
      .channel(`admin-time-off-${organizationId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'time_off_requests', filter: `organization_id=eq.${organizationId}` }, () => {
        qc.invalidateQueries({ queryKey: ['admin-time-off', organizationId] });
        qc.invalidateQueries({ queryKey: ['time-off-pending-count', organizationId] });
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [organizationId, qc]);

  const decide = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: 'approved' | 'denied' }) => {
      const user = (await supabase.auth.getUser()).data.user;
      const { error } = await (supabase as any)
        .from('time_off_requests')
        .update({
          status,
          admin_note: notes[id]?.trim() || null,
          reviewed_by: user?.id ?? null,
          reviewed_at: new Date().toISOString(),
        })
        .eq('id', id);
      if (error) throw error;
      supabase.functions.invoke('notify-time-off-request', {
        body: { requestId: id, event: 'decision' },
      }).catch(() => {});
    },
    onSuccess: (_d, v) => {
      toast.success(`Request ${v.status}`);
      setNotes(n => { const c = { ...n }; delete c[v.id]; return c; });
      qc.invalidateQueries({ queryKey: ['admin-time-off', organizationId] });
      refreshBadges(qc);
    },

    onError: (e: any) => toast.error(e.message || 'Failed'),
  });

  const pending = rows.filter(r => r.status === 'pending');
  const history = rows.filter(r => r.status !== 'pending');

  const renderRow = (r: Row) => (
    <div key={r.id} className="rounded-lg border p-3 space-y-2">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-semibold">{r.staff?.name ?? 'Staff'}</p>
            <Badge variant="outline" className={`capitalize ${statusStyle[r.status]}`}>{r.status}</Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            {format(parseISO(r.start_date), 'MMM d, yyyy')}
            {r.end_date !== r.start_date && ` – ${format(parseISO(r.end_date), 'MMM d, yyyy')}`}
          </p>
          {r.reason && <p className="mt-1 text-sm">{r.reason}</p>}
          {r.admin_note && r.status !== 'pending' && (
            <p className="mt-1 text-xs text-muted-foreground"><span className="font-medium">Note:</span> {r.admin_note}</p>
          )}
        </div>
      </div>
      {r.status === 'pending' && (
        <div className="space-y-2">
          <Textarea
            placeholder="Optional note to the staff member…"
            value={notes[r.id] ?? ''}
            onChange={e => setNotes(n => ({ ...n, [r.id]: e.target.value }))}
            rows={2}
          />
          <div className="flex gap-2">
            <Button size="sm" className="gap-1" disabled={decide.isPending} onClick={() => decide.mutate({ id: r.id, status: 'approved' })}>
              <Check className="h-4 w-4" /> Approve
            </Button>
            <Button size="sm" variant="outline" className="gap-1 text-destructive" disabled={decide.isPending} onClick={() => decide.mutate({ id: r.id, status: 'denied' })}>
              <X className="h-4 w-4" /> Deny
            </Button>
          </div>
        </div>
      )}
    </div>
  );

  if (rowsError) return <QueryError subject="time-off requests" onRetry={() => qc.invalidateQueries({ queryKey: ['admin-time-off', organizationId] })} />;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CalendarOff className="h-5 w-5" /> Pending requests
            {pending.length > 0 && <Badge variant="destructive">{pending.length}</Badge>}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {isLoading ? (
            <p className="text-sm text-muted-foreground flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</p>
          ) : pending.length === 0 ? (
            <p className="text-sm text-muted-foreground">No pending requests.</p>
          ) : pending.map(renderRow)}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>History</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {history.length === 0 ? (
            <p className="text-sm text-muted-foreground">No past requests.</p>
          ) : history.map(renderRow)}
        </CardContent>
      </Card>
    </div>
  );
}

export default TimeOffRequestsPanel;
