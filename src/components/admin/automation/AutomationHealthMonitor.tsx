import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { useOrganization } from '@/contexts/OrganizationContext';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, XCircle, AlertTriangle, Activity, TrendingUp, Clock, ChevronDown, ChevronUp } from 'lucide-react';
import { format } from 'date-fns';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { QueryError } from '@/components/QueryError';
import { OrgTimestamp } from '@/components/OrgTimestamp';

interface QueueStats {
  total: number;
  sent: number;
  failed: number;
  pending: number;
}

interface DetailItem {
  id: string;
  status: 'failed' | 'pending' | 'sent';
  error?: string | null;
  created_at: string;
  send_at?: string;
  customer_name?: string;
  booking_number?: number;
}

function useQueueDetails(orgId: string | undefined, table: string, enabled: boolean) {
  return useQuery({
    queryKey: ['automation-details', table, orgId, enabled],
    queryFn: async (): Promise<DetailItem[]> => {
      if (!orgId) return [];

      if (table === 'booking_reminder_log') {
        const { data, error } = await supabase
          .from('booking_reminder_log')
          .select('id, created_at, booking_id, recipient_phone, reminder_type, status, error_message')
          .eq('organization_id', orgId)
          .order('created_at', { ascending: false })
          .limit(50);
        if (error) throw error;
        return (data || []).map((r: any) => ({
          id: r.id,
          status: (r.status === 'failed' ? 'failed' : 'sent') as 'failed' | 'sent',
          created_at: r.created_at,
          customer_name: r.recipient_phone,
          error: r.error_message || null,
        }));
      }


      if (table === 'automated_review_sms_queue') {
        const { data, error } = await supabase
          .from('automated_review_sms_queue')
          .select(`
            id, created_at, send_at, sent, error,
            customer_id,
            booking_id
          `)
          .eq('organization_id', orgId)
          .order('created_at', { ascending: false })
          .limit(50);
        if (error) throw error;

        // Fetch customer names and booking numbers
        const customerIds = [...new Set((data || []).map(d => d.customer_id).filter(Boolean))];
        const bookingIds = [...new Set((data || []).map(d => d.booking_id).filter(Boolean))];
        
        let customerMap: Record<string, string> = {};
        let bookingMap: Record<string, number> = {};

        if (customerIds.length > 0) {
          const { data: customers } = await supabase
            .from('customers')
            .select('id, first_name, last_name')
            .in('id', customerIds as string[]);
          (customers || []).forEach((c: any) => {
            customerMap[c.id] = `${c.first_name || ''} ${c.last_name || ''}`.trim();
          });
        }
        if (bookingIds.length > 0) {
          const { data: bookings } = await supabase
            .from('bookings')
            .select('id, booking_number')
            .in('id', bookingIds);
          (bookings || []).forEach((b: any) => {
            bookingMap[b.id] = b.booking_number;
          });
        }

        return (data || []).map((r: any) => ({
          id: r.id,
          status: r.sent && r.error ? 'failed' : r.sent ? 'sent' : 'pending',
          error: r.error,
          created_at: r.created_at,
          send_at: r.send_at,
          customer_name: customerMap[r.customer_id] || 'Unknown',
          booking_number: bookingMap[r.booking_id],
        }));
      }

      // rebooking_reminder_queue and recurring_offer_queue have similar shape
      const { data, error } = await supabase
        .from(table as any)
        .select('id, created_at, send_at, sent, error, cancelled, customer_id, booking_id')
        .eq('organization_id', orgId)
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) throw error;

      const customerIds = [...new Set((data || []).map((d: any) => d.customer_id).filter(Boolean))];
      const bookingIds = [...new Set((data || []).map((d: any) => d.booking_id).filter(Boolean))];

      let customerMap: Record<string, string> = {};
      let bookingMap: Record<string, number> = {};

      if (customerIds.length > 0) {
        const { data: customers } = await supabase
          .from('customers')
          .select('id, first_name, last_name')
          .in('id', customerIds);
        (customers || []).forEach((c: any) => {
          customerMap[c.id] = `${c.first_name || ''} ${c.last_name || ''}`.trim();
        });
      }
      if (bookingIds.length > 0) {
        const { data: bookings } = await supabase
          .from('bookings')
          .select('id, booking_number')
          .in('id', bookingIds);
        (bookings || []).forEach((b: any) => {
          bookingMap[b.id] = b.booking_number;
        });
      }

      return (data || []).map((r: any) => ({
        id: r.id,
        status: r.error ? 'failed' : r.sent ? 'sent' : (r.cancelled ? 'sent' : 'pending'),
        error: r.error,
        created_at: r.created_at,
        send_at: r.send_at,
        customer_name: customerMap[r.customer_id] || 'Unknown',
        booking_number: bookingMap[r.booking_id],
      }));
    },
    enabled: !!orgId && enabled,
  });
}

function DetailsList({ items, filter }: { items: DetailItem[]; filter: 'failed' | 'pending' | 'all' }) {
  const filtered = filter === 'all' ? items : items.filter(i => i.status === filter);

  if (filtered.length === 0) {
    return <p className="text-xs text-muted-foreground py-2 px-3">No {filter} items found.</p>;
  }

  return (
    <div className="space-y-1.5 mt-2">
      {filtered.map(item => (
        <div key={item.id} className="flex items-start gap-2 p-2 rounded-md bg-muted/30 text-xs">
          {item.status === 'failed' ? (
            <XCircle className="w-3.5 h-3.5 text-destructive mt-0.5 flex-shrink-0" />
          ) : item.status === 'pending' ? (
            <AlertTriangle className="w-3.5 h-3.5 text-warning mt-0.5 flex-shrink-0" />
          ) : (
            <CheckCircle2 className="w-3.5 h-3.5 text-success mt-0.5 flex-shrink-0" />
          )}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-medium text-foreground">{item.customer_name || 'Unknown'}</span>
              {item.booking_number && (
                <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                  #{item.booking_number}
                </Badge>
              )}
            </div>
            {item.error && (
              <p className="text-destructive mt-0.5 break-all">{item.error}</p>
            )}
            <div className="flex gap-2 mt-0.5 text-muted-foreground">
              <span>Created: <OrgTimestamp value={item.created_at} /></span>
              {item.send_at && item.status === 'pending' && (
                <span>• Scheduled: <OrgTimestamp value={item.send_at} /></span>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

export function AutomationHealthMonitor() {
  const { organization } = useOrganization();
  const [expandedQueue, setExpandedQueue] = useState<string | null>(null);
  const [detailFilter, setDetailFilter] = useState<'failed' | 'pending' | 'all'>('all');

  const { data: reviewStats, error: reviewError } = useQuery({
    queryKey: ['automation-health-review', organization?.id],
    queryFn: async (): Promise<QueueStats> => {
      if (!organization?.id) return { total: 0, sent: 0, failed: 0, pending: 0 };
      const { data, error } = await supabase
        .from('automated_review_sms_queue')
        .select('sent, error')
        .eq('organization_id', organization.id);
      if (error) throw error;
      const items = data || [];
      return {
        total: items.length,
        sent: items.filter(i => i.sent && !i.error).length,
        failed: items.filter(i => i.sent && i.error).length,
        pending: items.filter(i => !i.sent).length,
      };
    },
    enabled: !!organization?.id,
  });

  const { data: rebookingStats, error: rebookingError } = useQuery({
    queryKey: ['automation-health-rebooking', organization?.id],
    queryFn: async (): Promise<QueueStats> => {
      if (!organization?.id) return { total: 0, sent: 0, failed: 0, pending: 0 };
      const { data, error } = await supabase
        .from('rebooking_reminder_queue')
        .select('sent, cancelled, error')
        .eq('organization_id', organization.id);
      if (error) throw error;
      const items = data || [];
      return {
        total: items.length,
        sent: items.filter((i: any) => i.sent && !i.error).length,
        failed: items.filter((i: any) => i.error).length,
        pending: items.filter((i: any) => !i.sent && !i.cancelled).length,
      };
    },
    enabled: !!organization?.id,
  });

  const { data: recurringStats, error: recurringError } = useQuery({
    queryKey: ['automation-health-recurring', organization?.id],
    queryFn: async (): Promise<QueueStats> => {
      if (!organization?.id) return { total: 0, sent: 0, failed: 0, pending: 0 };
      const { data, error } = await supabase
        .from('recurring_offer_queue')
        .select('sent, cancelled, error')
        .eq('organization_id', organization.id);
      if (error) throw error;
      const items = data || [];
      return {
        total: items.length,
        sent: items.filter((i: any) => i.sent && !i.error).length,
        failed: items.filter((i: any) => i.error).length,
        pending: items.filter((i: any) => !i.sent && !i.cancelled).length,
      };
    },
    enabled: !!organization?.id,
  });

  const { data: reminderStats, error: reminderError } = useQuery({
    queryKey: ['automation-health-reminders', organization?.id],
    queryFn: async (): Promise<QueueStats & { lastActivityAt: string | null; cronHealthy: boolean }> => {
      if (!organization?.id) return { total: 0, sent: 0, failed: 0, pending: 0, lastActivityAt: null, cronHealthy: true };
      const { data, error } = await supabase
        .from('booking_reminder_log')
        .select('status, sent_at')
        .eq('organization_id', organization.id)
        .order('sent_at', { ascending: false })
        .limit(1000);
      if (error) throw error;
      const items = (data || []) as Array<{ status: string | null; sent_at: string }>;
      const sent = items.filter(i => (i.status ?? 'sent') === 'sent').length;
      const failed = items.filter(i => i.status === 'failed').length;
      const lastActivityAt = items[0]?.sent_at ?? null;
      // Cron runs every 15 min; treat >2h of silence as an outage signal.
      const cronHealthy = lastActivityAt
        ? (Date.now() - new Date(lastActivityAt).getTime()) < 2 * 60 * 60 * 1000
        : false;
      return { total: items.length, sent, failed, pending: 0, lastActivityAt, cronHealthy };
    },
    enabled: !!organization?.id,
  });


  // Abandoned booking link stats
  const { data: abandonedStats, error: abandonedError } = useQuery({
    queryKey: ['automation-health-abandoned', organization?.id],
    queryFn: async (): Promise<{ total: number; opened: number; completed: number; abandoned: number; conversionRate: number }> => {
      if (!organization?.id) return { total: 0, opened: 0, completed: 0, abandoned: 0, conversionRate: 0 };
      const { data, error } = await supabase
        .from('booking_link_tracking' as any)
        .select('status, link_opened_at, booking_completed_at')
        .eq('organization_id', organization.id)
        .eq('link_type', 'booking');
      if (error) throw error;
      const items = data || [];
      const opened = items.filter((i: any) => i.link_opened_at).length;
      const completed = items.filter((i: any) => i.booking_completed_at).length;
      const abandoned = items.filter((i: any) => i.link_opened_at && !i.booking_completed_at).length;
      return {
        total: items.length,
        opened,
        completed,
        abandoned,
        conversionRate: opened > 0 ? Math.round((completed / opened) * 100) : 0,
      };
    },
    enabled: !!organization?.id,
  });

  // Campaign-specific abandoned stats
  const { data: campaignAbandonedStats, error: campaignAbandonedError } = useQuery({
    queryKey: ['automation-health-campaign-abandoned', organization?.id],
    queryFn: async () => {
      if (!organization?.id) return null;
      // Get tracking data with campaign associations
      const { data: trackingData, error: tErr } = await supabase
        .from('booking_link_tracking' as any)
        .select('campaign_id, link_opened_at, booking_completed_at')
        .eq('organization_id', organization.id)
        .eq('link_type', 'booking')
        .not('campaign_id', 'is', null);
      if (tErr || !trackingData) return null;

      // Get campaign names
      const campaignIds = [...new Set(trackingData.map((t: any) => t.campaign_id))];
      if (campaignIds.length === 0) return null;

      const { data: campaigns } = await supabase
        .from('automated_campaigns')
        .select('id, name')
        .in('id', campaignIds);

      const nameMap: Record<string, string> = {};
      (campaigns || []).forEach((c: any) => { nameMap[c.id] = c.name; });

      // Aggregate per campaign
      const perCampaign: Record<string, { name: string; sent: number; opened: number; completed: number; abandoned: number }> = {};
      trackingData.forEach((row: any) => {
        const cid = row.campaign_id;
        if (!perCampaign[cid]) perCampaign[cid] = { name: nameMap[cid] || 'Unknown', sent: 0, opened: 0, completed: 0, abandoned: 0 };
        perCampaign[cid].sent++;
        if (row.link_opened_at) perCampaign[cid].opened++;
        if (row.booking_completed_at) perCampaign[cid].completed++;
        if (row.link_opened_at && !row.booking_completed_at) perCampaign[cid].abandoned++;
      });

      const entries = Object.values(perCampaign).filter(c => c.sent > 0);
      const totalAbandoned = entries.reduce((sum, c) => sum + c.abandoned, 0);
      const best = entries.length > 0
        ? entries.reduce((b, c) => (c.sent > 0 && (c.completed / c.sent) > (b.completed / b.sent)) ? c : b)
        : null;
      const worst = entries.length > 0
        ? entries.reduce((w, c) => (c.sent > 0 && (c.abandoned / c.sent) > (w.abandoned / w.sent)) ? c : w)
        : null;

      return { totalAbandoned, best, worst, campaigns: entries };
    },
    enabled: !!organization?.id,
  });

  const automationQueues = [
    { name: 'Review Requests', table: 'automated_review_sms_queue', stats: reviewStats, icon: CheckCircle2, color: 'text-amber-500' },
    { name: 'Rebooking Reminders', table: 'rebooking_reminder_queue', stats: rebookingStats, icon: TrendingUp, color: 'text-green-500' },
    { name: 'Recurring Offers', table: 'recurring_offer_queue', stats: recurringStats, icon: Activity, color: 'text-purple-500' },
    { name: 'Appointment Reminders', table: 'booking_reminder_log', stats: reminderStats, icon: Clock, color: 'text-blue-500' },
  ];

  const totalSent = automationQueues.reduce((acc, q) => acc + (q.stats?.sent || 0), 0);
  const totalFailed = automationQueues.reduce((acc, q) => acc + (q.stats?.failed || 0), 0);
  const totalPending = automationQueues.reduce((acc, q) => acc + (q.stats?.pending || 0), 0);
  const totalAll = totalSent + totalFailed + totalPending;
  const successRate = totalAll > 0 ? Math.round(((totalSent) / (totalSent + totalFailed || 1)) * 100) : 100;

  // Fetch details for expanded queue — must be called before any early return
  // to satisfy the rules-of-hooks (hooks cannot be called conditionally).
  const { data: detailItems = [] } = useQueueDetails(
    organization?.id,
    expandedQueue || '',
    !!expandedQueue
  );

  const queryError = reviewError || rebookingError || recurringError || reminderError || abandonedError || campaignAbandonedError;
  if (queryError) {
    return <QueryError subject="automation health monitor" />;
  }

  return (
    <div className="space-y-4">
      {/* Summary Cards */}
      <div className="grid gap-4 grid-cols-2 md:grid-cols-4">
        <Card>
          <CardContent className="pt-4 pb-3 px-4">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-success" />
              <span className="text-xs font-medium text-muted-foreground">Sent</span>
            </div>
            <p className="text-2xl font-bold mt-1">{totalSent}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3 px-4">
            <div className="flex items-center gap-2">
              <XCircle className="w-4 h-4 text-destructive" />
              <span className="text-xs font-medium text-muted-foreground">Failed</span>
            </div>
            <p className="text-2xl font-bold mt-1">{totalFailed}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3 px-4">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-warning" />
              <span className="text-xs font-medium text-muted-foreground">Pending</span>
            </div>
            <p className="text-2xl font-bold mt-1">{totalPending}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3 px-4">
            <div className="flex items-center gap-2">
              <Activity className="w-4 h-4 text-primary" />
              <span className="text-xs font-medium text-muted-foreground">Success Rate</span>
            </div>
            <p className="text-2xl font-bold mt-1">{successRate}%</p>
            <Progress value={successRate} className="mt-2 h-1.5" />
          </CardContent>
        </Card>
      </div>

      {/* Cron heartbeat / reminder pipeline outage banner */}
      {reminderStats && reminderStats.cronHealthy === false && (
        <Card className="border-destructive/40 bg-destructive/5">
          <CardContent className="pt-4 pb-4 px-4 flex items-start gap-3">
            <XCircle className="w-5 h-5 text-destructive mt-0.5 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-destructive">
                Appointment reminder pipeline may be down
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                No reminder activity in the last 2 hours.{' '}
                {reminderStats.lastActivityAt
                  ? <>Last log entry <OrgTimestamp value={reminderStats.lastActivityAt} />.</>
                  : <>No reminder has ever been logged for this organization.</>}
                {' '}The scheduler runs every 15 minutes — if you have bookings in the next few days, contact support.
              </p>
            </div>
          </CardContent>
        </Card>
      )}


      {/* Abandoned Bookings Card */}
      {abandonedStats && abandonedStats.total > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-warning" />
              Abandoned Bookings
            </CardTitle>
            <CardDescription>Booking links sent but not completed</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="p-3 bg-muted/50 rounded-lg text-center">
                <p className="text-2xl font-bold">{abandonedStats.total}</p>
                <p className="text-xs text-muted-foreground">Links Sent</p>
              </div>
              <div className="p-3 bg-muted/50 rounded-lg text-center">
                <p className="text-2xl font-bold text-warning">{abandonedStats.opened}</p>
                <p className="text-xs text-muted-foreground">Opened</p>
              </div>
              <div className="p-3 bg-muted/50 rounded-lg text-center">
                <p className="text-2xl font-bold text-success">{abandonedStats.completed}</p>
                <p className="text-xs text-muted-foreground">Completed</p>
              </div>
              <div className="p-3 bg-muted/50 rounded-lg text-center">
                <p className="text-2xl font-bold">{abandonedStats.conversionRate}%</p>
                <p className="text-xs text-muted-foreground">Conversion</p>
                <Progress value={abandonedStats.conversionRate} className="mt-1 h-1.5" />
              </div>
            </div>
            {abandonedStats.abandoned > 0 && (
              <div className="mt-3 p-3 bg-warning/10 border border-warning/20 rounded-lg flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-warning shrink-0" />
                <p className="text-sm">
                  <strong>{abandonedStats.abandoned}</strong> customers opened their booking link but didn't complete.
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Campaign Abandoned Stats */}
      {campaignAbandonedStats && campaignAbandonedStats.campaigns.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-primary" />
              Campaign Booking Tracking
            </CardTitle>
            <CardDescription>Abandoned bookings from campaign messages</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="p-3 bg-muted/50 rounded-lg">
                <p className="text-xs text-muted-foreground mb-1">Total Abandoned (Campaigns)</p>
                <p className="text-2xl font-bold text-destructive">{campaignAbandonedStats.totalAbandoned}</p>
              </div>
              {campaignAbandonedStats.best && campaignAbandonedStats.best.completed > 0 && (
                <div className="p-3 bg-success/10 border border-success/20 rounded-lg">
                  <p className="text-xs text-muted-foreground mb-1">Best Conversion</p>
                  <p className="text-sm font-medium truncate">{campaignAbandonedStats.best.name}</p>
                  <p className="text-lg font-bold text-success">
                    {Math.round((campaignAbandonedStats.best.completed / campaignAbandonedStats.best.sent) * 100)}%
                  </p>
                </div>
              )}
              {campaignAbandonedStats.worst && campaignAbandonedStats.worst.abandoned > 0 && (
                <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-lg">
                  <p className="text-xs text-muted-foreground mb-1">Highest Abandonment</p>
                  <p className="text-sm font-medium truncate">{campaignAbandonedStats.worst.name}</p>
                  <p className="text-lg font-bold text-destructive">
                    {Math.round((campaignAbandonedStats.worst.abandoned / campaignAbandonedStats.worst.sent) * 100)}%
                  </p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Per-Automation Breakdown */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Automation Breakdown</CardTitle>
          <CardDescription>Tap any automation to see individual item details</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {automationQueues.map((queue) => {
            const stats = queue.stats || { total: 0, sent: 0, failed: 0, pending: 0 };
            const rate = stats.sent + stats.failed > 0
              ? Math.round((stats.sent / (stats.sent + stats.failed)) * 100)
              : 100;
            const Icon = queue.icon;
            const isExpanded = expandedQueue === queue.table;

            return (
              <Collapsible
                key={queue.name}
                open={isExpanded}
                onOpenChange={(open) => {
                  setExpandedQueue(open ? queue.table : null);
                  setDetailFilter('all');
                }}
              >
                <div className="rounded-lg border bg-card overflow-hidden">
                  <CollapsibleTrigger asChild>
                    <button className="flex items-center gap-4 p-3 w-full text-left hover:bg-muted/50 transition-colors">
                      <div className={`p-2 rounded-md bg-muted ${queue.color}`}>
                        <Icon className="w-4 h-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-sm font-medium">{queue.name}</span>
                          <div className="flex items-center gap-2">
                            <Badge variant={stats.failed > 0 ? 'destructive' : 'default'} className="text-xs">
                              {rate}% success
                            </Badge>
                            {isExpanded ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
                          </div>
                        </div>
                        <Progress value={rate} className="h-1.5" />
                        <div className="flex gap-3 mt-1.5 text-xs text-muted-foreground">
                          <span>{stats.sent} sent</span>
                          {stats.failed > 0 && <span className="text-destructive">{stats.failed} failed</span>}
                          {stats.pending > 0 && <span>{stats.pending} pending</span>}
                        </div>
                      </div>
                    </button>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <div className="border-t px-3 pb-3">
                      <div className="flex gap-1.5 mt-2 mb-1">
                        {(['all', 'failed', 'pending'] as const).map(f => (
                          <Button
                            key={f}
                            size="sm"
                            variant={detailFilter === f ? 'default' : 'outline'}
                            className="text-xs h-7 px-2.5"
                            onClick={() => setDetailFilter(f)}
                          >
                            {f === 'all' ? 'All' : f === 'failed' ? `Failed (${stats.failed})` : `Pending (${stats.pending})`}
                          </Button>
                        ))}
                      </div>
                      <DetailsList items={detailItems} filter={detailFilter} />
                    </div>
                  </CollapsibleContent>
                </div>
              </Collapsible>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}
