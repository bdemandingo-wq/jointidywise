import { Capacitor } from '@capacitor/core';
import { supabase } from '@/lib/supabase';
import WidgetBridge from '@/lib/widgetBridge';

// --- Next Booking ---

interface NextBookingData {
  bookingId: string;
  customerName: string;
  serviceType: string;
  address: string;
  scheduledAt: string;
  cleanerName: string;
  isEmpty: false;
}

interface NextBookingEmpty {
  isEmpty: true;
}

// --- Today's Schedule ---

interface ScheduleBooking {
  bookingId: string;
  customerName: string;
  serviceType: string;
  scheduledAt: string;
  price: number;
}

interface UpcomingScheduleData {
  totalJobs: number;
  bookings: ScheduleBooking[];
  isEmpty: false;
}

interface UpcomingScheduleEmpty {
  totalJobs: 0;
  bookings: [];
  isEmpty: true;
}

// --- Daily Stats ---

interface DailyStatsData {
  revenue: number;
  jobsCompleted: number;
  jobsRemaining: number;
  nextCustomerName: string | null;
  nextScheduledAt: string | null;
  nextBookingId: string | null;
}

export async function syncWidgetData(): Promise<void> {
  console.log('[WidgetSync] called, isNative:', Capacitor.isNativePlatform(), 'platform:', Capacitor.getPlatform());
  if (!Capacitor.isNativePlatform()) {
    console.log('[WidgetSync] skipped — not native');
    return;
  }

  try {
    const { data: { session } } = await supabase.auth.getSession();
    console.log('[WidgetSync] session:', session ? `user=${session.user.email}` : 'null');
    if (!session) {
      return;
    }

    await Promise.all([
      syncNextBooking(),
      syncUpcomingSchedule(),
      syncDailyStats(),
      syncDailyPay(),
      syncWeeklyRevenue(),
    ]);
    console.log('[WidgetSync] all syncs complete');
  } catch (err) {
    console.error('[WidgetSync] top-level error:', err);
  }
}

async function syncNextBooking(): Promise<void> {
  const { data: booking, error } = await supabase
    .from('bookings')
    .select(`
      id,
      scheduled_at,
      address,
      customer:customers(first_name, last_name),
      service:services(name),
      staff:staff(name)
    `)
    .neq('status', 'cancelled')
    .gt('scheduled_at', new Date().toISOString())
    .order('scheduled_at', { ascending: true })
    .order('id', { ascending: true })
    .limit(1)
    .maybeSingle();

  console.log('[WidgetSync:nextBooking] query result:', JSON.stringify({ booking, error: error?.message }));

  if (error) {
    console.error('[WidgetSync:nextBooking] query error:', error.message);
    return;
  }

  let data: NextBookingData | NextBookingEmpty;

  if (booking) {
    const customer = booking.customer as { first_name: string; last_name: string } | null;
    const service = booking.service as { name: string } | null;
    const staff = booking.staff as { name: string } | null;

    data = {
      bookingId: booking.id,
      customerName: customer
        ? `${customer.first_name} ${customer.last_name}`.trim()
        : 'Customer',
      serviceType: service?.name ?? 'Cleaning',
      address: booking.address ?? '',
      scheduledAt: booking.scheduled_at,
      cleanerName: staff?.name ?? '',
      isEmpty: false,
    };
  } else {
    data = { isEmpty: true };
  }

  const json = JSON.stringify(data);
  console.log('[WidgetSync:nextBooking] writing:', json);
  try {
    await WidgetBridge.syncBookingData({ json, key: 'widgetNextBooking' });
    console.log('[WidgetSync:nextBooking] bridge call succeeded');
  } catch (bridgeErr) {
    console.error('[WidgetSync:nextBooking] bridge call FAILED:', bridgeErr);
  }
}

async function syncUpcomingSchedule(): Promise<void> {
  const { data: bookings, error } = await supabase
    .from('bookings')
    .select(`
      id,
      scheduled_at,
      total_amount,
      customer:customers(first_name, last_name),
      service:services(name)
    `)
    .neq('status', 'cancelled')
    .gt('scheduled_at', new Date().toISOString())
    .order('scheduled_at', { ascending: true })
    .order('id', { ascending: true })
    .limit(10);

  if (error) {
    console.error('[WidgetSync:upcoming] query error:', error.message);
    return;
  }

  let data: UpcomingScheduleData | UpcomingScheduleEmpty;

  if (bookings && bookings.length > 0) {
    data = {
      totalJobs: bookings.length,
      bookings: bookings.map((b) => {
        const customer = b.customer as { first_name: string; last_name: string } | null;
        const service = b.service as { name: string } | null;
        return {
          bookingId: b.id,
          customerName: customer
            ? `${customer.first_name} ${customer.last_name}`.trim()
            : 'Customer',
          serviceType: service?.name ?? 'Cleaning',
          scheduledAt: b.scheduled_at,
          price: b.total_amount ?? 0,
        };
      }),
      isEmpty: false,
    };
  } else {
    data = { totalJobs: 0, bookings: [], isEmpty: true };
  }

  await WidgetBridge.syncBookingData({ json: JSON.stringify(data), key: 'widgetUpcomingSchedule' });
}

async function syncDailyStats(): Promise<void> {
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).toISOString();

  const { data: bookings, error } = await supabase
    .from('bookings')
    .select(`
      id,
      scheduled_at,
      total_amount,
      status,
      customer:customers(first_name, last_name)
    `)
    .neq('status', 'cancelled')
    .gte('scheduled_at', startOfDay)
    .lt('scheduled_at', endOfDay)
    .order('scheduled_at', { ascending: true })
    .order('id', { ascending: true })
    .limit(100);

  if (error) {
    console.error('[WidgetSync:dailyStats] query error:', error.message);
    return;
  }

  const completed = (bookings ?? []).filter((b) => b.status === 'completed');
  const remaining = (bookings ?? []).filter((b) => b.status !== 'completed');
  const revenue = completed.reduce((sum, b) => sum + (b.total_amount ?? 0), 0);

  const nextRemaining = remaining[0];
  const nextCustomer = nextRemaining?.customer as { first_name: string; last_name: string } | null;

  const data: DailyStatsData = {
    revenue,
    jobsCompleted: completed.length,
    jobsRemaining: remaining.length,
    nextCustomerName: nextCustomer
      ? `${nextCustomer.first_name} ${nextCustomer.last_name}`.trim()
      : null,
    nextScheduledAt: nextRemaining?.scheduled_at ?? null,
    nextBookingId: nextRemaining?.id ?? null,
  };

  await WidgetBridge.syncBookingData({ json: JSON.stringify(data), key: 'widgetDailyStats' });
}

async function syncDailyPay(): Promise<void> {
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).toISOString();

  const { data: assignments, error } = await supabase
    .from('booking_team_assignments')
    .select(`
      pay_share,
      staff:staff(name),
      booking:bookings!inner(scheduled_at, status)
    `)
    .gte('bookings.scheduled_at', startOfDay)
    .lt('bookings.scheduled_at', endOfDay)
    .neq('bookings.status', 'cancelled')
    .limit(200);

  if (error) {
    // Fallback: query bookings directly for cleaner_pay_expected
    const { data: bookings, error: fbErr } = await supabase
      .from('bookings')
      .select('cleaner_pay_expected, status, staff:staff(name)')
      .neq('status', 'cancelled')
      .gte('scheduled_at', startOfDay)
      .lt('scheduled_at', endOfDay)
      .order('id', { ascending: true })
      .limit(100);

    if (fbErr) {
      console.error('[WidgetSync:dailyPay] query error:', fbErr.message);
      return;
    }

    const cleanerMap: Record<string, number> = {};
    for (const b of bookings ?? []) {
      const staff = b.staff as { name: string } | null;
      const name = staff?.name ?? 'Unassigned';
      cleanerMap[name] = (cleanerMap[name] ?? 0) + (b.cleaner_pay_expected ?? 0);
    }

    const cleaners = Object.entries(cleanerMap).map(([name, amount]) => ({ name, amount }));
    const total = cleaners.reduce((s, c) => s + c.amount, 0);

    await WidgetBridge.syncBookingData({
      json: JSON.stringify({ total, cleaners }),
      key: 'widgetDailyPay',
    });
    return;
  }

  const cleanerMap: Record<string, number> = {};
  for (const a of assignments ?? []) {
    const staff = a.staff as { name: string } | null;
    const name = staff?.name ?? 'Unassigned';
    cleanerMap[name] = (cleanerMap[name] ?? 0) + (a.pay_share ?? 0);
  }

  const cleaners = Object.entries(cleanerMap).map(([name, amount]) => ({ name, amount }));
  const total = cleaners.reduce((s, c) => s + c.amount, 0);

  await WidgetBridge.syncBookingData({
    json: JSON.stringify({ total, cleaners }),
    key: 'widgetDailyPay',
  });
}

async function syncWeeklyRevenue(): Promise<void> {
  const now = new Date();
  const dayOfWeek = now.getDay(); // 0=Sun
  const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;

  const thisMonday = new Date(now.getFullYear(), now.getMonth(), now.getDate() + mondayOffset);
  const lastMonday = new Date(thisMonday.getFullYear(), thisMonday.getMonth(), thisMonday.getDate() - 7);
  const nextMonday = new Date(thisMonday.getFullYear(), thisMonday.getMonth(), thisMonday.getDate() + 7);

  const { data: bookings, error } = await supabase
    .from('bookings')
    .select('total_amount, scheduled_at, status')
    .eq('status', 'completed')
    .gte('scheduled_at', lastMonday.toISOString())
    .lt('scheduled_at', nextMonday.toISOString())
    .order('scheduled_at', { ascending: true })
    .order('id', { ascending: true })
    .limit(500);

  if (error) {
    console.error('[WidgetSync:weeklyRevenue] query error:', error.message);
    return;
  }

  let thisWeek = 0;
  let lastWeek = 0;
  const thisStart = thisMonday.getTime();

  for (const b of bookings ?? []) {
    const t = new Date(b.scheduled_at).getTime();
    if (t >= thisStart) {
      thisWeek += b.total_amount ?? 0;
    } else {
      lastWeek += b.total_amount ?? 0;
    }
  }

  const pctChange = lastWeek > 0 ? Math.round(((thisWeek - lastWeek) / lastWeek) * 100) : 0;

  await WidgetBridge.syncBookingData({
    json: JSON.stringify({ thisWeek, lastWeek, pctChange }),
    key: 'widgetWeeklyRevenue',
  });
}
