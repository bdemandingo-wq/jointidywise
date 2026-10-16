import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { SUPABASE_PUBLIC_ANON_KEY, SUPABASE_PUBLIC_URL } from '@/lib/supabasePublicEnv';
import { useOrganization } from '@/contexts/OrganizationContext';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { QueryError } from '@/components/QueryError';
import {
  Brain, TrendingUp, Flame, Target,
  Send, Sparkles, Calendar, Users, ArrowUpRight,
  RefreshCw, MessageSquare, ShieldAlert,
  BookOpen, Zap
} from 'lucide-react';
import { toast } from 'sonner';
import { format, differenceInDays, startOfMonth, endOfMonth, subMonths, startOfWeek, endOfWeek } from 'date-fns';
import ReactMarkdown from 'react-markdown';
import { useQuery as useRQ } from '@tanstack/react-query';
import { fmt } from '@/lib/activeCurrency';
import { useIsMobile } from '@/hooks/use-mobile';
import { handlePossibleAiCreditError, openAiCreditLimitModal } from '@/components/ai-credits/AiCreditLimitModal';
import { parseEdgeFunctionError } from '@/lib/errorHandling';
import { useOrgTimezone } from '@/hooks/useOrgTimezone';
import { orgStartOfMonth, orgEndOfMonth, orgStartOfWeek, orgEndOfWeek, formatInOrgTz } from '@/lib/orgDateRange';
import { demoAwareFetch } from '@/lib/demo/edgeFetch';

/** Wraps supabase.functions.invoke and shows the credit-limit modal when a 402 comes back. */
async function invokeAi(fn: string, body: Record<string, unknown>) {
  const result = await supabase.functions.invoke(fn, { body });
  if (result.error) {
    const handled = await handlePossibleAiCreditError(result.error);
    if (handled) {
      // Return a soft-null so callers show empty state instead of a red toast.
      return { data: null as unknown, error: null as unknown, creditLimited: true } as const;
    }
  }
  return { ...result, creditLimited: false } as const;
}

// ─── Call Stats Sub-Component ───
function CallStatsContent({ orgId }: { orgId: string | undefined }) {
  // The busiest-hour histogram is business advice; the hour is the org's.
  const { timezone: orgTimezone } = useOrgTimezone();
  const { data: callStats } = useRQ({
    queryKey: ['call-stats', orgId],
    queryFn: async () => {
      if (!orgId) return { total: 0, missed: 0, avgDuration: 0, incoming: 0, outgoing: 0, voicemails: 0, busiestHours: {} as Record<string, number>, topCallers: [] as { name: string; count: number }[] };
      const { data } = await supabase.from('openphone_calls').select('*').eq('organization_id', orgId).order('started_at', { ascending: false }).limit(500);
      const calls = data || [];
      const total = calls.length;
      const missed = calls.filter(c => c.status === 'missed' || c.status === 'no-answer').length;
      const incoming = calls.filter(c => c.direction === 'inbound').length;
      const outgoing = calls.filter(c => c.direction === 'outbound').length;
      const voicemails = calls.filter(c => c.has_voicemail).length;
      const avgDuration = total > 0 ? Math.round(calls.reduce((s, c) => s + (c.duration || 0), 0) / total) : 0;
      const hourCounts: Record<string, number> = {};
      const callerCounts: Record<string, number> = {};
      calls.forEach(c => {
        if (c.started_at) {
          // started_at is an instant. The "busiest hour" histogram this feeds
          // is business advice, so the hour must be the BUSINESS's — read from
          // the device it shifts by the whole offset and names the wrong peak.
          const h = Number(formatInOrgTz(new Date(c.started_at), orgTimezone, { hour: '2-digit', hour12: false, hourCycle: 'h23' }));
          const label = h < 12 ? `${h || 12}AM` : `${h === 12 ? 12 : h - 12}PM`;
          hourCounts[label] = (hourCounts[label] || 0) + 1;
        }
        const name = c.caller_name || c.caller_phone || 'Unknown';
        callerCounts[name] = (callerCounts[name] || 0) + 1;
      });
      const topCallers = Object.entries(callerCounts).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([name, count]) => ({ name, count }));
      return { total, missed, avgDuration, incoming, outgoing, voicemails, busiestHours: hourCounts, topCallers };
    },
    enabled: !!orgId,
  });

  const s = callStats || { total: 0, missed: 0, avgDuration: 0, incoming: 0, outgoing: 0, voicemails: 0, busiestHours: {}, topCallers: [] };
  const missedPct = s.total > 0 ? Math.round((s.missed / s.total) * 100) : 0;

  return (
    <div className="max-w-full space-y-4 overflow-x-hidden">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: 'Total Calls', value: s.total, colorClass: 'text-primary' },
          { label: 'Missed Calls', value: `${s.missed} (${missedPct}%)`, colorClass: 'text-destructive' },
          { label: 'Avg Duration', value: `${Math.floor(s.avgDuration / 60)}:${(s.avgDuration % 60).toString().padStart(2, '0')}`, colorClass: 'text-info' },
          { label: 'Voicemails', value: s.voicemails, colorClass: 'text-warning' },
        ].map((k, i) => (
          <div key={i} className="pv-surface-raised p-4">
            <p className="text-xs text-muted-foreground">{k.label}</p>
            <p className={`text-2xl font-semibold mt-1 ${k.colorClass}`}>{k.value}</p>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <div className="pv-surface-raised p-4">
          <p className="text-sm font-semibold mb-3">Busiest Hours</p>
          {Object.entries(s.busiestHours).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([hour, count]) => (
            <div key={hour} className="flex items-center gap-2 mb-2">
              <span className="text-xs text-muted-foreground w-10">{hour}</span>
              <div className="flex-1 h-4 rounded bg-muted">
                <div className="h-full rounded bg-primary" style={{ width: `${(count / Math.max(...Object.values(s.busiestHours), 1)) * 100}%` }} />
              </div>
              <span className="text-xs text-muted-foreground w-6 text-right">{count}</span>
            </div>
          ))}
          {Object.keys(s.busiestHours).length === 0 && <p className="text-xs text-muted-foreground">No call data yet. Sync calls from Messages → Calls tab.</p>}
        </div>
        <div className="pv-surface-raised p-4">
          <p className="text-sm font-semibold mb-3">Most Frequent Callers</p>
          {s.topCallers.map((c, i) => (
            <div key={i} className="flex items-center justify-between py-1.5 border-b border-border last:border-0">
              <span className="text-sm text-foreground">{c.name}</span>
              <span className="text-xs text-primary">{c.count} calls</span>
            </div>
          ))}
          {s.topCallers.length === 0 && <p className="text-xs text-muted-foreground">No call data yet.</p>}
        </div>
      </div>
    </div>
  );
}

// ─── Count-up hook ───
function useCountUp(target: number, duration = 1200) {
  const [value, setValue] = useState(0);
  useEffect(() => {
    if (target === 0) { setValue(0); return; }
    let start = 0;
    const step = Math.max(1, Math.ceil(target / (duration / 30)));
    const id = setInterval(() => {
      start += step;
      if (start >= target) { setValue(target); clearInterval(id); }
      else setValue(start);
    }, 30);
    return () => clearInterval(id);
  }, [target, duration]);
  return value;
}

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const priorityClass: Record<string, { chip: string; action: string; border: string }> = {
  Urgent: { chip: 'pv-chip-danger', action: 'pv-soft-destructive', border: 'hsl(var(--destructive) / 0.2)' },
  Watch: { chip: 'pv-chip-warn', action: 'pv-soft-warning', border: 'hsl(var(--warning) / 0.2)' },
  Opportunity: { chip: 'pv-chip-brand', action: 'pv-soft-info', border: 'hsl(var(--info) / 0.2)' },
  Pricing: { chip: 'pv-chip-brand', action: 'pv-soft-info', border: 'hsl(var(--info) / 0.2)' },
};

const insightTypeClass: Record<string, { chip: string; border: string }> = {
  critical: { chip: 'pv-chip-danger', border: 'hsl(var(--destructive) / 0.2)' },
  warning: { chip: 'pv-chip-warn', border: 'hsl(var(--warning) / 0.2)' },
  positive: { chip: 'pv-chip-success', border: 'hsl(var(--success) / 0.2)' },
  tip: { chip: 'pv-chip-brand', border: 'hsl(var(--info) / 0.2)' },
};

// ─── Proactive Insight type ───
interface ProactiveInsight {
  type: 'critical' | 'warning' | 'positive' | 'tip';
  icon: string;
  title: string;
  body: string;
  action: string;
}

interface AiInsight {
  priority: string;
  confidence: string;
  insight: string;
  action: string;
  promptText?: string;
}

interface ChurnCustomer {
  id: string;
  first_name: string;
  last_name: string;
  email?: string | null;
  phone?: string | null;
  daysSince: number;
  serviceName: string;
}

export function AIAnalysisCenter() {
  // Month and week windows below are query bounds against real timestamps.
  const { timezone: orgTimezone } = useOrgTimezone();
  const isMobile = useIsMobile();
  const { organization } = useOrganization();
  const orgId = organization?.id;
  const [activeTab, setActiveTab] = useState('overview');
  const tabsRef = useRef<HTMLDivElement>(null);

  const openAskAI = useCallback((prompt: string) => {
    setActiveTab('ask-ai');
    setChatInput(prompt);
    setTimeout(() => tabsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80);
  }, []);

  // ─── Data queries ───
  const now = new Date();
  // Query windows against real timestamps — "this month" and "last month" are
  // the business's months, not whichever one the admin's device is in.
  const monthStart = orgStartOfMonth(now, orgTimezone).toISOString();
  const monthEnd = orgEndOfMonth(now, orgTimezone).toISOString();
  const prevMonthStart = orgStartOfMonth(subMonths(now, 1), orgTimezone).toISOString();
  const prevMonthEnd = orgEndOfMonth(subMonths(now, 1), orgTimezone).toISOString();

  const { data: revenueData, error: revenueError } = useQuery({
    queryKey: ['ai-revenue', orgId],
    queryFn: async () => {
      if (!orgId) return { current: 0, previous: 0 };
      const [cur, prev] = await Promise.all([
        supabase.from('bookings').select('total_amount').eq('organization_id', orgId).in('status', ['confirmed', 'completed']).gte('scheduled_at', monthStart).lte('scheduled_at', monthEnd),
        supabase.from('bookings').select('total_amount').eq('organization_id', orgId).in('status', ['confirmed', 'completed']).gte('scheduled_at', prevMonthStart).lte('scheduled_at', prevMonthEnd),
      ]);
      const current = (cur.data || []).reduce((s, b) => s + (b.total_amount || 0), 0);
      const previous = (prev.data || []).reduce((s, b) => s + (b.total_amount || 0), 0);
      return { current, previous };
    },
    enabled: !!orgId,
  });

  const threeDaysAgo = new Date(Date.now() - 3 * 86400000).toISOString();
  const { data: hotLeads = [], error: hotLeadsError } = useQuery({
    queryKey: ['ai-hot-leads', orgId],
    queryFn: async () => {
      if (!orgId) return [];
      const { data } = await supabase.from('leads').select('*').eq('organization_id', orgId).or(`status.eq.hot,updated_at.lt.${threeDaysAgo}`).order('updated_at', { ascending: true });
      return data || [];
    },
    enabled: !!orgId,
  });

  const { data: churnCustomers = [], error: churnError } = useQuery({
    queryKey: ['ai-churn', orgId],
    queryFn: async () => {
      if (!orgId) return [];
      const nowIso = now.toISOString();
      // Batched to avoid an N+1 (previously one bookings query + one services
      // query PER customer). Fetch customers and their PAST bookings together,
      // newest first. Only bookings on/before today count — a future or
      // recurring visit must NOT be treated as the "last visit", otherwise
      // active customers can never register as churn risk.
      const [{ data: customers }, { data: pastBookings }] = await Promise.all([
        supabase.from('customers').select('id, first_name, last_name, email, phone').eq('organization_id', orgId),
        supabase.from('bookings').select('customer_id, scheduled_at, service_id').eq('organization_id', orgId).lte('scheduled_at', nowIso).order('scheduled_at', { ascending: false }).limit(2000),
      ]);
      if (!customers?.length) return [];

      // Group every past booking per customer (desc order preserved, so the
      // first entry is the most recent visit and its service).
      const byCustomer = new Map<string, { dates: Date[]; latestServiceId: string | null }>();
      for (const b of pastBookings || []) {
        if (!b.customer_id) continue; // no customer to attribute this to
        const entry = byCustomer.get(b.customer_id);
        if (entry) {
          entry.dates.push(new Date(b.scheduled_at));
        } else {
          byCustomer.set(b.customer_id, { dates: [new Date(b.scheduled_at)], latestServiceId: b.service_id });
        }
      }

      // Resolve service names in a single query rather than one per customer.
      const serviceIds = [...new Set([...byCustomer.values()].map(v => v.latestServiceId).filter(Boolean) as string[])];
      const { data: services } = serviceIds.length
        ? await supabase.from('services').select('id, name').in('id', serviceIds)
        : { data: [] as { id: string; name: string }[] };
      const serviceName = new Map((services || []).map(s => [s.id, s.name]));

      const results: ChurnCustomer[] = [];
      for (const c of customers) {
        const entry = byCustomer.get(c.id);
        if (!entry) continue;
        const daysSince = differenceInDays(now, entry.dates[0]);

        // Cadence-aware threshold: a customer is "overdue" at 1.5x their own
        // typical gap between visits — so a weekly customer flags fast while a
        // quarterly one isn't a false positive. Needs >=3 visits (>=2 gaps) for
        // a stable median; otherwise fall back to a flat 30 days. Floored at 30
        // so frequent customers aren't flagged after a single missed week.
        let threshold = 30;
        if (entry.dates.length >= 3) {
          const gaps: number[] = [];
          for (let i = 0; i < entry.dates.length - 1; i++) {
            gaps.push(differenceInDays(entry.dates[i], entry.dates[i + 1]));
          }
          gaps.sort((a, b) => a - b);
          const medianGap = gaps[Math.floor(gaps.length / 2)];
          threshold = Math.max(30, Math.round(medianGap * 1.5));
        }

        if (daysSince > threshold) {
          results.push({ ...c, daysSince, serviceName: serviceName.get(entry.latestServiceId || '') || 'General Cleaning' });
        }
      }
      return results.sort((a, b) => b.daysSince - a.daysSince).slice(0, 10);
    },
    enabled: !!orgId,
  });

  const { data: conversionData, error: conversionError } = useQuery({
    queryKey: ['ai-conversion', orgId],
    queryFn: async () => {
      if (!orgId) return { rate: 0, total: 0, converted: 0 };
      const { data: allLeads } = await supabase.from('leads').select('status, created_at').eq('organization_id', orgId).gte('created_at', monthStart);
      const total = allLeads?.length || 0;
      const converted = allLeads?.filter(l => l.status === 'converted' || l.status === 'won').length || 0;
      return { rate: total > 0 ? Math.round((converted / total) * 100) : 0, total, converted };
    },
    enabled: !!orgId,
  });

  const weekStart = orgStartOfWeek(now, orgTimezone, 1).toISOString();
  const weekEnd = orgEndOfWeek(now, orgTimezone, 1).toISOString();

  const { data: weeklyData = {} as Record<string, number>, error: weeklyError } = useQuery({
    queryKey: ['ai-weekly', orgId, weekStart],
    queryFn: async () => {
      if (!orgId) return {};
      const { data } = await supabase.from('bookings').select('scheduled_at').eq('organization_id', orgId).in('status', ['confirmed', 'completed']).gte('scheduled_at', weekStart).lte('scheduled_at', weekEnd);
      const counts: Record<string, number> = { Mon: 0, Tue: 0, Wed: 0, Thu: 0, Fri: 0, Sat: 0, Sun: 0 };
      (data || []).forEach(b => {
        const day = format(new Date(b.scheduled_at), 'EEE') as string;
        if (day in counts) counts[day]++;
      });
      return counts;
    },
    enabled: !!orgId,
  });

  const bestDay = useMemo(() => {
    const entries = Object.entries(weeklyData);
    if (!entries.length) return 'N/A';
    return entries.reduce((a, b) => (b[1] > a[1] ? b : a), entries[0])[0];
  }, [weeklyData]);

  const revenue = revenueData?.current || 0;
  const prevRevenue = revenueData?.previous || 0;
  const revenueChange = prevRevenue > 0 ? Math.round(((revenue - prevRevenue) / prevRevenue) * 100) : 0;
  const hotLeadsCount = hotLeads.length;
  const churnCount = churnCustomers.length;
  const conversionRate = conversionData?.rate || 0;

  const animRevenue = useCountUp(Math.round(revenue));
  const animHotLeads = useCountUp(hotLeadsCount);
  const animChurn = useCountUp(churnCount);
  const animConversion = useCountUp(conversionRate);

  const businessSnapshot = useMemo(() => ({
    revenue: Math.round(revenue),
    hotLeads: hotLeadsCount,
    churnCount,
    conversionRate,
    bestDay,
    weeklyData,
  }), [revenue, hotLeadsCount, churnCount, conversionRate, bestDay, weeklyData]);

  // ─── Proactive Insights Feed ───
  const [proactiveInsights, setProactiveInsights] = useState<ProactiveInsight[]>([]);
  const [proactiveLoading, setProactiveLoading] = useState(false);

  const fetchProactiveInsights = useCallback(async () => {
    if (!orgId) return;
    setProactiveLoading(true);
    try {
      const { data, error } = await invokeAi('ai-analysis-center', 
        { type: 'proactive-insights', organizationId: orgId },
      );
      if (error) throw error;
      setProactiveInsights(((data as { insights?: ProactiveInsight[] } | null)?.insights) || []);
    } catch (e) {
      console.error('Proactive insights error:', e);
    } finally {
      setProactiveLoading(false);
    }
  }, [orgId]);

  useEffect(() => {
    if (orgId) fetchProactiveInsights();
  }, [orgId, fetchProactiveInsights]);

  // ─── Dynamic Chips ───
  const [dynamicChips, setDynamicChips] = useState<string[]>([]);

  const fetchDynamicChips = useCallback(async () => {
    if (!orgId) return;
    try {
      const { data, error } = await invokeAi('ai-analysis-center', 
        { type: 'dynamic-chips', organizationId: orgId },
      );
      if (error) throw error;
      setDynamicChips(((data as { chips?: string[] } | null)?.chips) || []);
    } catch {
      // Fallback chips
      setDynamicChips([
        'Why did revenue change this month?',
        'Which 5 clients should I call today?',
        "What's my most profitable day?",
        'Draft me a win-back text',
      ]);
    }
  }, [orgId]);

  useEffect(() => {
    if (orgId) fetchDynamicChips();
  }, [orgId, fetchDynamicChips]);

  // ─── AI Insights (structured) ───
  const [insights, setInsights] = useState<AiInsight[]>([]);
  const [insightsLoading, setInsightsLoading] = useState(false);

  const fetchInsights = useCallback(async () => {
    if (!orgId) return;
    setInsightsLoading(true);
    try {
      const { data, error } = await invokeAi('ai-analysis-center', 
        { type: 'insights', organizationId: orgId, businessSnapshot },
      );
      if (error) throw error;
      setInsights(((data as { insights?: AiInsight[] } | null)?.insights) || []);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to generate insights');
    } finally {
      setInsightsLoading(false);
    }
  }, [orgId, businessSnapshot]);

  useEffect(() => {
    if (revenue > 0 || hotLeadsCount > 0) fetchInsights();
  }, [orgId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Scheduling recommendation ───
  const [schedRec, setSchedRec] = useState('');
  const [schedLoading, setSchedLoading] = useState(false);
  const fetchScheduleRec = useCallback(async () => {
    if (!orgId) return;
    setSchedLoading(true);
    try {
      const { data, error } = await invokeAi('ai-analysis-center', 
        { type: 'scheduling', organizationId: orgId, businessSnapshot: { ...businessSnapshot, staffCount: 'unknown' } },
      );
      if (error) throw error;
      setSchedRec(data?.recommendation || '');
    } catch { setSchedRec('Unable to generate recommendation.'); }
    finally { setSchedLoading(false); }
  }, [orgId, businessSnapshot]);

  useEffect(() => {
    if (activeTab === 'scheduling' && !schedRec) fetchScheduleRec();
  }, [activeTab]); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Growth Playbook ───
  const [playbook, setPlaybook] = useState('');
  const [playbookLoading, setPlaybookLoading] = useState(false);

  const fetchPlaybook = useCallback(async () => {
    if (!orgId) return;
    setPlaybookLoading(true);
    try {
      const { data, error } = await invokeAi('ai-analysis-center', 
        { type: 'growth-playbook', organizationId: orgId },
      );
      if (error) throw error;
      setPlaybook(((data as { playbook?: string } | null)?.playbook) || '');
    } catch {
      toast.error('Failed to generate playbook');
    } finally {
      setPlaybookLoading(false);
    }
  }, [orgId]);

  useEffect(() => {
    if (activeTab === 'playbook' && !playbook) fetchPlaybook();
  }, [activeTab]); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Ask AI chat ───
  const [chatMessages, setChatMessages] = useState<{ role: string; content: string }[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const chatMessagesRef = useRef(chatMessages);
  chatMessagesRef.current = chatMessages;

  // ─── Draft Message Modal ───
  const [draftOpen, setDraftOpen] = useState(false);
  const [draftLoading, setDraftLoading] = useState(false);
  const [draftSending, setDraftSending] = useState(false);
  const [draftText, setDraftText] = useState('');
  const [draftTarget, setDraftTarget] = useState<{ id?: string; name: string; phone?: string | null; email?: string | null; channel: 'sms' | 'email' } | null>(null);
  const queryClient = useQueryClient();

  const openDraftMessage = useCallback(async (
    target: { id?: string; name: string; phone?: string | null; email?: string | null },
    prompt: string,
    channel: 'sms' | 'email' = 'sms'
  ) => {
    setDraftTarget({ ...target, channel });
    setDraftOpen(true);
    setDraftText('');
    setDraftLoading(true);
    try {
      const { data, error } = await invokeAi('ai-analysis-center', 
        { type: 'draft-message', prompt, channel, organizationId: orgId },
      );
      if (error) throw error;
      setDraftText(((data as { message?: string } | null)?.message) || '');
    } catch (e) {
      console.error('Draft message error:', e);
      toast.error('Could not generate draft message.');
    } finally {
      setDraftLoading(false);
    }
  }, [orgId]);

  const sendDraftSms = useCallback(async () => {
    if (!draftTarget?.phone || !draftText.trim()) {
      toast.error('Missing phone number or message.');
      return;
    }
    setDraftSending(true);
    try {
      const { data, error } = await supabase.functions.invoke('send-openphone-sms', {
        body: { to: draftTarget.phone, message: draftText.trim(), organizationId: orgId },
      });
      if (error) throw error;
      const smsData = data as { success?: boolean; error?: string } | null;
      if (smsData?.success === false) throw new Error(smsData.error || 'Send failed');

      // Mark the lead as contacted so it drops out of Hot & Stale.
      if (draftTarget.id && orgId) {
        await supabase
          .from('leads')
          .update({ status: 'contacted', updated_at: new Date().toISOString() })
          .eq('id', draftTarget.id)
          .eq('organization_id', orgId);
        queryClient.invalidateQueries({ queryKey: ['ai-hot-leads', orgId] });
      }

      toast.success(`Message sent to ${draftTarget.name}`);
      setDraftOpen(false);
    } catch (e) {
      console.error('Send SMS error:', e);
      toast.error(e instanceof Error ? e.message : 'Could not send SMS. Copy the message instead.');
    } finally {
      setDraftSending(false);
    }
  }, [draftTarget, draftText, orgId, queryClient]);


  const sendChat = useCallback(async (input: string) => {
    if (!input.trim() || !orgId) return;
    // Item 6: hard-guard against re-entry while a request is in flight so
    // repeated taps on a suggested chip / Enter / Send button can't fire
    // the same message multiple times.
    if (chatLoading) return;
    const userMsg = { role: 'user' as const, content: input };
    setChatMessages(prev => [...prev, userMsg]);
    setChatInput('');
    setChatLoading(true);

    try {
      const SUPABASE_URL = SUPABASE_PUBLIC_URL;
      const SUPABASE_KEY = SUPABASE_PUBLIC_ANON_KEY;
      const CHAT_URL = `${SUPABASE_URL}/functions/v1/ai-analysis-center`;
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData?.session?.access_token;
      if (!accessToken) {
        toast.error('Please sign in to use AI chat.');
        setChatLoading(false);
        return;
      }
      const resp = await demoAwareFetch(CHAT_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
          apikey: SUPABASE_KEY,
        },
        body: JSON.stringify({
          type: 'chat',
          messages: [...chatMessagesRef.current, userMsg],
          organizationId: orgId,
          businessSnapshot,
        }),
      });

      // Item 7 + 16: parse structured 402 credit-limit payload and open the
      // branded "Buy more credits" modal instead of a raw toast. Fall back
      // gracefully if the body isn't the expected shape.
      if (resp.status === 402) {
        try {
          const parsed = await resp.json();
          if (parsed?.code === 'daily_limit_reached') {
            openAiCreditLimitModal({
              used: parsed.used,
              limit: parsed.limit,
              purchasedBalance: parsed.purchasedBalance ?? 0,
              resetsAt: parsed.resetsAt,
              message: parsed.message,
            });
          } else {
            toast.error("You're out of AI credits. Tap to buy more.", {
              action: { label: 'Get credits', onClick: () => openAiCreditLimitModal({ used: 0, limit: 0, purchasedBalance: 0, resetsAt: new Date().toISOString() }) },
            });
          }
        } catch {
          toast.error("You're out of AI credits. Tap to buy more.", {
            action: { label: 'Get credits', onClick: () => openAiCreditLimitModal({ used: 0, limit: 0, purchasedBalance: 0, resetsAt: new Date().toISOString() }) },
          });
        }
        // Remove the optimistic user message so they can retry cleanly.
        setChatMessages(prev => prev.slice(0, -1));
        return;
      }
      if (resp.status === 429) {
        toast.error("You're sending messages a bit too fast. Give it a few seconds and try again.");
        setChatMessages(prev => prev.slice(0, -1));
        return;
      }
      if (!resp.ok || !resp.body) {
        const errorText = await resp.text().catch(() => '');
        console.error('AI chat error:', resp.status, errorText);
        throw new Error(`AI request failed (${resp.status})`);
      }

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let textBuffer = '';
      let assistantSoFar = '';

      const upsert = (chunk: string) => {
        assistantSoFar += chunk;
        const content = assistantSoFar;
        setChatMessages(prev => {
          const last = prev[prev.length - 1];
          if (last?.role === 'assistant') return prev.map((m, i) => i === prev.length - 1 ? { ...m, content } : m);
          return [...prev, { role: 'assistant', content }];
        });
      };

      let streamDone = false;
      while (!streamDone) {
        const { done, value } = await reader.read();
        if (done) break;
        textBuffer += decoder.decode(value, { stream: true });
        let newlineIndex: number;
        while ((newlineIndex = textBuffer.indexOf('\n')) !== -1) {
          let line = textBuffer.slice(0, newlineIndex);
          textBuffer = textBuffer.slice(newlineIndex + 1);
          if (line.endsWith('\r')) line = line.slice(0, -1);
          if (line.startsWith(':') || line.trim() === '') continue;
          if (!line.startsWith('data: ')) continue;
          const jsonStr = line.slice(6).trim();
          if (jsonStr === '[DONE]') { streamDone = true; break; }
          try {
            const parsed = JSON.parse(jsonStr);
            const content = parsed.choices?.[0]?.delta?.content;
            if (content) upsert(content);
          } catch {
            textBuffer = line + '\n' + textBuffer;
            break;
          }
        }
      }
    } catch (e) {
      console.error('Chat error:', e);
      // Item 16: never surface raw "Edge Function returned a non-2xx..." to users.
      toast.error(parseEdgeFunctionError(e));
    } finally {
      setChatLoading(false);
      // Item 8: refresh the credit meter immediately after every request so
      // the "X free AI credits left" chip reflects reality.
      queryClient.invalidateQueries({ queryKey: ['ai-credit-status', orgId] });
    }
  }, [orgId, businessSnapshot, chatLoading, queryClient]);

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [chatMessages]);

  // iOS keyboard: 100dvh doesn't recompute when the keyboard opens with
  // Capacitor resize:"native", leaving a dead gap. Track the live visual
  // viewport height instead and keep the chat pinned to the bottom.
  const [viewportH, setViewportH] = useState<number | null>(null);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const onResize = () => {
      setViewportH(vv.height);
      requestAnimationFrame(() => chatEndRef.current?.scrollIntoView({ block: 'end' }));
    };
    vv.addEventListener('resize', onResize);
    onResize();
    return () => vv.removeEventListener('resize', onResize);
  }, []);

  const maxBookings = Math.max(...Object.values(weeklyData), 1);

  const analysisQueryError = revenueError || hotLeadsError || churnError || conversionError || weeklyError;
  if (analysisQueryError) {
    return <QueryError subject="AI analysis data" />;
  }

  return (
    <div className="portal-v2 bg-background text-foreground min-h-[100dvh] -mx-3 -mt-3 px-3 pt-5 pb-4 overflow-x-hidden md:-mx-4 md:-mt-4 md:px-6 md:pt-6">

      {/* ─── Proactive Insights Feed ─── */}
      {proactiveInsights.length > 0 && (
        <div className="mb-6">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Zap size={16} className="text-warning" />
              <h3 className="text-sm font-semibold text-foreground">Smart Insights</h3>
              <Badge className="pv-chip-success">Live</Badge>
            </div>
            <Button size="sm" variant="ghost" onClick={fetchProactiveInsights} disabled={proactiveLoading} className="gap-1.5">
              <RefreshCw size={12} className={proactiveLoading ? 'animate-spin' : ''} />
              Refresh
            </Button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {proactiveInsights.map((ins, i) => {
              const c = insightTypeClass[ins.type] || insightTypeClass.tip;
              return (
                <div key={i} className="pv-surface-raised p-4" style={{ borderColor: c.border }}>
                  <div className="flex items-start gap-3">
                    <span className="text-xl leading-none">{ins.icon}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-foreground mb-1">{ins.title}</p>
                      <p className="text-sm text-muted-foreground leading-relaxed">{ins.body}</p>
                      <button
                        type="button"
                        onClick={() => openAskAI(ins.action)}
                        className="mt-2 inline-flex items-center gap-1 text-xs text-primary hover:text-primary/80 bg-transparent border-0 p-0 text-left"
                      >
                        <span className="flex-1 min-w-0">{ins.action}</span>
                        <ArrowUpRight size={10} className="shrink-0" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ─── KPI Strip ─── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4 mb-6">
        {[
          { label: 'Monthly Revenue', value: `${fmt(animRevenue)}`, sub: revenueChange >= 0 ? `+${revenueChange}% vs last month` : `${revenueChange}% vs last month`, chip: 'pv-soft-success', text: 'text-success', icon: TrendingUp },
          { label: 'Hot Leads', value: animHotLeads.toString(), sub: `${hotLeads.filter(l => differenceInDays(now, new Date(l.updated_at)) > 5).length} need follow-up today`, chip: 'pv-soft-warning', text: 'text-warning', icon: Flame },
          { label: 'Churn Risk', value: animChurn.toString(), sub: churnCount > 0 ? `${churnCustomers.filter(c => c.daysSince > 45).length} critical (45+ days)` : 'All customers active', chip: 'pv-soft-destructive', text: 'text-destructive', icon: ShieldAlert },
          { label: 'Conversion Rate', value: `${animConversion}%`, sub: `${conversionData?.converted || 0} of ${conversionData?.total || 0} leads this month`, chip: 'pv-soft-info', text: 'text-info', icon: Target },
        ].map((kpi, i) => (
          <div key={i} className="pv-surface-raised p-5">
            <div className="flex items-center gap-2 mb-3">
              <div className={`p-1.5 rounded-lg ${kpi.chip}`}>
                <kpi.icon size={18} />
              </div>
              <span className="text-sm text-muted-foreground">{kpi.label}</span>
            </div>
            <p className={`text-3xl font-semibold tracking-tight ${isMobile ? 'text-2xl' : ''}`}>{kpi.value}</p>
            <p className={`text-sm mt-2 ${kpi.text}`}>{kpi.sub}</p>
          </div>
        ))}
      </div>

      {/* ─── Tabs ─── */}
      <div ref={tabsRef} />
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <div className="sticky top-0 z-10 -mx-3 px-3 md:-mx-4 md:px-6 bg-background">
          <TabsList className="w-full justify-start overflow-x-auto scrollbar-hide flex-nowrap">
            {[
              { value: 'overview', label: 'Overview', icon: Brain },
              { value: 'leads', label: 'Leads', icon: Flame },
              { value: 'retention', label: 'Retention', icon: Users },
              { value: 'scheduling', label: 'Scheduling', icon: Calendar },
              { value: 'playbook', label: 'Growth Playbook', icon: BookOpen },
              { value: 'ask-ai', label: 'Ask AI', icon: MessageSquare },
            ].map(tab => (
              <TabsTrigger
                key={tab.value}
                value={tab.value}
                className="whitespace-nowrap shrink-0 px-4 py-2 gap-2 inline-flex items-center"
              >
                <tab.icon size={15} />
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>

        {/* ─── Tab 1: Overview ─── */}
        <TabsContent value="overview">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-base font-semibold">AI-Generated Insights</h3>
            <Button size="sm" variant="ghost" onClick={fetchInsights} disabled={insightsLoading} className="gap-2">
              <RefreshCw size={14} className={insightsLoading ? 'animate-spin' : ''} />
              {insightsLoading ? 'Analyzing...' : 'Refresh'}
            </Button>
          </div>
          {insights.length === 0 && !insightsLoading && (
            <div className="pv-surface-raised p-8 text-center">
              <Sparkles size={32} className="text-primary mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">Click Refresh to generate AI insights from your business data</p>
            </div>
          )}
          <div className="space-y-3">
            {insights.map((ins, i) => {
              const c = priorityClass[ins.priority] || priorityClass.Watch;
              return (
                <div key={i} className="pv-surface-raised p-4 overflow-hidden" style={{ borderColor: c.border }}>
                  <div className="flex items-center gap-2 mb-2">
                    <Badge className={c.chip}>{ins.priority}</Badge>
                    <span className="text-xs text-muted-foreground">{ins.confidence}</span>
                  </div>
                  <p className="text-sm text-foreground leading-relaxed break-words">{ins.insight}</p>
                  <button
                    type="button"
                    onClick={() => openAskAI(ins.promptText || ins.action || '')}
                    className={`mt-3 w-full inline-flex items-start justify-start gap-2 rounded-md px-3 py-2 text-xs font-medium hover:brightness-95 transition-all ${c.action}`}
                  >
                    <span className="break-words min-w-0 flex-1 text-left">{ins.action}</span>
                    <ArrowUpRight size={12} className="shrink-0 mt-0.5" />
                  </button>
                </div>
              );
            })}
          </div>
        </TabsContent>

        {/* ─── Tab 2: Leads ─── */}
        <TabsContent value="leads">
          <h3 className="text-base font-semibold mb-4">Hot & Stale Leads</h3>
          {hotLeads.length === 0 ? (
            <div className="pv-surface-raised p-8 text-center">
              <Flame size={32} className="text-warning mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">No hot or stale leads found</p>
            </div>
          ) : (
            <div className="space-y-2">
              {hotLeads.slice(0, 15).map(lead => {
                const daysSince = differenceInDays(now, new Date(lead.updated_at));
                const typeLabel = lead.service_interest || 'Residential';
                const daysClass = daysSince > 5 ? 'text-destructive' : 'text-warning';
                return (
                  <div key={lead.id} className="pv-surface-raised p-4 flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium">{lead.name}</p>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-xs text-muted-foreground">{typeLabel}</span>
                        <span className={`text-xs font-mono ${daysClass}`}>{daysSince}d since contact</span>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => openDraftMessage(
                        { id: lead.id, name: lead.name, phone: lead.phone, email: lead.email },
                        `Draft a follow-up message for ${lead.name}, a ${typeLabel} lead who hasn't been contacted in ${daysSince} days. Make it personal and include a scheduling CTA.`,
                        'sms',
                      )}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs font-medium pv-soft-brand hover:brightness-95 transition-all"
                    >
                      Draft message <ArrowUpRight size={12} className="ml-1" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </TabsContent>

        {/* ─── Tab 3: Retention ─── */}
        <TabsContent value="retention">
          <h3 className="text-base font-semibold mb-4">Churn Risk Customers</h3>
          {churnCustomers.length === 0 ? (
            <div className="pv-surface-raised p-8 text-center">
              <Users size={32} className="text-success mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">All customers are active — no churn risk detected</p>
            </div>
          ) : (
            <div className="space-y-2">
              {churnCustomers.slice(0, 5).map(c => {
                const barClass = c.daysSince >= 45 ? 'bg-destructive' : c.daysSince >= 30 ? 'bg-warning' : 'bg-success';
                const daysClass = c.daysSince >= 45 ? 'text-destructive' : c.daysSince >= 30 ? 'text-warning' : 'text-success';
                const barWidth = Math.min((c.daysSince / 90) * 100, 100);
                return (
                  <div key={c.id} className="pv-surface-raised p-4">
                    <div className="flex items-center justify-between mb-2">
                      <div>
                        <p className="text-sm font-medium">{c.first_name} {c.last_name}</p>
                        <span className="text-xs text-muted-foreground">{c.serviceName}</span>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className={`font-mono text-sm ${daysClass}`}>{c.daysSince}d</span>
                        <button
                          type="button"
                          onClick={() => openDraftMessage(
                            { name: `${c.first_name} ${c.last_name}`, phone: c.phone, email: c.email },
                            `Draft a re-engagement message for ${c.first_name} ${c.last_name}, who last booked ${c.daysSince} days ago for ${c.serviceName}. Make it warm and offer a small incentive to rebook.`,
                            'sms',
                          )}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs font-medium pv-soft-brand hover:brightness-95 transition-all"
                        >
                          Draft re-engagement <ArrowUpRight size={12} className="ml-1" />
                        </button>
                      </div>
                    </div>
                    <div className="bg-muted rounded h-1.5 overflow-hidden">
                      <div className={`h-full rounded transition-all duration-500 ${barClass}`} style={{ width: `${barWidth}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </TabsContent>

        {/* ─── Tab 4: Scheduling ─── */}
        <TabsContent value="scheduling">
          <h3 className="text-base font-semibold mb-4">
            This Week's Bookings
            <span className="text-xs font-normal text-muted-foreground ml-2">
              {formatInOrgTz(orgStartOfWeek(now, orgTimezone, 1), orgTimezone, { month: 'short', day: 'numeric' })} – {formatInOrgTz(orgEndOfWeek(now, orgTimezone, 1), orgTimezone, { month: 'short', day: 'numeric', year: 'numeric' })}
            </span>
          </h3>
          <div className="pv-surface-raised p-5 mb-4">
            <div className="grid grid-cols-7 gap-3" style={{ height: 200 }}>
              {DAYS.map(day => {
                const count = weeklyData[day] || 0;
                const barHeight = count > 0 && maxBookings > 0 ? Math.max((count / maxBookings) * 100, 12) : 0;
                return (
                  <div key={day} className="flex flex-col items-center justify-end h-full gap-0">
                    <div className="w-full flex-1 flex items-end justify-center">
                      {count > 0 ? (
                        <div className="w-[55%] bg-primary rounded-t-md transition-all duration-500" style={{ height: `${barHeight}%`, minHeight: 16 }} />
                      ) : (
                        <div className="w-[55%] h-1 bg-muted rounded" />
                      )}
                    </div>
                    <span className={`font-mono text-sm font-medium mt-2 ${count > 0 ? 'text-foreground' : 'text-muted-foreground'}`}>{count}</span>
                    <span className="text-xs text-muted-foreground mt-0.5">{day}</span>
                  </div>
                );
              })}
            </div>
          </div>
          <div className="pv-surface-raised p-4">
            <div className="flex items-center gap-2 mb-2">
              <Sparkles size={14} className="text-primary" />
              <span className="text-sm font-semibold">AI Recommendation</span>
            </div>
            {schedLoading ? (
              <p className="text-sm text-muted-foreground">Generating recommendation...</p>
            ) : (
              <p className="text-sm text-foreground leading-relaxed">{schedRec || 'Click refresh to generate a scheduling recommendation.'}</p>
            )}
          </div>
        </TabsContent>

        {/* ─── Tab 5: Growth Playbook ─── */}
        <TabsContent value="playbook">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <BookOpen size={18} className="text-warning" />
              <h3 className="text-base font-semibold">Growth Playbook</h3>
              <span className="text-sm text-muted-foreground">Non-obvious strategies for your business</span>
            </div>
            <Button size="sm" variant="ghost" onClick={fetchPlaybook} disabled={playbookLoading} className="gap-2">
              <RefreshCw size={14} className={playbookLoading ? 'animate-spin' : ''} />
              {playbookLoading ? 'Generating...' : 'Regenerate'}
            </Button>
          </div>
          {playbookLoading && !playbook ? (
            <div className="pv-surface-raised p-8 text-center">
              <RefreshCw size={32} className="text-primary mx-auto mb-3 animate-spin" />
              <p className="text-sm text-muted-foreground">Analyzing your data and generating personalized growth strategies...</p>
            </div>
          ) : playbook ? (
            <div className="pv-surface-raised p-6">
              <div className="prose prose-sm dark:prose-invert max-w-none">
                <ReactMarkdown>{playbook}</ReactMarkdown>
              </div>
            </div>
          ) : (
            <div className="pv-surface-raised p-8 text-center">
              <BookOpen size={32} className="text-warning mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">Click Regenerate to get personalized growth strategies based on your data</p>
            </div>
          )}
        </TabsContent>

        {/* ─── Tab 6: Ask AI ─── */}
        <TabsContent value="ask-ai" className="max-w-full" style={{ display: 'flex', flexDirection: 'column', height: viewportH ? `calc(${viewportH}px - env(safe-area-inset-top) - 7rem)` : 'calc(100dvh - env(safe-area-inset-top) - 7rem - env(safe-area-inset-bottom))' }}>
          <h3 className="text-base font-semibold mb-3 shrink-0">Ask TidyWise AI</h3>
          <div className="flex max-w-full flex-wrap gap-2 mb-3 shrink-0" style={{ overflowX: 'hidden' }}>
            {dynamicChips.map((q, i) => (
              <button
                key={i}
                onClick={() => sendChat(q)}
                disabled={chatLoading}
                className="max-w-full break-words bg-muted border border-border rounded-full px-4 py-2 text-sm text-muted-foreground hover:bg-muted/80 transition-colors min-h-[44px] disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {q}
              </button>
            ))}
          </div>
          <div className="pv-surface-raised flex-1 min-h-0 overflow-y-auto overflow-x-hidden max-w-full p-4 mb-3">
            {chatMessages.length === 0 ? (
              <div className="text-center py-8">
                <Brain size={32} className="text-primary mx-auto mb-3" />
                <p className="text-sm text-muted-foreground">Ask a question or tap a chip above to start</p>
                <p className="text-xs text-muted-foreground/60 mt-1">AI has access to your real business data for specific advice</p>
              </div>
            ) : (
              <div className="space-y-4">
                {chatMessages.map((msg, i) => (
                  <div key={i} className={`flex min-w-0 max-w-full ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                    <div
                      className={`max-w-[min(80%,calc(100vw-5rem))] overflow-hidden break-words px-3.5 py-2.5 rounded-xl text-sm leading-relaxed ${msg.role === 'user' ? 'bg-primary/20 border border-primary/30 text-foreground' : 'bg-muted border border-border text-foreground'}`}
                    >
                      {msg.role === 'assistant' ? (
                        <div className="prose prose-sm dark:prose-invert max-w-none">
                          <ReactMarkdown>{msg.content}</ReactMarkdown>
                        </div>
                      ) : (
                        msg.content
                      )}
                    </div>
                  </div>
                ))}
                <div ref={chatEndRef} />
              </div>
            )}
          </div>
          <div className="flex w-full max-w-full min-w-0 gap-2 pt-2 shrink-0">
            <Input
              value={chatInput}
              onChange={e => setChatInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && !e.shiftKey && sendChat(chatInput)}
              placeholder="Ask about your business..."
              className="min-w-0 flex-1 bg-muted border-border text-foreground"
              style={{ minHeight: 44 }}
            />
            <Button
              onClick={() => sendChat(chatInput)}
              disabled={chatLoading || !chatInput.trim()}
              className="bg-primary text-primary-foreground hover:bg-primary/90 min-h-[44px] min-w-[44px]"
            >
              {chatLoading ? <RefreshCw size={16} className="animate-spin" /> : <Send size={16} />}
            </Button>
          </div>
        </TabsContent>

      </Tabs>

      <Dialog open={draftOpen} onOpenChange={setDraftOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Draft message{draftTarget?.name ? ` for ${draftTarget.name}` : ''}</DialogTitle>
            <DialogDescription>
              AI-generated {draftTarget?.channel === 'email' ? 'email' : 'SMS'}. Edit before sending.
            </DialogDescription>
          </DialogHeader>
          {draftLoading ? (
            <div className="flex items-center justify-center py-10 text-sm text-muted-foreground">
              <RefreshCw size={16} className="animate-spin mr-2" /> Generating message…
            </div>
          ) : (
            <Textarea
              value={draftText}
              onChange={(e) => setDraftText(e.target.value)}
              rows={8}
              placeholder="Your message…"
            />
          )}
          {draftTarget?.phone ? (
            <p className="text-xs text-muted-foreground">Will send to {draftTarget.phone}</p>
          ) : (
            <p className="text-xs text-warning">No phone on file — copy the message and send manually.</p>
          )}
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => {
                navigator.clipboard.writeText(draftText);
                toast.success('Copied to clipboard');
              }}
              disabled={!draftText.trim() || draftLoading}
            >
              Copy
            </Button>
            <Button
              onClick={sendDraftSms}
              disabled={!draftText.trim() || draftLoading || draftSending || !draftTarget?.phone}
            >
              {draftSending ? <><RefreshCw size={14} className="animate-spin mr-2" /> Sending…</> : 'Send SMS'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
