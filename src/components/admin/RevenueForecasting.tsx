import { useMemo, useState } from 'react';
import { BookingWithDetails } from '@/hooks/useBookings';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { 
  LineChart, 
  Line, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  Legend,
  Area,
  AreaChart,
  ComposedChart,
  Bar
} from 'recharts';
import { TrendingUp, TrendingDown, Calendar, DollarSign, Target, AlertTriangle } from 'lucide-react';
import { fmt } from '@/lib/activeCurrency';
import { 
  format, 
  addMonths, 
  subMonths, 
  startOfMonth, 
  endOfMonth, 
  eachMonthOfInterval,
  isWithinInterval,
  differenceInMonths
} from 'date-fns';
import { orgEndOfMonth, orgStartOfMonth, orgYMD } from '@/lib/orgDateRange';
import { useOrgTimezone } from '@/hooks/useOrgTimezone';

interface RevenueForecastingProps {
  bookings: BookingWithDetails[];
  recurringBookings?: { total_amount: number; frequency: string; is_active: boolean }[];
}

interface MonthlyData {
  month: string;
  actual: number;
  forecast?: number;
  lowerBound?: number;
  upperBound?: number;
  isProjected: boolean;
}

interface SeasonalFactor {
  month: number;
  factor: number;
}

export function RevenueForecasting({ bookings, recurringBookings = [] }: RevenueForecastingProps) {
  const { timezone: orgTimezone } = useOrgTimezone();
  const [forecastMonths, setForecastMonths] = useState(6);

  // Calculate historical monthly data
  const historicalData = useMemo(() => {
    // Month edges in ORG time. eachMonthOfInterval still walks the calendar,
    // but each bucket's bounds are resolved against the business's midnight —
    // otherwise a booking in the first or last hours of a month was counted in
    // the neighbouring one, which silently reshapes the trend the forecast is
    // extrapolating from.
    const startDate = orgStartOfMonth(subMonths(new Date(), 12), orgTimezone);
    const endDate = orgEndOfMonth(new Date(), orgTimezone);
    /* eslint-disable-next-line local/no-device-local-dates -- chart bucket geometry over an org-resolved span */
    const months = eachMonthOfInterval({ start: startDate, end: endDate });

    return months.map(rawMonth => {
      const monthStart = orgStartOfMonth(rawMonth, orgTimezone);
      const monthEnd = orgEndOfMonth(rawMonth, orgTimezone);
      const monthBookings = bookings.filter(b => 
        b.status !== 'cancelled' &&
        isWithinInterval(new Date(b.scheduled_at), { start: monthStart, end: monthEnd })
      );

      return {
        date: monthStart,
        month: format(monthStart, 'MMM yyyy'),
        shortMonth: format(monthStart, 'MMM'),
        revenue: monthBookings.reduce((sum, b) => sum + Number(b.total_amount || 0), 0),
        bookings: monthBookings.length,
        avgBookingValue: monthBookings.length > 0 
          ? monthBookings.reduce((sum, b) => sum + Number(b.total_amount || 0), 0) / monthBookings.length 
          : 0
      };
    });
  }, [bookings, orgTimezone]);

  // Calculate seasonal factors
  const seasonalFactors = useMemo((): SeasonalFactor[] => {
    const monthTotals: { [key: number]: { sum: number; count: number } } = {};
    
    historicalData.forEach(d => {
      /* eslint-disable-next-line local/no-device-local-dates -- bucket label */
      const month = d.date.getMonth();
      if (!monthTotals[month]) {
        monthTotals[month] = { sum: 0, count: 0 };
      }
      monthTotals[month].sum += d.revenue;
      monthTotals[month].count += 1;
    });

    const avgMonthlyRevenue = historicalData.reduce((sum, d) => sum + d.revenue, 0) / Math.max(historicalData.length, 1);

    return Array.from({ length: 12 }, (_, i) => {
      const monthData = monthTotals[i];
      if (!monthData || monthData.count === 0) return { month: i, factor: 1 };
      const monthAvg = monthData.sum / monthData.count;
      return {
        month: i,
        factor: avgMonthlyRevenue > 0 ? monthAvg / avgMonthlyRevenue : 1
      };
    });
  }, [historicalData]);

  // Calculate recurring revenue
  const recurringMonthlyRevenue = useMemo(() => {
    return recurringBookings
      .filter(r => r.is_active)
      .reduce((sum, r) => {
        const amount = Number(r.total_amount || 0);
        switch (r.frequency) {
          case 'weekly': return sum + (amount * 4.33);
          case 'biweekly': return sum + (amount * 2.17);
          case 'triweekly': return sum + (amount * 1.44);
          case 'anyday': return sum + (amount * 2); // Estimate ~2x/month for Airbnb
          case 'monthly': return sum + amount;
          default: return sum;
        }
      }, 0);
  }, [recurringBookings]);

  // Generate forecast
  const forecastData = useMemo((): MonthlyData[] => {
    const recentMonths = historicalData.slice(-6);
    if (recentMonths.length === 0) return [];

    // Calculate trend using linear regression
    const n = recentMonths.length;
    const sumX = recentMonths.reduce((sum, _, i) => sum + i, 0);
    const sumY = recentMonths.reduce((sum, d) => sum + d.revenue, 0);
    const sumXY = recentMonths.reduce((sum, d, i) => sum + (i * d.revenue), 0);
    const sumX2 = recentMonths.reduce((sum, _, i) => sum + (i * i), 0);

    const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX) || 0;
    const intercept = (sumY - slope * sumX) / n;

    // Calculate variance for confidence intervals
    const avgRevenue = sumY / n;
    const variance = recentMonths.reduce((sum, d) => sum + Math.pow(d.revenue - avgRevenue, 2), 0) / n;
    const stdDev = Math.sqrt(variance);

    // Build combined data
    const combined: MonthlyData[] = historicalData.map(d => ({
      month: d.shortMonth,
      actual: d.revenue,
      isProjected: false
    }));

    // Add forecast months
    for (let i = 1; i <= forecastMonths; i++) {
      const futureDate = addMonths(new Date(), i);
      /* eslint-disable-next-line local/no-device-local-dates -- bucket label */
    const monthIndex = futureDate.getMonth();
      const seasonalFactor = seasonalFactors[monthIndex]?.factor || 1;
      
      // Base forecast with trend + recurring + seasonal adjustment
      const trendValue = intercept + (slope * (n + i - 1));
      const baseForecast = Math.max(0, trendValue * seasonalFactor + recurringMonthlyRevenue * 0.3);
      
      // Confidence intervals widen over time
      const confidenceMultiplier = 1 + (i * 0.1);
      const uncertainty = stdDev * confidenceMultiplier;

      combined.push({
        month: format(futureDate, 'MMM'),
        actual: 0,
        forecast: Math.round(baseForecast),
        lowerBound: Math.round(Math.max(0, baseForecast - uncertainty)),
        upperBound: Math.round(baseForecast + uncertainty),
        isProjected: true
      });
    }

    return combined;
  }, [historicalData, forecastMonths, seasonalFactors, recurringMonthlyRevenue]);

  // Summary metrics
  const metrics = useMemo(() => {
    const lastMonth = historicalData[historicalData.length - 1];
    const previousMonth = historicalData[historicalData.length - 2];
    
    const monthOverMonth = lastMonth && previousMonth && previousMonth.revenue > 0
      ? ((lastMonth.revenue - previousMonth.revenue) / previousMonth.revenue) * 100
      : 0;

    const nextMonthForecast = forecastData.find(d => d.isProjected)?.forecast || 0;
    
    const threeMonthForecast = forecastData
      .filter(d => d.isProjected)
      .slice(0, 3)
      .reduce((sum, d) => sum + (d.forecast || 0), 0);

    // Get only the first 6 projected months for 6-month forecast
    const projectedMonths = forecastData.filter(d => d.isProjected);
    const sixMonthForecast = projectedMonths
      .slice(0, 6)
      .reduce((sum, d) => sum + (d.forecast || 0), 0);

    // Calculate YTD directly from bookings for accuracy (matches dashboard)
    const currentYear = orgYMD(new Date(), orgTimezone).y;
    const ytdRevenue = bookings
      .filter(b => 
        b.status !== 'cancelled' && 
        orgYMD(new Date(b.scheduled_at), orgTimezone).y === currentYear
      )
      .reduce((sum, b) => sum + Number(b.total_amount || 0), 0);

    // Growth trajectory
    const recentTrend = historicalData.slice(-3);
    const isGrowing = recentTrend.length >= 2 && 
      recentTrend[recentTrend.length - 1].revenue > recentTrend[0].revenue;

    return {
      currentMonthRevenue: lastMonth?.revenue || 0,
      monthOverMonth,
      nextMonthForecast,
      threeMonthForecast,
      sixMonthForecast,
      ytdRevenue,
      recurringMonthlyRevenue,
      isGrowing
    };
  }, [historicalData, forecastData, recurringMonthlyRevenue, bookings, orgTimezone]);

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10">
              <DollarSign className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">This Month</p>
              <p className="text-2xl font-bold">
                {`${fmt(metrics.currentMonthRevenue)}`}
              </p>
              <div className={`flex items-center gap-1 text-sm ${metrics.monthOverMonth >= 0 ? 'text-success' : 'text-destructive'}`}>
                {metrics.monthOverMonth >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                {`${Math.abs(metrics.monthOverMonth).toFixed(1)}%`} vs last month
              </div>
            </div>
          </div>
        </Card>

        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-success/10">
              <Target className="h-5 w-5 text-success" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Next Month Forecast</p>
              <p className="text-2xl font-bold">
                {`${fmt(metrics.nextMonthForecast)}`}
              </p>
            </div>
          </div>
        </Card>

        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-info/10">
              <Calendar className="h-5 w-5 text-info" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">3-Month Forecast</p>
              <p className="text-2xl font-bold">
                {`${fmt(metrics.threeMonthForecast)}`}
              </p>
            </div>
          </div>
        </Card>

        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-purple-500/10">
              <TrendingUp className="h-5 w-5 text-purple-500" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Recurring Revenue</p>
              <p className="text-2xl font-bold">
                {`${fmt(metrics.recurringMonthlyRevenue)}`}
              </p>
              <p className="text-xs text-muted-foreground">per month</p>
            </div>
          </div>
        </Card>
      </div>

      {/* Forecast Controls */}
      <Card className="p-4">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="font-semibold">Revenue Forecast</h3>
            <p className="text-sm text-muted-foreground">
              Based on historical trends, seasonality, and recurring bookings
            </p>
          </div>
          <div className="flex gap-2">
            {[3, 6, 12].map(months => (
              <Button
                key={months}
                variant={forecastMonths === months ? 'default' : 'outline'}
                size="sm"
                onClick={() => setForecastMonths(months)}
              >
                {months} months
              </Button>
            ))}
          </div>
        </div>

        <div className="h-[400px]">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={forecastData}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="month" />
              <YAxis tickFormatter={(v) => `$${v/1000}k`} />
              <Tooltip
                contentStyle={{
                  backgroundColor: 'hsl(var(--popover))',
                  border: '1px solid hsl(var(--border))',
                  borderRadius: '8px',
                }}
                formatter={(value: number, name: string) => [
                  `${fmt(value)}`,
                  name === 'actual' ? 'Actual' : name === 'forecast' ? 'Forecast' : name
                ]}
              />
              <Legend />
              
              {/* Confidence interval area */}
              <Area
                type="monotone"
                dataKey="upperBound"
                stroke="none"
                fill="hsl(var(--primary))"
                fillOpacity={0.1}
                name="Upper Bound"
              />
              <Area
                type="monotone"
                dataKey="lowerBound"
                stroke="none"
                fill="hsl(var(--background))"
                fillOpacity={1}
                name="Lower Bound"
              />
              
              {/* Actual revenue bars */}
              <Bar
                dataKey="actual"
                fill="hsl(var(--primary))"
                name="Actual Revenue"
                radius={[4, 4, 0, 0]}
              />
              
              {/* Forecast line */}
              <Line
                type="monotone"
                dataKey="forecast"
                stroke="hsl(var(--success))"
                strokeWidth={2}
                strokeDasharray="5 5"
                name="Forecast"
                dot={{ fill: 'hsl(var(--success))' }}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </Card>

      {/* Insights */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Seasonal Patterns */}
        <Card className="p-4">
          <h3 className="font-semibold mb-4">Seasonal Patterns</h3>
          <div className="h-[250px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={seasonalFactors.map((s, i) => ({
                month: format(new Date(2024, i, 1), 'MMM'),
                factor: s.factor * 100
              }))}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="month" />
                <YAxis tickFormatter={(v) => `${v}%`} domain={[50, 150]} />
                <Tooltip formatter={(v: number) => [`${v.toFixed(0)}%`, 'Seasonal Factor']} />
                <Area 
                  type="monotone" 
                  dataKey="factor" 
                  stroke="hsl(var(--primary))" 
                  fill="hsl(var(--primary))" 
                  fillOpacity={0.3}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <p className="text-sm text-muted-foreground mt-2">
            Shows relative revenue performance by month (100% = average)
          </p>
        </Card>

        {/* Key Insights */}
        <Card className="p-4">
          <h3 className="font-semibold mb-4">Key Insights</h3>
          <div className="space-y-4">
            <div className="flex items-start gap-3 p-3 rounded-lg bg-muted/50">
              <div className={`p-2 rounded-lg ${metrics.isGrowing ? 'bg-success/10' : 'bg-warning/10'}`}>
                {metrics.isGrowing ? (
                  <TrendingUp className="h-4 w-4 text-success" />
                ) : (
                  <TrendingDown className="h-4 w-4 text-warning" />
                )}
              </div>
              <div>
                <p className="font-medium">Revenue Trend</p>
                <p className="text-sm text-muted-foreground">
                  {metrics.isGrowing 
                    ? 'Your revenue is on an upward trajectory based on recent months.'
                    : 'Revenue has been declining. Consider promotions or outreach campaigns.'}
                </p>
              </div>
            </div>

            <div className="flex items-start gap-3 p-3 rounded-lg bg-muted/50">
              <div className="p-2 rounded-lg bg-info/10">
                <Calendar className="h-4 w-4 text-info" />
              </div>
              <div>
                <p className="font-medium">YTD Revenue</p>
                <p className="text-sm text-muted-foreground">
                  {`${fmt(metrics.ytdRevenue)}`} earned this year
                </p>
              </div>
            </div>

            <div className="flex items-start gap-3 p-3 rounded-lg bg-muted/50">
              <div className="p-2 rounded-lg bg-purple-500/10">
                <Target className="h-4 w-4 text-purple-500" />
              </div>
              <div>
                <p className="font-medium">6-Month Projection</p>
                <p className="text-sm text-muted-foreground">
                  Estimated {`${fmt(metrics.sixMonthForecast)}`} over the next 6 months
                </p>
              </div>
            </div>

            {metrics.recurringMonthlyRevenue > 0 && (
              <div className="flex items-start gap-3 p-3 rounded-lg bg-muted/50">
                <div className="p-2 rounded-lg bg-success/10">
                  <DollarSign className="h-4 w-4 text-success" />
                </div>
                <div>
                  <p className="font-medium">Recurring Revenue Base</p>
                  <p className="text-sm text-muted-foreground">
                    {`${fmt(metrics.recurringMonthlyRevenue)}`} guaranteed from recurring customers
                  </p>
                </div>
              </div>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
