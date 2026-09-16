import { useState, useMemo, useRef, useEffect } from 'react';
import { QueryError } from '@/components/QueryError';
import { supabase } from '@/lib/supabase';
import { saveBlob } from '@/lib/fileActions';
import { matrixToCsv } from '@/lib/orgDataExport';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { format, startOfMonth, endOfMonth, startOfYear, subMonths, startOfWeek, endOfWeek } from 'date-fns';
import { orgDateKey, orgEndOfDay, orgEndOfMonth, orgEndOfWeek, orgStartOfMonth, orgStartOfWeek, orgStartOfYear } from '@/lib/orgDateRange';
import { CalendarIcon, Download, DollarSign, TrendingUp, Briefcase, FileText, Clock, CalendarDays } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { DateRange } from 'react-day-picker';
import { cn } from '@/lib/utils';
import { resolveCleanerPay, type WageBooking, type WageStaff } from '@/lib/wageCalculation';
import { fmt } from '@/lib/activeCurrency';

interface Props {
  staffId: string;
  staffName: string;
}

interface Booking extends WageBooking {
  id: string;
  booking_number: number;
  scheduled_at: string;
  status: string;
  service: { name: string } | null;
  customer: { first_name: string; last_name: string } | null;
}

interface TeamAssignment {
  booking_id: string;
  staff_id: string;
  pay_share: number | null;
  is_primary: boolean | null;
}

// Pay resolution lives in lib/wageCalculation.ts:resolveCleanerPay — the same
// call the job cards and admin Payroll make. Nothing pay-related is computed
// in this file.
const resolveEarnings = resolveCleanerPay;

export function CleanerEarnings({ staffId, staffName }: Props) {
  const [dateRange, setDateRange] = useState<DateRange | undefined>({
    // Placeholder; corrected by the effect below once the org's zone loads.
    /* eslint-disable-next-line local/no-device-local-dates -- provisional, replaced by the effect */
    from: startOfMonth(new Date()),
    /* eslint-disable-next-line local/no-device-local-dates -- ditto */
    to: endOfMonth(new Date()),
  });

  const { data: staffInfo, error: staffInfoError } = useQuery({
    queryKey: ['cleaner-wage-info', staffId],
    queryFn: async () => {
      // base_wage is not selectable from `staff` by `authenticated` any more
      // (managers must not read wages). A cleaner reads their OWN rates via
      // this SECURITY DEFINER RPC, which is scoped to user_id = auth.uid().
      const { data, error } = await (supabase as unknown as {
        rpc: (n: string, a: Record<string, unknown>) => {
          maybeSingle: () => Promise<{ data: unknown; error: unknown }>;
        };
      }).rpc('get_my_staff_wages', { _staff_id: staffId }).maybeSingle();
      if (error) throw error;
      return data as WageStaff & { organization_id: string | null };
    },
    enabled: !!staffId,
  });

  // Upcoming week bounds
  /**
   * The cleaner's own organisation's timezone.
   *
   * NOT useOrgTimezone(): that reads OrganizationContext, which resolves from
   * org_memberships — and a cleaner is a row in `staff`, not necessarily a
   * member. It would have quietly returned the America/New_York fallback for
   * every cleaner outside it, which is the same silent-default failure this
   * whole change exists to remove.
   *
   * Resolved from the staff row's organization_id instead. business_settings
   * is readable by anyone ("Anyone can view settings"), so a cleaner can see
   * their own employer's zone.
   */
  const { data: orgTimezone = 'America/New_York', error: timezoneError } = useQuery({
    queryKey: ['cleaner-org-timezone', staffInfo?.organization_id],
    enabled: !!staffInfo?.organization_id,
    staleTime: 1000 * 60 * 10,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('business_settings')
        .select('timezone')
        .eq('organization_id', staffInfo!.organization_id!)
        .maybeSingle();
      // A real fetch failure must NOT collapse into the same silent default as
      // "no business_settings row yet". Those are different situations: the
      // second is normal, the first means the cleaner is about to be shown
      // Eastern week boundaries with nothing on screen to say why. Throwing
      // puts it in react-query's error state (CLAUDE.md rule 5); the caller's
      // `= 'America/New_York'` default still covers the genuinely-absent case.
      if (error) throw error;
      return data?.timezone ?? 'America/New_York';
    },
  });

  // Org time. A cleaner in another timezone was seeing a different week than
  // their admin for the same payroll period, with nothing on screen to explain
  // why the two numbers differed.
  const fromISO = dateRange?.from?.toISOString();
  // dateRange.to is org-derived (see the effect below); setHours re-anchored it
  // to the CLEANER's end of day, so a cleaner east of the org lost the last
  // hours of their own earnings window and one west gained the next day's.
  const toISO = dateRange?.to ? orgEndOfDay(dateRange.to, orgTimezone).toISOString() : undefined;

  const upcomingWeekStart = orgStartOfWeek(new Date(), orgTimezone, 1);
  const upcomingWeekEnd = orgEndOfWeek(new Date(), orgTimezone, 1);

  // Fetch upcoming week bookings for this cleaner (all non-cancelled statuses)
  const { data: upcomingBookings = [], error: upcomingError } = useQuery({
    queryKey: ['cleaner-upcoming-week', staffId],
    queryFn: async () => {
      // upcomingWeekEnd is already org-resolved; its end of day is too.
      const wEnd = orgEndOfDay(upcomingWeekEnd, orgTimezone);
      const { data, error } = await supabase
        .from('bookings')
        .select(`
          id, booking_number, scheduled_at, duration, status, total_amount, subtotal, discount_amount,
          cleaner_actual_payment, cleaner_pay_expected, cleaner_wage, cleaner_wage_type,
          cleaner_checkin_at, cleaner_checkout_at, cleaner_override_hours,
          staff_id,
          service:services(name),
          customer:customers(first_name, last_name)
        `)
        .eq('staff_id', staffId)
        .neq('status', 'cancelled')
        .gte('scheduled_at', upcomingWeekStart.toISOString())
        .lte('scheduled_at', wEnd.toISOString())
        .order('scheduled_at', { ascending: true });
      if (error) throw error;
      return data as (Booking & { staff_id: string })[];
    },
    enabled: !!staffId,
  });

  // Team assignments for upcoming week
  const { data: upcomingTeamAssignments = [], error: upcomingTeamError } = useQuery({
    queryKey: ['cleaner-upcoming-team', staffId],
    queryFn: async () => {
      // upcomingWeekEnd is already org-resolved; its end of day is too.
      const wEnd = orgEndOfDay(upcomingWeekEnd, orgTimezone);
      // Find team assignments for this cleaner
      const { data: assignments, error: aErr } = await supabase
        .from('booking_team_assignments')
        .select('booking_id, staff_id, pay_share, is_primary')
        .eq('staff_id', staffId);
      if (aErr) throw aErr;
      if (!assignments?.length) return [];
      const bookingIds = assignments.map((a) => a.booking_id);
      const { data: bookings, error: bErr } = await supabase
        .from('bookings')
        .select(`
          id, booking_number, scheduled_at, duration, status, total_amount, subtotal, discount_amount,
          cleaner_actual_payment, cleaner_pay_expected, cleaner_wage, cleaner_wage_type,
          cleaner_checkin_at, cleaner_checkout_at, cleaner_override_hours,
          staff_id,
          service:services(name),
          customer:customers(first_name, last_name)
        `)
        .in('id', bookingIds)
        .neq('status', 'cancelled')
        .gte('scheduled_at', upcomingWeekStart.toISOString())
        .lte('scheduled_at', wEnd.toISOString());
      if (bErr) throw bErr;
      return (bookings || []).map((b: any) => {
        const a = assignments.find((x) => x.booking_id === b.id)!;
        return { booking: b as Booking, payShare: a.pay_share };
      });
    },
    enabled: !!staffId,
  });

  // Merge upcoming: primary + team (de-duped)
  const upcomingWeekEntries = useMemo(() => {
    const entries: { booking: Booking; payShare: number | null }[] = [];
    const seen = new Set<string>();
    for (const b of upcomingBookings) {
      if (seen.has(b.id)) continue;
      seen.add(b.id);
      const ta = upcomingTeamAssignments.find((t) => t.booking.id === b.id);
      entries.push({ booking: b, payShare: ta?.payShare ?? null });
    }
    for (const t of upcomingTeamAssignments) {
      if (seen.has(t.booking.id)) continue;
      seen.add(t.booking.id);
      entries.push({ booking: t.booking, payShare: t.payShare });
    }
    entries.sort((a, b) => new Date(a.booking.scheduled_at).getTime() - new Date(b.booking.scheduled_at).getTime());
    return entries;
  }, [upcomingBookings, upcomingTeamAssignments]);

  const upcomingWeekStats = useMemo(() => {
    let totalPay = 0;
    let totalHours = 0;
    for (const { booking, payShare } of upcomingWeekEntries) {
      const { calculatedPay, hoursWorked } = resolveEarnings(booking, staffInfo, payShare);
      totalPay += calculatedPay;
      totalHours += hoursWorked;
    }
    return { totalPay, totalHours, jobCount: upcomingWeekEntries.length };
  }, [upcomingWeekEntries, staffInfo]);

  // Completed bookings (historical)
  const { data: primaryBookings = [], isLoading: loadingPrimary, error: primaryError } = useQuery({
    queryKey: ['cleaner-earnings-primary', staffId, dateRange],
    queryFn: async () => {
      let query = supabase
        .from('bookings')
        .select(`
          id, booking_number, scheduled_at, duration, status, total_amount, subtotal, discount_amount,
          cleaner_actual_payment, cleaner_pay_expected, cleaner_wage, cleaner_wage_type,
          cleaner_checkin_at, cleaner_checkout_at, cleaner_override_hours,
          service:services(name),
          customer:customers(first_name, last_name)
        `)
        .eq('staff_id', staffId)
        .eq('status', 'completed');
      if (fromISO) query = query.gte('scheduled_at', fromISO);
      if (toISO)   query = query.lte('scheduled_at', toISO);
      const { data, error } = await query.order('scheduled_at', { ascending: false });
      if (error) throw error;
      return data as Booking[];
    },
    enabled: !!staffId,
  });

  const { data: teamAssignments = [], isLoading: loadingTeam, error: teamError } = useQuery({
    queryKey: ['cleaner-earnings-team', staffId, dateRange],
    queryFn: async () => {
      const { data: assignments, error: aErr } = await supabase
        .from('booking_team_assignments')
        .select('booking_id, staff_id, pay_share, is_primary')
        .eq('staff_id', staffId);
      if (aErr) throw aErr;
      if (!assignments?.length) return [];
      const bookingIds = assignments.map((a) => a.booking_id);
      let bQuery = supabase
        .from('bookings')
        .select(`
          id, booking_number, scheduled_at, duration, status, total_amount,
          cleaner_actual_payment, cleaner_wage, cleaner_wage_type,
          cleaner_checkin_at, cleaner_checkout_at, cleaner_override_hours,
          staff_id,
          service:services(name),
          customer:customers(first_name, last_name)
        `)
        .in('id', bookingIds)
        .eq('status', 'completed');
      if (fromISO) bQuery = bQuery.gte('scheduled_at', fromISO);
      if (toISO)   bQuery = bQuery.lte('scheduled_at', toISO);
      const { data: bookings, error: bErr } = await bQuery.order('scheduled_at', { ascending: false });
      if (bErr) throw bErr;
      return (bookings || []).map((b: any) => {
        const a = assignments.find((x) => x.booking_id === b.id)!;
        return { booking: b as Booking, payShare: a.pay_share, isPrimary: a.is_primary };
      });
    },
    enabled: !!staffId,
  });

  const allEntries = useMemo(() => {
    const entries: { booking: Booking; payShare: number | null }[] = [];
    const seen = new Set<string>();
    for (const b of primaryBookings) {
      if (seen.has(b.id)) continue;
      seen.add(b.id);
      const ta = teamAssignments.find((t) => t.booking.id === b.id);
      entries.push({ booking: b, payShare: ta?.payShare ?? null });
    }
    for (const t of teamAssignments) {
      if (seen.has(t.booking.id)) continue;
      seen.add(t.booking.id);
      entries.push({ booking: t.booking, payShare: t.payShare });
    }
    entries.sort((a, b) => new Date(b.booking.scheduled_at).getTime() - new Date(a.booking.scheduled_at).getTime());
    return entries;
  }, [primaryBookings, teamAssignments]);

  const stats = useMemo(() => {
    let totalEarnings = 0;
    let totalHours = 0;
    for (const { booking, payShare } of allEntries) {
      const { calculatedPay, hoursWorked } = resolveEarnings(booking, staffInfo, payShare);
      totalEarnings += calculatedPay;
      totalHours += hoursWorked;
    }
    const totalJobs = allEntries.length;
    return {
      totalEarnings, totalJobs,
      avgPerJob: totalJobs > 0 ? totalEarnings / totalJobs : 0,
      totalHours,
      avgPerHour: totalHours > 0 ? totalEarnings / totalHours : 0,
    };
  }, [allEntries, staffInfo]);

  const exportToCSV = () => {
    const headers = ['Date', 'Booking #', 'Service', 'Customer', 'Actual Hours', 'Your Earnings'];
    const rows = allEntries.map(({ booking, payShare }) => {
      const { calculatedPay, hoursWorked } = resolveEarnings(booking, staffInfo, payShare);
      return [
        orgDateKey(new Date(booking.scheduled_at), orgTimezone),
        booking.booking_number,
        booking.service?.name || (booking.total_amount === 0 ? 'Re-clean' : 'Service'),
        booking.customer ? `${booking.customer.first_name} ${booking.customer.last_name}` : 'N/A',
        hoursWorked.toFixed(2),
        calculatedPay.toFixed(2),
      ];
    });
    rows.push([]);
    rows.push(['Summary']);
    rows.push(['Total Jobs', stats.totalJobs.toString()]);
    rows.push(['Total Hours', stats.totalHours.toFixed(2)]);
    rows.push(['Total Earnings', stats.totalEarnings.toFixed(2)]);
    rows.push(['Average Per Job', stats.avgPerJob.toFixed(2)]);
    rows.push(['Average Per Hour', stats.avgPerHour.toFixed(2)]);
    // "Export for Taxes" — a cleaner files from this file, so a shifted column
    // is a wrong number on a tax return. Customer and service names carry
    // commas routinely and `.join(',')` split every one of them.
    const csvContent = matrixToCsv([headers, ...rows]);
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const fileName = `earnings-${staffName.replace(/\s+/g, '-')}-${orgDateKey(dateRange?.from || new Date(), orgTimezone)}-to-${orgDateKey(dateRange?.to || new Date(), orgTimezone)}.csv`;
    // saveBlob → share sheet on iOS; <a download> is ignored in WKWebView.
    void saveBlob(blob, fileName);
  };

  // Same correction as PayrollPage: the useState initialiser runs before the
  // timezone query resolves, so the default month is re-derived once it does —
  // and only while the range is still untouched.
  const rangeTouchedRef = useRef(false);
  const appliedTzRef = useRef<string | null>(null);
  useEffect(() => {
    if (rangeTouchedRef.current) return;
    if (appliedTzRef.current === orgTimezone) return;
    appliedTzRef.current = orgTimezone;
    const now = new Date();
    setDateRange({ from: orgStartOfMonth(now, orgTimezone), to: orgEndOfMonth(now, orgTimezone) });
  }, [orgTimezone]);

  const setPreset = (preset: 'month' | 'quarter' | 'ytd' | 'year') => {
    const now = new Date();
    let from: Date;
    let to: Date = now;
    switch (preset) {
      case 'month':   from = orgStartOfMonth(now, orgTimezone); to = orgEndOfMonth(now, orgTimezone); break;
      case 'quarter': from = orgStartOfMonth(subMonths(now, 2), orgTimezone); break;
      case 'ytd':     from = orgStartOfYear(now, orgTimezone); break;
      case 'year':    from = orgStartOfMonth(subMonths(now, 12), orgTimezone); break;
    }
    rangeTouchedRef.current = true;
    setDateRange({ from, to });
  };

  const isLoading = loadingPrimary || loadingTeam;
  const earningsError = staffInfoError || timezoneError || upcomingError || upcomingTeamError || primaryError || teamError;

  return (
    <div className="space-y-6">
      {/* Upcoming Week Pay Card */}
      <Card className="border-primary/20 bg-primary/5">
        <CardHeader className="pb-2">
          <CardTitle className="text-lg flex items-center gap-2">
            <CalendarDays className="h-5 w-5 text-primary" />
            Upcoming Week Pay
          </CardTitle>
          <CardDescription>
            {format(upcomingWeekStart, 'MMM d')} – {format(upcomingWeekEnd, 'MMM d, yyyy')}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <p className="text-sm text-muted-foreground">Expected Pay</p>
              <p className="text-2xl font-bold text-primary">{fmt(upcomingWeekStats.totalPay)}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Jobs</p>
              <p className="text-2xl font-bold">{upcomingWeekStats.jobCount}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Hours</p>
              <p className="text-2xl font-bold">{upcomingWeekStats.totalHours.toFixed(1)}h</p>
            </div>
          </div>

          {/* Upcoming jobs breakdown */}
          {upcomingWeekEntries.length > 0 && (
            <div className="mt-4 space-y-2">
              <p className="text-sm font-medium text-muted-foreground">This week's jobs:</p>
              {upcomingWeekEntries.map(({ booking, payShare }) => {
                const { calculatedPay, hoursWorked } = resolveEarnings(booking, staffInfo, payShare);
                return (
                  <div key={booking.id} className="flex items-center justify-between text-sm p-2 rounded-md bg-background">
                    <div className="flex items-center gap-2">
                      <span className="text-muted-foreground">{format(new Date(booking.scheduled_at), 'EEE, MMM d')}</span>
                      <span>•</span>
                      <span>{booking.customer ? `${booking.customer.first_name} ${booking.customer.last_name}` : 'N/A'}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-muted-foreground">{hoursWorked.toFixed(1)}h</span>
                      <span className="font-medium text-green-600">{fmt(calculatedPay)}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3">
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" className={cn('justify-start text-left font-normal', !dateRange && 'text-muted-foreground')}>
              <CalendarIcon className="mr-2 h-4 w-4" />
              {dateRange?.from ? (
                dateRange.to ? (
                  <>{format(dateRange.from, 'LLL dd, y')} - {format(dateRange.to, 'LLL dd, y')}</>
                ) : (
                  format(dateRange.from, 'LLL dd, y')
                )
              ) : (
                <span>Pick a date range</span>
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <Calendar
              initialFocus
              mode="range"
              defaultMonth={dateRange?.from}
              selected={dateRange}
              onSelect={setDateRange}
              numberOfMonths={2}
            />
          </PopoverContent>
        </Popover>

        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setPreset('month')}>This Month</Button>
          <Button variant="outline" size="sm" onClick={() => setPreset('quarter')}>Last 3 Months</Button>
          <Button variant="outline" size="sm" onClick={() => setPreset('ytd')}>Year to Date</Button>
        </div>

        <Button onClick={exportToCSV} disabled={allEntries.length === 0} className="ml-auto gap-2">
          <Download className="h-4 w-4" />
          Export for Taxes
        </Button>
      </div>

      {/* Stats Cards */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Total Earnings</CardDescription>
            <CardTitle className="text-2xl flex items-center gap-2">
              <DollarSign className="h-5 w-5 text-green-500" />
              ${stats.totalEarnings.toFixed(2)}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Jobs Completed</CardDescription>
            <CardTitle className="text-2xl flex items-center gap-2">
              <Briefcase className="h-5 w-5 text-blue-500" />
              {stats.totalJobs}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Avg Per Job</CardDescription>
            <CardTitle className="text-2xl flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-purple-500" />
              ${stats.avgPerJob.toFixed(2)}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Total Hours</CardDescription>
            <CardTitle className="text-2xl flex items-center gap-2">
              <FileText className="h-5 w-5 text-orange-500" />
              {stats.totalHours.toFixed(1)}h
            </CardTitle>
          </CardHeader>
        </Card>
      </div>

      {/* Earnings Table */}
      <Card>
        <CardHeader>
          <CardTitle>Earnings History</CardTitle>
          <CardDescription>Detailed breakdown of your completed jobs and earnings</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-muted-foreground">Loading...</p>
          ) : earningsError ? (
            <QueryError subject="your earnings" onRetry={() => window.location.reload()} />
          ) : allEntries.length === 0 ? (
            <p className="text-muted-foreground text-center py-8">
              No completed jobs in this date range.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Booking #</TableHead>
                    <TableHead>Service</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead className="text-right">Duration</TableHead>
                    <TableHead className="text-right">Your Earnings</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {allEntries.map(({ booking, payShare }) => {
                    const { calculatedPay, hoursWorked } = resolveEarnings(booking, staffInfo, payShare);
                    return (
                      <TableRow key={booking.id}>
                        <TableCell>{format(new Date(booking.scheduled_at), 'MMM d, yyyy')}</TableCell>
                        <TableCell>
                          <Badge variant="outline">#{booking.booking_number}</Badge>
                        </TableCell>
                        <TableCell>{booking.service?.name || (booking.total_amount === 0 ? 'Re-clean' : 'Service')}</TableCell>
                        <TableCell>
                          {booking.customer
                            ? `${booking.customer.first_name} ${booking.customer.last_name}`
                            : 'N/A'}
                        </TableCell>
                        <TableCell className="text-right">{hoursWorked.toFixed(1)}h</TableCell>
                        <TableCell className="text-right font-medium text-green-600">
                          ${calculatedPay.toFixed(2)}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
