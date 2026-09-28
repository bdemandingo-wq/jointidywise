import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { supabase } from '@/integrations/supabase/client';
import { useOrganization } from '@/contexts/OrganizationContext';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { CheckCircle2, XCircle, Clock, Inbox } from 'lucide-react';
import { QueryError } from '@/components/QueryError';
import { OrgTimestamp } from '@/components/OrgTimestamp';

interface LogEntry {
  id: string;
  type: string;
  customer_name: string;
  status: 'sent' | 'pending' | 'failed';
  created_at: string;
  error?: string | null;
}

export function AutomationLogTable() {
  const { organization } = useOrganization();

  const { data: logs = [], isLoading, error: logsError } = useQuery({
    queryKey: ['automation-log-combined', organization?.id],
    queryFn: async (): Promise<LogEntry[]> => {
      if (!organization?.id) return [];

      // Fetch from multiple queues in parallel
      const [reviewRes, rebookRes, reminderRes] = await Promise.all([
        supabase
          .from('automated_review_sms_queue')
          .select('id, created_at, sent, error, customer_id')
          .eq('organization_id', organization.id)
          .order('created_at', { ascending: false })
          .limit(10),
        supabase
          .from('rebooking_reminder_queue')
          .select('id, created_at, sent, error, cancelled, customer_id')
          .eq('organization_id', organization.id)
          .order('created_at', { ascending: false })
          .limit(10),
        supabase
          .from('booking_reminder_log')
          .select('id, created_at, recipient_phone, reminder_type')
          .eq('organization_id', organization.id)
          .order('created_at', { ascending: false })
          .limit(10),
      ]);

      // Collect customer IDs to batch-fetch names
      const customerIds = new Set<string>();
      (reviewRes.data || []).forEach((r: any) => r.customer_id && customerIds.add(r.customer_id));
      (rebookRes.data || []).forEach((r: any) => r.customer_id && customerIds.add(r.customer_id));

      let customerMap: Record<string, string> = {};
      if (customerIds.size > 0) {
        const { data: customers } = await supabase
          .from('customers')
          .select('id, first_name, last_name')
          .in('id', [...customerIds]);
        (customers || []).forEach((c: any) => {
          customerMap[c.id] = `${c.first_name || ''} ${c.last_name || ''}`.trim() || 'Unknown';
        });
      }

      const entries: LogEntry[] = [];

      (reviewRes.data || []).forEach((r: any) => {
        entries.push({
          id: r.id,
          type: 'Review Request',
          customer_name: customerMap[r.customer_id] || 'Unknown',
          status: r.error ? 'failed' : r.sent ? 'sent' : 'pending',
          created_at: r.created_at,
          error: r.error,
        });
      });

      (rebookRes.data || []).forEach((r: any) => {
        entries.push({
          id: r.id,
          type: 'Rebooking Reminder',
          customer_name: customerMap[r.customer_id] || 'Unknown',
          status: r.error ? 'failed' : r.sent ? 'sent' : (r.cancelled ? 'sent' : 'pending'),
          created_at: r.created_at,
          error: r.error,
        });
      });

      (reminderRes.data || []).forEach((r: any) => {
        entries.push({
          id: r.id,
          type: `Reminder (${r.reminder_type || 'SMS'})`,
          customer_name: r.recipient_phone || 'N/A',
          status: 'sent',
          created_at: r.created_at,
        });
      });

      // Sort combined by date descending, take top 20
      entries.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      return entries.slice(0, 20);
    },
    enabled: !!organization?.id,
  });

  if (logsError) {
    return <QueryError subject="automation log" />;
  }

  if (isLoading) {
    return (
      <div className="space-y-2">
        {[1, 2, 3, 4, 5].map(i => (
          <div key={i} className="flex items-center gap-3 p-3">
            <Skeleton className="w-4 h-4 rounded-full" />
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-3 w-32 ml-auto" />
          </div>
        ))}
      </div>
    );
  }

  if (logs.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
        <Inbox className="w-10 h-10 mb-2 opacity-40" />
        <p className="text-sm">No automation events yet</p>
        <p className="text-xs mt-1">Events will appear here as automations fire.</p>
      </div>
    );
  }

  const statusIcon = {
    sent: <CheckCircle2 className="w-3.5 h-3.5 text-green-500" />,
    pending: <Clock className="w-3.5 h-3.5 text-yellow-500" />,
    failed: <XCircle className="w-3.5 h-3.5 text-destructive" />,
  };

  const statusVariant = {
    sent: 'default' as const,
    pending: 'secondary' as const,
    failed: 'destructive' as const,
  };

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-muted-foreground text-xs">
            <th className="text-left py-2 px-3 font-medium">Status</th>
            <th className="text-left py-2 px-3 font-medium">Type</th>
            <th className="text-left py-2 px-3 font-medium">Recipient</th>
            <th className="text-left py-2 px-3 font-medium">Date</th>
          </tr>
        </thead>
        <tbody>
          {logs.map((log) => (
            <tr key={log.id} className="border-b last:border-0 hover:bg-muted/30 transition-colors">
              <td className="py-2.5 px-3">
                <div className="flex items-center gap-1.5">
                  {statusIcon[log.status]}
                  <Badge variant={statusVariant[log.status]} className="text-[10px] px-1.5 py-0 h-4 capitalize">
                    {log.status}
                  </Badge>
                </div>
              </td>
              <td className="py-2.5 px-3 font-medium text-foreground">{log.type}</td>
              <td className="py-2.5 px-3 text-muted-foreground">{log.customer_name}</td>
              <td className="py-2.5 px-3 text-muted-foreground whitespace-nowrap">
                <OrgTimestamp value={log.created_at} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
