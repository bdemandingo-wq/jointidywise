import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { TrendingUp, TrendingDown, DollarSign, Percent, CalendarIcon, Download } from 'lucide-react';
import { format, subMonths, startOfMonth, endOfMonth, isWithinInterval } from 'date-fns';
import { BookingWithDetails } from '@/hooks/useBookings';
import { cn } from '@/lib/utils';
import { matrixToCsv } from '@/lib/orgDataExport';
import { DateRange } from 'react-day-picker';
import { useTestMode } from '@/contexts/TestModeContext';
import { useOrgId } from '@/hooks/useOrgId';
import { supabase } from '@/lib/supabase';
import { saveBlob } from '@/lib/fileActions';
import { fmt } from '@/lib/activeCurrency';
import { QueryError } from '@/components/QueryError';
import { orgDateKey, orgEndOfDay, orgStartOfDay } from '@/lib/orgDateRange';
import { useOrgTimezone } from '@/hooks/useOrgTimezone';

interface ProfitMarginReportProps {
  bookings: BookingWithDetails[];
}

interface BookingProfit {
  id: string;
  bookingNumber: number;
  customerName: string;
  serviceName: string;
  scheduledAt: Date;
  revenue: number;
  cleanerPay: number;
  profit: number;
  marginPercent: number;
  status: string;
}

export function ProfitMarginReport({ bookings }: ProfitMarginReportProps) {
  const { organizationId } = useOrgId();
  const { timezone: orgTimezone } = useOrgTimezone();
  const [dateRange, setDateRange] = useState<DateRange | undefined>(undefined);
  const { isTestMode, maskName, maskAmount } = useTestMode();

  const completedBookingIds = useMemo(() => {
    return bookings
      .filter((b) => b.status === 'completed')
      .map((b) => b.id);
  }, [bookings]);

  const { data: teamPaysByBooking = new Map<string, number>(), error: teamPayError } = useQuery({
    queryKey: ['profit-margin-team-pay', organizationId, completedBookingIds.join(',')],
    queryFn: async () => {
      if (!organizationId || completedBookingIds.length === 0) return new Map<string, number>();

      // Fetch all team assignments with staff wage info
      const { data, error } = await supabase
        .from('booking_team_assignments')
        .select('booking_id, pay_share, staff_id, staff:staff(hourly_rate)')
        .eq('organization_id', organizationId)
        .in('booking_id', completedBookingIds);
      if (error) throw error;

      // Build a map of booking_id -> has team assignments
      const bookingTeamMap = new Map<string, any[]>();
      for (const row of data || []) {
        const bid = String((row as any).booking_id);
        if (!bookingTeamMap.has(bid)) bookingTeamMap.set(bid, []);
        bookingTeamMap.get(bid)!.push(row);
      }

      // For each booking with team assignments, sum up labor cost
      const map = new Map<string, number>();
      for (const [bid, members] of bookingTeamMap) {
        let totalPay = 0;
        let hasAnyPay = false;
        for (const m of members) {
          const payShare = Number((m as any).pay_share);
          if (Number.isFinite(payShare) && payShare > 0) {
            totalPay += payShare;
            hasAnyPay = true;
          }
        }
        // Only set if we found pay data for at least one member
        if (hasAnyPay) {
          map.set(bid, totalPay);
        }
      }
      return map;
    },
    enabled: !!organizationId && completedBookingIds.length > 0,
    staleTime: 1000 * 60 * 10,
  });

  const profitData = useMemo(() => {
    return bookings
      .map((booking): BookingProfit => {
        const revenue = Number(booking.total_amount || 0);
        const bookingAny = booking as any;

        // Team cleanings: if pay_share totals exist, use them as labor cost
        const teamPay = teamPaysByBooking.get(booking.id);

        let cleanerPay = 0;
        if (teamPay != null && teamPay > 0) {
          cleanerPay = teamPay;
        } else if (bookingAny.cleaner_actual_payment != null) {
          cleanerPay = Number(bookingAny.cleaner_actual_payment);
        } else if (bookingAny.cleaner_wage) {
          const wage = Number(bookingAny.cleaner_wage);
          const wageType = bookingAny.cleaner_wage_type || 'hourly';

          if (wageType === 'flat') {
            cleanerPay = wage;
          } else if (wageType === 'percentage') {
            cleanerPay = (revenue * wage) / 100;
          } else {
            const hours = bookingAny.cleaner_override_hours || (booking.duration / 60);
            cleanerPay = wage * hours;
          }
        }

        const profit = revenue - cleanerPay;
        const marginPercent = revenue > 0 ? (profit / revenue) * 100 : 0;

        return {
          id: booking.id,
          bookingNumber: booking.booking_number,
          customerName: booking.customer
            ? `${booking.customer.first_name} ${booking.customer.last_name}`
            : 'Unknown',
          serviceName: booking.service?.name || 'Refund',
          scheduledAt: new Date(booking.scheduled_at),
          revenue,
          cleanerPay,
          profit,
          marginPercent,
          status: booking.status,
        };
      })
      .filter((b) => {
        if (b.status !== 'completed') return false;
        if (!dateRange?.from) return true;

        // Org-day bounds, and note the END. This was
        //   isWithinInterval(x, { start: from, end: to || from })
        // so picking a SINGLE day produced a zero-width interval — start and
        // end both at that day's midnight — and matched only a booking at
        // exactly 00:00:00.000. One click on the calendar emptied the report.
        // Widening to end-of-day fixes that as well as the timezone.
        const start = orgStartOfDay(dateRange.from, orgTimezone);
        const end = orgEndOfDay(dateRange.to || dateRange.from, orgTimezone);
        return isWithinInterval(b.scheduledAt, { start, end });
      })
      .sort((a, b) => b.marginPercent - a.marginPercent);
  }, [bookings, dateRange, teamPaysByBooking, orgTimezone]);

  const summaryStats = useMemo(() => {
    const totalRevenue = profitData.reduce((sum, b) => sum + b.revenue, 0);
    const totalCleanerPay = profitData.reduce((sum, b) => sum + b.cleanerPay, 0);
    const totalProfit = totalRevenue - totalCleanerPay;
    const avgMargin = profitData.length > 0 
      ? profitData.reduce((sum, b) => sum + b.marginPercent, 0) / profitData.length 
      : 0;
    const mostProfitable = profitData[0];
    const leastProfitable = profitData[profitData.length - 1];

    return {
      totalRevenue,
      totalCleanerPay,
      totalProfit,
      avgMargin,
      mostProfitable,
      leastProfitable,
      totalJobs: profitData.length,
    };
  }, [profitData]);

  const getMarginColor = (margin: number) => {
    if (margin >= 50) return 'text-success';
    if (margin >= 30) return 'text-info';
    if (margin >= 15) return 'text-warning';
    return 'text-destructive';
  };

  const getMarginBadge = (margin: number) => {
    if (margin >= 50) return { label: 'Excellent', variant: 'bg-success/10 text-success' };
    if (margin >= 30) return { label: 'Good', variant: 'bg-info/10 text-info' };
    if (margin >= 15) return { label: 'Fair', variant: 'bg-warning/10 text-warning' };
    return { label: 'Low', variant: 'bg-destructive/10 text-destructive' };
  };

  const exportToCSV = () => {
    const headers = ['Booking #', 'Date', 'Customer', 'Service', 'Revenue', 'Cleaner Pay', 'Profit', 'Margin %'];
    const rows = profitData.map(item => [
      item.bookingNumber,
      // scheduledAt is an instant; the row's day belongs to the org.
      orgDateKey(new Date(item.scheduledAt), orgTimezone),
      item.customerName,
      item.serviceName,
      item.revenue.toFixed(2),
      item.cleanerPay.toFixed(2),
      item.profit.toFixed(2),
      item.marginPercent.toFixed(1),
    ]);

    // Service names carry commas. `.join(',')` split them into extra columns
    // and shifted every figure after, so a margin landed under the wrong header.
    const csvContent = matrixToCsv([headers, ...rows]);

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    /* eslint-disable-next-line local/no-device-local-dates -- names an export file with the downloader's own day; no org context here and nothing downstream reads it */
    void saveBlob(blob, `profit-margin-report-${format(new Date(), 'yyyy-MM-dd')}.csv`);
  };

  if (teamPayError) {
    return <QueryError subject="profit margin data" />;
  }

  return (
    <div className="space-y-6">
      {/* Date Range Selector */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" className="gap-2">
              <CalendarIcon className="w-4 h-4" />
              {dateRange?.from ? (
                dateRange.to ? (
                  <>
                    {format(dateRange.from, 'MMM d, yyyy')} - {format(dateRange.to, 'MMM d, yyyy')}
                  </>
                ) : (
                  format(dateRange.from, 'MMM d, yyyy')
                )
              ) : (
                'All Time'
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <Calendar
              mode="range"
              selected={dateRange}
              onSelect={setDateRange}
              numberOfMonths={2}
              initialFocus
            />
          </PopoverContent>
        </Popover>

        <Button variant="outline" onClick={exportToCSV} className="gap-2">
          <Download className="w-4 h-4" />
          Export CSV
        </Button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="border-border/50">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Total Revenue</p>
                <p className="text-2xl font-bold text-foreground">{isTestMode ? '$XXX' : `${fmt(summaryStats.totalRevenue)}`}</p>
              </div>
              <div className="p-2 rounded-lg bg-success/10">
                <DollarSign className="w-5 h-5 text-success" />
              </div>
            </div>
          </CardContent>
        </Card>
        
        <Card className="border-border/50">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Total Cleaner Pay</p>
                <p className="text-2xl font-bold text-foreground">{isTestMode ? '$XXX' : `${fmt(summaryStats.totalCleanerPay)}`}</p>
              </div>
              <div className="p-2 rounded-lg bg-info/10">
                <DollarSign className="w-5 h-5 text-info" />
              </div>
            </div>
          </CardContent>
        </Card>
        
        <Card className="border-border/50">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Net Profit</p>
                <p className="text-2xl font-bold text-foreground">{isTestMode ? '$XXX' : `${fmt(summaryStats.totalProfit)}`}</p>
              </div>
              <div className="p-2 rounded-lg bg-primary/10">
                <TrendingUp className="w-5 h-5 text-primary" />
              </div>
            </div>
          </CardContent>
        </Card>
        
        <Card className="border-border/50">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Avg Margin</p>
                <p className={cn("text-2xl font-bold", getMarginColor(summaryStats.avgMargin))}>
                  {summaryStats.avgMargin.toFixed(1)}%
                </p>
              </div>
              <div className="p-2 rounded-lg bg-warning/10">
                <Percent className="w-5 h-5 text-warning" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Most/Least Profitable */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {summaryStats.mostProfitable && (
          <Card className="border-success/20 bg-gradient-to-br from-success/5 to-transparent">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-success" />
                Most Profitable Job
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="font-semibold">{summaryStats.mostProfitable.serviceName}</p>
              <p className="text-sm text-muted-foreground">{maskName(summaryStats.mostProfitable.customerName)}</p>
              <div className="flex items-center gap-4 mt-2">
                <span className="text-lg font-bold text-success">{isTestMode ? 'XX.X%' : `${summaryStats.mostProfitable.marginPercent.toFixed(1)}%`}</span>
                <span className="text-sm text-muted-foreground">margin</span>
                <span className="text-sm text-foreground">{maskAmount(summaryStats.mostProfitable.profit)}</span>
              </div>
            </CardContent>
          </Card>
        )}
        
        {summaryStats.leastProfitable && summaryStats.totalJobs > 1 && (
          <Card className="border-destructive/20 bg-gradient-to-br from-destructive/5 to-transparent">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <TrendingDown className="w-4 h-4 text-destructive" />
                Least Profitable Job
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="font-semibold">{summaryStats.leastProfitable.serviceName}</p>
              <p className="text-sm text-muted-foreground">{maskName(summaryStats.leastProfitable.customerName)}</p>
              <div className="flex items-center gap-4 mt-2">
                <span className="text-lg font-bold text-destructive">{isTestMode ? 'XX.X%' : `${summaryStats.leastProfitable.marginPercent.toFixed(1)}%`}</span>
                <span className="text-sm text-muted-foreground">margin</span>
                <span className="text-sm text-foreground">{maskAmount(summaryStats.leastProfitable.profit)}</span>
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Detailed Table */}
      <Card className="border-border/50">
        <CardHeader>
          <CardTitle className="text-base">Profit by Booking ({profitData.length} jobs)</CardTitle>
        </CardHeader>
        <CardContent>
          {profitData.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No completed bookings with wage data in selected date range
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Booking #</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Service</TableHead>
                  <TableHead className="text-right">Revenue</TableHead>
                  <TableHead className="text-right">Cleaner Pay</TableHead>
                  <TableHead className="text-right">Profit</TableHead>
                  <TableHead className="text-right">Margin</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {profitData.map((item) => {
                  const badge = getMarginBadge(item.marginPercent);
                  return (
                    <TableRow key={item.id}>
                      <TableCell className="font-medium">#{item.bookingNumber}</TableCell>
                      <TableCell>{format(item.scheduledAt, 'MMM d, yyyy')}</TableCell>
                      <TableCell>{maskName(item.customerName)}</TableCell>
                      <TableCell>{item.serviceName}</TableCell>
                      <TableCell className="text-right">{maskAmount(item.revenue)}</TableCell>
                      <TableCell className="text-right text-muted-foreground">{maskAmount(item.cleanerPay)}</TableCell>
                      <TableCell className={cn("text-right font-semibold", getMarginColor(item.marginPercent))}>
                        {maskAmount(item.profit)}
                      </TableCell>
                      <TableCell className="text-right">
                        <Badge className={cn("font-medium", badge.variant)}>
                          {isTestMode ? 'XX.X%' : `${item.marginPercent.toFixed(1)}%`}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}