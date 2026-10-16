import { useMemo } from 'react';
import { BookingWithDetails } from '@/hooks/useBookings';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  Cell,
  LabelList,
  PieChart,
  Pie
} from 'recharts';
import { TrendingUp, Users, DollarSign, Calendar, Star } from 'lucide-react';
import { differenceInDays, format, parseISO } from 'date-fns';
import { fmt } from '@/lib/activeCurrency';

interface CustomerLifetimeValueProps {
  bookings: BookingWithDetails[];
  customers: { id: string; first_name: string; last_name: string; email: string; created_at: string }[];
}

interface CustomerCLV {
  id: string;
  name: string;
  email: string;
  totalSpent: number;
  bookingCount: number;
  avgBookingValue: number;
  firstBookingDate: Date | null;
  lastBookingDate: Date | null;
  daysSinceLastBooking: number;
  frequency: string;
  clvScore: number;
  tier: 'platinum' | 'gold' | 'silver' | 'bronze';
}

const tierColors = {
  platinum: 'hsl(var(--primary))',
  gold: '#f59e0b',
  silver: '#94a3b8',
  bronze: '#cd7f32'
};

const tierBadgeStyles = {
  platinum: 'bg-primary/20 text-primary border-primary/30',
  gold: 'bg-amber-500/20 text-amber-600 dark:text-amber-400 border-amber-500/30',
  silver: 'bg-slate-400/20 text-slate-600 dark:text-slate-300 border-slate-400/30',
  bronze: 'bg-orange-700/20 text-orange-700 dark:text-orange-400 border-orange-700/30'
};

export function CustomerLifetimeValue({ bookings, customers }: CustomerLifetimeValueProps) {

  const customerCLVData = useMemo(() => {
    const customerMap = new Map<string, CustomerCLV>();

    // Initialize with all customers
    customers.forEach(c => {
      customerMap.set(c.id, {
        id: c.id,
        name: `${c.first_name} ${c.last_name}`,
        email: c.email,
        totalSpent: 0,
        bookingCount: 0,
        avgBookingValue: 0,
        firstBookingDate: null,
        lastBookingDate: null,
        daysSinceLastBooking: 999,
        frequency: 'None',
        clvScore: 0,
        tier: 'bronze'
      });
    });

    // Process bookings
    bookings
      .filter(b => b.customer?.id && b.status !== 'cancelled')
      .forEach(booking => {
        const customerId = booking.customer!.id;
        const existing = customerMap.get(customerId);
        
        if (existing) {
          const bookingDate = new Date(booking.scheduled_at);
          existing.totalSpent += Number(booking.total_amount || 0);
          existing.bookingCount += 1;
          
          if (!existing.firstBookingDate || bookingDate < existing.firstBookingDate) {
            existing.firstBookingDate = bookingDate;
          }
          if (!existing.lastBookingDate || bookingDate > existing.lastBookingDate) {
            existing.lastBookingDate = bookingDate;
          }
        }
      });

    // Calculate metrics
    const now = new Date();
    customerMap.forEach((customer, id) => {
      if (customer.bookingCount > 0) {
        customer.avgBookingValue = customer.totalSpent / customer.bookingCount;
        
        if (customer.lastBookingDate) {
          customer.daysSinceLastBooking = differenceInDays(now, customer.lastBookingDate);
        }

        // Calculate frequency
        if (customer.firstBookingDate && customer.lastBookingDate && customer.bookingCount > 1) {
          const daysBetween = differenceInDays(customer.lastBookingDate, customer.firstBookingDate);
          const avgDaysBetween = daysBetween / (customer.bookingCount - 1);
          
          if (avgDaysBetween <= 14) customer.frequency = 'Weekly';
          else if (avgDaysBetween <= 35) customer.frequency = 'Bi-weekly';
          else if (avgDaysBetween <= 45) customer.frequency = 'Monthly';
          else if (avgDaysBetween <= 100) customer.frequency = 'Quarterly';
          else customer.frequency = 'Occasional';
        } else if (customer.bookingCount === 1) {
          customer.frequency = 'One-time';
        }

        // Calculate CLV Score (RFM-based)
        // Recency: Lower days = higher score (max 100)
        const recencyScore = Math.max(0, 100 - customer.daysSinceLastBooking);
        // Frequency: More bookings = higher score
        const frequencyScore = Math.min(100, customer.bookingCount * 15);
        // Monetary: Higher spend = higher score
        const monetaryScore = Math.min(100, customer.totalSpent / 20);
        
        customer.clvScore = Math.round((recencyScore * 0.3) + (frequencyScore * 0.35) + (monetaryScore * 0.35));

        // Assign tier
        if (customer.clvScore >= 75) customer.tier = 'platinum';
        else if (customer.clvScore >= 50) customer.tier = 'gold';
        else if (customer.clvScore >= 25) customer.tier = 'silver';
        else customer.tier = 'bronze';
      }
    });

    return Array.from(customerMap.values())
      .filter(c => c.bookingCount > 0)
      .sort((a, b) => b.totalSpent - a.totalSpent);
  }, [bookings, customers]);

  const tierDistribution = useMemo(() => {
    const counts = { platinum: 0, gold: 0, silver: 0, bronze: 0 };
    customerCLVData.forEach(c => counts[c.tier]++);
    
    return [
      { name: 'Platinum', value: counts.platinum, color: tierColors.platinum },
      { name: 'Gold', value: counts.gold, color: tierColors.gold },
      { name: 'Silver', value: counts.silver, color: tierColors.silver },
      { name: 'Bronze', value: counts.bronze, color: tierColors.bronze },
    ].filter(t => t.value > 0);
  }, [customerCLVData]);

  const clvMetrics = useMemo(() => {
    if (customerCLVData.length === 0) return { avgCLV: 0, totalCLV: 0, avgBookings: 0, avgDaysBetween: 0 };
    
    const totalCLV = customerCLVData.reduce((sum, c) => sum + c.totalSpent, 0);
    const avgCLV = totalCLV / customerCLVData.length;
    const totalBookings = customerCLVData.reduce((sum, c) => sum + c.bookingCount, 0);
    const avgBookings = totalBookings / customerCLVData.length;
    
    // Average days between visits for repeat customers
    const repeatCustomers = customerCLVData.filter(c => c.bookingCount > 1);
    let avgDaysBetween = 0;
    if (repeatCustomers.length > 0) {
      const totalDays = repeatCustomers.reduce((sum, c) => {
        if (c.firstBookingDate && c.lastBookingDate) {
          return sum + differenceInDays(c.lastBookingDate, c.firstBookingDate) / (c.bookingCount - 1);
        }
        return sum;
      }, 0);
      avgDaysBetween = totalDays / repeatCustomers.length;
    }

    return { avgCLV, totalCLV, avgBookings, avgDaysBetween };
  }, [customerCLVData]);

  const topCustomersChartData = useMemo(() => {
    return customerCLVData.slice(0, 10).map(c => ({
      name: c.name,
      value: c.totalSpent,
      tier: c.tier
    }));
  }, [customerCLVData]);

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
              <p className="text-sm text-muted-foreground">Avg Customer Value</p>
              <p className="text-2xl font-bold">
                {`${fmt(clvMetrics.avgCLV)}`}
              </p>
            </div>
          </div>
        </Card>

        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-success/10">
              <TrendingUp className="h-5 w-5 text-success" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Total CLV</p>
              <p className="text-2xl font-bold">
                {`${fmt(clvMetrics.totalCLV)}`}
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
              <p className="text-sm text-muted-foreground">Avg Bookings/Customer</p>
              <p className="text-2xl font-bold">
                {clvMetrics.avgBookings.toFixed(1)}
              </p>
            </div>
          </div>
        </Card>

        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-warning/10">
              <Users className="h-5 w-5 text-warning" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Avg Days Between Visits</p>
              <p className="text-2xl font-bold">
                {clvMetrics.avgDaysBetween.toFixed(0)}
              </p>
            </div>
          </div>
        </Card>
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Top Customers Chart */}
        <Card className="p-4">
          <h3 className="font-semibold mb-4">Top 10 Customers by Lifetime Value</h3>
          <div className="h-[420px]">
            {topCustomersChartData.length === 0 ? (
              <div className="flex items-center justify-center h-full text-muted-foreground">
                No customer data available
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={topCustomersChartData} layout="vertical" margin={{ top: 4, right: 72, bottom: 4, left: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis type="number" tickFormatter={(v) => `$${v}`} />
                  <YAxis
                    type="category"
                    dataKey="name"
                    width={120}
                    interval={0}
                    tick={{ fontSize: 12 }}
                    tickFormatter={(v) => (v.length > 14 ? `${v.slice(0, 13)}…` : v)}
                  />
                  <Tooltip
                    cursor={{ fill: 'hsl(var(--muted))', fillOpacity: 0.4 }}
                    allowEscapeViewBox={{ x: true }}
                    contentStyle={{
                      backgroundColor: 'hsl(var(--popover))',
                      border: '1px solid hsl(var(--border))',
                      borderRadius: '8px',
                    }}
                    formatter={(value: number) => [`${fmt(value)}`, 'Total Spent']}
                  />
                  <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                    {topCustomersChartData.map((entry, index) => (
                      <Cell key={index} fill={tierColors[entry.tier]} />
                    ))}
                    <LabelList
                      dataKey="value"
                      position="right"
                      formatter={(v: any) => (fmt(v))}
                      fill="hsl(var(--foreground))"
                      fontSize={11}
                    />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </Card>

        {/* Tier Distribution */}
        <Card className="p-4 h-[300px] lg:h-full flex flex-col">
          <h3 className="font-semibold mb-4">Customer Tier Distribution</h3>
          <div className="flex-1 min-h-0">
            {tierDistribution.length === 0 ? (
              <div className="flex items-center justify-center h-full text-muted-foreground">
                No tier data available
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={tierDistribution}
                    cx="50%"
                    cy="50%"
                    innerRadius="42%"
                    outerRadius="65%"
                    dataKey="value"
                    nameKey="name"
                    label={({ name, value }) => `${name}: ${value}`}
                  >
                    {tierDistribution.map((entry, index) => (
                      <Cell key={index} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            )}
          </div>
        </Card>
      </div>

      {/* Customer Table */}
      <Card className="p-4">
        <h3 className="font-semibold mb-4">Customer Lifetime Value Details</h3>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="text-left border-b border-border">
                <th className="pb-3 font-medium text-muted-foreground">Customer</th>
                <th className="pb-3 font-medium text-muted-foreground">Tier</th>
                <th className="pb-3 font-medium text-muted-foreground text-right">Total Spent</th>
                <th className="pb-3 font-medium text-muted-foreground text-right">Bookings</th>
                <th className="pb-3 font-medium text-muted-foreground text-right">Avg Value</th>
                <th className="pb-3 font-medium text-muted-foreground">Frequency</th>
                <th className="pb-3 font-medium text-muted-foreground text-right">Days Since Last</th>
                <th className="pb-3 font-medium text-muted-foreground text-right">CLV Score</th>
              </tr>
            </thead>
            <tbody>
              {customerCLVData.slice(0, 20).map((customer, index) => (
                <tr key={customer.id} className="border-b border-border/50 last:border-0">
                  <td className="py-3">
                    <div>
                      <p className="font-medium">{customer.name}</p>
                      <p className="text-sm text-muted-foreground">{customer.email}</p>
                    </div>
                  </td>
                  <td className="py-3">
                    <Badge variant="outline" className={tierBadgeStyles[customer.tier]}>
                      <Star className="w-3 h-3 mr-1" />
                      {customer.tier.charAt(0).toUpperCase() + customer.tier.slice(1)}
                    </Badge>
                  </td>
                  <td className="py-3 text-right font-semibold text-success">
                    {`${fmt(customer.totalSpent)}`}
                  </td>
                  <td className="py-3 text-right">{customer.bookingCount}</td>
                  <td className="py-3 text-right">
                    {`${fmt(customer.avgBookingValue)}`}
                  </td>
                  <td className="py-3">
                    <Badge variant="secondary">{customer.frequency}</Badge>
                  </td>
                  <td className="py-3 text-right">
                    <span className={customer.daysSinceLastBooking > 60 ? 'text-destructive' : ''}>
                      {customer.daysSinceLastBooking}
                    </span>
                  </td>
                  <td className="py-3 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <div className="w-16 h-2 bg-muted rounded-full overflow-hidden">
                        <div 
                          className="h-full rounded-full" 
                          style={{ 
                            width: `${customer.clvScore}%`,
                            backgroundColor: tierColors[customer.tier]
                          }} 
                        />
                      </div>
                      <span className="text-sm font-medium w-8">{customer.clvScore}</span>
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
