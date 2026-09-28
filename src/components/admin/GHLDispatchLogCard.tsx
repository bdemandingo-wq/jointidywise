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
import { RefreshCw, Loader2, History, CheckCircle2, XCircle, RotateCw, Search, AlertCircle } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useOrganization } from '@/contexts/OrganizationContext';
import { toast } from 'sonner';
import { OrgTimestamp } from '@/components/OrgTimestamp';

interface LogRow {
  id: string;
  organization_id: string;
  event_type: string;
  status: 'success' | 'failed' | 'retrying';
  http_status: number | null;
  attempt: number;
  latency_ms: number | null;
  webhook_url: string | null;
  payload: unknown;
  response_snippet: string | null;
  error_code: string | null;
  error_hint: string | null;
  created_at: string;
}

export function GHLDispatchLogCard() {
  const { organization } = useOrganization();
  const [rows, setRows] = useState<LogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [event, setEvent] = useState('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'success' | 'failed'>('all');

  const load = async () => {
    if (!organization?.id) return;
    setLoading(true);
    const { data, error } = await (supabase as any)
      .from('ghl_dispatch_log')
      .select('*')
      .eq('organization_id', organization.id)
      .order('created_at', { ascending: false })
      .limit(200);
    if (error) toast.error('Failed to load GHL dispatch log');
    setRows((data ?? []) as LogRow[]);
    setLoading(false);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organization?.id]);

  const eventOptions = useMemo(() => {
    const s = new Set<string>();
    rows.forEach((r) => s.add(r.event_type));
    return Array.from(s).sort();
  }, [rows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (event !== 'all' && r.event_type !== event) return false;
      if (statusFilter === 'success' && r.status !== 'success') return false;
      if (statusFilter === 'failed' && r.status === 'success') return false;
      if (q) {
        const hay = `${r.event_type} ${r.error_code ?? ''} ${r.error_hint ?? ''} ${r.response_snippet ?? ''} ${r.http_status ?? ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [rows, search, event, statusFilter]);

  const retry = async (row: LogRow) => {
    if (!organization?.id) return;
    setRetryingId(row.id);
    try {
      const { data, error } = await supabase.functions.invoke('ghl-dispatch', {
        body: { organization_id: organization.id, mode: 'retry', retry_log_id: row.id },
      });
      if (error) throw error;
      const ok = (data as any)?.success;
      if (ok) toast.success('Retry delivered to GHL');
      else toast.error((data as any)?.error_hint ?? `Retry failed (HTTP ${(data as any)?.status ?? '—'})`);
      load();
    } catch (e: any) {
      toast.error(e?.message ?? 'Retry failed');
    } finally {
      setRetryingId(null);
    }
  };

  const clearFilters = () => {
    setSearch('');
    setEvent('all');
    setStatusFilter('all');
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div>
          <CardTitle className="flex items-center gap-2">
            <History className="h-5 w-5 text-primary" /> GHL dispatch log
          </CardTitle>
          <CardDescription>
            Recent GoHighLevel delivery attempts (last 200). Click a row for the full payload and troubleshooting hint.
          </CardDescription>
        </div>
        <Button size="sm" variant="outline" onClick={load} disabled={loading}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <><RefreshCw className="h-4 w-4 mr-1" /> Refresh</>}
        </Button>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-3">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder="Search error / status / event…"
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
          <Select value={statusFilter} onValueChange={(v: any) => setStatusFilter(v)}>
            <SelectTrigger className="h-9"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="success">Success only</SelectItem>
              <SelectItem value="failed">Failures only</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center justify-between mb-2">
          <p className="text-xs text-muted-foreground">Showing {filtered.length} of {rows.length}</p>
          {(search || event !== 'all' || statusFilter !== 'all') && (
            <Button size="sm" variant="ghost" onClick={clearFilters} className="h-7 text-xs">Clear filters</Button>
          )}
        </div>

        {loading ? (
          <div className="py-8 flex justify-center text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /></div>
        ) : filtered.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6 text-center">No GHL dispatch attempts yet.</p>
        ) : (
          <div className="space-y-2">
            {filtered.map((r) => {
              const isOpen = expanded === r.id;
              const ok = r.status === 'success';
              return (
                <div key={r.id} className="rounded-md border text-xs">
                  <button
                    type="button"
                    onClick={() => setExpanded(isOpen ? null : r.id)}
                    className="w-full flex items-center gap-2 p-2 text-left hover:bg-muted/40 flex-wrap"
                  >
                    {ok ? (
                      <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0" />
                    ) : (
                      <XCircle className="h-4 w-4 text-destructive shrink-0" />
                    )}
                    <span className="text-muted-foreground shrink-0 w-36">
                      <OrgTimestamp value={r.created_at} />
                    </span>
                    <Badge variant="outline" className="font-mono shrink-0">{r.event_type}</Badge>
                    <Badge variant="secondary" className="shrink-0">HTTP {r.http_status ?? '—'}</Badge>
                    {r.latency_ms != null && (
                      <span className="text-muted-foreground shrink-0">{r.latency_ms}ms</span>
                    )}
                    {r.attempt > 1 && (
                      <Badge variant="outline" className="shrink-0">×{r.attempt}</Badge>
                    )}
                    <span className={ok ? 'text-muted-foreground truncate flex-1' : 'text-destructive truncate flex-1'}>
                      {ok ? 'Delivered' : (r.error_hint ?? r.error_code ?? 'Failed')}
                    </span>
                    {!ok && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 shrink-0"
                        onClick={(e) => { e.stopPropagation(); retry(r); }}
                        disabled={retryingId === r.id}
                      >
                        {retryingId === r.id ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <><RotateCw className="h-3 w-3 mr-1" /> Retry</>
                        )}
                      </Button>
                    )}
                  </button>
                  {isOpen && (
                    <div className="border-t p-2 space-y-2 bg-muted/30">
                      {r.error_hint && !ok && (
                        <div className="flex items-start gap-2 text-destructive">
                          <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                          <span>{r.error_hint}</span>
                        </div>
                      )}
                      {r.webhook_url && (
                        <div>
                          <div className="text-muted-foreground">Webhook URL</div>
                          <code className="break-all">{r.webhook_url}</code>
                        </div>
                      )}
                      {r.response_snippet && (
                        <div>
                          <div className="text-muted-foreground">Response</div>
                          <pre className="bg-background rounded p-2 max-h-40 overflow-x-auto">{r.response_snippet}</pre>
                        </div>
                      )}
                      {r.payload != null && (
                        <div>
                          <div className="text-muted-foreground">Payload sent</div>
                          <pre className="bg-background rounded p-2 max-h-60 overflow-x-auto">
{JSON.stringify(r.payload, null, 2)}
                          </pre>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
