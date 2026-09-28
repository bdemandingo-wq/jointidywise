import { useEffect, useState } from 'react';
import { AdminLayout } from '@/components/admin/AdminLayout';
import { readEdgeFunctionError } from '@/lib/edgeFunctionError';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Loader2, Users, Building2, CreditCard, TrendingUp,
  UserPlus, RefreshCw, Trash2, Activity, Calendar,
  ArrowUpRight, ArrowDownRight, Clock, Timer, Mail,
  CalendarCheck, Phone, Briefcase, Bell, Search, Gift, DollarSign,
  AlertTriangle, Info
} from 'lucide-react';
import { PlatformRevenueView } from '@/pages/admin/PlatformRevenuePage';
import { BroadcastView } from '@/pages/admin/BroadcastPage';
import { isPlatformOwner } from '@/lib/platformOwner';

import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { format, formatDistanceToNow, subDays, differenceInDays, parseISO } from 'date-fns';
import { orgDateKey } from '@/lib/orgDateRange';
import { useOrgTimezone } from '@/hooks/useOrgTimezone';

const APPLE_CLIENT_SECRET_EXPIRES = '2027-02-21';
import { Button } from '@/components/ui/button';
import { Link, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
  countWithOnboardingData,
  describeAnswers,
  summariseSource,
} from '@/lib/onboardingAnswers';
import { useQuery } from '@tanstack/react-query';
import { SEOHead } from '@/components/SEOHead';
import { DemoCalendarTab } from '@/components/admin/DemoCalendarTab';
import { PlatformNotificationsLog } from '@/components/admin/PlatformNotificationsLog';
import { CancellationFeedbackPanel } from '@/components/admin/CancellationFeedbackPanel';
import { UserSessionEvidence } from '@/components/admin/UserSessionEvidence';
import { DisputeEvidencePanel } from '@/components/admin/DisputeEvidencePanel';
import ChurnRetentionTab from '@/components/admin/ChurnRetentionTab';
import { ErrorsIncidentsPanel } from '@/components/admin/ErrorsIncidentsPanel';
import { TrendingDown, Bug, Megaphone } from 'lucide-react';
import { formatTimestampWithZone } from '@/lib/timezoneUtils';

interface Subscriber {
  id: string;
  email: string;
  name: string | null;
  created: string;
  subscriptionStatus: string;
  subscriptionCreated: string;
  subscriptionId?: string;
  source: string;
}

interface PlatformAnalytics {
  signups: {
    total: number;
    recent: {
      id: string;
      email: string;
      created_at: string;
      org_name?: string | null;
      org_id?: string | null;
      role?: string | null;
      /**
       * jsonb from platform-analytics. `unknown`, not a concrete shape: it is
       * NULL for every organisation created before 2026-08-13 and was never
       * backfilled, and the API does not guarantee the shape. @/lib/onboardingAnswers
       * narrows it. Claiming a shape the API cannot honour is how the silent
       * failures in ChoosePlanPage started.
       */
      onboarding_answers?: unknown;
    }[];
    last30Days: number;
  };
  organizations: {
    total: number;
    recent: { id: string; name: string; created_at: string }[];
    last30Days: number;
  };
  subscriptions: {
    active: number;
    trialing: number;
    canceled: number;
    list: { id: string; customer_email: string; status: string; created: string; current_period_end: string }[];
  };
  subscribers: {
    total: number;
    recent: Subscriber[];
    last30Days: number;
  };
  compedAccess?: {
    activeCount: number;
    active: CompRow[];
    recentlyExpired: CompRow[];
    compedOrgIds: string[];
  };
}

interface CompRow {
  id: string;
  organization_id: string;
  organization_name: string | null;
  owner_email: string | null;
  code: string | null;
  email_lock: string | null;
  source: 'code' | 'direct';
  granted_at: string;
  expires_at: string;
  revoked_at: string | null;
  days_remaining: number;
  reason: string | null;
}

interface UserSessionStats {
  user_id: string;
  user_email: string;
  total_duration_seconds: number;
  session_count: number;
  user_type?: 'admin' | 'client_portal';
}

interface SessionStatsResponse {
  avgSessionDuration: number;
  totalSessions: number;
  userList: UserSessionStats[];
  adminStats?: {
    totalSessions: number;
    totalDuration: number;
    avgDuration: number;
    userCount: number;
  };
  clientPortalStats?: {
    totalSessions: number;
    totalDuration: number;
    avgDuration: number;
    userCount: number;
  };
}

// Helper to format seconds into human readable time
function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) {
    const mins = Math.floor(seconds / 60);
    return `${mins}m`;
  }
  const hours = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
}

// Platform-level analytics — intentionally unscoped by org_id. Super admin only.
export default function PlatformAnalyticsPage() {
  const { user } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [itemToDelete, setItemToDelete] = useState<{ id: string; type: 'user' | 'organization'; name: string } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [activityFilter, setActivityFilter] = useState<'all' | 'admin' | 'client_portal'>('all');
  const [activitySearch, setActivitySearch] = useState('');
  const [subscriberSearch, setSubscriberSearch] = useState('');
  const [cancelTarget, setCancelTarget] = useState<Subscriber | null>(null);
  const [cancelImmediate, setCancelImmediate] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [resubTarget, setResubTarget] = useState<Subscriber | null>(null);
  const [sendingResub, setSendingResub] = useState(false);
  const { timezone: orgTimezone } = useOrgTimezone();

  // Apple Sign In client secret expiry
  const appleSecretDaysLeft = (() => {
    const today = orgDateKey(new Date(), orgTimezone);
    return differenceInDays(parseISO(APPLE_CLIENT_SECRET_EXPIRES), parseISO(today));
  })();

  // Deep-link support: e.g. /dashboard/platform-analytics?tab=evidence (used by
  // the /dashboard/disputes redirect). Falls back to 'subscribers'.
  const [searchParams] = useSearchParams();
  const VALID_TABS = ['subscribers', 'signups', 'organizations', 'comped', 'churn', 'activity', 'evidence', 'demos', 'notifications', 'errors', 'broadcasts'];
  const requestedTab = searchParams.get('tab') || '';
  const [activeTab, setActiveTab] = useState(VALID_TABS.includes(requestedTab) ? requestedTab : 'subscribers');

  const handleSendResubscribeEmail = async () => {
    if (!resubTarget) return;
    setSendingResub(true);
    try {
      const { data, error } = await supabase.functions.invoke('admin-send-resubscribe-email', {
        body: { customerEmail: resubTarget.email },
      });
      // The catch surfaces err.message directly, so without this the operator
      // saw "Edge Function returned a non-2xx status code" instead of the
      // function's actual reason.
      if (error) throw new Error(await readEdgeFunctionError(error, 'Failed to send resubscribe email'));
      if ((data as any)?.error) throw new Error((data as any).error);
      toast.success(`Resubscribe email sent to ${resubTarget.email}`);
      setResubTarget(null);
    } catch (err: any) {
      toast.error(err?.message || 'Failed to send resubscribe email');
    } finally {
      setSendingResub(false);
    }
  };
  const [selectedSignups, setSelectedSignups] = useState<Set<string>>(new Set());
  const [selectedOrgs, setSelectedOrgs] = useState<Set<string>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [bulkConfirm, setBulkConfirm] = useState<null | 'user' | 'organization'>(null);

  const toggleSelect = (setter: typeof setSelectedSignups, id: string) => {
    setter((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleBulkDelete = async () => {
    const type = bulkConfirm;
    if (!type) return;
    const ids = Array.from(type === 'user' ? selectedSignups : selectedOrgs);
    if (ids.length === 0) return;
    setBulkDeleting(true);
    let success = 0;
    const failures: { label: string; reason: string }[] = [];

    // Build a lookup so we can name the failures
    const labelFor = (id: string): string => {
      if (type === 'user') {
        const signup = analytics?.signups.recent.find(s => s.id === id);
        return signup?.email || id;
      }
      const org = analytics?.organizations.recent.find(o => o.id === id);
      return org?.name || id;
    };

    const results = await Promise.allSettled(
      ids.map(async (id) => {
        const { data, error } = await supabase.functions.invoke('delete-platform-account', {
          body: { userId: id, type },
        });
        const errMsg = (data as any)?.error || error?.message;
        if (errMsg) throw Object.assign(new Error(errMsg), { label: labelFor(id) });
        return id;
      })
    );
    for (const r of results) {
      if (r.status === 'fulfilled') {
        success++;
      } else {
        const err = r.reason as Error & { label?: string };
        failures.push({ label: err.label || 'Unknown', reason: err.message });
      }
    }
    if (success) toast.success(`Deleted ${success} ${type === 'user' ? 'user(s)' : 'organization(s)'}`);
    if (failures.length) {
      const detail = failures.map(f => `${f.label}: ${f.reason}`).join('\n');
      toast.error(`${failures.length} failed to delete:\n${detail}`, { duration: 10000 });
    }
    if (type === 'user') setSelectedSignups(new Set());
    else setSelectedOrgs(new Set());
    setBulkConfirm(null);
    setBulkDeleting(false);
    fetchAnalytics();
    refetchSessions();
  };


  const handleCancelSubscription = async () => {
    if (!cancelTarget) return;
    setCancelling(true);
    try {
      const { data, error } = await supabase.functions.invoke('admin-cancel-subscription', {
        body: {
          subscriptionId: cancelTarget.subscriptionId,
          customerEmail: cancelTarget.email,
          immediate: cancelImmediate,
        },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      toast.success(
        cancelImmediate
          ? `Subscription canceled immediately for ${cancelTarget.email}`
          : `Subscription will cancel at period end for ${cancelTarget.email}`
      );
      setCancelTarget(null);
      setCancelImmediate(false);
      // Refetch analytics so the list reflects the new status
      fetchAnalytics();
    } catch (err: any) {
      toast.error(err?.message || 'Failed to cancel subscription');
    } finally {
      setCancelling(false);
    }
  };

  // Fetch session data - ALL TIME for total sessions, 30d for avg duration
  const { data: sessionStats, refetch: refetchSessions, error: sessionStatsError } = useQuery({
    queryKey: ['platform-session-stats'],
    queryFn: async (): Promise<SessionStatsResponse> => {
      // Fetch ALL TIME sessions for total count
      const { data: allTimeData, error: allTimeError } = await supabase.functions.invoke('platform-session-stats', {
        body: { days: 0 }, // 0 = all time
      });

      if (allTimeError) throw allTimeError;

      return {
        avgSessionDuration: allTimeData?.avgSessionDuration ?? 0,
        totalSessions: allTimeData?.totalSessions ?? 0,
        userList: (allTimeData?.userList ?? []) as UserSessionStats[],
        adminStats: allTimeData?.adminStats,
        clientPortalStats: allTimeData?.clientPortalStats,
      };
    },
    enabled: isPlatformOwner(user),
  });


  const {
    data: analytics = null,
    isLoading: loading,
    error: analyticsError,
    refetch: fetchAnalytics,
  } = useQuery({
    queryKey: ['platform-analytics'],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke('platform-analytics');
      if (error) throw error;
      return data as PlatformAnalytics;
    },
    enabled: isPlatformOwner(user),
    staleTime: 1000 * 60 * 10, // 10 minutes — the Stripe loop takes 10-30s, so don't re-run on every navigation
    retry: 1,
  });

  useEffect(() => {
    if (analyticsError) {
      const msg = analyticsError instanceof Error ? analyticsError.message : 'Failed to load analytics';
      setError(msg);
      toast.error(msg);
    } else {
      setError(null);
    }
  }, [analyticsError]);

  const handleDelete = async () => {
    if (!itemToDelete) return;
    
    setDeleting(true);
    try {
      const { data, error } = await supabase.functions.invoke('delete-platform-account', {
        body: { userId: itemToDelete.id, type: itemToDelete.type }
      });
      
      if (error || data?.error) {
        const errorMessage = data?.error || error?.message || 'Failed to delete';
        toast.error(errorMessage);
        return;
      }
      
      toast.success(`${itemToDelete.type === 'user' ? 'User' : 'Organization'} deleted successfully`);
      setDeleteDialogOpen(false);
      setItemToDelete(null);
      fetchAnalytics();
      refetchSessions();
    } catch (err: any) {
      console.error('Error deleting:', err);
      toast.error(err.message || 'Failed to delete');
    } finally {
      setDeleting(false);
    }
  };

  const openDeleteDialog = (id: string, type: 'user' | 'organization', name: string) => {
    setItemToDelete({ id, type, name });
    setDeleteConfirmText('');
    setDeleteDialogOpen(true);
  };

  const confirmTextMatches =
    !!itemToDelete && deleteConfirmText.trim() === itemToDelete.name.trim();

  // fetchAnalytics is now managed by useQuery — no manual useEffect needed.

  // Check if user is platform admin
  // Same predicate PlatformOwnerRoute guards the broadcast detail page with,
  // so the composer here and the send it navigates to cannot drift on who may
  // open them.
  if (!isPlatformOwner(user)) {
    return (
      <AdminLayout title="Unauthorized" subtitle="You don't have access to this page">
<div className="portal-v2 portal-v2-scroll overflow-x-clip">
      <SEOHead title="Platform Analytics | TidyWise" description="View platform usage and engagement analytics" noIndex />
        <Card className="border-destructive/20 bg-destructive/5">
          <CardContent className="py-12 text-center">
            <p className="text-muted-foreground">This page is only accessible to platform administrators.</p>
          </CardContent>
        </Card>
      </div>
</AdminLayout>
    );
  }

  if (loading) {
    return (
      <AdminLayout title="Platform Analytics" subtitle="Loading...">
<div className="portal-v2 portal-v2-scroll overflow-x-clip">
        <div className="flex items-center justify-center h-64">
          <div className="flex flex-col items-center gap-3">
            <Loader2 className="w-10 h-10 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">Loading platform data...</p>
          </div>
        </div>
      </div>
</AdminLayout>
    );
  }

  if (error) {
    return (
      <AdminLayout title="Platform Analytics" subtitle="Error loading data">
<div className="portal-v2 portal-v2-scroll overflow-x-clip">
        <Card className="border-destructive/20">
          <CardContent className="py-12 text-center">
            <p className="text-destructive mb-4">{error}</p>
            <Button onClick={() => fetchAnalytics()}>Try Again</Button>
          </CardContent>
        </Card>
      </div>
</AdminLayout>
    );
  }

  // Conversion rate based on organization signups (not total signups which include staff)
  const conversionRate = analytics?.organizations.total 
    ? Math.round(((analytics.subscriptions.active + analytics.subscriptions.trialing) / analytics.organizations.total) * 100) 
    : 0;

  return (
    <AdminLayout
      title="Platform Analytics"
      subtitle="Monitor signups, organizations, and subscriptions"
    >
<div className="portal-v2 portal-v2-scroll overflow-x-clip">
      <div className="space-y-6">
        {/* Header Actions */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Activity className="w-5 h-5 text-primary" />
            <span className="text-sm text-muted-foreground">
              Last updated: {formatTimestampWithZone(new Date(), orgTimezone)}
            </span>
          </div>
          <Button variant="outline" size="sm" onClick={() => { fetchAnalytics(); refetchSessions(); }} disabled={loading}>
            <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>

        {/* Apple Sign In secret expiry */}
        {appleSecretDaysLeft <= 0 ? (
          <div className="flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/10 p-4">
            <AlertTriangle className="w-5 h-5 text-destructive shrink-0 mt-0.5" />
            <p className="text-sm text-destructive">
              <span className="font-semibold">Apple Sign In client secret expired.</span>{' '}
              Regenerate the JWT in Lovable → Cloud → Users → Apple settings → Generate secret, using the .p8 key (Key ID 4H5MGTMV9Y), Services ID com.jointidywise.web.auth, Team ID JV99ZGTGR3. Users cannot sign in with Apple until this is renewed.
            </p>
          </div>
        ) : appleSecretDaysLeft <= 45 ? (
          <div className="flex items-start gap-3 rounded-lg border border-warning/30 bg-warning/10 p-4">
            <AlertTriangle className="w-5 h-5 text-warning shrink-0 mt-0.5" />
            <p className="text-sm text-warning">
              <span className="font-semibold">Apple Sign In client secret expires in {appleSecretDaysLeft} day{appleSecretDaysLeft === 1 ? '' : 's'}.</span>{' '}
              Regenerate the JWT in Lovable → Cloud → Users → Apple settings → Generate secret, using the .p8 key (Key ID 4H5MGTMV9Y), Services ID com.jointidywise.web.auth, Team ID JV99ZGTGR3. Users cannot sign in with Apple after expiry.
            </p>
          </div>
        ) : (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Info className="w-3.5 h-3.5" />
            <span>Apple Sign In secret expires Feb 21, 2027 ({appleSecretDaysLeft} days)</span>
          </div>
        )}

        {/* Stats Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
          <Card className="relative overflow-hidden">
            <div className="absolute top-0 right-0 w-20 h-20 bg-gradient-to-bl from-primary/10 to-transparent rounded-bl-full" />
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Total Signups</CardTitle>
              <div className="p-2 bg-primary/10 rounded-lg">
                <Users className="h-4 w-4 text-primary" />
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{analytics?.signups.total || 0}</div>
              <div className="flex items-center gap-1 mt-1">
                <ArrowUpRight className="w-3 h-3 text-success" />
                <span className="text-xs text-success font-medium">+{analytics?.signups.last30Days || 0}</span>
                <span className="text-xs text-muted-foreground">last 30 days</span>
              </div>
            </CardContent>
          </Card>

          <Card className="relative overflow-hidden">
            <div className="absolute top-0 right-0 w-20 h-20 bg-gradient-to-bl from-info/10 to-transparent rounded-bl-full" />
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Organizations</CardTitle>
              <div className="p-2 bg-info/10 rounded-lg">
                <Building2 className="h-4 w-4 text-info" />
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{analytics?.organizations.total || 0}</div>
              <div className="flex items-center gap-1 mt-1">
                <ArrowUpRight className="w-3 h-3 text-success" />
                <span className="text-xs text-success font-medium">+{analytics?.organizations.last30Days || 0}</span>
                <span className="text-xs text-muted-foreground">last 30 days</span>
              </div>
            </CardContent>
          </Card>

          <Card className="relative overflow-hidden">
            <div className="absolute top-0 right-0 w-20 h-20 bg-gradient-to-bl from-success/10 to-transparent rounded-bl-full" />
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Active Subscriptions</CardTitle>
              <div className="p-2 bg-success/10 rounded-lg">
                <CreditCard className="h-4 w-4 text-success" />
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{analytics?.subscriptions.active || 0}</div>
              <div className="flex items-center gap-1 mt-1">
                <span className="text-xs text-info font-medium">{analytics?.subscriptions.trialing || 0} trialing</span>
                <span className="text-xs text-muted-foreground">•</span>
                <span className="text-xs text-destructive">{analytics?.subscriptions.canceled || 0} canceled</span>
              </div>
            </CardContent>
          </Card>

          <Card className="relative overflow-hidden">
            <div className="absolute top-0 right-0 w-20 h-20 bg-gradient-to-bl from-warning/10 to-transparent rounded-bl-full" />
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Conversion Rate</CardTitle>
              <div className="p-2 bg-warning/10 rounded-lg">
                <TrendingUp className="h-4 w-4 text-warning" />
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{conversionRate}%</div>
              <p className="text-xs text-muted-foreground mt-1">
                Organizations → Subscriptions
              </p>
            </CardContent>
          </Card>

          <Card className="relative overflow-hidden">
            <div className="absolute top-0 right-0 w-20 h-20 bg-gradient-to-bl from-pink-500/10 to-transparent rounded-bl-full" />
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Comped Access</CardTitle>
              <div className="p-2 bg-pink-500/10 rounded-lg">
                <Gift className="h-4 w-4 text-pink-500" />
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{analytics?.compedAccess?.activeCount || 0}</div>
              <p className="text-xs text-muted-foreground mt-1">
                Not counted as paying customers
              </p>
              <Link
                to="/admin/access-codes"
                className="text-xs font-medium text-primary hover:underline inline-flex items-center gap-1 mt-2"
              >
                Manage access codes
                <ArrowUpRight className="w-3 h-3" />
              </Link>
            </CardContent>
          </Card>
        </div>


        {/* Tabbed Content */}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <div className="mb-4 flex flex-col md:flex-row md:items-center md:justify-between gap-2">
            <div className="md:hidden w-full px-4">
              <Select value={activeTab} onValueChange={setActiveTab}>
                <SelectTrigger className="w-full bg-background">
                  <SelectValue placeholder="Choose report" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="revenue">Revenue</SelectItem>
                  <SelectItem value="subscribers">Subscribers ({analytics?.subscribers?.total || 0})</SelectItem>

                  <SelectItem value="signups">Signups ({analytics?.signups.total || 0})</SelectItem>
                  <SelectItem value="organizations">Orgs ({analytics?.organizations.total || 0})</SelectItem>
                  <SelectItem value="comped">Comped ({analytics?.compedAccess?.activeCount || 0})</SelectItem>
                  <SelectItem value="churn">Churn</SelectItem>
                  <SelectItem value="activity">Activity</SelectItem>
                  <SelectItem value="evidence">Evidence</SelectItem>
                  <SelectItem value="demos">Demos</SelectItem>
                  <SelectItem value="notifications">Feed</SelectItem>
                  <SelectItem value="errors">Errors</SelectItem>
                  <SelectItem value="broadcasts">Broadcasts</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="hidden md:block md:mx-0 min-w-0 overflow-x-auto overscroll-x-contain scrollbar-none md:flex-1">
            <TabsList className="inline-flex md:grid md:w-full md:grid-cols-12 h-auto gap-1 min-w-max px-1 md:min-w-0 md:px-1">
              <TabsTrigger value="revenue" className="flex items-center gap-1.5 whitespace-nowrap shrink-0 min-w-max px-3">
                <DollarSign className="w-4 h-4" />
                <span>Revenue</span>
              </TabsTrigger>
              <TabsTrigger value="subscribers" className="flex items-center gap-1.5 whitespace-nowrap shrink-0 min-w-max px-3">

                <CreditCard className="w-4 h-4" />
                <span>Subscribers ({analytics?.subscribers?.total || 0})</span>
              </TabsTrigger>
              <TabsTrigger value="signups" className="flex items-center gap-1.5 whitespace-nowrap shrink-0 min-w-max px-3">
                <UserPlus className="w-4 h-4" />
                <span>Signups ({analytics?.signups.total || 0})</span>
              </TabsTrigger>
              <TabsTrigger value="organizations" className="flex items-center gap-1.5 whitespace-nowrap shrink-0 min-w-max px-3">
                <Building2 className="w-4 h-4" />
                <span>Orgs ({analytics?.organizations.total || 0})</span>
              </TabsTrigger>
              <TabsTrigger value="comped" className="flex items-center gap-1.5 whitespace-nowrap shrink-0 min-w-max px-3">
                <Gift className="w-4 h-4" />
                <span>Comped ({analytics?.compedAccess?.activeCount || 0})</span>
              </TabsTrigger>
              <TabsTrigger value="churn" className="flex items-center gap-1.5 whitespace-nowrap shrink-0 min-w-max px-3">
                <TrendingDown className="w-4 h-4" />
                <span>Churn</span>
              </TabsTrigger>
              <TabsTrigger value="activity" className="flex items-center gap-1.5 whitespace-nowrap shrink-0 min-w-max px-3">
                <Activity className="w-4 h-4" />
                <span>Activity</span>
              </TabsTrigger>
              <TabsTrigger value="evidence" className="flex items-center gap-1.5 whitespace-nowrap shrink-0 min-w-max px-3">
                <Search className="w-4 h-4" />
                <span>Evidence</span>
              </TabsTrigger>
              <TabsTrigger value="demos" className="flex items-center gap-1.5 whitespace-nowrap shrink-0 min-w-max px-3">
                <CalendarCheck className="w-4 h-4" />
                <span>Demos</span>
              </TabsTrigger>
              <TabsTrigger value="notifications" className="flex items-center gap-1.5 whitespace-nowrap shrink-0 min-w-max px-3">
                <Bell className="w-4 h-4" />
                <span>Feed</span>
              </TabsTrigger>
              <TabsTrigger value="errors" className="flex items-center gap-1.5 whitespace-nowrap shrink-0 min-w-max px-3">
                <Bug className="w-4 h-4" />
                <span>Errors</span>
              </TabsTrigger>
              <TabsTrigger value="broadcasts" className="flex items-center gap-1.5 whitespace-nowrap shrink-0 min-w-max px-3">
                <Megaphone className="w-4 h-4" />
                <span>Broadcasts</span>
              </TabsTrigger>
            </TabsList>
          </div>
            <Link
            to="/admin/access-codes"
              className="text-sm font-medium text-primary hover:underline inline-flex items-center gap-1 px-4 md:px-0 shrink-0"
          >
            Manage access codes
            <ArrowUpRight className="w-4 h-4" />
          </Link>
        </div>

          <TabsContent value="revenue">
            {/* Same component the standalone CRM Revenue page renders, so the two
                surfaces can never drift apart. */}
            <PlatformRevenueView embedded />
          </TabsContent>

          <TabsContent value="churn">

            <div className="space-y-6">
              <ChurnRetentionTab />
              <CancellationFeedbackPanel />
            </div>
          </TabsContent>

          <TabsContent value="comped">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-lg flex items-center gap-2">
                  <Gift className="w-5 h-5 text-pink-500" />
                  Comped Access ({analytics?.compedAccess?.activeCount || 0} active)
                </CardTitle>
                <p className="text-xs text-muted-foreground">
                  Orgs on time-limited comps do <b>not</b> appear in Subscribers / revenue metrics.
                </p>
              </CardHeader>
              <CardContent className="space-y-6">
                <div>
                  <h4 className="text-sm font-semibold mb-2">Active</h4>
                  {(analytics?.compedAccess?.active?.length ?? 0) === 0 ? (
                    <p className="text-sm text-muted-foreground">No active comps.</p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead className="text-xs text-muted-foreground">
                          <tr className="border-b">
                            <th className="text-left py-2 pr-3">Organization</th>
                            <th className="text-left py-2 pr-3">Owner</th>
                            <th className="text-left py-2 pr-3">Code</th>
                            <th className="text-left py-2 pr-3">Granted</th>
                            <th className="text-left py-2 pr-3">Expires</th>
                            <th className="text-left py-2 pr-3">Days left</th>
                          </tr>
                        </thead>
                        <tbody>
                          {analytics!.compedAccess!.active.map((c) => (
                            <tr key={c.id} className="border-b last:border-0">
                              <td className="py-2 pr-3 font-medium">{c.organization_name ?? c.organization_id}</td>
                              <td className="py-2 pr-3 text-muted-foreground">{c.owner_email ?? '—'}</td>
                              <td className="py-2 pr-3"><code className="text-xs">{c.code ?? (c.source === 'direct' ? 'DIRECT' : '—')}</code></td>
                              {/* eslint-disable-next-line local/no-device-local-dates -- viewer-local display of a stored instant, not a business-day boundary */}
                              <td className="py-2 pr-3 text-muted-foreground">{new Date(c.granted_at).toLocaleDateString()}</td>
                              {/* eslint-disable-next-line local/no-device-local-dates -- viewer-local display of a stored instant, not a business-day boundary */}
                              <td className="py-2 pr-3 text-muted-foreground">{new Date(c.expires_at).toLocaleDateString()}</td>
                              <td className="py-2 pr-3 font-medium">{c.days_remaining}d</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                <div>
                  <h4 className="text-sm font-semibold mb-2">Recently expired / revoked (last 30 days)</h4>
                  {(analytics?.compedAccess?.recentlyExpired?.length ?? 0) === 0 ? (
                    <p className="text-sm text-muted-foreground">None.</p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead className="text-xs text-muted-foreground">
                          <tr className="border-b">
                            <th className="text-left py-2 pr-3">Organization</th>
                            <th className="text-left py-2 pr-3">Owner</th>
                            <th className="text-left py-2 pr-3">Code</th>
                            <th className="text-left py-2 pr-3">Ended</th>
                            <th className="text-left py-2 pr-3">Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {analytics!.compedAccess!.recentlyExpired.map((c) => (
                            <tr key={c.id} className="border-b last:border-0">
                              <td className="py-2 pr-3">{c.organization_name ?? c.organization_id}</td>
                              <td className="py-2 pr-3 text-muted-foreground">{c.owner_email ?? '—'}</td>
                              <td className="py-2 pr-3"><code className="text-xs">{c.code ?? '—'}</code></td>
                              <td className="py-2 pr-3 text-muted-foreground">
                                {/* eslint-disable-next-line local/no-device-local-dates -- viewer-local display of a stored instant, not a business-day boundary */}
                                {new Date(c.revoked_at ?? c.expires_at).toLocaleDateString()}
                              </td>
                              <td className="py-2 pr-3">
                                {c.revoked_at ? <span className="text-destructive">Revoked</span> : <span className="text-muted-foreground">Expired</span>}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* TidyWise Subscribers Tab - Only shows users with subscriptions */}
          <TabsContent value="subscribers">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-lg flex items-center gap-2">
                  <CreditCard className="w-5 h-5 text-primary" />
                  TidyWise Subscribers
                  <Badge variant="secondary" className="ml-auto">
                    +{analytics?.subscribers?.last30Days || 0} last 30 days
                  </Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4 sm:px-6">
                <div className="relative mb-3">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    placeholder="Search by email or name…"
                    value={subscriberSearch}
                    onChange={(e) => setSubscriberSearch(e.target.value)}
                    className="pl-9"
                  />
                </div>
                <ScrollArea className="h-[500px] pr-0 sm:pr-4 overflow-x-hidden">
                  {(() => {
                    const list = analytics?.subscribers?.recent || [];
                    const q = subscriberSearch.trim().toLowerCase();
                    const filtered = q
                      ? list.filter(
                          (s) =>
                            s.email?.toLowerCase().includes(q) ||
                            s.name?.toLowerCase().includes(q)
                        )
                      : list;
                    if (filtered.length === 0) {
                      return (
                        <div className="text-center py-12 text-muted-foreground">
                          <CreditCard className="w-12 h-12 mx-auto mb-3 opacity-30" />
                          <p>{q ? 'No subscribers match your search' : 'No TidyWise subscribers found'}</p>
                          {!q && (
                            <p className="text-xs mt-1">Only users with active TidyWise subscriptions appear here</p>
                          )}
                        </div>
                      );
                    }
                    return (
                      <div className="space-y-2 overflow-x-hidden">
                        {filtered.map((subscriber) => {
                          const canCancel = ['active', 'trialing', 'past_due'].includes(
                            subscriber.subscriptionStatus
                          );
                          return (
                            <div
                              key={subscriber.id}
                              className="group w-full overflow-hidden rounded-lg bg-muted/50 p-3 transition-colors hover:bg-muted sm:flex sm:items-center sm:justify-between sm:gap-2"
                            >
                              <div className="grid min-w-0 grid-cols-[2.5rem_minmax(0,1fr)] gap-3 sm:flex sm:flex-1 sm:items-center">
                                <div className="w-10 h-10 shrink-0 rounded-full bg-primary/10 flex items-center justify-center">
                                  <span className="text-sm font-medium text-primary">
                                    {subscriber.email?.charAt(0).toUpperCase() || '?'}
                                  </span>
                                </div>
                                <div className="min-w-0 overflow-hidden">
                                  <p className="truncate text-sm font-medium sm:max-w-none">{subscriber.email}</p>
                                  {subscriber.name && (
                                    <p className="truncate text-xs text-muted-foreground">{subscriber.name}</p>
                                  )}
                                  <p className="flex items-center gap-1 truncate text-xs text-muted-foreground">
                                    <Calendar className="w-3 h-3 shrink-0" />
                                    Subscribed {subscriber.subscriptionCreated !== 'Unknown'
                                      ? formatDistanceToNow(new Date(subscriber.subscriptionCreated), { addSuffix: true })
                                      : 'Unknown date'}
                                  </p>
                                </div>
                              </div>
                              <div className="mt-3 flex w-full items-center justify-between gap-2 pl-[3.25rem] sm:mt-0 sm:w-auto sm:justify-end sm:pl-0 sm:shrink-0">
                                <Badge
                                  variant={subscriber.subscriptionStatus === 'active' ? 'default' :
                                           subscriber.subscriptionStatus === 'trialing' ? 'secondary' : 'destructive'}
                                  className="max-w-[9rem] shrink truncate text-xs"
                                >
                                  {subscriber.subscriptionStatus}
                                </Badge>
                                {canCancel ? (
                                  <Button
                                    size="sm"
                                    variant="destructive"
                                    onClick={() => { setCancelImmediate(false); setCancelTarget(subscriber); }}
                                    className="min-w-[5.5rem] shrink-0"
                                  >
                                    Cancel
                                  </Button>
                                ) : (
                                  <Button
                                    size="icon"
                                    variant="outline"
                                    onClick={() => setResubTarget(subscriber)}
                                    aria-label="Send resubscribe email"
                                    title="Send resubscribe email"
                                    className="h-9 w-9 shrink-0"
                                  >
                                    <Mail className="w-4 h-4" />
                                  </Button>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    );
                  })()}
                </ScrollArea>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Cancel subscription confirm dialog */}
          <AlertDialog open={!!cancelTarget} onOpenChange={(o) => !o && setCancelTarget(null)}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Cancel subscription?</AlertDialogTitle>
                <AlertDialogDescription>
                  This will cancel the TidyWise subscription for{' '}
                  <span className="font-medium text-foreground">{cancelTarget?.email}</span>.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <label className="flex items-start gap-2 text-sm py-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={cancelImmediate}
                  onChange={(e) => setCancelImmediate(e.target.checked)}
                  className="mt-1"
                />
                <span>
                  Cancel <span className="font-medium">immediately</span> (otherwise cancels at period end)
                </span>
              </label>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={cancelling}>Keep subscription</AlertDialogCancel>
                <AlertDialogAction
                  onClick={(e) => { e.preventDefault(); handleCancelSubscription(); }}
                  disabled={cancelling}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  {cancelling ? 'Cancelling…' : 'Cancel subscription'}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>

          {/* Send resubscribe email confirm dialog */}
          <AlertDialog open={!!resubTarget} onOpenChange={(o) => !o && setResubTarget(null)}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Send resubscribe email?</AlertDialogTitle>
                <AlertDialogDescription>
                  This will email{' '}
                  <span className="font-medium text-foreground">{resubTarget?.email}</span>{' '}
                  a Stripe checkout link to restart the TidyWise Pro subscription.
                  They&apos;ll need to complete checkout themselves.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={sendingResub}>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={(e) => { e.preventDefault(); handleSendResubscribeEmail(); }}
                  disabled={sendingResub}
                >
                  {sendingResub ? 'Sending…' : 'Send email'}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>


          <TabsContent value="signups">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-lg flex items-center gap-2">
                  <UserPlus className="w-5 h-5 text-primary" />
                  Recent Signups
                  <Badge variant="secondary" className="ml-auto">Last 30 days</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent>
                {analytics?.signups.recent && analytics.signups.recent.length > 0 && (
                  <div className="flex items-center justify-between mb-3 px-1">
                    <label className="flex items-center gap-2 text-sm cursor-pointer">
                      <Checkbox
                        checked={
                          selectedSignups.size > 0 &&
                          selectedSignups.size === analytics.signups.recent.length
                        }
                        onCheckedChange={(checked) => {
                          if (checked) {
                            setSelectedSignups(new Set(analytics.signups.recent.map((s) => s.id)));
                          } else {
                            setSelectedSignups(new Set());
                          }
                        }}
                      />
                      <span className="text-muted-foreground">
                        {selectedSignups.size > 0
                          ? `${selectedSignups.size} selected`
                          : 'Select all'}
                      </span>
                    </label>
                    {selectedSignups.size > 0 && (
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => setBulkConfirm('user')}
                      >
                        <Trash2 className="w-4 h-4 mr-2" />
                        Delete {selectedSignups.size}
                      </Button>
                    )}
                  </div>
                )}
                {/*
                  States the absence rather than leaving the reader to infer it.
                  onboarding_answers is null for nearly every organisation — the
                  column landed 2026-08-13 and was deliberately not backfilled —
                  so without this line a column of dashes is indistinguishable
                  from a broken panel. The number is the whole point.
                */}
                {analytics?.signups.recent && analytics.signups.recent.length > 0 && (
                  <p className="text-xs text-muted-foreground mb-2">
                    {countWithOnboardingData(analytics.signups.recent)} of{' '}
                    {analytics.signups.recent.length} signups have acquisition data — captured at
                    onboarding from 13 Aug 2026, not backfilled.
                  </p>
                )}
                <ScrollArea className="h-[400px] pr-4">
                  {analytics?.signups.recent && analytics.signups.recent.length > 0 ? (
                    <div className="space-y-2">
                      {analytics.signups.recent.map((signup) => (
                        <div 
                          key={signup.id} 
                          className="group flex items-center justify-between p-3 bg-muted/50 hover:bg-muted rounded-lg transition-colors"
                        >
                          <div className="flex items-center gap-3">
                            <Checkbox
                              checked={selectedSignups.has(signup.id)}
                              onCheckedChange={() => toggleSelect(setSelectedSignups, signup.id)}
                            />
                            <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                              <span className="text-sm font-medium text-primary">
                                {signup.email?.charAt(0).toUpperCase() || '?'}
                              </span>
                            </div>
                            <div>
                              <p className="font-medium text-sm">{signup.email}</p>
                              {signup.org_name && (
                                <p className="text-xs text-primary/80 font-medium flex items-center gap-1">
                                  <Building2 className="w-3 h-3" />
                                  {signup.org_name}
                                  {signup.role && <Badge variant="outline" className="text-[10px] px-1 py-0 ml-1">{signup.role}</Badge>}
                                </p>
                              )}
                              <p className="text-xs text-muted-foreground flex items-center gap-1">
                                <Calendar className="w-3 h-3" />
                                {formatDistanceToNow(new Date(signup.created_at), { addSuffix: true })}
                              </p>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            {/*
                              Fixed slot, always rendered. A dash only reads as
                              "no data" if there is visibly a column for it to be
                              missing from; rendered conditionally it would just
                              look like the feature had not shipped.
                            */}
                            {(() => {
                              const source = summariseSource(signup.onboarding_answers);
                              if (!source) {
                                return (
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <span className="w-20 text-right text-xs text-muted-foreground/50">
                                        —
                                      </span>
                                    </TooltipTrigger>
                                    <TooltipContent>
                                      No acquisition data — this organisation signed up before the
                                      question existed.
                                    </TooltipContent>
                                  </Tooltip>
                                );
                              }
                              return (
                                <Popover>
                                  <PopoverTrigger asChild>
                                    {/* Popover, not HoverCard: hover-only disclosure is
                                        unreachable on touch, and this page is opened on phones. */}
                                    <button type="button" className="shrink-0">
                                      <Badge
                                        variant="secondary"
                                        className="cursor-pointer text-xs font-medium"
                                      >
                                        {source.primary}
                                        {source.extraCount > 0 && ` +${source.extraCount}`}
                                      </Badge>
                                    </button>
                                  </PopoverTrigger>
                                  <PopoverContent align="end" className="w-72 space-y-2 text-xs">
                                    {describeAnswers(signup.onboarding_answers).map((row) => (
                                      <div key={row.key}>
                                        <p className="text-muted-foreground">{row.question}</p>
                                        <p className="font-medium">{row.labels.join(', ')}</p>
                                      </div>
                                    ))}
                                  </PopoverContent>
                                </Popover>
                              );
                            })()}
                            <Badge variant="outline" className="text-xs">
                              {format(new Date(signup.created_at), 'MMM d')}
                            </Badge>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity text-destructive hover:text-destructive hover:bg-destructive/10"
                              onClick={() => openDeleteDialog(signup.id, 'user', signup.email)}
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-center py-12 text-muted-foreground">
                      <Users className="w-12 h-12 mx-auto mb-3 opacity-30" />
                      <p>No recent signups</p>
                    </div>
                  )}
                </ScrollArea>
              </CardContent>
            </Card>
          </TabsContent>


          <TabsContent value="organizations">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-lg flex items-center gap-2">
                  <Building2 className="w-5 h-5 text-info" />
                  Recent Organizations
                  <Badge variant="secondary" className="ml-auto">Last 30 days</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent>
                {analytics?.organizations.recent && analytics.organizations.recent.length > 0 && (
                  <div className="flex items-center justify-between mb-3 px-1">
                    <label className="flex items-center gap-2 text-sm cursor-pointer">
                      <Checkbox
                        checked={
                          selectedOrgs.size > 0 &&
                          selectedOrgs.size === analytics.organizations.recent.length
                        }
                        onCheckedChange={(checked) => {
                          if (checked) {
                            setSelectedOrgs(new Set(analytics.organizations.recent.map((o) => o.id)));
                          } else {
                            setSelectedOrgs(new Set());
                          }
                        }}
                      />
                      <span className="text-muted-foreground">
                        {selectedOrgs.size > 0
                          ? `${selectedOrgs.size} selected`
                          : 'Select all'}
                      </span>
                    </label>
                    {selectedOrgs.size > 0 && (
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => setBulkConfirm('organization')}
                      >
                        <Trash2 className="w-4 h-4 mr-2" />
                        Delete {selectedOrgs.size}
                      </Button>
                    )}
                  </div>
                )}
                <ScrollArea className="h-[400px] pr-4">
                  {analytics?.organizations.recent && analytics.organizations.recent.length > 0 ? (
                    <div className="space-y-2">
                      {analytics.organizations.recent.map((org) => (
                        <div 
                          key={org.id} 
                          className="group flex items-center justify-between p-3 bg-muted/50 hover:bg-muted rounded-lg transition-colors"
                        >
                          <div className="flex items-center gap-3">
                            <Checkbox
                              checked={selectedOrgs.has(org.id)}
                              onCheckedChange={() => toggleSelect(setSelectedOrgs, org.id)}
                            />

                            <div className="w-10 h-10 rounded-full bg-info/10 flex items-center justify-center">
                              <Building2 className="w-5 h-5 text-info" />
                            </div>
                            <div>
                              <p className="font-medium text-sm">{org.name}</p>
                              <p className="text-xs text-muted-foreground flex items-center gap-1">
                                <Calendar className="w-3 h-3" />
                                {formatDistanceToNow(new Date(org.created_at), { addSuffix: true })}
                              </p>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <Badge variant="outline" className="text-xs">
                              {format(new Date(org.created_at), 'MMM d')}
                            </Badge>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity text-destructive hover:text-destructive hover:bg-destructive/10"
                              onClick={() => openDeleteDialog(org.id, 'organization', org.name)}
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-center py-12 text-muted-foreground">
                      <Building2 className="w-12 h-12 mx-auto mb-3 opacity-30" />
                      <p>No recent organizations</p>
                    </div>
                  )}
                </ScrollArea>
              </CardContent>
            </Card>
          </TabsContent>


          <TabsContent value="activity">
            <Card>
              <CardHeader className="pb-3">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                  <CardTitle className="text-base sm:text-lg flex items-center gap-2 flex-wrap">
                    <Activity className="w-5 h-5 text-primary" />
                    User Activity Tracking
                    <Badge variant="secondary">Live</Badge>
                  </CardTitle>
                  {/* Filter buttons — horizontally scroll on narrow screens */}
                  <div className="-mx-1 px-1 overflow-x-auto scrollbar-none">
                    <div className="flex gap-1 w-max sm:w-auto">
                      <Button
                        variant={activityFilter === 'all' ? 'default' : 'outline'}
                        size="sm"
                        className="whitespace-nowrap"
                        onClick={() => setActivityFilter('all')}
                      >
                        All
                      </Button>
                      <Button
                        variant={activityFilter === 'admin' ? 'default' : 'outline'}
                        size="sm"
                        className="whitespace-nowrap"
                        onClick={() => setActivityFilter('admin')}
                      >
                        Admin ({sessionStats?.adminStats?.userCount || 0})
                      </Button>
                      <Button
                        variant={activityFilter === 'client_portal' ? 'default' : 'outline'}
                        size="sm"
                        className="whitespace-nowrap"
                        onClick={() => setActivityFilter('client_portal')}
                      >
                        Client Portal ({sessionStats?.clientPortalStats?.userCount || 0})
                      </Button>
                    </div>
                  </div>
                </div>
                {/* Client-side filter on the already-loaded list (email) */}
                <div className="relative mt-3 w-full sm:max-w-xs">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    value={activitySearch}
                    onChange={(e) => setActivitySearch(e.target.value)}
                    placeholder="Filter by email…"
                    className="pl-8 h-9"
                  />
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-6">
                  {/* Activity Stats */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <div className="text-center p-3 bg-primary/10 rounded-lg border border-primary/20">
                      <p className="text-2xl font-bold text-primary">
                        {activityFilter === 'all' 
                          ? (sessionStats?.userList?.length || 0)
                          : activityFilter === 'admin'
                            ? (sessionStats?.adminStats?.userCount || 0)
                            : (sessionStats?.clientPortalStats?.userCount || 0)
                        }
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {activityFilter === 'client_portal' ? 'Portal Users' : 'Active Users'} (All Time)
                      </p>
                    </div>
                    <div className="text-center p-3 bg-info/10 rounded-lg border border-info/20">
                      <p className="text-2xl font-bold text-info">
                        {activityFilter === 'all' 
                          ? Math.round(((sessionStats?.userList?.length || 0) / Math.max(1, analytics?.signups.total || 1)) * 100)
                          : activityFilter === 'admin'
                            ? Math.round(((sessionStats?.adminStats?.userCount || 0) / Math.max(1, analytics?.signups.total || 1)) * 100)
                            : (sessionStats?.clientPortalStats?.userCount || 0)
                        }%
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {activityFilter === 'client_portal' ? 'Portal Engagement' : 'Engagement Rate'}
                      </p>
                    </div>
                    <div className="text-center p-3 bg-success/10 rounded-lg border border-success/20">
                      <div className="flex items-center justify-center gap-1">
                        <Timer className="w-4 h-4 text-success" />
                        <p className="text-2xl font-bold text-success">
                          {formatDuration(
                            activityFilter === 'all' 
                              ? (sessionStats?.avgSessionDuration || 0)
                              : activityFilter === 'admin'
                                ? (sessionStats?.adminStats?.avgDuration || 0)
                                : (sessionStats?.clientPortalStats?.avgDuration || 0)
                          )}
                        </p>
                      </div>
                      <p className="text-xs text-muted-foreground">Avg Session Duration</p>
                    </div>
                    <div className="text-center p-3 bg-warning/10 rounded-lg border border-warning/20">
                      <p className="text-2xl font-bold text-warning">
                        {activityFilter === 'all' 
                          ? (sessionStats?.totalSessions || 0)
                          : activityFilter === 'admin'
                            ? (sessionStats?.adminStats?.totalSessions || 0)
                            : (sessionStats?.clientPortalStats?.totalSessions || 0)
                        }
                      </p>
                      <p className="text-xs text-muted-foreground">Total Sessions (All Time)</p>
                    </div>
                  </div>

                  {/* Most Active Users */}
                  <div>
                    <h4 className="text-sm font-medium mb-3 flex items-center gap-2">
                      <TrendingUp className="w-4 h-4 text-primary" />
                      Most Active Users
                      <span className="text-xs text-muted-foreground ml-auto">By time spent (all time)</span>
                    </h4>
                    <ScrollArea className="h-[280px] pr-4 pb-2">
                      {(() => {
                        const q = activitySearch.trim().toLowerCase();
                        const filteredUsers = sessionStats?.userList?.filter(u =>
                          (activityFilter === 'all' || u.user_type === activityFilter) &&
                          (!q || u.user_email.toLowerCase().includes(q))
                        ) || [];
                        
                        if (filteredUsers.length > 0) {
                          return (
                            <div className="space-y-2">
                              {filteredUsers.map((userStat, index) => (
                                <div
                                  key={userStat.user_id}
                                  className="flex items-center justify-between p-3 bg-muted/50 hover:bg-muted rounded-lg transition-colors pr-4"
                                >
                                  <div className="flex items-center gap-3">
                                    <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${
                                      index === 0 ? 'bg-yellow-500/20 text-yellow-600' :
                                      index === 1 ? 'bg-gray-300/30 text-gray-600' :
                                      index === 2 ? 'bg-amber-600/20 text-amber-700' :
                                      'bg-primary/10 text-primary'
                                    }`}>
                                      {index + 1}
                                    </div>
                                    <div>
                                      <div className="flex items-center gap-2">
                                        <p className="font-medium text-sm">{userStat.user_email}</p>
                                        {userStat.user_type === 'client_portal' && (
                                          <Badge variant="outline" className="text-[10px] px-1.5 py-0">Portal</Badge>
                                        )}
                                      </div>
                                      <p className="text-xs text-muted-foreground">
                                        {userStat.session_count} session{userStat.session_count !== 1 ? 's' : ''}
                                      </p>
                                    </div>
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <Badge variant="outline" className="text-xs bg-success/10 text-success border-success/20 flex items-center gap-1">
                                      <Clock className="w-3 h-3" />
                                      {formatDuration(userStat.total_duration_seconds)}
                                    </Badge>
                                  </div>
                                </div>
                              ))}
                            </div>
                          );
                        }
                        
                        return (
                          <div className="text-center py-12 text-muted-foreground">
                            <Activity className="w-12 h-12 mx-auto mb-3 opacity-30" />
                            {q ? (
                              <p>No users match "{activitySearch.trim()}"</p>
                            ) : (
                              <>
                                <p>No session data available yet</p>
                                <p className="text-xs mt-1">Sessions are tracked as users browse the app</p>
                              </>
                            )}
                          </div>
                        );
                      })()}
                    </ScrollArea>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
          <TabsContent value="evidence">
            <div className="space-y-6">
              <DisputeEvidencePanel />
              <UserSessionEvidence />
            </div>
          </TabsContent>
          <DemoCalendarTab />
          <PlatformNotificationsLog />
          <TabsContent value="errors">
            <ErrorsIncidentsPanel />
          </TabsContent>
          {/* The one tab that acts rather than reports. Radix unmounts inactive
              TabsContent, so an unsaved compose is lost on a tab switch — the
              send gate deliberately survives that via the broadcast row (see
              useBroadcastTested) rather than via a live component. */}
          <TabsContent value="broadcasts">
            <BroadcastView embedded />
          </TabsContent>
        </Tabs>
      </div>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {itemToDelete?.type === 'user' ? 'User' : 'Organization'}?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete <strong>{itemToDelete?.name}</strong>?
              This action cannot be undone and will permanently remove all associated data
              {itemToDelete?.type === 'organization'
                ? ' (bookings, customers, staff, settings, and everything else tied to this business)'
                : ''}.
            </AlertDialogDescription>
          </AlertDialogHeader>


          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Deleting...
                </>
              ) : (
                <>
                  <Trash2 className="w-4 h-4 mr-2" />
                  Delete
                </>
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Bulk Delete Confirmation Dialog */}
      <AlertDialog open={!!bulkConfirm} onOpenChange={(o) => !o && !bulkDeleting && setBulkConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete {bulkConfirm === 'user' ? selectedSignups.size : selectedOrgs.size}{' '}
              {bulkConfirm === 'user' ? 'user(s)' : 'organization(s)'}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone and will permanently remove all associated data
              {bulkConfirm === 'organization'
                ? ' (bookings, customers, staff, settings, and everything else tied to each business)'
                : ''}.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={bulkDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); handleBulkDelete(); }}
              disabled={bulkDeleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {bulkDeleting ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Deleting...
                </>
              ) : (
                <>
                  <Trash2 className="w-4 h-4 mr-2" />
                  Delete all
                </>
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
</AdminLayout>

  );
}
