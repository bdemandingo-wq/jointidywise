import { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { RefreshCw, Loader2, History, CheckCircle2, XCircle, RotateCw, Search } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useOrganization } from '@/contexts/OrganizationContext';
import { toast } from 'sonner';
import { OrgTimestamp } from '@/components/OrgTimestamp';

interface LogRow {
  id: string;
  organization_id: string;
  webhook_id: string | null;
  event_type: string;
  status_code: number | null;
  success: boolean;
  error_message: string | null;
  created_at: string;
}
interface HookRef {
  id: string;
  name: string;
}

export function ZapierDispatchLogCard() {
  const { organization } = useOrganization();
  const [rows, setRows] = useState<LogRow[]>([]);
  const [hooks, setHooks] = useState<HookRef[]>([]);
  const [loading, setLoading] = useState(true);
  const [retryingId, setRetryingId] = useState<string | null>(null);

  // filters
  const [search, setSearch] = useState('');
  const [event, setEvent] = useState('all');
  const [webhook, setWebhook] = useState('all');
  const [status, setStatus] = useState<'all' | 'success' | 'fail'>('all');

  const load = async () => {
    if (!organization?.id) return;
    setLoading(true);
    const [{ data: logData, error }, { data: hookData }] = await Promise.all([
      (supabase as any)
        .from('zapier_dispatch_log')
        .select('id,organization_id,webhook_id,event_type,status_code,success,error_message,created_at')
        .eq('organization_id', organization.id)
        .order('created_at', { ascending: false })
        .limit(200),
      (supabase as any)
        .from('org_zapier_webhooks')
        .select('id,name')
        .eq('organization_id', organization.id),
    ]);
    if (error) toast.error('Failed to load dispatch log');
    setRows((logData ?? []) as LogRow[]);
    setHooks((hookData ?? []) as HookRef[]);
    setLoading(false);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organization?.id]);

  const eventOptions = useMemo(() => {
    const set = new Set<string>();
    rows.forEach((r) => set.add(r.event_type));
    return Array.from(set).sort();
  }, [rows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (event !== 'all' && r.event_type !== event) return false;
      if (webhook !== 'all' && r.webhook_id !== webhook) return false;
      if (status === 'success' && !r.success) return false;
      if (status === 'fail' && r.success) return false;
      if (q) {
        const hay = `${r.event_type} ${r.error_message ?? ''} ${r.status_code ?? ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [rows, search, event, webhook, status]);

  const hookName = (id: string | null) =>
    (id && hooks.find((h) => h.id === id)?.name) || (id ? 'Deleted webhook' : '—');

  const retry = async (row: LogRow) => {
    if (!organization?.id) return;
    if (!row.webhook_id) {
      toast.error('Original webhook no longer exists');
      return;
    }
    setRetryingId(row.id);
    try {
      const { data, error } = await supabase.functions.invoke('zapier-dispatch', {
        body: { organization_id: organization.id, retry_log_id: row.id },
      });
      if (error) throw error;
      const ok = (data as any)?.success;
      toast[ok ? 'success' : 'error'](
        ok ? 'Retry delivered' : `Retry failed (HTTP ${(data as any)?.status ?? '—'})`,
      );
      load();
    } catch (e) {
      toast.error('Retry failed');
    } finally {
      setRetryingId(null);
    }
  };

  const clearFilters = () => {
    setSearch('');
    setEvent('all');
    setWebhook('all');
    setStatus('all');
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div>
          <CardTitle className="flex items-center gap-2">
            <History className="h-5 w-5 text-primary" /> Dispatch log
          </CardTitle>
          <CardDescription>
            Recent Zapier delivery attempts (last 200). Filter to find issues fast and retry failed sends.
          </CardDescription>
        </div>
        <Button size="sm" variant="outline" onClick={load} disabled={loading}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <><RefreshCw className="h-4 w-4 mr-1" /> Refresh</>}
        </Button>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-2 mb-3">
          <div className="relative sm:col-span-1">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder="Search error / status…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-7 h-9"
            />
          </div>
          <Select value={event} onValueChange={setEvent}>
            <SelectTrigger className="h-9"><SelectValue placeholder="Event" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All events</SelectItem>
              {eventOptions.map((e) => (
                <SelectItem key={e} value={e}>{e}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={webhook} onValueChange={setWebhook}>
            <SelectTrigger className="h-9"><SelectValue placeholder="Webhook" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All webhooks</SelectItem>
              {hooks.map((h) => (
                <SelectItem key={h.id} value={h.id}>{h.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={status} onValueChange={(v: any) => setStatus(v)}>
            <SelectTrigger className="h-9"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="success">Success only</SelectItem>
              <SelectItem value="fail">Failures only</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center justify-between mb-2">
          <p className="text-xs text-muted-foreground">
            Showing {filtered.length} of {rows.length}
          </p>
          {(search || event !== 'all' || webhook !== 'all' || status !== 'all') && (
            <Button size="sm" variant="ghost" onClick={clearFilters} className="h-7 text-xs">
              Clear filters
            </Button>
          )}
        </div>

        {loading ? (
          <div className="py-8 flex justify-center text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6 text-center">No matching log entries.</p>
        ) : (
          <div className="space-y-2">
            {filtered.map((r) => (
              <div key={r.id} className="flex items-center gap-3 rounded-md border p-2 text-xs">
                {r.success ? (
                  <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0" />
                ) : (
                  <XCircle className="h-4 w-4 text-destructive shrink-0" />
                )}
                <span className="text-muted-foreground shrink-0 w-36">
                  <OrgTimestamp value={r.created_at} />
                </span>
                <Badge variant="outline" className="font-mono shrink-0">{r.event_type}</Badge>
                <span className="text-muted-foreground truncate shrink-0 max-w-[140px]" title={hookName(r.webhook_id)}>
                  {hookName(r.webhook_id)}
                </span>
                <Badge variant="secondary" className="shrink-0">HTTP {r.status_code ?? '—'}</Badge>
                <span className="text-destructive truncate flex-1" title={r.error_message ?? ''}>
                  {r.error_message ?? ''}
                </span>
                {!r.success && r.webhook_id && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 shrink-0"
                    onClick={() => retry(r)}
                    disabled={retryingId === r.id}
                  >
                    {retryingId === r.id ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <><RotateCw className="h-3 w-3 mr-1" /> Retry</>
                    )}
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
