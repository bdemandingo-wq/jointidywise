import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useOrganization } from '@/contexts/OrganizationContext';
import { useOrgRole } from '@/hooks/useOrgRole';
import { useNotificationPreferences } from '@/hooks/useNotificationPreferences';
import { useCleanerPayoutSetupRequired } from '@/hooks/useCleanerPayoutSetupRequired';
import { useDismissedBadges } from '@/hooks/useDismissedBadges';
import { NOTIFICATION_TYPES, isChannelEnabled, isMasterChannelOn } from '@/lib/notificationCatalog';
import { orgDateKey, orgStartOfWeek } from '@/lib/orgDateRange';
import { useOrgTimezone } from '@/hooks/useOrgTimezone';

/**
 * Centralized sidebar badge counts + breakdowns.
 *
 * Each nav href has:
 *   - a numeric count (sum of enabled sub-counts)
 *   - a breakdown array of {key, label, count}
 *
 * Breakdowns power the sidebar hover tooltip (display only — those rows are not
 * links) and the on-page "Attention" strip, where clicking a reason calls
 * onReasonClick and the page switches on its `key`. Individual sub-counts are
 * gated by the organization's notification preferences.
 */

export interface BadgeReason {
  key: string;
  label: string;
  count: number;
  /*
    There is deliberately no `filter` here any more.

    A `filter?: string` carrying query strings ('status=pending',
    'payment=pending' and so on) sat on every reason for a long time and was
    read by NOTHING. The sidebar tooltip renders each row as a plain <p> — never
    a link — and AttentionStrip, the one surface where reasons ARE clickable,
    dispatches on `key` via onReasonClick. Grepped: zero consumers.

    It was worse than dead weight. Its presence repeatedly read as "these are
    deep-links and they're broken", producing a bug report and a risk assessment
    for a defect that did not exist. The `key` values were correct the whole
    time; only the filter was misleading.

    If per-reason navigation is ever built, carry the matching row IDs rather
    than a query string. A query string means re-deriving each badge's predicate
    on the page, which is two definitions of the same thing in two files — the
    exact shape of the ['staff'] / ['staff-all'] drift fixed in a6ac1263.
  */
}

export interface SidebarBadgeData {
  counts: Record<string, number>;
  breakdowns: Record<string, BadgeReason[]>;
}

export function useSidebarBadgesFull(): SidebarBadgeData {
  // Badge counts are per BUSINESS day.
  const { timezone: orgTimezone } = useOrgTimezone();
  const { organization } = useOrganization();
  const { hasFinancialAccess, isOwner } = useOrgRole();
  const orgId = organization?.id;
  const queryClient = useQueryClient();
  const prefs = useNotificationPreferences();
  const payoutRequired = useCleanerPayoutSetupRequired(orgId);
  const dismissed = useDismissedBadges();
  const showBadges = isMasterChannelOn('sidebar', prefs.channels) && prefs.channels['channel.sidebar_badge'] !== false;
  const sb = prefs.sidebar_badges;
  // Aggregate the matrix into a "sidebar allowed" lookup by legacy sidebarKey.
  // If ANY type mapped to a given sidebarKey has sidebar channel enabled, we allow the badge.
  const sidebarAllowedByLegacyKey = useMemo(() => {
    const map: Record<string, boolean> = {};
    for (const t of NOTIFICATION_TYPES) {
      if (!t.sidebarKey) continue;
      if (t.managerLocked && !hasFinancialAccess) continue;
      const enabled = isChannelEnabled(t.key, 'sidebar', prefs.notification_matrix, prefs.snoozed_until, prefs.channels);
      map[t.sidebarKey] = map[t.sidebarKey] || enabled;
    }
    return map;
  }, [prefs.notification_matrix, prefs.snoozed_until, prefs.channels, hasFinancialAccess]);
  const on = (k: string) =>
    showBadges && sb[k] !== false && sidebarAllowedByLegacyKey[k] !== false;

  // Twelve badge queries used to leave with the dashboard's first bookings
  // read. On a large org that stampede sat on the same connection pool and
  // the auth lock, and the jobs the owner is waiting to see waited with it.
  const [badgesReady, setBadgesReady] = useState(false);
  useEffect(() => {
    if (!orgId) {
      setBadgesReady(false);
      return;
    }
    const timer = window.setTimeout(() => setBadgesReady(true), 2000);
    return () => window.clearTimeout(timer);
  }, [orgId]);
  const enabled = !!orgId && badgesReady;
  /*
    Badge polling used to be a flat 60s across all 12 queries — 12 requests a
    minute on every admin page, forever, whether or not anything changed.

    Nine of the badge-driving tables already push through the realtime channel
    below, so polling them was pure duplication: the invalidation arrives the
    moment a row changes. Those now don't poll at all; they refetch on realtime,
    on mount, and on window focus.

    The five with no realtime coverage (invoices, inventory, automation,
    campaigns, payment) still poll, but at 5 minutes and never while the tab is
    in the background. Net: 12 requests/min -> 1 request/min while active, 0
    while backgrounded.
  */
  const REALTIME_BACKED = { refetchInterval: false as const, staleTime: 60_000, refetchOnWindowFocus: true };
  const POLLED = { refetchInterval: 300_000, refetchIntervalInBackground: false, staleTime: 120_000, refetchOnWindowFocus: true };

  // ── Staff
  // Destructure `error` on every badge query. A failed badge must not show 0
  // (which reads as "nothing needs attention"); it must show nothing at all.
  // The useMemo below treats null data as "unknown" and hides the badge.
  const { data: staff = null, error: staffError } = useQuery<{ timeOff: number; docs: number; payout: number }>({
    queryKey: ['sb-staff', orgId, payoutRequired],
    enabled,
    ...REALTIME_BACKED,
    queryFn: async () => {
      if (!orgId) return { timeOff: 0, docs: 0, payout: 0 };
      const [timeOff, docs, payouts] = await Promise.all([
        (supabase as any).from('time_off_requests').select('*', { count: 'exact', head: true }).eq('organization_id', orgId).eq('status', 'pending'),
        supabase.from('staff_documents').select('*', { count: 'exact', head: true }).eq('organization_id', orgId).eq('status', 'pending'),
        payoutRequired
          ? supabase.from('staff_payout_accounts').select('id, disabled_reason, requirements_currently_due').eq('organization_id', orgId)
          : Promise.resolve({ data: [] as any[] }),
      ]);
      const payout = (payouts.data || []).filter((a: any) =>
        a?.disabled_reason || (Array.isArray(a?.requirements_currently_due) && a.requirements_currently_due.length > 0)
      ).length;
      return { timeOff: timeOff.count || 0, docs: docs.count || 0, payout };
    },
  });

  // ── Bookings
  const { data: bookings = null, error: bookingsError } = useQuery<{ pending: number; unassigned: number; payment: number; chargeFailed: number }>({
    queryKey: ['sb-bookings', orgId, orgTimezone],
    enabled,
    ...REALTIME_BACKED,
    queryFn: async () => {
      if (!orgId) return { pending: 0, unassigned: 0, payment: 0, chargeFailed: 0 };
      const now = new Date().toISOString();

      // Monday, deliberately hardcoded. The only org-configured week start on
      // the platform is payroll_settings.payroll_week_start_day, which is a
      // PAYROLL setting — and reading it here would mean someone moving payroll
      // to Sunday for wage reasons silently reframes an unrelated notification.
      // (That table is also empty for every org today, so it would resolve to
      // Monday regardless.) Computed in the ORG's zone, so the week does not
      // turn over at the viewer's midnight.
      const weekStart = orgStartOfWeek(new Date(), orgTimezone, 1).toISOString();

      const [pending, unassigned, uncollected, failedRows] = await Promise.all([
        supabase.from('bookings').select('*', { count: 'exact', head: true }).eq('organization_id', orgId).eq('status', 'pending').gte('scheduled_at', now),
        supabase.from('bookings').select('*', { count: 'exact', head: true }).eq('organization_id', orgId).is('staff_id', null).neq('status', 'cancelled').gte('scheduled_at', now),
        // Money still collectable: a job that HAPPENED this week and has not
        // been marked paid. `completed` does the work of three filters — it
        // excludes future bookings (not owed yet) and cancelled ones (never
        // going to be paid, and previously a permanent floor under this badge:
        // TIDYWISE sat at 7 here, of which 6 were cancelled).
        //
        // payment_status 'pending' means "never collected", not "Stripe has not
        // settled": the enum has no `failed` value, and zero completed bookings
        // carry a payment_intent_id while still pending. Do NOT add
        // `payment_intent_id is null` as hardening — a failed charge can leave
        // an intent behind, so it would hide exactly the rows worth chasing.
        supabase.from('bookings').select('*', { count: 'exact', head: true }).eq('organization_id', orgId).eq('status', 'completed').eq('payment_status', 'pending').gte('scheduled_at', weekStart),
        // Charge attempts that failed. Ordered and bounded per the paging rule;
        // a genuine org will have a handful, and 500 is far past that.
        (supabase as any).from('charge_audit_log').select('booking_id').eq('organization_id', orgId).eq('match_status', 'fail').not('booking_id', 'is', null).order('created_at', { ascending: false }).limit(500),
      ]);

      // A failed charge only needs action while the money is still outstanding.
      // Counting every failure ever would rebuild the problem this badge just
      // shed — TIDYWISE has 7 such bookings and all 7 were later collected, so
      // an all-time count would sit at 7 forever with nothing to click.
      const failedIds = [...new Set(((failedRows.data || []) as { booking_id: string }[]).map(r => r.booking_id))];
      let chargeFailed = 0;
      if (failedIds.length > 0) {
        const { count } = await supabase
          .from('bookings')
          .select('*', { count: 'exact', head: true })
          .eq('organization_id', orgId)
          .in('id', failedIds)
          .eq('payment_status', 'pending')
          .neq('status', 'cancelled');
        chargeFailed = count || 0;
      }

      return {
        pending: pending.count || 0,
        unassigned: unassigned.count || 0,
        payment: uncollected.count || 0,
        chargeFailed,
      };
    },
  });

  // ── Client Portal
  const { data: clientPortal = null, error: clientPortalError } = useQuery<number>({
    queryKey: ['sb-client-portal', orgId],
    enabled,
    ...REALTIME_BACKED,
    queryFn: async () => {
      if (!orgId) return 0;
      const { count } = await supabase.from('client_booking_requests').select('*', { count: 'exact', head: true }).eq('organization_id', orgId).eq('status', 'pending');
      return count || 0;
    },
  });

  // ── Invoices
  const { data: invoices = null, error: invoicesError } = useQuery<{ overdue: number }>({
    queryKey: ['sb-invoices', orgId],
    enabled: enabled && hasFinancialAccess,
    ...POLLED,
    queryFn: async () => {
      if (!orgId) return { overdue: 0 };
      // Reads the STORED status, matching InvoicesPage's Overdue card exactly.
      //
      // This used to compute overdue itself — not paid, not void, due_date in the
      // past — which is arguably the truer number, but it meant the sidebar and
      // the page could disagree whenever send-invoice-reminder's cron had not yet
      // flipped a status. One definition, maintained by that cron, beats two that
      // are each defensible.
      //
      // The `failed` count is gone. It queried .eq('status','failed'), and
      // 'failed' is not in the invoices CHECK constraint (draft | sent | paid |
      // overdue | cancelled), so that badge was permanently zero. There is no
      // org-level concept of a failed invoice: invoice.payment_failed concerns
      // TidyWise's own subscription billing and writes nothing to `invoices`.
      const overdue = await supabase
        .from('invoices')
        .select('*', { count: 'exact', head: true })
        .eq('organization_id', orgId)
        .eq('status', 'overdue');
      return { overdue: overdue.count || 0 };
    },
  });

  // ── Messages
  const { data: messages = null, error: messagesError } = useQuery<{ unreadConvs: number; unreadTotal: number }>({
    queryKey: ['sb-messages', orgId],
    enabled,
    ...REALTIME_BACKED,
    queryFn: async () => {
      if (!orgId) return { unreadConvs: 0, unreadTotal: 0 };
      const { data } = await supabase
        .from('sms_conversations')
        .select('unread_count')
        .eq('organization_id', orgId)
        .gt('unread_count', 0);
      const rows = data || [];
      const unreadConvs = rows.filter((c: any) => (c.unread_count || 0) > 0).length;
      const unreadTotal = rows.reduce((s: number, c: any) => s + (c.unread_count || 0), 0);
      return { unreadConvs, unreadTotal };
    },
  });

  // ── Tasks
  const { data: tasks = null, error: tasksError } = useQuery<{ open: number; overdue: number }>({
    queryKey: ['sb-tasks', orgId],
    enabled,
    ...REALTIME_BACKED,
    queryFn: async () => {
      if (!orgId) return { open: 0, overdue: 0 };
      // Was the UTC date, so the "due today" badge changed over mid-afternoon
      // in the Americas instead of at the business's midnight.
      const today = orgDateKey(new Date(), orgTimezone);
      const { data } = await supabase
        .from('tasks_and_notes')
        .select('due_date, is_completed, type')
        .eq('organization_id', orgId)
        .in('type', ['daily', 'weekly', 'monthly'])
        .eq('is_completed', false);
      const rows = data || [];
      const overdue = rows.filter((r: any) => r.due_date && r.due_date < today).length;
      return { open: rows.length, overdue };
    },
  });

  // ── Leads (actionable = new + follow_up)
  const { data: leads = null, error: leadsError } = useQuery<{ newCount: number; followUp: number }>({
    queryKey: ['sb-leads', orgId],
    enabled,
    ...REALTIME_BACKED,
    queryFn: async () => {
      if (!orgId) return { newCount: 0, followUp: 0 };
      const [n, f] = await Promise.all([
        supabase.from('leads').select('*', { count: 'exact', head: true }).eq('organization_id', orgId).eq('status', 'new'),
        supabase.from('leads').select('*', { count: 'exact', head: true }).eq('organization_id', orgId).eq('status', 'follow_up'),
      ]);
      return { newCount: n.count || 0, followUp: f.count || 0 };
    },
  });

  // ── Inventory
  const { data: inventory = null, error: inventoryError } = useQuery<number>({
    queryKey: ['sb-inventory', orgId],
    enabled,
    ...POLLED,
    queryFn: async () => {
      if (!orgId) return 0;
      const { data } = await supabase.from('inventory_items').select('quantity, min_quantity').eq('organization_id', orgId);
      return (data || []).filter((i: any) => (i.quantity ?? 0) <= (i.min_quantity ?? 0)).length;
    },
  });

  // ── Automation
  const { data: automation = null, error: automationError } = useQuery<number>({
    queryKey: ['sb-automation', orgId],
    enabled,
    ...POLLED,
    queryFn: async () => {
      if (!orgId) return 0;
      const since = new Date(Date.now() - 7 * 24 * 3600_000).toISOString();
      const { count } = await supabase.from('custom_automation_logs').select('*', { count: 'exact', head: true }).eq('organization_id', orgId).eq('status', 'failed').gte('created_at', since);
      return count || 0;
    },
  });

  // ── Campaigns
  const { data: campaigns = null, error: campaignsError } = useQuery<number>({
    queryKey: ['sb-campaigns', orgId],
    enabled,
    ...POLLED,
    queryFn: async () => {
      if (!orgId) return 0;
      const since = new Date(Date.now() - 7 * 24 * 3600_000).toISOString();
      const [sms, emails] = await Promise.all([
        supabase.from('campaign_sms_sends').select('*', { count: 'exact', head: true }).eq('organization_id', orgId).eq('status', 'failed').gte('sent_at', since),
        supabase.from('campaign_emails').select('*', { count: 'exact', head: true }).eq('organization_id', orgId).eq('status', 'failed').gte('sent_at', since),
      ]);
      return (sms.count || 0) + (emails.count || 0);
    },
  });

  // ── Payment Setup (owner only)
  const { data: payment = null, error: paymentError } = useQuery<number>({
    queryKey: ['sb-payment', orgId],
    enabled: enabled && isOwner,
    ...POLLED,
    queryFn: async () => {
      if (!orgId) return 0;
      const { data: rows } = await supabase.rpc('get_org_stripe_settings_safe', { p_organization_id: orgId });
      const data = rows?.[0] ?? null;
      if (!data) return 1;
      if (!data.is_connected) return 1;
      if (data.stripe_payouts_enabled === false) return 1;
      return 0;
    },
  });

  // ── Feedback (unresolved + follow-up-not-yet-resolved, counted separately
  //     so the sidebar always matches the on-page filter counts.)
  const { data: feedback = null, error: feedbackError } = useQuery<{ unresolved: number; followup: number }>({
    queryKey: ['sb-feedback', orgId],
    enabled,
    ...REALTIME_BACKED,
    queryFn: async () => {
      if (!orgId) return { unresolved: 0, followup: 0 };
      const { data } = await supabase
        .from('client_feedback')
        .select('is_resolved, followup_needed')
        .eq('organization_id', orgId);
      const rows = data || [];
      const unresolved = rows.filter((r: any) => !r.is_resolved).length;
      // Follow-ups that still need attention (regardless of resolved flag,
      // matches the on-page "Needs Follow-up" filter which excludes resolved).
      const followup = rows.filter((r: any) => r.followup_needed && !r.is_resolved).length;
      return { unresolved, followup };
    },
  });

  // ── Realtime invalidation for every badge-driving table.
  useEffect(() => {
    if (!orgId) return;
    const inv = (key: string) => queryClient.invalidateQueries({ queryKey: [key, orgId] });
    const ch = supabase
      .channel(`sidebar-badges-${orgId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'time_off_requests', filter: `organization_id=eq.${orgId}` }, () => inv('sb-staff'))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'staff_documents', filter: `organization_id=eq.${orgId}` }, () => inv('sb-staff'))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'staff_payout_accounts', filter: `organization_id=eq.${orgId}` }, () => inv('sb-staff'))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'client_booking_requests', filter: `organization_id=eq.${orgId}` }, () => inv('sb-client-portal'))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bookings', filter: `organization_id=eq.${orgId}` }, () => inv('sb-bookings'))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sms_conversations', filter: `organization_id=eq.${orgId}` }, () => inv('sb-messages'))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'leads', filter: `organization_id=eq.${orgId}` }, () => inv('sb-leads'))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'client_feedback', filter: `organization_id=eq.${orgId}` }, () => inv('sb-feedback'))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks_and_notes', filter: `organization_id=eq.${orgId}` }, () => inv('sb-tasks'))
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [orgId, queryClient]);

  return useMemo<SidebarBadgeData>(() => {
    // `g` gates a count by notification preferences. If the query failed (data
    // is null), the count is 0 — meaning the badge hides entirely for that
    // section rather than showing a misleading zero. A badge that reads "0"
    // asserts "nothing needs attention"; hiding it says "we don't know."
    const g = (n: number | null, key: string) => (n != null && on(key) ? n : 0);
    const push = (arr: BadgeReason[], r: BadgeReason) => { if (r.count > 0) arr.push(r); };

    // Staff — if query failed, all three sub-counts are null → badge hidden
    const staffReasons: BadgeReason[] = [];
    push(staffReasons, { key: 'time_off', label: 'time-off request', count: g(staff?.timeOff ?? null, 'staff.time_off') });
    push(staffReasons, { key: 'docs', label: 'document review', count: g(staff?.docs ?? null, 'staff.documents') });
    if (payoutRequired) push(staffReasons, { key: 'payout', label: 'payout issue', count: g(staff?.payout ?? null, 'staff.payout') });

    // Bookings
    const bookingReasons: BadgeReason[] = [];
    push(bookingReasons, { key: 'pending', label: 'pending booking', count: g(bookings?.pending ?? null, 'bookings.pending') });
    push(bookingReasons, { key: 'unassigned', label: 'unassigned booking', count: g(bookings?.unassigned ?? null, 'bookings.unassigned') });
    push(bookingReasons, { key: 'payment', label: 'uncollected job', count: g(bookings?.payment ?? null, 'bookings.payment') });
    push(bookingReasons, { key: 'chargeFailed', label: 'failed card charge', count: g(bookings?.chargeFailed ?? null, 'bookings.payment') });

    // Scheduler intentionally has no badge — unassigned jobs surface on the
    // Bookings item, and duplicating the count here produced a "phantom"
    // count that never cleared from the Scheduler screen itself.
    const schedulerReasons: BadgeReason[] = [];

    // Client portal
    const portalReasons: BadgeReason[] = [];
    push(portalReasons, { key: 'requests', label: 'pending request', count: g(clientPortal, 'client_portal.requests') });

    // Invoices
    const invoiceReasons: BadgeReason[] = [];
    push(invoiceReasons, { key: 'overdue', label: 'overdue invoice', count: g(invoices?.overdue ?? null, 'payments.failed_charges') });

    // Messages
    const messageReasons: BadgeReason[] = [];
    push(messageReasons, { key: 'unread', label: 'unread conversation', count: g(messages?.unreadConvs ?? null, 'messages.unread') });

    // Tasks
    const taskReasons: BadgeReason[] = [];
    push(taskReasons, { key: 'overdue', label: 'overdue task', count: g(tasks?.overdue ?? null, 'tasks.overdue') });
    const openMinusOverdue = tasks ? Math.max(0, tasks.open - tasks.overdue) : null;
    push(taskReasons, { key: 'open', label: 'open task', count: g(openMinusOverdue, 'tasks.open') });

    // Leads
    const leadReasons: BadgeReason[] = [];
    push(leadReasons, { key: 'new', label: 'new lead', count: g(leads?.newCount ?? null, 'leads.new') });
    push(leadReasons, { key: 'follow_up', label: 'lead needs follow-up', count: g(leads?.followUp ?? null, 'leads.new') });

    // Inventory
    const invReasons: BadgeReason[] = [];
    push(invReasons, { key: 'low', label: 'low-stock item', count: g(inventory, 'inventory.low') });

    // Automation / Campaigns
    const autoReasons: BadgeReason[] = [];
    push(autoReasons, { key: 'failed', label: 'failed automation', count: g(automation, 'automation.failed') });
    const campReasons: BadgeReason[] = [];
    push(campReasons, { key: 'failed', label: 'failed send', count: g(campaigns, 'automation.failed') });

    // Payment setup
    const payReasons: BadgeReason[] = [];
    push(payReasons, { key: 'stripe', label: 'Stripe setup issue', count: g(payment, 'payments.stripe_requirements') });

    // Feedback
    const fbReasons: BadgeReason[] = [];
    push(fbReasons, { key: 'unresolved', label: 'unresolved feedback', count: g(feedback?.unresolved ?? null, 'feedback.low_rating') });
    push(fbReasons, { key: 'followup', label: 'needs follow-up', count: g(feedback?.followup ?? null, 'feedback.low_rating') });

    const sum = (arr: BadgeReason[]) => arr.reduce((s, r) => s + r.count, 0);

    const rawBreakdowns: Record<string, BadgeReason[]> = {
      '/dashboard/staff': staffReasons,
      '/dashboard/bookings': bookingReasons,
      '/dashboard/scheduler': schedulerReasons,
      '/dashboard/client-portal': portalReasons,
      '/dashboard/invoices': invoiceReasons,
      '/dashboard/messages': messageReasons,
      '/dashboard/tasks': taskReasons,
      '/dashboard/leads': leadReasons,
      '/dashboard/inventory': invReasons,
      '/dashboard/automation-center': autoReasons,
      '/dashboard/campaigns': campReasons,
      '/dashboard/payment-integration': payReasons,
      '/dashboard/feedback': fbReasons,
    };
    // Apply per-user "mark as read" dismissals. A reason stays hidden as long
    // as its count hasn't grown past the snapshot the user dismissed at.
    const breakdowns: Record<string, BadgeReason[]> = {};
    for (const [href, arr] of Object.entries(rawBreakdowns)) {
      breakdowns[href] = arr.filter(r => !dismissed.isDismissed(href, r.key, r.count));
    }
    const counts: Record<string, number> = {};
    for (const k of Object.keys(breakdowns)) counts[k] = sum(breakdowns[k]);
    return { counts, breakdowns };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `on` is a stable helper that doesn't affect the memo result
  }, [staff, bookings, clientPortal, invoices, messages, tasks, leads, inventory, automation, campaigns, payment, feedback, showBadges, sb, payoutRequired, dismissed]);
}

/** Back-compat: returns just counts as before. */
export function useSidebarBadges(): Record<string, number> {
  return useSidebarBadgesFull().counts;
}

/** Convenience for per-page attention strips. */
export function usePageBadgeReasons(href: string): BadgeReason[] {
  const { breakdowns } = useSidebarBadgesFull();
  return breakdowns[href] || [];
}
