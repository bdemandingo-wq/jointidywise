import { useQuery, useQueryClient } from '@tanstack/react-query';
import { refreshBadges } from '@/lib/badgeRefresh';
import { supabase } from '@/lib/supabase';
import { useOrgId } from '@/hooks/useOrgId';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Bell, FileText, PenLine, Banknote, Check, CalendarOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useOrgTimezone } from '@/hooks/useOrgTimezone';
import { formatTimestampWithZone } from '@/lib/timezoneUtils';
import { useNavigate } from 'react-router-dom';
import { QueryError } from '@/components/QueryError';

export function StaffEventNotifications() {
  const { organizationId } = useOrgId();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data: eventRows = [], refetch, error: eventRowsError } = useQuery({
    queryKey: ['staff-event-notifications', organizationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('staff_event_notifications')
        .select('*, staff:staff_id(name)')
        .eq('organization_id', organizationId!)
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      return data;
    },
    enabled: !!organizationId,
  });

  const { data: timeOffRows = [], error: timeOffRowsError } = useQuery({
    queryKey: ['staff-activity-time-off', organizationId],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('time_off_requests')
        .select('id,status,start_date,end_date,reason,created_at,reviewed_at,staff:staff(name)')
        .eq('organization_id', organizationId)
        .order('created_at', { ascending: false })
        .limit(30);
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!organizationId,
  });

  // Merge time-off rows into the activity list, sorted by most recent event
  const notifications = [
    ...eventRows.map((n: any) => ({ ...n, __kind: 'event' as const })),
    ...timeOffRows.map((r: any) => ({
      __kind: 'time_off' as const,
      id: `to-${r.id}`,
      created_at: r.reviewed_at || r.created_at,
      is_read: r.status !== 'pending',
      title: r.status === 'pending'
        ? 'Time-off requested'
        : `Time off ${r.status}`,
      message: `${r.staff?.name ?? 'Staff'}, ${r.start_date}${r.end_date && r.end_date !== r.start_date ? ` → ${r.end_date}` : ''}${r.reason ? ` · ${r.reason}` : ''}`,
      event_type: 'time_off',
      staff: r.staff,
      status: r.status,
    })),
  ].sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());


  const unreadCount = notifications.filter((n: any) => !n.is_read).length;

  const markAllRead = async () => {
    if (!organizationId) return;
    await supabase
      .from('staff_event_notifications')
      .update({ is_read: true })
      .eq('organization_id', organizationId)
      .eq('is_read', false);
    refetch();
    refreshBadges(queryClient);
  };

  const getIcon = (type: string) => {
    switch (type) {
      case 'document_uploaded': return <FileText className="w-4 h-4 text-blue-400" />;
      case 'document_signed': return <PenLine className="w-4 h-4 text-green-400" />;
      case 'payout_setup': return <Banknote className="w-4 h-4 text-amber-400" />;
      case 'booking_claimed': return <Check className="w-4 h-4 text-emerald-400" />;
      case 'time_off': return <CalendarOff className="w-4 h-4 text-amber-500" />;
      default: return <Bell className="w-4 h-4 text-muted-foreground" />;
    }
  };

  if (eventRowsError) return <QueryError subject="staff event notifications" />;
  if (timeOffRowsError) return <QueryError subject="staff time-off activity" />;
  if (notifications.length === 0) return null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Bell className="w-4 h-4" />
            Staff Activity
            {unreadCount > 0 && (
              <Badge variant="default" className="ml-1">{unreadCount}</Badge>
            )}
          </CardTitle>
          {unreadCount > 0 && (
            <Button variant="ghost" size="sm" onClick={markAllRead}>
              <Check className="w-4 h-4 mr-1" />
              Mark all read
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-2 max-h-[300px] overflow-y-auto">
          {notifications.slice(0, 20).map((n: any) => {
            const isTimeOff = n.__kind === 'time_off';
            return (
              <div
                key={n.id}
                onClick={isTimeOff ? () => navigate('/dashboard/staff?tab=time-off') : undefined}
                className={`flex items-start gap-3 p-2 rounded-md text-sm ${
                  !n.is_read ? 'bg-primary/5 border border-primary/10' : ''
                } ${isTimeOff ? 'cursor-pointer hover:bg-muted/50' : ''}`}
              >
                <div className="mt-0.5">{getIcon(n.event_type)}</div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium">{n.title}</p>
                  <p className="text-muted-foreground text-xs truncate">{n.message}</p>
                  <p className="text-muted-foreground text-xs mt-0.5">
                    {formatTimestampWithZone(n.created_at, timezone)}
                  </p>
                </div>
                {!n.is_read && (
                  <div className="w-2 h-2 rounded-full bg-primary shrink-0 mt-2" />
                )}
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
