import { useState, useMemo, useEffect } from 'react';
import { QueryError } from '@/components/QueryError';
import { AdminLayout } from '@/components/admin/AdminLayout';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Calendar } from '@/components/ui/calendar';
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
import { Phone, Target, DollarSign, MessageSquare, Users, CheckCircle, Plus, Edit, Trash2, Download, TrendingUp, CalendarDays } from 'lucide-react';
import { PerformanceAnalytics } from '@/components/admin/PerformanceAnalytics';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';
import { format, startOfWeek, endOfWeek, isWithinInterval, parseISO, startOfMonth, endOfMonth, isSameDay, subDays } from 'date-fns';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useTestMode } from '@/contexts/TestModeContext';
import { cn } from '@/lib/utils';
import { matrixToCsv } from '@/lib/orgDataExport';
import { useOrganization } from '@/contexts/OrganizationContext';
import { SEOHead } from '@/components/SEOHead';
import { useOrgTimezone } from '@/hooks/useOrgTimezone';
import { orgStartOfWeek, orgEndOfWeek, orgStartOfMonth, orgEndOfMonth, orgDateKey, calendarDayKey } from '@/lib/orgDateRange';
import { confirmDialog } from "@/components/AppDialogs";
// Import functionality has been removed


interface OperationsEntry {
  id: string;
  track_date: string;
  incoming_calls: number;
  closed_deals: number;
  revenue_booked: number;
  cold_emails_sent: number;
  cold_calls_made: number;
  leads_followed_up: number;
  jobs_completed: number;
  notes: string | null;
}

export default function OperationsTrackerPage() {
  // Operations are logged against the BUSINESS's calendar day, and the weekly
  // and monthly rollups are its week and month.
  const { timezone: orgTimezone } = useOrgTimezone();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingEntry, setEditingEntry] = useState<OperationsEntry | null>(null);
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(new Date());
  
  const [dateRange, setDateRange] = useState<{ from: Date; to: Date }>({
    from: subDays(new Date(), 30),
    to: new Date()
  });
  const queryClient = useQueryClient();
  const { isTestMode, maskAmount } = useTestMode();
  const { organization } = useOrganization();

  const { data: entries = [], isLoading, error: entriesError } = useQuery({
    queryKey: ['operations-tracker', organization?.id],
    queryFn: async () => {
      if (!organization?.id) return [];
      const { data, error } = await supabase
        .from('operations_tracker')
        .select('*')
        .eq('organization_id', organization.id)
        .order('track_date', { ascending: false });
      if (error) throw error;
      return data as OperationsEntry[];
    },
    enabled: !!organization?.id,
  });

  const createMutation = useMutation({
    mutationFn: async (data: Omit<OperationsEntry, 'id'>) => {
      if (!organization?.id) {
        throw new Error('No organization found');
      }
      // Insert with organization_id
      const { error } = await supabase
        .from('operations_tracker')
        .insert([{ ...data, organization_id: organization.id }]);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['operations-tracker'] });
      toast.success('Entry saved');
      setDialogOpen(false);
    },
    onError: (error: any) => toast.error(error.message),
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, ...data }: Partial<OperationsEntry> & { id: string }) => {
      if (!organization?.id) throw new Error('No organization found');
      const { error } = await supabase.from('operations_tracker').update(data).eq('id', id).eq('organization_id', organization.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['operations-tracker'] });
      toast.success('Entry updated');
      setDialogOpen(false);
      setEditingEntry(null);
    },
    onError: (error: any) => toast.error(error.message),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      if (!organization?.id) throw new Error('No organization found');
      const { error } = await supabase.from('operations_tracker').delete().eq('id', id).eq('organization_id', organization.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['operations-tracker'] });
      toast.success('Entry deleted');
    },
    onError: (error: any) => toast.error(error.message),
  });

  // Calculate weekly and monthly stats
  const stats = useMemo(() => {
    const now = new Date();
    /*
      track_date is a DATE column — every entry is a plain calendar day. So the
      window is compared as calendar days too, which removes the parseISO round
      trip entirely: no instant is constructed, so none can be misplaced.

      What had to change is WHOSE week and month these are. startOfWeek(now) was
      the admin's, so on a Monday morning in Manila the "this week" totals were
      still showing the org's previous week — and at a month end the monthly
      figures rolled over a day early.
    */
    const weekStartKey = orgDateKey(orgStartOfWeek(now, orgTimezone, 1), orgTimezone);
    const weekEndKey = orgDateKey(orgEndOfWeek(now, orgTimezone, 1), orgTimezone);
    const monthStartKey = orgDateKey(orgStartOfMonth(now, orgTimezone), orgTimezone);
    const monthEndKey = orgDateKey(orgEndOfMonth(now, orgTimezone), orgTimezone);

    const weeklyEntries = entries.filter(
      e => e.track_date >= weekStartKey && e.track_date <= weekEndKey,
    );
    const monthlyEntries = entries.filter(
      e => e.track_date >= monthStartKey && e.track_date <= monthEndKey,
    );

    const weeklyTotals = weeklyEntries.reduce((acc, e) => ({
      calls: acc.calls + e.incoming_calls,
      deals: acc.deals + e.closed_deals,
      revenue: acc.revenue + Number(e.revenue_booked),
      coldEmails: acc.coldEmails + e.cold_emails_sent,
      coldCalls: acc.coldCalls + e.cold_calls_made,
      followups: acc.followups + e.leads_followed_up,
    }), { calls: 0, deals: 0, revenue: 0, coldEmails: 0, coldCalls: 0, followups: 0 });

    const monthlyTotals = monthlyEntries.reduce((acc, e) => ({
      calls: acc.calls + e.incoming_calls,
      deals: acc.deals + e.closed_deals,
      revenue: acc.revenue + Number(e.revenue_booked),
    }), { calls: 0, deals: 0, revenue: 0 });

    const weeklyCloseRate = weeklyTotals.calls > 0 
      ? ((weeklyTotals.deals / weeklyTotals.calls) * 100).toFixed(1) 
      : '0';
    const monthlyCloseRate = monthlyTotals.calls > 0 
      ? ((monthlyTotals.deals / monthlyTotals.calls) * 100).toFixed(1) 
      : '0';

    return { weeklyTotals, monthlyTotals, weeklyCloseRate, monthlyCloseRate };
  }, [entries, orgTimezone]);

  const exportToExcel = async () => {
    const headers = ['Date', 'Incoming Calls', 'Closed Deals', 'Revenue Booked', 'Cold Emails', 'Cold Calls', 'Leads Followed Up', 'Notes'];
    const rows = entries.map(e => [
      e.track_date,
      e.incoming_calls,
      e.closed_deals,
      e.revenue_booked,
      e.cold_emails_sent,
      e.cold_calls_made,
      e.leads_followed_up,
      e.notes || '',
    ]);

    // `notes` is free text. Wrapping in quotes without doubling the inner ones
    // meant a single " in a note truncated the field and shifted the row.
    const csvContent = matrixToCsv([headers, ...rows]);

    const { exportFile } = await import('@/lib/exportFile');
    await exportFile(`operations-tracker-${orgDateKey(new Date(), orgTimezone)}.csv`, csvContent, 'text/csv');
  };

  // Filter entries by date range
  const filteredEntries = useMemo(() => {
    return entries.filter(e => {
      const date = parseISO(e.track_date);
      return isWithinInterval(date, { start: dateRange.from, end: dateRange.to });
    });
  }, [entries, dateRange]);

  return (
    <AdminLayout
      title="Operations Tracker"
      subtitle="Track daily calls, deals, and revenue"
      actions={
        <div className="flex gap-2 flex-wrap">
      <SEOHead title="Operations | TidyWise" description="Track daily cleaning operations" noIndex />
          {/* Date Range Picker */}
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" className="gap-2">
                <CalendarDays className="w-4 h-4" />
                {format(dateRange.from, 'MMM d')} - {format(dateRange.to, 'MMM d, yyyy')}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="end">
              <Calendar
                mode="range"
                selected={{ from: dateRange.from, to: dateRange.to }}
                onSelect={(range) => {
                  if (range?.from && range?.to) {
                    setDateRange({ from: range.from, to: range.to });
                  } else if (range?.from) {
                    setDateRange({ from: range.from, to: range.from });
                  }
                }}
                numberOfMonths={2}
                className="pointer-events-auto"
              />
            </PopoverContent>
          </Popover>
          
          <Button variant="outline" onClick={exportToExcel} className="gap-2">
            <Download className="w-4 h-4" />
            Export
          </Button>
          <Button onClick={() => setDialogOpen(true)} className="gap-2">
            <Plus className="w-4 h-4" />
            Add Entry
          </Button>
        </div>
      }
    >
<div className="portal-v2 portal-v2-scroll">
      {/* Weekly Stats - This Week */}
      <div className="mb-6">
        <h3 className="text-sm font-medium text-muted-foreground mb-3 flex items-center gap-2">
          <CalendarDays className="w-4 h-4" />
          This Week's Performance
        </h3>
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <Phone className="w-4 h-4 text-blue-500" />
              <span className="text-xs text-muted-foreground">Weekly Calls</span>
            </div>
            <p className="text-2xl font-bold">{isTestMode ? 'XX' : stats.weeklyTotals.calls}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <Target className="w-4 h-4 text-green-500" />
              <span className="text-xs text-muted-foreground">Weekly Closes</span>
            </div>
            <p className="text-2xl font-bold">{isTestMode ? 'XX' : stats.weeklyTotals.deals}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <TrendingUp className="w-4 h-4 text-purple-500" />
              <span className="text-xs text-muted-foreground">Close Rate</span>
            </div>
            <p className="text-2xl font-bold">{isTestMode ? 'XX%' : `${stats.weeklyCloseRate}%`}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <DollarSign className="w-4 h-4 text-emerald-500" />
              <span className="text-xs text-muted-foreground">Weekly Rev</span>
            </div>
            <p className="text-2xl font-bold">{maskAmount(stats.weeklyTotals.revenue)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <MessageSquare className="w-4 h-4 text-orange-500" />
              <span className="text-xs text-muted-foreground">Cold Outreach</span>
            </div>
            <p className="text-2xl font-bold">{isTestMode ? 'XX' : stats.weeklyTotals.coldEmails}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <Users className="w-4 h-4 text-cyan-500" />
              <span className="text-xs text-muted-foreground">Follow-ups</span>
            </div>
            <p className="text-2xl font-bold">{isTestMode ? 'XX' : stats.weeklyTotals.followups}</p>
          </CardContent>
        </Card>
        </div>
      </div>

      {/* Calendar and Monthly Summary */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
        {/* Calendar */}
        <Card className="lg:col-span-1">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <CalendarDays className="w-4 h-4" />
              Select Date
            </CardTitle>
          </CardHeader>
          <CardContent className="flex justify-center">
            <Calendar
              mode="single"
              selected={selectedDate}
              onSelect={(date) => {
                setSelectedDate(date);
                if (date) {
                  // Both sides are calendar days (track_date is a DATE column, `date` is
                  // a picker token), so compare them as such.
                  const existingEntry = entries.find(e => e.track_date === calendarDayKey(date));
                  if (existingEntry) {
                    setEditingEntry(existingEntry);
                  } else {
                    setEditingEntry(null);
                  }
                  setDialogOpen(true);
                }
              }}
              className={cn("p-3 pointer-events-auto")}
              modifiers={{
                hasEntry: entries.map(e => parseISO(e.track_date)),
              }}
              modifiersStyles={{
                hasEntry: {
                  backgroundColor: 'hsl(var(--primary) / 0.15)',
                  fontWeight: 'bold',
                  borderRadius: '50%',
                },
              }}
            />
          </CardContent>
        </Card>

        {/* Monthly Summary */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Monthly Summary ({format(new Date(), 'MMMM yyyy')})</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="text-center p-4 bg-secondary/50 rounded-lg">
                <p className="text-3xl font-bold">{isTestMode ? 'XX' : stats.monthlyTotals.calls}</p>
                <p className="text-sm text-muted-foreground">Total Calls</p>
              </div>
              <div className="text-center p-4 bg-secondary/50 rounded-lg">
                <p className="text-3xl font-bold">{isTestMode ? 'XX' : stats.monthlyTotals.deals}</p>
                <p className="text-sm text-muted-foreground">Total Closes</p>
              </div>
              <div className="text-center p-4 bg-secondary/50 rounded-lg">
                <p className="text-3xl font-bold text-primary">{isTestMode ? 'XX%' : `${stats.monthlyCloseRate}%`}</p>
                <p className="text-sm text-muted-foreground">Close %</p>
              </div>
              <div className="text-center p-4 bg-secondary/50 rounded-lg">
                <p className="text-3xl font-bold text-emerald-600">{maskAmount(stats.monthlyTotals.revenue)}</p>
                <p className="text-sm text-muted-foreground">Total Revenue</p>
              </div>
            </div>
            
            {/* Selected Date Details */}
            {selectedDate && (
              <div className="mt-4 p-4 border rounded-lg">
                <h4 className="font-medium mb-2">{format(selectedDate, 'EEEE, MMMM d, yyyy')}</h4>
                {(() => {
                  const dayEntry = entries.find(e => e.track_date === calendarDayKey(selectedDate));
                  if (dayEntry) {
                    return (
                      <div className="grid grid-cols-3 gap-2 text-sm">
                        <div className="text-center p-2 bg-blue-50 dark:bg-blue-950 rounded">
                          <p className="font-bold">{isTestMode ? 'X' : dayEntry.incoming_calls}</p>
                          <p className="text-xs text-muted-foreground">Calls</p>
                        </div>
                        <div className="text-center p-2 bg-green-50 dark:bg-green-950 rounded">
                          <p className="font-bold">{isTestMode ? 'X' : dayEntry.closed_deals}</p>
                          <p className="text-xs text-muted-foreground">Deals</p>
                        </div>
                        <div className="text-center p-2 bg-emerald-50 dark:bg-emerald-950 rounded">
                          <p className="font-bold">{maskAmount(Number(dayEntry.revenue_booked))}</p>
                          <p className="text-xs text-muted-foreground">Revenue</p>
                        </div>
                      </div>
                    );
                  }
                  return <p className="text-sm text-muted-foreground">No entry for this date. Click to add one.</p>;
                })()}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Daily Entries Table */}
      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead className="text-center">Calls</TableHead>
                <TableHead className="text-center">Deals</TableHead>
                <TableHead className="text-right">Revenue</TableHead>
                <TableHead className="text-center">Cold Emails</TableHead>
                <TableHead className="text-center">Cold Calls</TableHead>
                <TableHead className="text-center">Follow-ups</TableHead>
                <TableHead className="w-[80px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center py-8">Loading...</TableCell>
                </TableRow>
              ) : entriesError ? (
                <TableRow>
                  <TableCell colSpan={8}>
                    <QueryError subject="operations data" onRetry={() => window.location.reload()} />
                  </TableCell>
                </TableRow>
              ) : filteredEntries.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                    No entries for this date range. Try adjusting the dates or add a new entry.
                  </TableCell>
                </TableRow>
              ) : (
                filteredEntries.map((entry) => (
                  <TableRow key={entry.id}>
                    <TableCell className="font-medium">
                      {format(parseISO(entry.track_date), 'EEE, MMM d')}
                    </TableCell>
                    <TableCell className="text-center">{isTestMode ? 'X' : entry.incoming_calls}</TableCell>
                    <TableCell className="text-center">{isTestMode ? 'X' : entry.closed_deals}</TableCell>
                    <TableCell className="text-right font-medium">{maskAmount(Number(entry.revenue_booked))}</TableCell>
                    <TableCell className="text-center">{isTestMode ? 'X' : entry.cold_emails_sent}</TableCell>
                    <TableCell className="text-center">{isTestMode ? 'X' : entry.cold_calls_made}</TableCell>
                    <TableCell className="text-center">{isTestMode ? 'X' : entry.leads_followed_up}</TableCell>
                    <TableCell>
                      <div className="flex gap-1">
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
                            void confirmDialog('Delete this entry?').then((ok) => {
                              if (ok) deleteMutation.mutate(entry.id);
                            });
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

      {/* Performance Analytics */}
      <PerformanceAnalytics entries={entries} />

      {/* Add/Edit Dialog */}
      <OperationsDialog
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) setEditingEntry(null);
        }}
        entry={editingEntry}
        defaultDate={selectedDate}
        onSave={(data) => {
          if (editingEntry) {
            updateMutation.mutate({ id: editingEntry.id, ...data });
          } else {
            createMutation.mutate(data as Omit<OperationsEntry, 'id'>);
          }
        }}
      />
    </div>
</AdminLayout>
  );
}

function OperationsDialog({
  open,
  onOpenChange,
  entry,
  defaultDate,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entry: OperationsEntry | null;
  defaultDate?: Date;
  onSave: (data: Partial<OperationsEntry>) => void;
}) {
  const { timezone: orgTimezone } = useOrgTimezone();
  const [formData, setFormData] = useState({
    track_date: '',
    incoming_calls: '0',
    closed_deals: '0',
    revenue_booked: '0',
    cold_emails_sent: '0',
    cold_calls_made: '0',
    leads_followed_up: '0',
    notes: '',
  });

  // Reset form when entry or defaultDate changes
  useEffect(() => {
    if (entry) {
      setFormData({
        track_date: entry.track_date,
        incoming_calls: entry.incoming_calls.toString(),
        closed_deals: entry.closed_deals.toString(),
        revenue_booked: entry.revenue_booked.toString(),
        cold_emails_sent: entry.cold_emails_sent.toString(),
        cold_calls_made: entry.cold_calls_made.toString(),
        leads_followed_up: entry.leads_followed_up.toString(),
        notes: entry.notes || '',
      });
    } else {
      setFormData({
        // defaultDate is a picker token; the fallback is "today", which must be
        // the BUSINESS's today — this writes to a DATE column with a UNIQUE
        // constraint, so an admin abroad could log a day's operations against
        // the wrong date and collide with, or duplicate, an existing row.
        track_date: defaultDate ? calendarDayKey(defaultDate) : orgDateKey(new Date(), orgTimezone),
        incoming_calls: '0',
        closed_deals: '0',
        revenue_booked: '0',
        cold_emails_sent: '0',
        cold_calls_made: '0',
        leads_followed_up: '0',
        notes: '',
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- orgTimezone is stable per session; form resets on entry/date/open change
  }, [entry, defaultDate, open]);

  const handleSubmit = () => {
    onSave({
      track_date: formData.track_date,
      incoming_calls: parseInt(formData.incoming_calls) || 0,
      closed_deals: parseInt(formData.closed_deals) || 0,
      revenue_booked: parseFloat(formData.revenue_booked) || 0,
      cold_emails_sent: parseInt(formData.cold_emails_sent) || 0,
      cold_calls_made: parseInt(formData.cold_calls_made) || 0,
      leads_followed_up: parseInt(formData.leads_followed_up) || 0,
      notes: formData.notes || null,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{entry ? 'Edit' : 'Add'} Daily Entry</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label>Date</Label>
            <Input
              type="date"
              value={formData.track_date}
              onChange={(e) => setFormData({ ...formData, track_date: e.target.value })}
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Incoming Calls</Label>
              <Input
                type="number"
                value={formData.incoming_calls}
                onChange={(e) => setFormData({ ...formData, incoming_calls: e.target.value })}
              />
            </div>
            <div>
              <Label>Closed Deals</Label>
              <Input
                type="number"
                value={formData.closed_deals}
                onChange={(e) => setFormData({ ...formData, closed_deals: e.target.value })}
              />
            </div>
          </div>
          <div>
            <Label>Revenue Booked ($)</Label>
            <Input
              type="number"
              step="0.01"
              value={formData.revenue_booked}
              onChange={(e) => setFormData({ ...formData, revenue_booked: e.target.value })}
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Cold Emails Sent</Label>
              <Input
                type="number"
                value={formData.cold_emails_sent}
                onChange={(e) => setFormData({ ...formData, cold_emails_sent: e.target.value })}
              />
            </div>
            <div>
              <Label>Cold Calls Made</Label>
              <Input
                type="number"
                value={formData.cold_calls_made}
                onChange={(e) => setFormData({ ...formData, cold_calls_made: e.target.value })}
              />
            </div>
          </div>
          <div>
            <Label>Leads Followed Up</Label>
            <Input
              type="number"
              value={formData.leads_followed_up}
              onChange={(e) => setFormData({ ...formData, leads_followed_up: e.target.value })}
            />
          </div>
          <div>
            <Label>Notes</Label>
            <Textarea
              value={formData.notes}
              onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
              rows={3}
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
