import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AdminLayout } from '@/components/admin/AdminLayout';
import { SEOHead } from '@/components/SEOHead';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/lib/supabase';
import { useBroadcastRecipients, useRetryFailed, type MessageClass, type RecipientRow } from '@/hooks/useBroadcasts';
import { AlertTriangle, ArrowLeft, CheckCircle2, Clock, Loader2, Mail, RefreshCw, XCircle } from 'lucide-react';
import { formatTimestampWithZone } from '@/lib/timezoneUtils';
import { useOrgTimezone } from '@/hooks/useOrgTimezone';

/**
 * Broadcast detail — "did it finish, who didn't get it, retry the failures."
 *
 * The ONLY mutation this page performs is retry_failed. It must never offer a
 * way to start, resume, or send a broadcast: Task 7's "Start over" resets
 * local state only, so an abandoned draft — a `broadcasts` row plus ~97
 * `broadcast_recipients` rows nobody previewed, test-sent, or confirmed — can
 * sit in the database forever (`broadcast-admin` has no delete/cancel
 * action). That orphan satisfies `start`'s guard exactly
 * (status='draft' AND audience_resolved_at IS NOT NULL), so a "resume" or
 * "send this" control on a draft row here would fire a real send to every
 * organization owner. `draft` rows are rendered strictly read-only below —
 * see the "Abandoned draft" banner — and there is deliberately no import of
 * useStartBroadcast, useCreateBroadcast, or useTestSend anywhere in this file.
 */

const STUCK_SENDING_MINUTES = 10;

interface BroadcastDetail {
  id: string;
  subject: string;
  message_class: MessageClass;
  status: string;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
}

// Page-local, not appended to useBroadcasts.ts — Task 8 only adds
// useBroadcastRecipients there. The header needs `started_at`, which
// useBroadcasts()'s existing BroadcastRow/select does not carry, so this
// fetches the single row directly instead of widening that shared hook.
function useBroadcastDetail(id: string | undefined) {
  return useQuery({
    queryKey: ['broadcast-detail', id],
    enabled: !!id,
    // Only the 'sending' status can still change here (-> 'sent'/'failed',
    // completed_at populated). Draft/sent/failed/cancelled are all terminal
    // for this row, so polling those forever would just waste requests.
    refetchInterval: (q) => {
      const row = q.state.data as BroadcastDetail | null | undefined;
      return row?.status === 'sending' ? 5000 : false;
    },
    queryFn: async (): Promise<BroadcastDetail | null> => {
      const { data, error } = await supabase
        .from('broadcasts')
        .select('id, subject, message_class, status, started_at, completed_at, created_at')
        .eq('id', id!)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      // Same widening as useBroadcasts.ts: message_class's CHECK constraint
      // is not a Postgres enum, so the generated type is `string`.
      return { ...data, message_class: data.message_class as MessageClass };
    },
  });
}

function formatDateTime(value: string | null, timezone: string): string {
  if (!value) return '—';
  return formatTimestampWithZone(value, timezone);
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function statusBadgeVariant(status: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  switch (status) {
    case 'sent':
      return 'default';
    case 'sending':
      return 'secondary';
    case 'failed':
    case 'cancelled':
      return 'destructive';
    default:
      return 'outline'; // draft
  }
}

function recipientBadgeVariant(status: RecipientRow['status']): 'default' | 'secondary' | 'destructive' | 'outline' {
  switch (status) {
    case 'sent':
      return 'default';
    case 'failed':
      return 'destructive';
    case 'skipped':
      return 'outline';
    default:
      return 'secondary'; // queued, sending
  }
}

/**
 * Verbatim from the task brief, with the operator's actual broadcast id
 * substituted for the `<id>` placeholder — every comment is unchanged, word
 * for word, because those comments are the safety rationale (why NOT to
 * requeue straight to 'queued'), not decoration to be paraphrased.
 */
function buildStuckSql(id: string): string {
  return `-- Inspect first. A 'sending' row MAY already have been delivered — that is
-- exactly why the worker refuses to requeue it automatically.
select id, email, attempts, updated_at
from public.broadcast_recipients
where broadcast_id = '${id}' and status = 'sending'
  and updated_at < now() - interval '10 minutes';

-- Then mark them abandoned, NOT queued. 'failed' makes them visible and
-- reachable by Retry failed, which puts the resend decision in a human's
-- hands. Flipping them straight to 'queued' would re-send to someone who may
-- already have the email — the duplicate this whole design avoids.
update public.broadcast_recipients
set status = 'failed',
    error_message = 'abandoned in sending — worker died mid-send, resend manually if needed',
    updated_at = now()
where broadcast_id = '${id}' and status = 'sending'
  and updated_at < now() - interval '10 minutes';`;
}

export default function BroadcastDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { toast } = useToast();
  const qc = useQueryClient();
  const { timezone } = useOrgTimezone();

  const [showAll, setShowAll] = useState(false);
  const [retryDialogOpen, setRetryDialogOpen] = useState(false);

  const { data: broadcast, isLoading: detailLoading, error: detailError } = useBroadcastDetail(id);
  const { data: recipients, isLoading: recipientsLoading, error: recipientsError } = useBroadcastRecipients(id);
  const retryFailed = useRetryFailed();

  // Memoized so `rows` is a stable reference across renders — otherwise
  // `recipients ?? []` mints a new array every render and the useMemo hooks
  // below that depend on `rows` recompute on every render regardless of
  // whether the data actually changed (react-hooks/exhaustive-deps).
  const rows = useMemo(() => recipients ?? [], [recipients]);

  // The four counters and the "did it finish" line are both derived from
  // these rows — never from broadcasts.sent_count/failed_count/skipped_count
  // — so they can never disagree with what the table below actually shows.
  const counts = useMemo(() => {
    let sent = 0;
    let failed = 0;
    let skipped = 0;
    let remaining = 0; // queued or sending
    for (const r of rows) {
      if (r.status === 'sent') sent++;
      else if (r.status === 'failed') failed++;
      else if (r.status === 'skipped') skipped++;
      else remaining++;
    }
    return { sent, failed, skipped, remaining, total: rows.length };
  }, [rows]);

  const isDraft = broadcast?.status === 'draft';

  const finishedLine =
    !broadcast || isDraft
      ? null
      : counts.remaining === 0
        ? `Complete: ${counts.sent} of ${counts.total} sent`
        : `In progress: ${counts.sent} sent, ${counts.remaining} remaining`;

  // Item 7's safety net: a 'sending' row whose worker died is unreachable by
  // both the dispatcher (only claims 'queued') and Retry failed (only claims
  // 'failed'). Left alone it pins the broadcast at 'sending' forever, with
  // the cron re-counting it every minute. This banner is the only thing that
  // makes that state visible; there is deliberately no automatic sweeper —
  // see buildStuckSql's comments for why an operator must decide.
  const stuckRows = useMemo(() => {
    const cutoffMs = Date.now() - STUCK_SENDING_MINUTES * 60 * 1000;
    return rows.filter((r) => r.status === 'sending' && new Date(r.updated_at).getTime() < cutoffMs);
  }, [rows]);

  const visibleRows = showAll ? rows : rows.filter((r) => r.status !== 'sent');

  function handleRetry() {
    if (!id) return;
    retryFailed.mutate(id, {
      onSuccess: (data) => {
        const requeued = (data as { requeued?: number } | null)?.requeued ?? null;
        setRetryDialogOpen(false);
        toast({
          title: 'Retry started',
          description:
            requeued !== null
              ? `${requeued} recipient(s) requeued. The 1-minute cron will pick them up.`
              : 'Failed recipients requeued.',
        });
        // useRetryFailed only invalidates the ['broadcasts'] list query (Task
        // 7's history table). This page reads two queries that key aren't
        // in — refresh them explicitly so the reopened 'sending' status and
        // the requeued rows show up here without waiting on a manual reload.
        void qc.invalidateQueries({ queryKey: ['broadcast-detail', id] });
        void qc.invalidateQueries({ queryKey: ['broadcast-recipients', id] });
      },
      onError: (error: Error) => {
        toast({ title: 'Retry failed', description: error.message, variant: 'destructive' });
      },
    });
  }

  return (
    <AdminLayout
      title="Broadcast detail"
      subtitle={broadcast?.subject}
      actions={
        <Button asChild variant="ghost" size="sm">
          <Link to="/dashboard/broadcasts">
            <ArrowLeft className="w-4 h-4 mr-1" />
            Back to broadcasts
          </Link>
        </Button>
      }
    >
      <SEOHead title="Broadcast detail | TidyWise" description="Platform broadcast send status" noIndex />

      <div className="space-y-6 max-w-4xl">
        {detailError && (
          <p className="text-sm text-destructive flex items-start gap-1.5">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            Could not load this broadcast — {(detailError as Error).message}
          </p>
        )}

        {detailLoading && (
          <p className="text-sm text-muted-foreground flex items-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading…
          </p>
        )}

        {!detailLoading && !detailError && !broadcast && (
          <p className="text-sm text-muted-foreground">Broadcast not found.</p>
        )}

        {broadcast && (
          <>
            {/* 1. Header */}
            <Card>
              <CardHeader>
                <div className="flex flex-wrap items-center gap-2">
                  <CardTitle className="text-base">{broadcast.subject}</CardTitle>
                  <Badge variant="outline" className="capitalize">
                    {broadcast.message_class}
                  </Badge>
                  <Badge variant={statusBadgeVariant(broadcast.status)} className="capitalize">
                    {isDraft ? 'Draft: never sent' : broadcast.status}
                  </Badge>
                </div>
                <CardDescription>
                  {broadcast.started_at
                    ? `Started ${formatDateTime(broadcast.started_at, timezone)} → ${
                        broadcast.completed_at ? formatDateTime(broadcast.completed_at, timezone) : 'in progress'
                      }`
                    : 'Not started'}
                </CardDescription>
              </CardHeader>
            </Card>

            {/* Read-only notice for orphaned/abandoned drafts — see the file
                header comment. This banner, not a control, is the point. */}
            {isDraft && (
              <Alert>
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>Abandoned draft — read only</AlertTitle>
                <AlertDescription>
                  This draft was saved and its audience resolved, but it was never test-sent or
                  confirmed. This page intentionally offers no send, resume, or start control — doing
                  so here would email every organization owner with content nobody reviewed. To send
                  it, go back to Compose and build a new draft from scratch.
                </AlertDescription>
              </Alert>
            )}

            {/* Item 7: stuck-in-'sending' warning */}
            {stuckRows.length > 0 && (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>
                  {stuckRows.length} recipient{stuckRows.length === 1 ? '' : 's'} stuck in "sending"
                </AlertTitle>
                <AlertDescription className="space-y-2">
                  <p>
                    Claimed by the worker more than {STUCK_SENDING_MINUTES} minutes ago and never
                    resolved — most likely a redeploy or timeout killed the function mid-send. Neither
                    the dispatcher (claims only <code>queued</code>) nor Retry failed (claims only{' '}
                    <code>failed</code>) can reach these rows, so the broadcast will stay "sending"
                    forever unless an operator resolves them manually. Run this in the Lovable SQL
                    editor — inspect first, since a stuck row may already have been delivered:
                  </p>
                  <pre className="rounded-md border bg-background/60 p-3 text-xs overflow-x-auto whitespace-pre">
                    {buildStuckSql(id ?? '')}
                  </pre>
                </AlertDescription>
              </Alert>
            )}

            {/* 2. Four counters, all derived from the recipient rows */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Card>
                <CardContent className="p-4">
                  <div className="flex items-center gap-2 mb-1 text-muted-foreground">
                    <CheckCircle2 className="w-4 h-4" />
                    <span className="text-sm">Sent</span>
                  </div>
                  <p className="text-2xl font-bold tabular-nums">{counts.sent}</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4">
                  <div className="flex items-center gap-2 mb-1 text-muted-foreground">
                    <XCircle className="w-4 h-4" />
                    <span className="text-sm">Failed</span>
                  </div>
                  <p className="text-2xl font-bold tabular-nums">{counts.failed}</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4">
                  <div className="flex items-center gap-2 mb-1 text-muted-foreground">
                    <Mail className="w-4 h-4" />
                    <span className="text-sm">Skipped</span>
                  </div>
                  <p className="text-2xl font-bold tabular-nums">{counts.skipped}</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4">
                  <div className="flex items-center gap-2 mb-1 text-muted-foreground">
                    <Clock className="w-4 h-4" />
                    <span className="text-sm">Remaining</span>
                  </div>
                  <p className="text-2xl font-bold tabular-nums">{counts.remaining}</p>
                </CardContent>
              </Card>
            </div>

            {/* 3. "Did it finish?" */}
            {finishedLine && (
              <p className="text-sm font-medium flex items-center gap-2">
                {counts.remaining === 0 ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                ) : (
                  <Loader2 className="w-4 h-4 animate-spin shrink-0" />
                )}
                {finishedLine}
              </p>
            )}

            {/* 5. Retry failed — the only mutation this page performs */}
            {!isDraft && counts.failed > 0 && (
              <div>
                <Button variant="outline" onClick={() => setRetryDialogOpen(true)} disabled={retryFailed.isPending}>
                  {retryFailed.isPending ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <RefreshCw className="w-4 h-4 mr-2" />
                  )}
                  Retry {counts.failed} failed
                </Button>

                <AlertDialog open={retryDialogOpen} onOpenChange={setRetryDialogOpen}>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Retry {counts.failed} failed recipient{counts.failed === 1 ? '' : 's'}?</AlertDialogTitle>
                      <AlertDialogDescription>
                        Moves failed recipients back to queued and reopens the broadcast so the
                        1-minute cron picks them up again. Recipients that already sent successfully
                        or were skipped are not touched.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction
                        disabled={retryFailed.isPending}
                        onClick={(e) => {
                          e.preventDefault();
                          handleRetry();
                        }}
                      >
                        {retryFailed.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                        Retry
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            )}

            {/* 4. Recipient table */}
            <Card>
              <CardHeader className="flex flex-row items-center justify-between gap-4 space-y-0">
                <div>
                  <CardTitle className="text-base">Recipients</CardTitle>
                  <CardDescription>
                    {showAll ? `All ${rows.length}` : `${visibleRows.length} who haven't received it`}
                  </CardDescription>
                </div>
                <label className="flex items-center gap-2 text-sm shrink-0">
                  <Switch checked={showAll} onCheckedChange={setShowAll} />
                  Show all
                </label>
              </CardHeader>
              <CardContent>
                {recipientsError && (
                  <p className="text-sm text-destructive flex items-start gap-1.5 mb-3">
                    <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                    Could not load recipients — {(recipientsError as Error).message}
                  </p>
                )}

                {recipientsLoading && (
                  <p className="text-sm text-muted-foreground flex items-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin" /> Loading…
                  </p>
                )}

                {!recipientsLoading && !recipientsError && visibleRows.length === 0 && (
                  <p className="text-sm text-muted-foreground">
                    {showAll ? 'No recipients.' : 'Everyone in this broadcast has been sent to.'}
                  </p>
                )}

                {!recipientsLoading && !recipientsError && visibleRows.length > 0 && (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Email</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead>Reason</TableHead>
                          <TableHead className="text-right">Attempts</TableHead>
                          <TableHead>Sent at</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {visibleRows.map((r) => {
                          const reason = r.skip_reason ?? (r.error_message ? truncate(r.error_message, 80) : null);
                          return (
                            <TableRow key={r.id}>
                              <TableCell className="font-medium">{r.email}</TableCell>
                              <TableCell>
                                <Badge variant={recipientBadgeVariant(r.status)} className="capitalize">
                                  {r.status}
                                </Badge>
                              </TableCell>
                              <TableCell
                                className="max-w-xs truncate text-sm text-muted-foreground"
                                title={r.error_message ?? r.skip_reason ?? undefined}
                              >
                                {reason ?? '—'}
                              </TableCell>
                              <TableCell className="text-right tabular-nums">{r.attempts}</TableCell>
                              <TableCell className="whitespace-nowrap">{formatDateTime(r.sent_at, timezone)}</TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </AdminLayout>
  );
}
