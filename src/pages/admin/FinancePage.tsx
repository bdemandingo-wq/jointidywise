import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { AdminLayout } from '@/components/admin/AdminLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { supabase } from '@/lib/supabase';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { format, startOfMonth, endOfMonth } from 'date-fns';
import { useOrgTimezone } from '@/hooks/useOrgTimezone';
import { orgDateKey, orgEndOfMonth, orgStartOfMonth } from '@/lib/orgDateRange';
import { matrixToCsv } from '@/lib/orgDataExport';
import { formatInTimezone } from '@/lib/timezoneUtils';
import { 
  CalendarIcon, 
  Download, 
  DollarSign, 
  TrendingDown,
  CreditCard,
  Receipt,
  PiggyBank,
  Calculator,
  RefreshCw,
  AlertTriangle,
  CheckCircle,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTestMode } from '@/contexts/TestModeContext';
import { useOrganization } from '@/contexts/OrganizationContext';
import { PlanFeatureGate } from '@/components/admin/PlanFeatureGate';
import { PnLCalendar } from '@/components/admin/PnLCalendar';
import { SEOHead } from '@/components/SEOHead';
import { toast } from 'sonner';
import { fmt } from '@/lib/activeCurrency';
import { QueryError } from '@/components/QueryError';
import { STAFF_SELECTABLE_COLUMNS } from '@/lib/staffColumns';

interface Transaction {
  id: string;
  booking_number: number;
  customer_name: string;
  service_name: string;
  scheduled_at: string;
  gross_amount: number;
  processing_fee: number;
  net_amount: number;
  cleaner_pay: number;
  zip_code: string | null;
  status: string;
  payment_status: string;
}

export default function FinancePage() {
  const { organization } = useOrganization();
  const organizationId = organization?.id;
  const { timezone: orgTz, error: tzError } = useOrgTimezone();
  
  const [dateRange, setDateRange] = useState<{ from: Date; to: Date }>({
    // Placeholder; corrected below once orgTz resolves.
    /* eslint-disable-next-line local/no-device-local-dates -- provisional, replaced once the org zone resolves */
    from: startOfMonth(new Date()),
    /* eslint-disable-next-line local/no-device-local-dates -- ditto */
    to: endOfMonth(new Date()),
  });
  /**
   * Re-derive the default range once the org's real timezone loads.
   *
   * useOrgTimezone returns its America/New_York fallback on the first render,
   * so the useState initialiser above can only ever see the fallback. Guarded
   * so a range the user has chosen is never snatched back.
   */
  const rangeTouchedRef = useRef(false);
  const appliedTzRef = useRef<string | null>(null);
  useEffect(() => {
    if (rangeTouchedRef.current) return;
    if (appliedTzRef.current === orgTz) return;
    appliedTzRef.current = orgTz;
    const now = new Date();
    setDateRange({ from: orgStartOfMonth(now, orgTz), to: orgEndOfMonth(now, orgTz) });
  }, [orgTz]);

  const { maskName, isTestMode } = useTestMode();
  const queryClient = useQueryClient();
  const [isSyncing, setIsSyncing] = useState(false);

  // Stripe Live Sync
  const { data: stripeData, isLoading: stripeLoading, error: stripeError, refetch: refetchStripe } = useQuery({
    queryKey: ['stripe-analytics', organizationId, dateRange],
    queryFn: async () => {
      if (!organizationId) return null;
      const { data, error } = await supabase.functions.invoke('stripe-analytics-sync', {
        body: {
          organization_id: organizationId,
          date_from: dateRange.from.toISOString(),
          date_to: dateRange.to.toISOString(),
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.message || data.error);
      return data;
    },
    enabled: !!organizationId,
    staleTime: 5 * 60 * 1000, // 5 min cache
    retry: 1,
  });

  const handleSyncStripe = useCallback(async () => {
    setIsSyncing(true);
    try {
      await refetchStripe();
      toast.success('Stripe data synced successfully');
    } catch (err) {
      toast.error('Failed to sync with Stripe');
    } finally {
      setIsSyncing(false);
    }
  }, [refetchStripe]);

  const stripeConnected = !stripeError && !!stripeData;

  // Fetch completed bookings with payment data - scoped to organization
  const { data: bookings = [], error: bookingsError } = useQuery({
    queryKey: ['bookings-finance', organizationId, dateRange],
    queryFn: async () => {
      if (!organizationId) return [];
      const { data, error } = await supabase
        .from('bookings')
        .select(`
          *,
          customer:customers(*),
          service:services(*),
          staff:staff(${STAFF_SELECTABLE_COLUMNS})
        `)
        .eq('organization_id', organizationId)
        // Drafts are not committed work and must not count as revenue.
        // Mirrors the guard in useBookings, which every other surface
        // already goes through — this query was the outlier.
        .or('is_draft.is.null,is_draft.eq.false')
        .gte('scheduled_at', dateRange.from.toISOString())
        .lte('scheduled_at', dateRange.to.toISOString())
        .order('scheduled_at', { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!organizationId,
  });

  // Fetch team assignment pay for accurate labor costs
  const bookingIds = useMemo(() => bookings.map((b: any) => b.id), [bookings]);
  const { data: teamPaysByBooking = new Map<string, number>(), error: teamPaysError } = useQuery({
    queryKey: ['finance-team-pay', organizationId, bookingIds.join(',')],
    queryFn: async () => {
      if (!organizationId || bookingIds.length === 0) return new Map<string, number>();
      const { data, error } = await supabase
        .from('booking_team_assignments')
        .select('booking_id, pay_share, staff_id')
        .eq('organization_id', organizationId)
        .in('booking_id', bookingIds);
      if (error) throw error;

      const bookingTeamMap = new Map<string, any[]>();
      for (const row of data || []) {
        const bid = String((row as any).booking_id);
        if (!bookingTeamMap.has(bid)) bookingTeamMap.set(bid, []);
        bookingTeamMap.get(bid)!.push(row);
      }

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
        if (hasAnyPay) {
          map.set(bid, totalPay);
        }
      }
      return map;
    },
    enabled: !!organizationId && bookingIds.length > 0,
  });

  // Fetch paid tips collected through portal in date range
  const { data: paidTips = [], error: paidTipsError } = useQuery({
    queryKey: ['finance-paid-tips', organizationId, dateRange],
    queryFn: async () => {
      if (!organizationId) return [];
      const { data, error } = await supabase
        .from('tips')
        .select('amount, paid_at, payment_intent_id')
        .eq('organization_id', organizationId)
        .eq('status', 'paid')
        .gte('paid_at', dateRange.from.toISOString())
        .lte('paid_at', dateRange.to.toISOString());
      if (error) throw error;
      return data || [];
    },
    enabled: !!organizationId,
  });

  // Fetch expenses for the date range - scoped to organization
  const { data: expenses = [], error: expensesError } = useQuery({
    queryKey: ['expenses-finance', organizationId, dateRange],
    queryFn: async () => {
      if (!organizationId) return [];
      const { data, error } = await supabase
        .from('expenses')
        .select('*')
        .eq('organization_id', organizationId)
        // expense_date is a DATE column and dateRange holds picker tokens, so
        // this is calendar day compared with calendar day.
        /* eslint-disable local/no-device-local-dates -- date-column comparison */
        .gte('expense_date', format(dateRange.from, 'yyyy-MM-dd'))
        .lte('expense_date', format(dateRange.to, 'yyyy-MM-dd'));
        /* eslint-enable local/no-device-local-dates */
      if (error) throw error;
      return data;
    },
    enabled: !!organizationId,
  });

  useEffect(() => {
    const err = bookingsError || teamPaysError || paidTipsError || expensesError;
    if (err) toast.error('Failed to load data');
  }, [bookingsError, teamPaysError, paidTipsError, expensesError]);

  // Transform bookings to transactions with calculated fees
  const transactions: Transaction[] = useMemo(() => {
    return bookings.map((b: any) => {
      const grossAmount = Number(b.total_amount) || 0;
      // Only apply Stripe fee (2.9% + $0.30) to bookings actually charged through Stripe
      const hasStripePayment = !!b.payment_intent_id;
      const processingFee = hasStripePayment ? (grossAmount * 0.029) + 0.30 : 0;
      const netAmount = grossAmount - processingFee;
      
      // Calculate cleaner pay - use single source of truth: cleaner_pay_expected
      const teamPay = teamPaysByBooking.get(b.id);
      let cleanerPay = 0;
      if (teamPay != null && teamPay > 0) {
        cleanerPay = teamPay;
      } else if (b.cleaner_pay_expected != null && Number(b.cleaner_pay_expected) > 0) {
        cleanerPay = Number(b.cleaner_pay_expected);
      } else if (b.cleaner_actual_payment != null && Number(b.cleaner_actual_payment) > 0) {
        cleanerPay = Number(b.cleaner_actual_payment);
      } else if (b.cleaner_wage) {
        const wage = Number(b.cleaner_wage);
        const wageType = b.cleaner_wage_type || 'hourly';
        if (wageType === 'flat') {
          cleanerPay = wage;
        } else if (wageType === 'percentage') {
          cleanerPay = (grossAmount * wage) / 100;
        } else {
          const hours = b.cleaner_override_hours || (b.duration / 60);
          cleanerPay = wage * hours;
        }
      }

      return {
        id: b.id,
        booking_number: b.booking_number,
        customer_name: b.customer ? `${b.customer.first_name} ${b.customer.last_name}` : 'Unknown',
        service_name: b.service?.name || (b.total_amount === 0 ? 'Re-clean' : 'Service'),
        scheduled_at: b.scheduled_at,
        gross_amount: grossAmount,
        processing_fee: Math.round(processingFee * 100) / 100,
        net_amount: Math.round(netAmount * 100) / 100,
        cleaner_pay: Math.round(cleanerPay * 100) / 100,
        zip_code: b.zip_code,
        status: b.status,
        payment_status: b.payment_status,
      };
    });
  }, [bookings, teamPaysByBooking]);

  // Calculate P&L metrics - exclude cancelled bookings
  const metrics = useMemo(() => {
    // Exclude cancelled bookings from all calculations
    const activeTransactions = transactions.filter(t => t.status !== 'cancelled');
    const paidTransactions = activeTransactions.filter(t => t.payment_status === 'paid' || t.payment_status === 'partial');
    
    // Total sales from active bookings in range (excludes cancelled)
    const totalSales = activeTransactions.reduce((sum, t) => sum + t.gross_amount, 0);
    const totalFees = activeTransactions.reduce((sum, t) => sum + t.processing_fee, 0);
    const totalCleanerPay = activeTransactions.reduce((sum, t) => sum + t.cleaner_pay, 0);
    const refundedTransactions = activeTransactions.filter(t => t.payment_status === 'refunded');
    const totalRefunds = refundedTransactions.reduce((sum, t) => sum + t.gross_amount, 0);

    // Portal revenue: paid bookings collected through the client portal
    // (not yet captured by Stripe sync — i.e. no payment_intent_id) + paid tips
    const portalBookingsRevenue = bookings
      .filter((b: any) =>
        b.status !== 'cancelled' &&
        (b.payment_status === 'paid' || b.payment_status === 'partial') &&
        !b.payment_intent_id
      )
      .reduce((sum: number, b: any) => sum + (Number(b.total_amount) || 0), 0);
    const portalTipsRevenue = paidTips
      .filter((t: any) => !t.payment_intent_id)
      .reduce((sum: number, t: any) => sum + (Number(t.amount) || 0), 0);
    const portalRevenue = portalBookingsRevenue + portalTipsRevenue;
    const portalPaymentCount =
      bookings.filter((b: any) =>
        b.status !== 'cancelled' &&
        (b.payment_status === 'paid' || b.payment_status === 'partial') &&
        !b.payment_intent_id
      ).length + paidTips.filter((t: any) => !t.payment_intent_id).length;
    
    // Calculate expenses by category
    const expensesByCategory: Record<string, number> = {};
    expenses.forEach((e: any) => {
      const category = e.category || 'other';
      expensesByCategory[category] = (expensesByCategory[category] || 0) + Number(e.amount);
    });
    
    const totalExpenses = expenses.reduce((sum, e: any) => sum + Number(e.amount), 0);
    
    const netRevenue = totalSales - totalFees;
    const netProfit = netRevenue - totalCleanerPay - totalExpenses - totalRefunds;
    const profitMargin = totalSales > 0 ? (netProfit / totalSales) * 100 : 0;

    return {
      totalSales: Math.round(totalSales * 100) / 100,
      totalFees: Math.round(totalFees * 100) / 100,
      netRevenue: Math.round(netRevenue * 100) / 100,
      totalCleanerPay: Math.round(totalCleanerPay * 100) / 100,
      totalExpenses: Math.round(totalExpenses * 100) / 100,
      expensesByCategory,
      totalRefunds: Math.round(totalRefunds * 100) / 100,
      netProfit: Math.round(netProfit * 100) / 100,
      profitMargin: Math.round(profitMargin * 10) / 10,
      transactionCount: activeTransactions.length,
      portalRevenue: Math.round(portalRevenue * 100) / 100,
      portalPaymentCount,
    };
  }, [transactions, expenses, bookings, paidTips]);

  // Sales tax by zip code
  const salesTaxByZip = useMemo(() => {
    const zipMap = new Map<string, { count: number; total: number }>();
    transactions.forEach(t => {
      const zip = t.zip_code || 'No Zip';
      const existing = zipMap.get(zip) || { count: 0, total: 0 };
      zipMap.set(zip, {
        count: existing.count + 1,
        total: existing.total + t.gross_amount,
      });
    });
    return Array.from(zipMap.entries()).map(([zip, data]) => ({
      zip_code: zip,
      ...data,
      // Assume 7% sales tax for cleaning services (varies by state)
      estimated_tax: Math.round(data.total * 0.07 * 100) / 100,
    }));
  }, [transactions]);


  // Export functions
  const exportQuickBooksCSV = () => {
    const headers = ['Date', 'Transaction ID', 'Customer', 'Service', 'Gross Amount', 'Processing Fee', 'Net Amount', 'Category'];
    const rows = transactions.map(t => [
      // An instant, so its day is the org's.
      orgDateKey(new Date(t.scheduled_at), orgTz),
      `#${t.booking_number}`,
      t.customer_name,
      t.service_name,
      t.gross_amount.toFixed(2),
      t.processing_fee.toFixed(2),
      t.net_amount.toFixed(2),
      'Cleaning Services',
    ]);
    downloadCSV('quickbooks-export', headers, rows);
  };

  const exportAnnualIncome = () => {
    // Use proper CSV format with quoted headers to ensure all columns show
    const headers = ['"Period"', '"Total Sales"', '"Processing Fees"', '"Net Revenue"', '"Cleaner Pay"', '"Expenses"', '"Refunds"', '"Net Profit"', '"Profit Margin %"'];
    const rows = [[
      `"${format(dateRange.from, 'MMM d, yyyy')} - ${format(dateRange.to, 'MMM d, yyyy')}"`,
      metrics.totalSales.toFixed(2),
      metrics.totalFees.toFixed(2),
      metrics.netRevenue.toFixed(2),
      metrics.totalCleanerPay.toFixed(2),
      metrics.totalExpenses.toFixed(2),
      metrics.totalRefunds.toFixed(2),
      metrics.netProfit.toFixed(2),
      metrics.profitMargin.toFixed(1),
    ]];
    downloadCSV('annual-income-report', headers, rows);
  };

  const exportSalesTaxByZip = () => {
    const headers = ['Zip Code', 'Transaction Count', 'Total Revenue'];
    const rows = salesTaxByZip.map(z => [
      z.zip_code,
      z.count.toString(),
      z.total.toFixed(2),
    ]);
    downloadCSV('sales-tax-by-zipcode', headers, rows);
  };

  const downloadCSV = async (filename: string, headers: string[], rows: string[][]) => {
    const csv = matrixToCsv([headers, ...rows]);
    const { exportFile } = await import('@/lib/exportFile');
    await exportFile(`${filename}-${orgDateKey(new Date(), orgTz)}.csv`, csv, 'text/csv');
  };

  if (tzError) {
    return (
      <AdminLayout title="Finance & Taxes" subtitle="Profit & loss, transactions, and tax exports">
        <QueryError subject="timezone settings" />
      </AdminLayout>
    );
  }

  return (
    <AdminLayout
      title="Finance & Taxes"
      subtitle="Profit & loss, transactions, and tax exports"
    >
<div className="portal-v2 portal-v2-scroll">
      <SEOHead title="Finance | TidyWise" description="Manage finances and tax reporting" noIndex />
      <PlanFeatureGate feature="reports">
      {/* Stripe Sync Header */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <Button
          variant="outline"
          size="sm"
          className="gap-2"
          onClick={handleSyncStripe}
          disabled={isSyncing || stripeLoading}
        >
          <RefreshCw className={cn("w-4 h-4", (isSyncing || stripeLoading) && "animate-spin")} />
          Sync with Stripe
        </Button>
        {stripeConnected ? (
          <Badge variant="outline" className="gap-1 text-success border-success/30 bg-success/10">
            <CheckCircle className="w-3 h-3" /> Stripe Live
          </Badge>
        ) : (
          <Badge variant="outline" className="gap-1 text-warning border-warning/30 bg-warning/10">
            <AlertTriangle className="w-3 h-3" /> {stripeError ? 'Cached Data' : 'Loading...'}
          </Badge>
        )}
        {stripeData?.synced_at && (
          <span className="text-xs text-muted-foreground">
            Last synced: {formatInTimezone(stripeData.synced_at, orgTz, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true })}
          </span>
        )}
      </div>

      {stripeError && (
        <div className="flex items-center gap-2 p-3 mb-4 rounded-md bg-warning/10 border border-warning/20 text-warning text-sm">
          <AlertTriangle className="w-4 h-4 flex-shrink-0" />
          <span>Unable to fetch live Stripe data. Showing estimates from local records.</span>
        </div>
      )}

      {/* Date Range Selector */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 sm:gap-4 mb-6">
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" className="gap-2 w-full sm:w-auto min-h-[44px]">
              <CalendarIcon className="w-4 h-4" />
              <span className="truncate">{format(dateRange.from, 'MMM d')} - {format(dateRange.to, 'MMM d, yyyy')}</span>
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <Calendar
              mode="range"
              selected={{ from: dateRange.from, to: dateRange.to }}
              onSelect={(range) => {
                if (range?.from && range?.to) {
                  rangeTouchedRef.current = true;
                  setDateRange({ from: range.from, to: range.to });
                }
              }}
              numberOfMonths={2}
            />
          </PopoverContent>
        </Popover>

        <div className="flex flex-wrap gap-2 w-full sm:w-auto sm:ml-auto">
          <Button variant="outline" size="sm" className="gap-2 flex-1 sm:flex-none min-h-[44px]" onClick={exportQuickBooksCSV}>
            <Download className="w-4 h-4" />
            <span className="hidden sm:inline">QuickBooks/Xero</span>
            <span className="sm:hidden">QB</span>
          </Button>
          <Button variant="outline" size="sm" className="gap-2 flex-1 sm:flex-none min-h-[44px]" onClick={exportAnnualIncome}>
            <Download className="w-4 h-4" />
            <span className="hidden sm:inline">Income Report</span>
            <span className="sm:hidden">Income</span>
          </Button>
          <Button variant="outline" size="sm" className="gap-2 flex-1 sm:flex-none min-h-[44px]" onClick={exportSalesTaxByZip}>
            <Download className="w-4 h-4" />
            <span className="hidden sm:inline">Sales Tax by Zip</span>
            <span className="sm:hidden">Sales Tax</span>
          </Button>
        </div>
      </div>

      {/* P&L Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4 mb-6">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <DollarSign className="w-4 h-4 text-success" />
              <span className="text-xs text-muted-foreground">Total Sales</span>
            </div>
            <p className="text-xl font-bold text-success">
              {isTestMode ? '$X,XXX.XX' : fmt(metrics.totalSales)}
            </p>
            {/* transactionCount is activeTransactions.length — every booking
                with status != 'cancelled', regardless of payment_status. It
                previously read "paid bookings", which it never was. */}
            <p className="text-[10px] text-muted-foreground">
              {metrics.transactionCount} bookings · gross, incl. unpaid
            </p>
            {/* The connectivity icon used to sit beside "Total Sales", which
                read as "this figure came from Stripe". It never does — this
                card is always metrics.totalSales from bookings. Moved next to
                the Stripe text so it can only be read as connection state. */}
            {!isTestMode && (
              stripeConnected ? (
                <p className="text-[10px] text-muted-foreground mt-0.5 flex items-center gap-1">
                  <CheckCircle className="w-3 h-3 text-success shrink-0" />
                  <span>Stripe connected · processed {fmt(stripeData.total_revenue)} in window</span>
                </p>
              ) : (
                <p className="text-[10px] text-muted-foreground mt-0.5 flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3 text-warning shrink-0" />
                  <span>Stripe not connected</span>
                </p>
              )
            )}
          </CardContent>
        </Card>
        <Card className="bg-gradient-to-br from-info/10 to-info/5">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <DollarSign className="w-4 h-4 text-info" />
              <span className="text-xs text-muted-foreground">Portal Revenue</span>
              <CheckCircle className="w-3 h-3 text-success ml-auto" />
            </div>
            <p className="text-xl font-bold text-info">
              {isTestMode ? '$X,XXX.XX' : `${fmt(metrics.portalRevenue)}`}
            </p>
            <p className="text-[10px] text-muted-foreground">
              {metrics.portalPaymentCount} portal payments (incl. tips)
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <CreditCard className="w-4 h-4 text-warning" />
              <span className="text-xs text-muted-foreground">Processing Fees</span>
              {stripeConnected ? <CheckCircle className="w-3 h-3 text-success ml-auto" /> : <AlertTriangle className="w-3 h-3 text-warning ml-auto" />}
            </div>
            <p className="text-xl font-bold text-warning">
              {isTestMode ? '-$XXX.XX' : `-${fmt((stripeConnected ? stripeData.total_fees : metrics.totalFees))}`}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <Receipt className="w-4 h-4 text-info" />
              <span className="text-xs text-muted-foreground">Cleaner Pay</span>
            </div>
            <p className="text-xl font-bold text-info">
              {isTestMode ? '-$X,XXX.XX' : `-${fmt(metrics.totalCleanerPay)}`}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <TrendingDown className="w-4 h-4 text-destructive" />
              <span className="text-xs text-muted-foreground">Refunds</span>
              {stripeConnected ? <CheckCircle className="w-3 h-3 text-success ml-auto" /> : <AlertTriangle className="w-3 h-3 text-warning ml-auto" />}
            </div>
            <p className="text-xl font-bold text-destructive">
              {isTestMode ? '-$X.XX' : `-${fmt((stripeConnected ? stripeData.total_refunds : metrics.totalRefunds))}`}
            </p>
            {stripeConnected && stripeData.disputes_count > 0 && (
              <p className="text-[10px] text-destructive">{stripeData.disputes_count} disputes (-${stripeData.total_disputes})</p>
            )}
          </CardContent>
        </Card>
        <Card className="bg-gradient-to-br from-primary/10 to-primary/5">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <PiggyBank className="w-4 h-4 text-primary" />
              <span className="text-xs text-muted-foreground">Net Profit</span>
            </div>
            <p className={cn(
              "text-xl font-bold",
              (stripeConnected ? stripeData.net_revenue + metrics.portalRevenue - metrics.totalCleanerPay - metrics.totalExpenses : metrics.netProfit) >= 0 ? "text-primary" : "text-destructive"
            )}>
              {isTestMode ? '$X,XXX.XX' : `${fmt((stripeConnected ? (stripeData.net_revenue + metrics.portalRevenue - metrics.totalCleanerPay - metrics.totalExpenses) : metrics.netProfit))}`}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <Calculator className="w-4 h-4 text-primary" />
              <span className="text-xs text-muted-foreground">Spend / Customer</span>
              {stripeConnected && <CheckCircle className="w-3 h-3 text-success ml-auto" />}
            </div>
            <p className="text-xl font-bold text-primary">
              {isTestMode ? '$XXX.XX' : `${fmt((stripeConnected ? stripeData.spend_per_customer : (metrics.transactionCount > 0 ? metrics.totalSales / metrics.transactionCount : 0)))}`}
            </p>
            {stripeConnected && (
              <p className="text-[10px] text-muted-foreground">{stripeData.new_customers_count} customers</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Tabs for different views */}
      <Tabs defaultValue="transactions" className="space-y-4">
        <TabsList>
          <TabsTrigger value="transactions">Transactions</TabsTrigger>
          <TabsTrigger value="pnl-calendar">P&L Calendar</TabsTrigger>
          <TabsTrigger value="sales-tax">Sales Tax by Zip</TabsTrigger>
          <TabsTrigger value="pnl">P&L Breakdown</TabsTrigger>
        </TabsList>

        <TabsContent value="transactions">
          <Card>
            <CardHeader>
              <CardTitle>Transaction History</CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Booking #</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead>Service</TableHead>
                    <TableHead className="text-right">Gross Amount</TableHead>
                    <TableHead className="text-right">Processing Fee</TableHead>
                    <TableHead className="text-right">Net Amount</TableHead>
                    <TableHead className="text-right">Cleaner Pay</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {transactions.map((t) => (
                    <TableRow key={t.id}>
                      <TableCell className="whitespace-nowrap">
                        {formatInTimezone(t.scheduled_at, orgTz, { month: 'short', day: 'numeric', year: 'numeric' })}
                      </TableCell>
                      <TableCell>#{t.booking_number}</TableCell>
                      <TableCell>{maskName(t.customer_name)}</TableCell>
                      <TableCell>{t.service_name}</TableCell>
                      <TableCell className="text-right font-medium text-success">
                        {isTestMode ? '$XXX.XX' : `${fmt(t.gross_amount)}`}
                      </TableCell>
                      <TableCell className="text-right text-warning">
                        {isTestMode ? '-$X.XX' : `-${fmt(t.processing_fee)}`}
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        {isTestMode ? '$XXX.XX' : `${fmt(t.net_amount)}`}
                      </TableCell>
                      <TableCell className="text-right text-info">
                        {isTestMode ? '$XX.XX' : `${fmt(t.cleaner_pay)}`}
                      </TableCell>
                      <TableCell>
                        <Badge variant={t.payment_status === 'paid' ? 'default' : 'secondary'}>
                          {t.payment_status}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                  {transactions.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={9} className="text-center py-8 text-muted-foreground">
                        No transactions for the selected period
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="pnl-calendar">
          <PnLCalendar />
        </TabsContent>

        <TabsContent value="sales-tax">
          <Card>
            <CardHeader>
              <CardTitle>Sales Tax by Zip Code</CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Zip Code</TableHead>
                    <TableHead className="text-right">Transactions</TableHead>
                    <TableHead className="text-right">Total Revenue</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {salesTaxByZip.map((row) => (
                    <TableRow key={row.zip_code}>
                      <TableCell className="font-medium">{row.zip_code}</TableCell>
                      <TableCell className="text-right">{isTestMode ? 'X' : row.count}</TableCell>
                      <TableCell className="text-right">{isTestMode ? '$XXX.XX' : `${fmt(row.total)}`}</TableCell>
                    </TableRow>
                  ))}
                  {salesTaxByZip.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={3} className="text-center py-8 text-muted-foreground">
                        No data for the selected period
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="pnl">
          <Card>
            <CardHeader>
              <CardTitle>Profit & Loss Breakdown</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4 max-w-md">
                <div className="flex justify-between items-center py-3 border-b">
                  <span className="font-medium">Total Sales (Gross)</span>
                  <span className="text-lg font-bold text-success">{isTestMode ? '+$X,XXX.XX' : `+${fmt(metrics.totalSales)}`}</span>
                </div>
                <div className="flex justify-between items-center py-3 border-b">
                  <span className="text-muted-foreground">Less: Processing Fees <span className="text-xs">(Stripe only)</span></span>
                  <span className="text-warning">{isTestMode ? '-$XXX.XX' : `-${fmt(metrics.totalFees)}`}</span>
                </div>
                <div className="flex justify-between items-center py-3 border-b bg-muted/50 px-3 rounded">
                  <span className="font-medium">Net Revenue</span>
                  <span className="font-bold">{isTestMode ? '$X,XXX.XX' : `${fmt(metrics.netRevenue)}`}</span>
                </div>
                <div className="flex justify-between items-center py-3 border-b">
                  <span className="text-muted-foreground">Less: Cleaner Pay</span>
                  <span className="text-info">{isTestMode ? '-$X,XXX.XX' : `-${fmt(metrics.totalCleanerPay)}`}</span>
                </div>
                {Object.entries(metrics.expensesByCategory).map(([category, amount]) => (
                  <div key={category} className="flex justify-between items-center py-3 border-b">
                    <span className="text-muted-foreground">Less: {category.charAt(0).toUpperCase() + category.slice(1)}</span>
                    <span className="text-muted-foreground">{isTestMode ? '-$XXX.XX' : `-${fmt((amount as number))}`}</span>
                  </div>
                ))}
                {Object.keys(metrics.expensesByCategory).length === 0 && (
                  <div className="flex justify-between items-center py-3 border-b">
                    <span className="text-muted-foreground">Less: Expenses</span>
                    <span className="text-muted-foreground">{isTestMode ? '-$XXX.XX' : '-$0.00'}</span>
                  </div>
                )}
                <div className="flex justify-between items-center py-3 border-b">
                  <span className="text-muted-foreground">Less: Refunds</span>
                  <span className="text-destructive">{isTestMode ? '-$X.XX' : `-${fmt(metrics.totalRefunds)}`}</span>
                </div>
                <div className="flex justify-between items-center py-4 bg-primary/10 px-3 rounded-lg">
                  <span className="text-lg font-bold">Net Profit</span>
                  <span className={cn(
                    "text-xl font-bold",
                    metrics.netProfit >= 0 ? "text-primary" : "text-destructive"
                  )}>
                    {isTestMode ? '$X,XXX.XX' : `${fmt(metrics.netProfit)}`}
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
      </PlanFeatureGate>
    </div>
</AdminLayout>
  );
}
