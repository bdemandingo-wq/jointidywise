import { useMemo, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Trophy, TrendingUp, Phone, Target, DollarSign, ArrowUpDown } from 'lucide-react';
import { format, startOfWeek, endOfWeek, startOfMonth, endOfMonth, parseISO, eachWeekOfInterval, eachMonthOfInterval } from 'date-fns';
import { Button } from '@/components/ui/button';
import { Area, AreaChart, ResponsiveContainer } from 'recharts';
import { fmt } from '@/lib/activeCurrency';

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

interface AggregatedRow {
  label: string;
  sortKey: number;
  calls: number;
  deals: number;
  revenue: number;
  closeRate: number;
  coldOutreach: number;
  followups: number;
}

type SortField = 'label' | 'calls' | 'deals' | 'revenue' | 'closeRate' | 'coldOutreach' | 'followups';

interface PerformanceAnalyticsProps {
  entries: OperationsEntry[];
}

function Sparkline({ data, color }: { data: number[]; color: string }) {
  if (data.length < 2) return null;
  const chartData = data.map((v, i) => ({ v, i }));
  return (
    <div className="h-6 w-20">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={chartData} margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id={`spark-${color}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.3} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <Area type="monotone" dataKey="v" stroke={color} strokeWidth={1.5} fill={`url(#spark-${color})`} dot={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export function PerformanceAnalytics({ entries }: PerformanceAnalyticsProps) {
  const [weekSort, setWeekSort] = useState<{ field: SortField; dir: 'asc' | 'desc' }>({ field: 'label', dir: 'desc' });
  const [monthSort, setMonthSort] = useState<{ field: SortField; dir: 'asc' | 'desc' }>({ field: 'label', dir: 'desc' });

  const weeklyRows = useMemo((): AggregatedRow[] => {
    if (entries.length === 0) return [];
    const dates = entries.map(e => parseISO(e.track_date));
    const minDate = new Date(Math.min(...dates.map(d => d.getTime())));
    const maxDate = new Date(Math.max(...dates.map(d => d.getTime())));
    /* eslint-disable local/no-device-local-dates -- chart bucket geometry: the
       intervals spanning the data's own min/max, not a business-day boundary.
       Every bucket is labelled from the same series it slices, so a shifted
       edge moves a point between adjacent buckets at worst. Display only. */
    const weeks = eachWeekOfInterval({ start: minDate, end: maxDate }, { weekStartsOn: 1 });

    return weeks.map(weekStart => {
      const wEnd = endOfWeek(weekStart, { weekStartsOn: 1 });
      const weekEntries = entries.filter(e => {
        const d = parseISO(e.track_date);
        return d >= weekStart && d <= wEnd;
      });
      const calls = weekEntries.reduce((s, e) => s + e.incoming_calls, 0);
      const deals = weekEntries.reduce((s, e) => s + e.closed_deals, 0);
      const revenue = weekEntries.reduce((s, e) => s + Number(e.revenue_booked), 0);
      const coldOutreach = weekEntries.reduce((s, e) => s + e.cold_emails_sent + e.cold_calls_made, 0);
      const followups = weekEntries.reduce((s, e) => s + e.leads_followed_up, 0);
      return {
        label: `${format(weekStart, 'MMM d')} – ${format(wEnd, 'MMM d, yyyy')}`,
        sortKey: weekStart.getTime(),
        calls, deals, revenue,
        closeRate: calls > 0 ? (deals / calls) * 100 : 0,
        coldOutreach, followups,
      };
    }).filter(r => r.calls > 0 || r.deals > 0 || r.revenue > 0);
  }, [entries]);

  const monthlyRows = useMemo((): AggregatedRow[] => {
    if (entries.length === 0) return [];
    const dates = entries.map(e => parseISO(e.track_date));
    const minDate = startOfMonth(new Date(Math.min(...dates.map(d => d.getTime()))));
    const maxDate = endOfMonth(new Date(Math.max(...dates.map(d => d.getTime()))));
    const months = eachMonthOfInterval({ start: minDate, end: maxDate });

    return months.map(monthStart => {
      const mEnd = endOfMonth(monthStart);
      /* eslint-enable local/no-device-local-dates */
      const monthEntries = entries.filter(e => {
        const d = parseISO(e.track_date);
        return d >= monthStart && d <= mEnd;
      });
      const calls = monthEntries.reduce((s, e) => s + e.incoming_calls, 0);
      const deals = monthEntries.reduce((s, e) => s + e.closed_deals, 0);
      const revenue = monthEntries.reduce((s, e) => s + Number(e.revenue_booked), 0);
      const coldOutreach = monthEntries.reduce((s, e) => s + e.cold_emails_sent + e.cold_calls_made, 0);
      const followups = monthEntries.reduce((s, e) => s + e.leads_followed_up, 0);
      return {
        label: format(monthStart, 'MMMM yyyy'),
        sortKey: monthStart.getTime(),
        calls, deals, revenue,
        closeRate: calls > 0 ? (deals / calls) * 100 : 0,
        coldOutreach, followups,
      };
    }).filter(r => r.calls > 0 || r.deals > 0 || r.revenue > 0);
  }, [entries]);

  const allTimeBests = useMemo(() => {
    const bestRevWeek = [...weeklyRows].sort((a, b) => b.revenue - a.revenue)[0];
    const bestRevMonth = [...monthlyRows].sort((a, b) => b.revenue - a.revenue)[0];
    const bestCloseWeek = [...weeklyRows].filter(r => r.calls >= 3).sort((a, b) => b.closeRate - a.closeRate)[0];
    const bestCloseMonth = [...monthlyRows].filter(r => r.calls >= 3).sort((a, b) => b.closeRate - a.closeRate)[0];
    const mostCallsWeek = [...weeklyRows].sort((a, b) => b.calls - a.calls)[0];
    const mostDealsWeek = [...weeklyRows].sort((a, b) => b.deals - a.deals)[0];
    return { bestRevWeek, bestRevMonth, bestCloseWeek, bestCloseMonth, mostCallsWeek, mostDealsWeek };
  }, [weeklyRows, monthlyRows]);

  function sortRows(rows: AggregatedRow[], sort: { field: SortField; dir: 'asc' | 'desc' }) {
    return [...rows].sort((a, b) => {
      const av = sort.field === 'label' ? a.sortKey : a[sort.field];
      const bv = sort.field === 'label' ? b.sortKey : b[sort.field];
      return sort.dir === 'asc' ? (av as number) - (bv as number) : (bv as number) - (av as number);
    });
  }

  function toggleSort(current: { field: SortField; dir: 'asc' | 'desc' }, field: SortField, setter: (v: any) => void) {
    if (current.field === field) {
      setter({ field, dir: current.dir === 'asc' ? 'desc' : 'asc' });
    } else {
      setter({ field, dir: 'desc' });
    }
  }

  const SortHeader = ({ label, field, sort, setter }: { label: string; field: SortField; sort: { field: SortField; dir: 'asc' | 'desc' }; setter: (v: any) => void }) => (
    <Button variant="ghost" size="sm" className="h-auto p-0 font-medium text-xs hover:bg-transparent gap-1" onClick={() => toggleSort(sort, field, setter)}>
      {label}
      <ArrowUpDown className={`w-3 h-3 ${sort.field === field ? 'text-primary' : 'text-muted-foreground/50'}`} />
    </Button>
  );

  // Sparkline data for weekly rows (last 8 weeks revenue & close rate)
  const weeklySparkData = useMemo(() => {
    const sorted = [...weeklyRows].sort((a, b) => a.sortKey - b.sortKey);
    return {
      revenue: sorted.map(r => r.revenue),
      closeRate: sorted.map(r => r.closeRate),
    };
  }, [weeklyRows]);

  const monthlySparkData = useMemo(() => {
    const sorted = [...monthlyRows].sort((a, b) => a.sortKey - b.sortKey);
    return {
      revenue: sorted.map(r => r.revenue),
      closeRate: sorted.map(r => r.closeRate),
    };
  }, [monthlyRows]);

  function isBestRevenue(row: AggregatedRow, bestRow?: AggregatedRow) {
    return bestRow && row.sortKey === bestRow.sortKey && row.revenue > 0;
  }
  function isBestCloseRate(row: AggregatedRow, bestRow?: AggregatedRow) {
    return bestRow && row.sortKey === bestRow.sortKey && row.closeRate > 0;
  }

  const BestBadge = () => (
    <Trophy className="w-4 h-4 text-amber-500 inline ml-1" />
  );

  if (entries.length === 0) return null;

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold text-foreground flex items-center gap-2">
        <TrendingUp className="w-5 h-5" />
        Performance Analytics
      </h3>

      {/* All-Time Bests */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {[
          { title: 'Best Week (Rev)', value: allTimeBests.bestRevWeek ? fmt(allTimeBests.bestRevWeek.revenue) : '—', sub: allTimeBests.bestRevWeek?.label, icon: DollarSign },
          { title: 'Best Month (Rev)', value: allTimeBests.bestRevMonth ? fmt(allTimeBests.bestRevMonth.revenue) : '—', sub: allTimeBests.bestRevMonth?.label, icon: DollarSign },
          { title: 'Best Close % (Wk)', value: allTimeBests.bestCloseWeek ? `${allTimeBests.bestCloseWeek.closeRate.toFixed(1)}%` : '—', sub: allTimeBests.bestCloseWeek?.label, icon: Target },
          { title: 'Best Close % (Mo)', value: allTimeBests.bestCloseMonth ? `${allTimeBests.bestCloseMonth.closeRate.toFixed(1)}%` : '—', sub: allTimeBests.bestCloseMonth?.label, icon: Target },
          { title: 'Most Calls (Wk)', value: allTimeBests.mostCallsWeek ? `${allTimeBests.mostCallsWeek.calls}` : '—', sub: allTimeBests.mostCallsWeek?.label, icon: Phone },
          { title: 'Most Deals (Wk)', value: allTimeBests.mostDealsWeek ? `${allTimeBests.mostDealsWeek.deals}` : '—', sub: allTimeBests.mostDealsWeek?.label, icon: Target },
        ].map((card, i) => (
          <Card key={i} className="border-amber-500/20 bg-amber-500/5">
            <CardContent className="p-3">
              <div className="flex items-center gap-1.5 mb-1">
                <Trophy className="w-3.5 h-3.5 text-amber-500" />
                <span className="text-[10px] font-medium text-amber-600 dark:text-amber-400 uppercase tracking-wide">{card.title}</span>
              </div>
              <p className="text-lg font-bold">{card.value}</p>
              <p className="text-[10px] text-muted-foreground truncate">{card.sub || ''}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Tabs */}
      <Tabs defaultValue="weekly">
        <TabsList>
          <TabsTrigger value="weekly">Weekly View</TabsTrigger>
          <TabsTrigger value="monthly">Monthly View</TabsTrigger>
        </TabsList>

        <TabsContent value="weekly">
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead><SortHeader label="Week" field="label" sort={weekSort} setter={setWeekSort} /></TableHead>
                    <TableHead className="text-center"><SortHeader label="Calls" field="calls" sort={weekSort} setter={setWeekSort} /></TableHead>
                    <TableHead className="text-center"><SortHeader label="Deals" field="deals" sort={weekSort} setter={setWeekSort} /></TableHead>
                    <TableHead className="text-right"><SortHeader label="Revenue" field="revenue" sort={weekSort} setter={setWeekSort} /></TableHead>
                    <TableHead className="text-center"><SortHeader label="Close %" field="closeRate" sort={weekSort} setter={setWeekSort} /></TableHead>
                    <TableHead className="text-center"><SortHeader label="Outreach" field="coldOutreach" sort={weekSort} setter={setWeekSort} /></TableHead>
                    <TableHead className="text-center"><SortHeader label="Follow-ups" field="followups" sort={weekSort} setter={setWeekSort} /></TableHead>
                    <TableHead className="text-center hidden md:table-cell">Trend</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sortRows(weeklyRows, weekSort).map((row, idx) => (
                    <TableRow key={idx}>
                      <TableCell className="font-medium text-xs">{row.label}</TableCell>
                      <TableCell className="text-center">{row.calls}</TableCell>
                      <TableCell className="text-center">{row.deals}</TableCell>
                      <TableCell className="text-right font-medium">
                        {fmt(row.revenue)}
                        {isBestRevenue(row, allTimeBests.bestRevWeek) && <BestBadge />}
                      </TableCell>
                      <TableCell className="text-center">
                        {`${row.closeRate.toFixed(1)}%`}
                        {isBestCloseRate(row, allTimeBests.bestCloseWeek) && <BestBadge />}
                      </TableCell>
                      <TableCell className="text-center">{row.coldOutreach}</TableCell>
                      <TableCell className="text-center">{row.followups}</TableCell>
                      <TableCell className="hidden md:table-cell">
                        <div className="flex gap-1 items-center justify-center">
                          <Sparkline data={weeklySparkData.revenue.slice(-8)} color="hsl(142, 76%, 36%)" />
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                  {weeklyRows.length === 0 && (
                    <TableRow><TableCell colSpan={8} className="text-center py-6 text-muted-foreground">No weekly data yet.</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="monthly">
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead><SortHeader label="Month" field="label" sort={monthSort} setter={setMonthSort} /></TableHead>
                    <TableHead className="text-center"><SortHeader label="Calls" field="calls" sort={monthSort} setter={setMonthSort} /></TableHead>
                    <TableHead className="text-center"><SortHeader label="Deals" field="deals" sort={monthSort} setter={setMonthSort} /></TableHead>
                    <TableHead className="text-right"><SortHeader label="Revenue" field="revenue" sort={monthSort} setter={setMonthSort} /></TableHead>
                    <TableHead className="text-center"><SortHeader label="Close %" field="closeRate" sort={monthSort} setter={setMonthSort} /></TableHead>
                    <TableHead className="text-center"><SortHeader label="Outreach" field="coldOutreach" sort={monthSort} setter={setMonthSort} /></TableHead>
                    <TableHead className="text-center"><SortHeader label="Follow-ups" field="followups" sort={monthSort} setter={setMonthSort} /></TableHead>
                    <TableHead className="text-center hidden md:table-cell">Trend</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sortRows(monthlyRows, monthSort).map((row, idx) => (
                    <TableRow key={idx}>
                      <TableCell className="font-medium text-xs">{row.label}</TableCell>
                      <TableCell className="text-center">{row.calls}</TableCell>
                      <TableCell className="text-center">{row.deals}</TableCell>
                      <TableCell className="text-right font-medium">
                        {fmt(row.revenue)}
                        {isBestRevenue(row, allTimeBests.bestRevMonth) && <BestBadge />}
                      </TableCell>
                      <TableCell className="text-center">
                        {`${row.closeRate.toFixed(1)}%`}
                        {isBestCloseRate(row, allTimeBests.bestCloseMonth) && <BestBadge />}
                      </TableCell>
                      <TableCell className="text-center">{row.coldOutreach}</TableCell>
                      <TableCell className="text-center">{row.followups}</TableCell>
                      <TableCell className="hidden md:table-cell">
                        <div className="flex gap-1 items-center justify-center">
                          <Sparkline data={monthlySparkData.revenue.slice(-6)} color="hsl(142, 76%, 36%)" />
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                  {monthlyRows.length === 0 && (
                    <TableRow><TableCell colSpan={8} className="text-center py-6 text-muted-foreground">No monthly data yet.</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
