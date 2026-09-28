import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useOrgTimezone } from '@/hooks/useOrgTimezone';
import { orgStartOfWeek, orgEndOfWeek } from '@/lib/orgDateRange';
import { resolveCleanerPay } from '@/lib/wageCalculation';
import { bookingStatusBadge } from '@/lib/bookingStatus';
import { combinedPhase } from '@/lib/queryState';
import { CleanerHomeView, type HomeJob, type SetupStep } from '@/components/portal-v2';
import { formatTimestampWithZone } from '@/lib/timezoneUtils';

/**
 * Screen 2a wired to real data — the cleaner's home.
 *
 * ADDITIVE, at /staff/home. StaffPortal (1,573 lines, 13 tabs) is untouched;
 * replacing it would mean porting every tab at once. All presentation lives in
 * CleanerHomeView so its states stay renderable from fixtures.
 *
 * The dual-org lesson from 3a is applied from the start: a cleaner can have
 * more than one staff row, so nothing here uses .maybeSingle() on a user_id
 * lookup, and the profile comes from get_my_staff_profile per org.
 */

const MONEY = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });

const timeLabel = (iso: string, tz: string) =>
  formatTimestampWithZone(iso, tz);

export default function StaffHomePage() {
  const navigate = useNavigate();
  const [tab, setTab] = useState('today');

  const rowsQ = useQuery({
    queryKey: ['staff-rows'],
    queryFn: async () => {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) return null;
      const { data, error } = await supabase
        .from('staff')
        .select('id, organization_id, is_active')
        .eq('user_id', auth.user.id)
        .order('created_at', { ascending: true })
        .order('id', { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });

  const rows = rowsQ.data;
  const anyActive = !!rows?.some((r) => r.is_active);
  const staffRow = useMemo(() => rows?.find((r) => r.is_active) ?? null, [rows]);
  const { timezone: orgTz } = useOrgTimezone(staffRow?.organization_id ?? null);

  const profileQ = useQuery({
    queryKey: ['staff-profile', staffRow?.organization_id],
    enabled: !!staffRow?.organization_id,
    queryFn: async () => {
      const { data, error } = await (supabase as never as {
        rpc: (n: string, a: Record<string, unknown>) => {
          maybeSingle: () => Promise<{ data: unknown; error: unknown }>;
        };
      })
        .rpc('get_my_staff_profile', { p_organization_id: staffRow!.organization_id })
        .maybeSingle();
      if (error) throw error;
      return data as { name: string | null; base_wage: number | null; hourly_rate: number | null; default_hours: number | null } | null;
    },
  });

  /* Assigned jobs. Errors are thrown, not swallowed — the live
     OnboardingProgress swallows its reads and that is the bug below. */
  const jobsQ = useQuery({
    queryKey: ['staff-home-jobs', staffRow?.id],
    enabled: !!staffRow?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('bookings')
        .select(`
          id, organization_id, booking_number, scheduled_at, duration, status,
          city, zip_code, notes,
          total_amount, subtotal, discount_amount,
          cleaner_wage, cleaner_wage_type, cleaner_actual_payment, cleaner_pay_expected,
          cleaner_override_hours, cleaner_checkin_at, cleaner_checkout_at,
          service:services(name)
        `)
        .eq('staff_id', staffRow!.id)
        .in('status', ['pending', 'confirmed', 'in_progress'])
        .order('scheduled_at', { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });

  /* Week totals in the ORG's week, not the device's — a cleaner in another
     timezone was seeing a different week (see CleanerEarnings). */
  const weekQ = useQuery({
    queryKey: ['staff-home-week', staffRow?.id, orgTz],
    enabled: !!staffRow?.id,
    queryFn: async () => {
      const from = orgStartOfWeek(new Date(), orgTz, 1);
      const to = orgEndOfWeek(new Date(), orgTz, 1);
      const { data, error } = await supabase
        .from('bookings')
        .select(`
          id, duration, status, total_amount, subtotal, discount_amount,
          cleaner_wage, cleaner_wage_type, cleaner_actual_payment, cleaner_pay_expected,
          cleaner_override_hours, cleaner_checkin_at, cleaner_checkout_at
        `)
        .eq('staff_id', staffRow!.id)
        .neq('status', 'cancelled')
        .gte('scheduled_at', from.toISOString())
        .lte('scheduled_at', to.toISOString());
      if (error) throw error;
      return data ?? [];
    },
  });

  /* The four real onboarding steps. Unlike OnboardingProgress, every read
     throws on error so a failure cannot render as "not done". */
  const setupQ = useQuery({
    queryKey: ['staff-home-setup', staffRow?.id, staffRow?.organization_id],
    enabled: !!staffRow?.id && !!staffRow?.organization_id,
    queryFn: async (): Promise<SetupStep[]> => {
      const sid = staffRow!.id;
      const oid = staffRow!.organization_id!;
      const [avail, docs, signable, sigs, payout] = await Promise.all([
        supabase.from('working_hours').select('id').eq('staff_id', sid),
        supabase.from('staff_documents').select('id, status').eq('staff_id', sid),
        supabase.from('staff_signable_documents').select('id').eq('organization_id', oid).eq('is_active', true),
        supabase.from('staff_signatures').select('id').eq('staff_id', sid),
        supabase.from('staff_payout_accounts').select('account_status').eq('staff_id', sid),
      ]);
      for (const r of [avail, docs, signable, sigs, payout]) if (r.error) throw r.error;

      const required = signable.data?.length ?? 0;
      const signed = sigs.data?.length ?? 0;
      const acct = payout.data?.[0]?.account_status ?? null;

      return [
        { id: 'availability', label: 'Set Availability', done: (avail.data?.length ?? 0) > 0 },
        { id: 'documents', label: 'Upload Documents', done: (docs.data?.length ?? 0) > 0 },
        {
          id: 'signatures',
          label: 'Sign Agreements',
          description: required === 0 ? 'No documents to sign yet' : `${signed}/${required} signed`,
          done: required === 0 ? true : signed >= required,
        },
        {
          id: 'payouts',
          label: 'Set Up Payouts',
          description:
            acct === 'pending_verification' || acct === 'onboarding' ? 'Verification pending' : undefined,
          done: acct === 'active',
          pending: acct === 'pending_verification' || acct === 'onboarding',
        },
      ];
    },
  });

  const notifQ = useQuery({
    queryKey: ['staff-home-notifs', staffRow?.id],
    enabled: !!staffRow?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cleaner_notifications')
        .select('id, is_read')
        .eq('staff_id', staffRow!.id)
        .limit(50);
      if (error) throw error;
      return (data ?? []).filter((n) => !n.is_read).length;
    },
  });

  const profile = profileQ.data;

  const jobs: HomeJob[] = useMemo(() => {
    if (!jobsQ.data || !profile) return [];
    return jobsQ.data.map((b) => {
      const pay = resolveCleanerPay(b as never, profile as never, null);
      const start = b.scheduled_at ? timeLabel(b.scheduled_at, orgTz) : '';
      const end =
        b.scheduled_at && b.duration
          ? timeLabel(new Date(new Date(b.scheduled_at).getTime() + b.duration * 60000).toISOString(), orgTz)
          : '';
      return {
        id: b.id,
        ref: `#${b.booking_number}`,
        service: b.service?.name ?? 'Cleaning',
        status: bookingStatusBadge(b.status),
        time: start && end ? `${start} – ${end}` : start || 'Not scheduled',
        area: [b.city, b.zip_code].filter(Boolean).join(' · ') || 'No address on file',
        /* §5.1: a job with no pay set shows the words, never $0.00. */
        pay: pay.isMissingPay ? 'Pay not set' : MONEY(pay.calculatedPay),
        note: b.notes ?? undefined,
        unlockCaption: b.cleaner_checkout_at
          ? 'Job complete'
          : b.cleaner_checkin_at
            ? 'In progress'
            : 'Full controls are on My jobs',
      };
    });
  }, [jobsQ.data, profile, orgTz]);

  const week = useMemo(() => {
    if (!weekQ.data || !profile) return null;
    let earned = 0;
    let hours = 0;
    for (const b of weekQ.data) {
      const p = resolveCleanerPay(b as never, profile as never, null);
      if (!p.isMissingPay) earned += p.calculatedPay;
      hours += p.hoursWorked;
    }
    return { earned: MONEY(earned), jobs: String(weekQ.data.length), hours: hours.toFixed(1) };
  }, [weekQ.data, profile]);

  /* Offline is ruled out before absence is allowed to mean anything — a
     paused read has no error and isLoading false, so this used to render
     "No staff record" to a cleaner who simply had no signal. */
  const phase = combinedPhase([rowsQ, profileQ]);

  const mode = phase === 'error'
    ? 'error'
    : phase === 'offline'
      ? 'offline'
      : rowsQ.isPending
        ? 'loading'
        : !rows?.length
          ? 'noStaff'
          : !anyActive
            ? 'deactivated'
            : 'ready';

  const setupSteps = setupQ.data ?? null;
  const outstanding = setupSteps?.some((s) => !s.done) ?? false;

  return (
    <CleanerHomeView
      mode={mode}
      name={profile?.name ?? 'there'}
      notifications={notifQ.data ?? 0}
      /* §5.1: omitted entirely when nothing is outstanding. */
      setup={outstanding ? setupSteps : null}
      setupState={setupQ.error ? 'error' : setupQ.isLoading ? 'loading' : 'ready'}
      week={week}
      weekState={weekQ.error ? 'error' : weekQ.isLoading || !profile ? 'loading' : 'ready'}
      tabs={[{ id: 'today', label: 'Assigned', count: jobs.length }]}
      tab={tab}
      onTab={setTab}
      jobs={jobs}
      jobsState={jobsQ.error ? 'error' : jobsQ.isLoading || !profile ? 'loading' : 'ready'}
      onRetrySetup={() => setupQ.refetch()}
      onRetryWeek={() => weekQ.refetch()}
      onRetryJobs={() => jobsQ.refetch()}
      onOpenJob={(id) => navigate(`/staff/job/${id}`)}
    />
  );
}
