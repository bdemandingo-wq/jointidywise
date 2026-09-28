import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { supabase } from '@/integrations/supabase/client';
import { useOrganization } from '@/contexts/OrganizationContext';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Clock, Star, RotateCcw, Repeat, UserX, Loader2,
  ChevronDown, ChevronUp, Save, Phone, CreditCard,
  PartyPopper, BarChart3, Trophy, Zap,
  MessageSquare, Plus, Trash2, Pencil, Wallet,
} from 'lucide-react';
import { AutomationEditorDialog } from './AutomationEditorDialog';
import { QueryError } from '@/components/QueryError';

import { format } from 'date-fns';
import { OrgTimestamp } from '@/components/OrgTimestamp';

interface ReminderInterval {
  id?: string;
  label: string;
  hours_before: number;
  is_active: boolean;
  send_to_client: boolean;
  send_to_cleaner: boolean;
}

function AppointmentReminderSettings({ organizationId }: { organizationId: string }) {
  const [reminderIntervals, setReminderIntervals] = useState<ReminderInterval[]>([]);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [newLabel, setNewLabel] = useState('');
  const [newHours, setNewHours] = useState<string>('');

  const fetchIntervals = React.useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('appointment_reminder_intervals')
        .select('*')
        .eq('organization_id', organizationId)
        .order('hours_before', { ascending: false });
      if (error) throw error;
      if (data) {
        setReminderIntervals(data.map(d => ({
          id: d.id,
          label: d.label,
          hours_before: Number(d.hours_before),
          is_active: d.is_active,
          send_to_client: d.send_to_client,
          send_to_cleaner: d.send_to_cleaner,
        })));
      }
    } catch (error) {
      console.error('Error fetching reminder intervals:', error);
    } finally {
      setLoading(false);
    }
  }, [organizationId]);

  React.useEffect(() => {
    fetchIntervals();
  }, [fetchIntervals]);

  const updateInterval = (index: number, updater: (interval: ReminderInterval) => ReminderInterval) => {
    setReminderIntervals((prev) => prev.map((interval, currentIndex) => (
      currentIndex === index ? updater(interval) : interval
    )));
  };

  const toggleIntervalEnabled = (index: number, checked?: boolean) => {
    updateInterval(index, (interval) => ({
      ...interval,
      is_active: checked ?? !interval.is_active,
    }));
  };

  const toggleRecipient = (
    index: number,
    recipient: 'send_to_client' | 'send_to_cleaner',
    checked?: boolean,
  ) => {
    updateInterval(index, (interval) => ({
      ...interval,
      [recipient]: checked ?? !interval[recipient],
    }));
  };

  const handleKeyToggle = (event: React.KeyboardEvent<HTMLDivElement>, callback: () => void) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      callback();
    }
  };

  const addInterval = async () => {
    const hours = Number(newHours);
    if (!newLabel.trim() || !Number.isFinite(hours) || hours <= 0) {
      toast.error('Enter a label and a positive hours value');
      return;
    }
    if (reminderIntervals.some((i) => Number(i.hours_before) === hours)) {
      toast.error('An interval with that hours value already exists');
      return;
    }
    try {
      const { error } = await supabase
        .from('appointment_reminder_intervals')
        .insert({
          organization_id: organizationId,
          label: newLabel.trim(),
          hours_before: hours,
          is_active: true,
          send_to_client: true,
          send_to_cleaner: true,
        });
      if (error) throw error;
      toast.success('Reminder interval added');
      setNewLabel('');
      setNewHours('');
      fetchIntervals();
    } catch (error) {
      console.error('Failed to add interval:', error);
      toast.error('Failed to add interval');
    }
  };

  const deleteInterval = async (id?: string) => {
    if (!id) return;
    if (!confirm('Delete this reminder interval?')) return;
    try {
      const { error } = await supabase
        .from('appointment_reminder_intervals')
        .delete()
        .eq('id', id);
      if (error) throw error;
      toast.success('Reminder interval deleted');
      fetchIntervals();
    } catch (error) {
      console.error('Failed to delete interval:', error);
      toast.error('Failed to delete interval');
    }
  };

  const saveIntervals = async () => {
    setSaving(true);
    try {
      const results = await Promise.all(
        reminderIntervals
          .filter((interval) => interval.id)
          .map((interval) => supabase
            .from('appointment_reminder_intervals')
            .update({
              label: interval.label,
              hours_before: interval.hours_before,
              is_active: interval.is_active,
              send_to_client: interval.send_to_client,
              send_to_cleaner: interval.send_to_cleaner,
            })
            .eq('id', interval.id as string)),
      );

      const failedResult = results.find((result) => result.error);
      if (failedResult?.error) throw failedResult.error;

      toast.success('Reminder schedule saved');
      fetchIntervals();
    } catch (error) {
      console.error('Failed to save reminder schedule:', error);
      toast.error('Failed to save reminder schedule');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="flex items-center justify-center py-4"><Loader2 className="w-4 h-4 animate-spin text-muted-foreground" /></div>;
  }

  return (
    <div className="space-y-3 pt-3 border-t">
      <div className="flex items-center gap-2">
        <Clock className="w-4 h-4 text-muted-foreground" />
        <Label className="font-medium text-sm">Reminder Schedule</Label>
      </div>

      {reminderIntervals.length === 0 && (
        <p className="text-sm text-muted-foreground py-2">No reminder intervals yet — add one below.</p>
      )}

      {reminderIntervals.map((interval, index) => (
        <div key={interval.id || index} className="space-y-3 rounded-lg border bg-muted/30 p-3">
          <div className="flex items-center gap-2">
            <Input
              value={interval.label}
              onChange={(e) => updateInterval(index, (i) => ({ ...i, label: e.target.value }))}
              placeholder="Label (e.g. 24 hours before)"
              className="flex-1 h-9"
            />
            <Input
              type="number"
              min={0.25}
              step={0.25}
              value={interval.hours_before}
              onChange={(e) => updateInterval(index, (i) => ({ ...i, hours_before: Number(e.target.value) }))}
              className="w-24 h-9"
              aria-label="Hours before"
            />
            <span className="text-xs text-muted-foreground">hrs</span>
            <Switch
              checked={interval.is_active}
              onCheckedChange={(checked) => toggleIntervalEnabled(index, checked)}
              aria-label={`Toggle ${interval.label}`}
            />
            <Button
              variant="ghost"
              size="icon"
              className="h-9 w-9 text-destructive hover:text-destructive"
              onClick={() => deleteInterval(interval.id)}
              aria-label="Delete interval"
            >
              <Trash2 className="w-4 h-4" />
            </Button>
          </div>

          {interval.is_active && (
            <div className="grid gap-3 sm:grid-cols-2">
              <div
                role="button"
                tabIndex={0}
                className="flex cursor-pointer items-center justify-between rounded-md border bg-background/60 px-3 py-2"
                onClick={() => toggleRecipient(index, 'send_to_client')}
                onKeyDown={(event) => handleKeyToggle(event, () => toggleRecipient(index, 'send_to_client'))}
              >
                <span className="text-sm text-muted-foreground">Client</span>
                <Switch
                  checked={interval.send_to_client}
                  onClick={(event) => event.stopPropagation()}
                  onCheckedChange={(checked) => toggleRecipient(index, 'send_to_client', checked)}
                  aria-label={`Toggle client reminders for ${interval.label}`}
                />
              </div>

              <div
                role="button"
                tabIndex={0}
                className="flex cursor-pointer items-center justify-between rounded-md border bg-background/60 px-3 py-2"
                onClick={() => toggleRecipient(index, 'send_to_cleaner')}
                onKeyDown={(event) => handleKeyToggle(event, () => toggleRecipient(index, 'send_to_cleaner'))}
              >
                <span className="text-sm text-muted-foreground">Cleaner</span>
                <Switch
                  checked={interval.send_to_cleaner}
                  onClick={(event) => event.stopPropagation()}
                  onCheckedChange={(checked) => toggleRecipient(index, 'send_to_cleaner', checked)}
                  aria-label={`Toggle cleaner reminders for ${interval.label}`}
                />
              </div>
            </div>
          )}
        </div>
      ))}

      <div className="flex items-center gap-2 rounded-lg border border-dashed bg-background/60 p-3">
        <Input
          value={newLabel}
          onChange={(e) => setNewLabel(e.target.value)}
          placeholder="New interval label"
          className="flex-1 h-9"
        />
        <Input
          type="number"
          min={0.25}
          step={0.25}
          value={newHours}
          onChange={(e) => setNewHours(e.target.value)}
          placeholder="Hours"
          className="w-24 h-9"
        />
        <Button size="sm" onClick={addInterval} className="gap-1">
          <Plus className="w-3 h-3" /> Add
        </Button>
      </div>

      <Button variant="outline" size="sm" onClick={saveIntervals} disabled={saving} className="gap-2 w-full">
        {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
        Save Reminder Schedule
      </Button>
    </div>
  );
}

const activeAutomationsMeta: Record<string, {
  icon: typeof Zap;
  emoji: string;
  description: string;
  color: string;
}> = {
  appointment_reminder: {
    icon: Clock,
    emoji: '🗓️',
    description: 'Fires before every booking based on your reminder schedule',
    color: 'text-blue-500',
  },
  review_request: {
    icon: Star,
    emoji: '⭐',
    description: 'Fires 30 min after booking marked complete. Sends review request SMS.',
    color: 'text-amber-500',
  },
  rebooking_reminder: {
    icon: RotateCcw,
    emoji: '🔄',
    description: 'Fires 28 days after last completed cleaning with no future booking',
    color: 'text-green-500',
  },
  winback_60day: {
    icon: UserX,
    emoji: '💸',
    description: 'Enable win-back for clients with no booking in 60+ days. You send it from the Campaigns page (not automatic).',
    color: 'text-orange-500',
  },
  recurring_upsell: {
    icon: Repeat,
    emoji: '🔁',
    description: 'Offers recurring service plan 2 hours after first completed cleaning',
    color: 'text-purple-500',
  },
  seasonal_promo: {
    icon: PartyPopper,
    emoji: '🎉',
    description: 'Sends promo SMS 3 days before major US holidays (Christmas, Thanksgiving, July 4, etc.)',
    color: 'text-pink-500',
  },
  weekly_summary: {
    icon: BarChart3,
    emoji: '📊',
    description: 'Emails you a weekly digest of bookings, revenue, and team stats every Monday',
    color: 'text-blue-500',
  },
  payroll_period_report: {
    icon: Wallet,
    emoji: '💰',
    description: 'Emails you a payroll report when each pay period closes. Timing follows your payroll week in Settings.',
    color: 'text-emerald-500',
  },
  quote_stale_reengage: {
    icon: MessageSquare,
    emoji: '💬',
    description: 'Auto-sends a follow-up SMS when a quote sits unbooked for 3 days',
    color: 'text-cyan-500',
  },
  abandoned_booking_recovery: {
    icon: RotateCcw,
    emoji: '🔄',
    description: "Texts people who started booking and didn't finish. Only those who ticked the opt-in box. One message, never a second.",
    color: 'text-orange-500',
  },
};

const availableAutomations = [
  {
    id: 'post_call_followup',
    emoji: '📞',
    icon: Phone,
    name: 'Post-Call Follow Up',
    description: 'Sends SMS after missed OpenPhone call',
  },
  {
    id: 'card_expiry_alert',
    emoji: '💳',
    icon: CreditCard,
    name: 'Card Expiry Alert',
    description: 'Warns client when saved card is about to expire',
  },
  {
    id: 'loyalty_milestone',
    emoji: '🏆',
    icon: Trophy,
    name: 'Loyalty Milestone',
    description: 'Triggers when client hits 5/10/20 bookings. Sends reward message.',
  },
];

export function AutomationsTab() {
  const { organization } = useOrganization();
  const queryClient = useQueryClient();
  const [expandedCard, setExpandedCard] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ key: string; name: string } | null>(null);


  const { data: automations = [], isLoading, isError, error: automationsError, refetch } = useQuery({
    queryKey: ['organization-automations', organization?.id],
    queryFn: async () => {
      if (!organization?.id) return [];
      const { data, error } = await supabase
        .from('organization_automations')
        .select('*')
        .eq('organization_id', organization.id)
        .order('created_at', { ascending: true });
      if (error) throw error;
      // recurring_lapse_alert was removed; defensively hide any lingering row
      // (e.g. before the cleanup migration lands).
      return (data || []).filter((a) => a.automation_type !== 'recurring_lapse_alert');
    },
    enabled: !!organization?.id,
    retry: 3,
  });

  // Fetch fire counts from queue tables
  const { data: fireCounts = {}, error: fireCountsError } = useQuery({
    queryKey: ['automation-fire-counts', organization?.id],
    queryFn: async () => {
      if (!organization?.id) return {};
      const counts: Record<string, { total: number; lastFired: string | null }> = {};

      // Review requests
      // "Fired" = actually sent. Skips/failures are stamped sent=true with an
      // error (e.g. "Automation disabled"), so exclude error rows.
      const { count: reviewCount } = await supabase
        .from('automated_review_sms_queue')
        .select('*', { count: 'exact', head: true })
        .eq('organization_id', organization.id)
        .eq('sent', true)
        .is('error', null);
      const { data: lastReview } = await supabase
        .from('automated_review_sms_queue')
        .select('sent_at')
        .eq('organization_id', organization.id)
        .eq('sent', true)
        .is('error', null)
        .order('sent_at', { ascending: false })
        .limit(1);
      counts['review_request'] = { total: reviewCount || 0, lastFired: lastReview?.[0]?.sent_at || null };

      // Reminders
      const { count: reminderCount } = await supabase
        .from('booking_reminder_log')
        .select('*', { count: 'exact', head: true })
        .eq('organization_id', organization.id);
      const { data: lastReminder } = await supabase
        .from('booking_reminder_log')
        .select('sent_at')
        .eq('organization_id', organization.id)
        .order('sent_at', { ascending: false })
        .limit(1);
      counts['appointment_reminder'] = { total: reminderCount || 0, lastFired: lastReminder?.[0]?.sent_at || null };

      // Rebooking
      const { count: rebookCount } = await supabase
        .from('rebooking_reminder_queue')
        .select('*', { count: 'exact', head: true })
        .eq('organization_id', organization.id)
        .eq('sent', true)
        .is('error', null);
      const { data: lastRebook } = await supabase
        .from('rebooking_reminder_queue')
        .select('created_at')
        .eq('organization_id', organization.id)
        .eq('sent', true)
        .is('error', null)
        .order('created_at', { ascending: false })
        .limit(1);
      counts['rebooking_reminder'] = { total: rebookCount || 0, lastFired: lastRebook?.[0]?.created_at || null };

      // Recurring upsell
      const { count: recurCount } = await supabase
        .from('recurring_offer_queue')
        .select('*', { count: 'exact', head: true })
        .eq('organization_id', organization.id)
        .eq('sent', true)
        .is('error', null);
      const { data: lastRecur } = await supabase
        .from('recurring_offer_queue')
        .select('created_at')
        .eq('organization_id', organization.id)
        .eq('sent', true)
        .is('error', null)
        .order('created_at', { ascending: false })
        .limit(1);
      counts['recurring_upsell'] = { total: recurCount || 0, lastFired: lastRecur?.[0]?.created_at || null };

      // Winback (campaign SMS sends with type win_back)
      const { count: winbackCount } = await supabase
        .from('campaign_sms_sends')
        .select('*', { count: 'exact', head: true })
        .eq('organization_id', organization.id)
        .eq('campaign_type', 'win_back');
      const { data: lastWinback } = await supabase
        .from('campaign_sms_sends')
        .select('sent_at')
        .eq('organization_id', organization.id)
        .eq('campaign_type', 'win_back')
        .order('sent_at', { ascending: false })
        .limit(1);
      counts['winback_60day'] = { total: winbackCount || 0, lastFired: lastWinback?.[0]?.sent_at || null };

      // Seasonal Promo, Weekly Summary, Recurring Lapse Alert, and Quote Stale
      // Reengage each write one row per confirmed send to the shared
      // automation_fire_log (a row only exists on success — no sent/error flag
      // to filter on).
      for (const type of ['seasonal_promo', 'weekly_summary', 'quote_stale_reengage', 'abandoned_booking_recovery']) {
        const { count } = await supabase
          .from('automation_fire_log')
          .select('*', { count: 'exact', head: true })
          .eq('organization_id', organization.id)
          .eq('automation_type', type);
        const { data: last } = await supabase
          .from('automation_fire_log')
          .select('fired_at')
          .eq('organization_id', organization.id)
          .eq('automation_type', type)
          .order('fired_at', { ascending: false })
          .limit(1);
        counts[type] = { total: count || 0, lastFired: last?.[0]?.fired_at || null };
      }

      return counts;
    },
    enabled: !!organization?.id,
  });

  // Fetch history log (last 50 fired automations)
  const { data: historyLog = [], error: historyLogError } = useQuery({
    queryKey: ['automation-history-log', organization?.id],
    queryFn: async () => {
      if (!organization?.id) return [];
      const items: Array<{
        date: string;
        automationName: string;
        clientName: string;
        messagePreview: string;
        status: 'delivered' | 'failed' | 'pending';
      }> = [];

      // Review SMS queue
      const { data: reviews } = await supabase
        .from('automated_review_sms_queue')
        .select('created_at, sent, error, customer_id')
        .eq('organization_id', organization.id)
        .order('created_at', { ascending: false })
        .limit(20);

      // Reminder log
      const { data: reminders } = await supabase
        .from('booking_reminder_log')
        .select('created_at, recipient_phone, reminder_type')
        .eq('organization_id', organization.id)
        .order('created_at', { ascending: false })
        .limit(20);

      // Get customer names for review entries
      const customerIds = [...new Set((reviews || []).map(r => r.customer_id).filter((id): id is string => Boolean(id)))];
      let customerMap: Record<string, string> = {};
      if (customerIds.length > 0) {
        const { data: customers } = await supabase
          .from('customers')
          .select('id, first_name, last_name')
          .in('id', customerIds);
        (customers || []).forEach((c) => {
          customerMap[c.id] = `${c.first_name || ''} ${c.last_name || ''}`.trim();
        });
      }

      (reviews || []).forEach(r => {
        items.push({
          date: r.created_at,
          automationName: 'Review Request',
          clientName: (r.customer_id && customerMap[r.customer_id]) || 'Unknown',
          messagePreview: 'Review request SMS sent after cleaning',
          status: r.error ? 'failed' : r.sent ? 'delivered' : 'pending',
        });
      });

      (reminders || []).forEach(r => {
        items.push({
          date: r.created_at,
          automationName: `Reminder (${r.reminder_type})`,
          clientName: r.recipient_phone || 'Unknown',
          messagePreview: 'Appointment reminder SMS',
          status: 'delivered',
        });
      });

      items.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
      return items.slice(0, 50);
    },
    enabled: !!organization?.id,
  });

  const toggleMutation = useMutation({
    mutationFn: async ({ id, is_enabled }: { id: string; is_enabled: boolean }) => {
      const { error } = await supabase
        .from('organization_automations')
        .update({ is_enabled })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['organization-automations'] });
      toast.success('Automation updated');
    },
    onError: () => toast.error('Failed to update automation'),
  });

  const formatName = (type: string) =>
    type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()).replace('60day', '(60 Days)');

  const activeAutos = automations.filter(a => a.is_enabled);
  const inactiveAutos = automations.filter(a => !a.is_enabled);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (isError) {
    return <QueryError subject="automations" onRetry={() => refetch()} />;
  }

  if (fireCountsError || historyLogError) {
    return <QueryError subject="automation fire counts" />;
  }

  if (!organization?.id) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* ACTIVE AUTOMATIONS */}
      <div className="space-y-4">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <Zap className="w-5 h-5 text-primary" />
          Active Automations
        </h2>
        {activeAutos.length === 0 ? (
          <Card><CardContent className="py-8 text-center text-muted-foreground">No active automations. Enable one below to get started.</CardContent></Card>
        ) : (
          <div className="space-y-3">
            {activeAutos.map((auto) => {
              const meta = activeAutomationsMeta[auto.automation_type];
              const Icon = meta?.icon ?? Zap;
              const counts = (fireCounts as Record<string, { total: number; lastFired: string | null }>)[auto.automation_type];
              const isReminder = auto.automation_type === 'appointment_reminder';
              const isExpanded = expandedCard === auto.id;

              return (
                <Card key={auto.id} className="overflow-hidden">
                  <CardContent className="p-4">
                    <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 sm:gap-4">
                      <div className="flex items-start gap-3 flex-1 min-w-0">
                        <div className={`p-2.5 rounded-xl bg-muted ${meta?.color ?? 'text-primary'} flex-shrink-0`}>
                          <Icon className="w-5 h-5" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            {meta?.emoji && <span className="text-sm">{meta.emoji}</span>}
                            <h3 className="font-semibold text-foreground">{formatName(auto.automation_type)}</h3>
                          </div>
                          <p className="text-sm text-muted-foreground mt-1">{meta?.description ?? 'Automation enabled'}</p>
                          <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground flex-wrap">
                            {counts?.lastFired && (
                              <span>Last fired: {format(new Date(counts.lastFired), 'MMM d, yyyy')}</span>
                            )}
                            <span>Fired {counts?.total || 0}x total</span>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0 justify-end sm:self-start">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setEditing({ key: auto.automation_type, name: formatName(auto.automation_type) })}
                        >
                          <Pencil className="w-3.5 h-3.5 mr-1" /> Edit
                        </Button>
                        <Switch
                          checked={auto.is_enabled}
                          onCheckedChange={(checked) => toggleMutation.mutate({ id: auto.id, is_enabled: checked })}
                          className="scale-110"
                        />
                      </div>

                    </div>

                    {isReminder && (
                      <>
                        <Button
                          variant="outline"
                          size="sm"
                          className="w-full gap-2 mt-3"
                          onClick={() => setExpandedCard(isExpanded ? null : auto.id)}
                        >
                          {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                          {isExpanded ? 'Hide Schedule' : 'Edit Reminder Schedule'}
                        </Button>
                        {isExpanded && organization?.id && (
                          <AppointmentReminderSettings organizationId={organization.id} />
                        )}
                      </>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      {/* INACTIVE / AVAILABLE AUTOMATIONS FROM DB */}
      {inactiveAutos.length > 0 && (
        <div className="space-y-4">
          <h2 className="text-lg font-semibold text-muted-foreground">Disabled Automations</h2>
          <div className="space-y-3">
            {inactiveAutos.map((auto) => {
              const meta = activeAutomationsMeta[auto.automation_type];
              const Icon = meta?.icon ?? Zap;
              return (
                <Card key={auto.id} className="opacity-70 hover:opacity-100 transition-opacity">
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between gap-4">
                      <div className="flex items-center gap-3">
                        <div className={`p-2.5 rounded-xl bg-muted ${meta?.color ?? 'text-primary'}`}>
                          <Icon className="w-5 h-5" />
                        </div>
                        <div>
                          <h3 className="font-semibold text-foreground">{formatName(auto.automation_type)}</h3>
                          <p className="text-sm text-muted-foreground">{meta?.description ?? 'Automation disabled'}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setEditing({ key: auto.automation_type, name: formatName(auto.automation_type) })}
                        >
                          <Pencil className="w-3.5 h-3.5 mr-1" /> Edit
                        </Button>
                        <Switch
                          checked={false}
                          onCheckedChange={() => toggleMutation.mutate({ id: auto.id, is_enabled: true })}
                        />
                      </div>

                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
      )}

      {/* AVAILABLE (not yet created) */}
      <div className="space-y-4">
        <h2 className="text-lg font-semibold text-muted-foreground">Available Automations</h2>
        <p className="text-sm text-muted-foreground">Coming soon — these automations are not yet enabled for your account.</p>
        <div className="grid gap-3 md:grid-cols-2">
          {availableAutomations.map((auto) => {
            const Icon = auto.icon;
            return (
              <Card key={auto.id} className="opacity-60">
                <CardContent className="p-4">
                  <div className="flex items-center gap-3">
                    <div className="p-2.5 rounded-xl bg-muted text-muted-foreground flex-shrink-0">
                      <Icon className="w-5 h-5" />
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm">{auto.emoji}</span>
                        <h3 className="font-medium text-foreground">{auto.name}</h3>
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">{auto.description}</p>
                    </div>
                    <Badge variant="outline" className="text-xs flex-shrink-0">Coming Soon</Badge>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>

      {/* AUTOMATION HISTORY LOG */}
      <div className="space-y-4">
        <h2 className="text-lg font-semibold">Automation History</h2>
        {historyLog.length === 0 ? (
          <Card><CardContent className="py-8 text-center text-muted-foreground">No automation history yet.</CardContent></Card>
        ) : (
          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Automation</TableHead>
                      <TableHead>Client</TableHead>
                      <TableHead>Message</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {historyLog.slice(0, 25).map((log, i) => (
                      <TableRow key={i}>
                        <TableCell className="text-xs whitespace-nowrap">
                          <OrgTimestamp value={log.date} />
                        </TableCell>
                        <TableCell className="font-medium text-sm">{log.automationName}</TableCell>
                        <TableCell className="text-sm">{log.clientName}</TableCell>
                        <TableCell className="text-xs text-muted-foreground max-w-[200px] truncate">{log.messagePreview}</TableCell>
                        <TableCell>
                          <Badge
                            variant={log.status === 'delivered' ? 'default' : log.status === 'failed' ? 'destructive' : 'secondary'}
                            className="text-xs"
                          >
                            {log.status === 'delivered' ? '✅ Delivered' : log.status === 'failed' ? '❌ Failed' : '⏳ Pending'}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
      {editing && organization?.id && (
        <AutomationEditorDialog
          open={!!editing}
          onOpenChange={(v) => !v && setEditing(null)}
          organizationId={organization.id}
          automationKey={editing.key}
          automationName={editing.name}
        />
      )}
    </div>
  );
}

