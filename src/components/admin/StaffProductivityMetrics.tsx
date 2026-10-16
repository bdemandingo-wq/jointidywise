import { useMemo } from 'react';
import { BookingWithDetails } from '@/hooks/useBookings';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  LineChart,
  Line,
  Legend,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Radar
} from 'recharts';
import { Clock, TrendingUp, Target, Award, Users, DollarSign, CheckCircle } from 'lucide-react';
import { differenceInMinutes, format, startOfWeek, eachWeekOfInterval, subMonths, isSameWeek } from 'date-fns';
import { fmt } from '@/lib/activeCurrency';

interface StaffProductivityMetricsProps {
  bookings: BookingWithDetails[];
  staff: { id: string; name: string; hourly_rate?: number | null; percentage_rate?: number | null }[];
}

interface StaffMetrics {
  id: string;
  name: string;
  completedJobs: number;
  totalRevenue: number;
  totalEarnings: number;
  avgJobDuration: number;
  onTimeRate: number | null;
  onTimeCheckins: number;
  avgRating: number;
  efficiency: number; // Revenue per hour
  jobsPerWeek: number;
  cancellationRate: number;
  productivityScore: number;
}

export function StaffProductivityMetrics({ bookings, staff }: StaffProductivityMetricsProps) {

  const staffMetrics = useMemo(() => {
    const metricsMap = new Map<string, StaffMetrics>();

    staff.forEach(s => {
      metricsMap.set(s.id, {
        id: s.id,
        name: s.name,
        completedJobs: 0,
        totalRevenue: 0,
        totalEarnings: 0,
        avgJobDuration: 0,
        onTimeRate: null,
        onTimeCheckins: 0,
        avgRating: 0,
        efficiency: 0,
        jobsPerWeek: 0,
        cancellationRate: 0,
        productivityScore: 0
      });
    });

    // Group bookings by staff
    const staffBookings = new Map<string, BookingWithDetails[]>();
    bookings.forEach(b => {
      if (b.staff?.id) {
        const existing = staffBookings.get(b.staff.id) || [];
        existing.push(b);
        staffBookings.set(b.staff.id, existing);
      }
    });

    // Calculate metrics for each staff member
    staffBookings.forEach((staffJobs, staffId) => {
      const metrics = metricsMap.get(staffId);
      if (!metrics) return;

      const completedJobs = staffJobs.filter(b => b.status === 'completed');
      const cancelledJobs = staffJobs.filter(b => b.status === 'cancelled');
      
      metrics.completedJobs = completedJobs.length;
      metrics.totalRevenue = completedJobs.reduce((sum, b) => sum + Number(b.total_amount || 0), 0);
      metrics.totalEarnings = completedJobs.reduce((sum, b) => sum + Number((b as any).cleaner_actual_payment || 0), 0);
      
      // Calculate average job duration (from check-in to check-out if available)
      const jobsWithTime = completedJobs.filter(b => (b as any).cleaner_checkin_at && (b as any).cleaner_checkout_at);
      if (jobsWithTime.length > 0) {
        const totalMinutes = jobsWithTime.reduce((sum, b) => {
          const checkin = new Date((b as any).cleaner_checkin_at);
          const checkout = new Date((b as any).cleaner_checkout_at);
          return sum + differenceInMinutes(checkout, checkin);
        }, 0);
        metrics.avgJobDuration = totalMinutes / jobsWithTime.length;
      } else {
        metrics.avgJobDuration = completedJobs.reduce((sum, b) => sum + b.duration, 0) / Math.max(completedJobs.length, 1);
      }

      // Calculate efficiency (revenue per hour)
      const totalHours = (metrics.avgJobDuration * metrics.completedJobs) / 60;
      metrics.efficiency = totalHours > 0 ? metrics.totalRevenue / totalHours : 0;

      // Calculate jobs per week (last 12 weeks)
      const twelveWeeksAgo = subMonths(new Date(), 3);
      const recentJobs = completedJobs.filter(b => new Date(b.scheduled_at) > twelveWeeksAgo);
      metrics.jobsPerWeek = recentJobs.length / 12;

      // Cancellation rate
      const totalJobs = staffJobs.length;
      metrics.cancellationRate = totalJobs > 0 ? (cancelledJobs.length / totalJobs) * 100 : 0;

      // On-time rate: on time if the cleaner clocks in at or before the
      // scheduled start, or no more than 15 minutes late. Arriving early never
      // counts against them. Stays null when there are no clock-ins at all, so
      // "no data" is distinguishable from a perfect score.
      const jobsWithCheckin = completedJobs.filter(b => (b as any).cleaner_checkin_at);
      metrics.onTimeCheckins = jobsWithCheckin.length;
      if (jobsWithCheckin.length > 0) {
        const onTimeJobs = jobsWithCheckin.filter(b => {
          const scheduled = new Date(b.scheduled_at);
          const checkin = new Date((b as any).cleaner_checkin_at);
          return differenceInMinutes(checkin, scheduled) <= 15;
        });
        metrics.onTimeRate = (onTimeJobs.length / jobsWithCheckin.length) * 100;
      }

      // Productivity score = weighted average of the measured components.
      // When on-time has no clock-in data we drop that component and let the
      // remaining weights renormalize (divide by the weight actually present),
      // so a data gap neither rewards (as 100) nor punishes (as 0) — the score
      // reflects only what was measured.
      const scoreComponents: { score: number; weight: number }[] = [
        { score: Math.min(100, metrics.completedJobs * 2), weight: 0.25 },
        { score: Math.min(100, metrics.efficiency), weight: 0.25 },
        { score: 100 - metrics.cancellationRate, weight: 0.15 },
        { score: Math.min(100, metrics.jobsPerWeek * 20), weight: 0.15 },
      ];
      if (metrics.onTimeRate !== null) {
        scoreComponents.push({ score: metrics.onTimeRate, weight: 0.2 });
      }
      const totalWeight = scoreComponents.reduce((sum, c) => sum + c.weight, 0);
      metrics.productivityScore = Math.round(
        scoreComponents.reduce((sum, c) => sum + c.score * c.weight, 0) / totalWeight
      );
    });

    return Array.from(metricsMap.values())
      .filter(m => m.completedJobs > 0)
      .sort((a, b) => b.productivityScore - a.productivityScore);
  }, [bookings, staff]);

  const weeklyTrends = useMemo(() => {
    const startDate = subMonths(new Date(), 3);
    /* eslint-disable-next-line local/no-device-local-dates -- chart bucket geometry, display only */
    const weeks = eachWeekOfInterval({ start: startDate, end: new Date() });
    
    return weeks.map(weekStart => {
      const weekBookings = bookings.filter(b => 
        b.status === 'completed' && 
        isSameWeek(new Date(b.scheduled_at), weekStart)
      );
      
      return {
        week: format(weekStart, 'MMM d'),
        jobs: weekBookings.length,
        revenue: weekBookings.reduce((sum, b) => sum + Number(b.total_amount || 0), 0),
        avgDuration: weekBookings.length > 0 
          ? weekBookings.reduce((sum, b) => sum + b.duration, 0) / weekBookings.length 
          : 0
      };
    });
  }, [bookings]);

  const teamAverages = useMemo(() => {
    if (staffMetrics.length === 0) return {
      avgJobs: 0, avgRevenue: 0, avgEfficiency: 0, avgOnTime: null as number | null, avgScore: 0
    };

    // Only staff who have clock-in data count toward the team on-time rate,
    // so staff with none don't inflate it. null when nobody has clock-in data.
    const withOnTime = staffMetrics.filter(s => s.onTimeRate !== null);

    return {
      avgJobs: staffMetrics.reduce((sum, s) => sum + s.completedJobs, 0) / staffMetrics.length,
      avgRevenue: staffMetrics.reduce((sum, s) => sum + s.totalRevenue, 0) / staffMetrics.length,
      avgEfficiency: staffMetrics.reduce((sum, s) => sum + s.efficiency, 0) / staffMetrics.length,
      avgOnTime: withOnTime.length > 0
        ? withOnTime.reduce((sum, s) => sum + (s.onTimeRate as number), 0) / withOnTime.length
        : null,
      avgScore: staffMetrics.reduce((sum, s) => sum + s.productivityScore, 0) / staffMetrics.length
    };
  }, [staffMetrics]);

  const topPerformer = staffMetrics[0];
  
  const radarData = topPerformer ? [
    { metric: 'Jobs', value: Math.min(100, topPerformer.completedJobs * 2) },
    { metric: 'Efficiency', value: Math.min(100, topPerformer.efficiency) },
    // Drop the On-Time axis when the top performer has no clock-in data,
    // mirroring the score's renormalization rather than showing a fake 100.
    ...(topPerformer.onTimeRate !== null
      ? [{ metric: 'On-Time', value: topPerformer.onTimeRate }]
      : []),
    { metric: 'Consistency', value: 100 - topPerformer.cancellationRate },
    { metric: 'Frequency', value: Math.min(100, topPerformer.jobsPerWeek * 20) },
  ] : [];

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10">
              <Users className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Active Staff</p>
              <p className="text-2xl font-bold">{staffMetrics.length}</p>
            </div>
          </div>
        </Card>

        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-success/10">
              <CheckCircle className="h-5 w-5 text-success" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Avg Jobs/Staff</p>
              <p className="text-2xl font-bold">{teamAverages.avgJobs.toFixed(0)}</p>
            </div>
          </div>
        </Card>

        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-info/10">
              <DollarSign className="h-5 w-5 text-info" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Avg Efficiency</p>
              <p className="text-2xl font-bold">{`${fmt(teamAverages.avgEfficiency)}/hr`}</p>
            </div>
          </div>
        </Card>

        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-warning/10">
              <Clock className="h-5 w-5 text-warning" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">On-Time Rate</p>
              <p className="text-2xl font-bold">
                {teamAverages.avgOnTime === null ? '—' : `${teamAverages.avgOnTime.toFixed(0)}%`}
              </p>
            </div>
          </div>
        </Card>

        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-purple-500/10">
              <Target className="h-5 w-5 text-purple-500" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Team Score</p>
              <p className="text-2xl font-bold">{teamAverages.avgScore.toFixed(0)}</p>
            </div>
          </div>
        </Card>
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Weekly Trends */}
        <Card className="p-4">
          <h3 className="font-semibold mb-4">Weekly Team Performance</h3>
          <div className="h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={weeklyTrends}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="week" fontSize={12} />
                <YAxis yAxisId="left" tickFormatter={(v) => `$${v/1000}k`} />
                <YAxis yAxisId="right" orientation="right" />
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'hsl(var(--popover))',
                    border: '1px solid hsl(var(--border))',
                    borderRadius: '8px',
                  }}
                />
                <Legend />
                <Line yAxisId="left" type="monotone" dataKey="revenue" stroke="hsl(var(--primary))" name="Revenue" strokeWidth={2} />
                <Line yAxisId="right" type="monotone" dataKey="jobs" stroke="hsl(var(--success))" name="Jobs" strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>

        {/* Top Performer Radar */}
        <Card className="p-4">
          <h3 className="font-semibold mb-4">
            Top Performer: {topPerformer ? topPerformer.name : 'N/A'}
          </h3>
          <div className="h-[300px]">
            {radarData.length === 0 ? (
              <div className="flex items-center justify-center h-full text-muted-foreground">
                No performance data available
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <RadarChart data={radarData}>
                  <PolarGrid stroke="hsl(var(--border))" />
                  <PolarAngleAxis dataKey="metric" fontSize={12} />
                  <PolarRadiusAxis angle={30} domain={[0, 100]} />
                  <Radar
                    name="Performance"
                    dataKey="value"
                    stroke="hsl(var(--primary))"
                    fill="hsl(var(--primary))"
                    fillOpacity={0.3}
                  />
                </RadarChart>
              </ResponsiveContainer>
            )}
          </div>
        </Card>
      </div>

      {/* Staff Productivity Table */}
      <Card className="p-4">
        <h3 className="font-semibold mb-4">Staff Productivity Rankings</h3>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="text-left border-b border-border">
                <th className="pb-3 font-medium text-muted-foreground">Rank</th>
                <th className="pb-3 font-medium text-muted-foreground">Staff Member</th>
                <th className="pb-3 font-medium text-muted-foreground text-right">Jobs</th>
                <th className="pb-3 font-medium text-muted-foreground text-right">Revenue</th>
                <th className="pb-3 font-medium text-muted-foreground text-right">Efficiency</th>
                <th className="pb-3 font-medium text-muted-foreground text-right">On-Time</th>
                <th className="pb-3 font-medium text-muted-foreground text-right">Jobs/Week</th>
                <th className="pb-3 font-medium text-muted-foreground text-right">Score</th>
              </tr>
            </thead>
            <tbody>
              {staffMetrics.map((staff, index) => (
                <tr key={staff.id} className="border-b border-border/50 last:border-0">
                  <td className="py-3">
                    <div className="flex items-center gap-2">
                      {index === 0 && <Award className="w-4 h-4 text-amber-500" />}
                      {index === 1 && <Award className="w-4 h-4 text-slate-400" />}
                      {index === 2 && <Award className="w-4 h-4 text-orange-600" />}
                      <span className="font-medium">#{index + 1}</span>
                    </div>
                  </td>
                  <td className="py-3 font-medium">{staff.name}</td>
                  <td className="py-3 text-right">{staff.completedJobs}</td>
                  <td className="py-3 text-right font-semibold text-success">
                    {`${fmt(staff.totalRevenue)}`}
                  </td>
                  <td className="py-3 text-right">
                    {`${fmt(staff.efficiency)}/hr`}
                  </td>
                  <td className="py-3 text-right">
                    {staff.onTimeRate === null ? (
                      <span className="text-muted-foreground" title="No clock-in data for this staff member">—</span>
                    ) : (
                      <div className="flex items-center justify-end gap-1.5">
                        <Badge variant={staff.onTimeRate >= 90 ? 'default' : staff.onTimeRate >= 75 ? 'secondary' : 'destructive'}>
                          {`${staff.onTimeRate.toFixed(0)}%`}
                        </Badge>
                        <span className="text-xs text-muted-foreground whitespace-nowrap">
                          {`(${staff.onTimeCheckins} of ${staff.completedJobs})`}
                        </span>
                      </div>
                    )}
                  </td>
                  <td className="py-3 text-right">{staff.jobsPerWeek.toFixed(1)}</td>
                  <td className="py-3 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <Progress value={staff.productivityScore} className="w-16 h-2" />
                      <span className="font-bold w-8">{staff.productivityScore}</span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
