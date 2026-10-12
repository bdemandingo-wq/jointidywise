import { AdminLayout } from '@/components/admin/AdminLayout';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import {
  Bell,
  Loader2,
  Mail,
  Play,
  CheckCircle2,
  Smartphone,
  CreditCard,
  MessageSquare,
  Navigation,
  XCircle,
  Users,
} from 'lucide-react';
import { useEffect, useState, useCallback } from 'react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { useOrganization } from '@/contexts/OrganizationContext';
import { Skeleton } from '@/components/ui/skeleton';
import { SEOHead } from '@/components/SEOHead';
import { usePushNotifications } from '@/hooks/usePushNotifications';
import { describePushRuntime } from '@/lib/pushRuntime';
import { NotificationPreferencesCard } from '@/components/admin/NotificationPreferencesCard';
import { useLegacyNotificationMigration } from '@/hooks/useLegacyNotificationMigration';
import { useQueryClient } from '@tanstack/react-query';
import { usePullToRefresh } from '@/hooks/usePullToRefresh';
import { PullToRefreshIndicator } from '@/components/admin/PullToRefreshIndicator';
import { requestAdminNotificationRefresh } from '@/lib/adminNotificationRefresh';

const PUSH_CATEGORIES = [
  { key: 'new_booking', label: 'New Booking', description: 'When a customer submits a booking request', icon: Bell },
  { key: 'booking_confirmed', label: 'Booking Confirmed', description: 'When a booking is confirmed and paid', icon: CheckCircle2 },
  { key: 'cancellation', label: 'Cancellation', description: 'When a customer cancels a booking', icon: XCircle },
  { key: 'cleaner_on_way', label: 'Cleaner On The Way', description: 'When a cleaner marks themselves en route', icon: Navigation },
  { key: 'payment_received', label: 'Payment Received', description: 'When an invoice is paid via Stripe', icon: CreditCard },
  { key: 'new_inbound_message', label: 'New Inbound Message', description: 'When a customer texts your business number', icon: MessageSquare },
  { key: 'new_facebook_lead', label: 'New Facebook Lead', description: 'When a lead comes in from your Facebook ad', icon: Users },
];

export default function NotificationsPage() {
  const { organization } = useOrganization();
  const orgId = organization?.id ?? null;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [briefsAutoSend, setBriefsAutoSend] = useState({ morning: true, evening: true });
  const [savingBrief, setSavingBrief] = useState<'morning' | 'evening' | null>(null);
  const [sendingBrief, setSendingBrief] = useState(false);
  const [sendingEvening, setSendingEvening] = useState(false);
  const { isSupported, isRegistered, isRegistering, status, runtimeFacts, registerDevice } = usePushNotifications();
  const queryClient = useQueryClient();

  // Shared, non-destructive migration of the three legacy notify_* flags into
  // the new organization_notification_preferences matrix.
  useLegacyNotificationMigration();

  const loadBriefs = useCallback(async (opts?: { quiet?: boolean }) => {
    if (!orgId) return;
    if (!opts?.quiet) setLoading(true);
    setError(null);
    const { data, error: err } = await supabase
      .from('business_settings')
      .select('notify_evening_brief, notify_morning_brief')
      .eq('organization_id', orgId)
      .maybeSingle();
    if (err) {
      setError(err.message);
      setLoading(false);
      return;
    }
    setBriefsAutoSend({
      morning: (data as { notify_morning_brief?: boolean } | null)?.notify_morning_brief ?? true,
      evening: (data as { notify_evening_brief?: boolean } | null)?.notify_evening_brief ?? true,
    });
    setLoading(false);
  }, [orgId]);

  useEffect(() => {
    void loadBriefs();
  }, [loadBriefs]);

  const handlePullRefresh = useCallback(async () => {
    await Promise.all([
      loadBriefs({ quiet: true }),
      queryClient.invalidateQueries({ queryKey: ['org-notification-prefs'] }),
    ]);
    requestAdminNotificationRefresh();
  }, [loadBriefs, queryClient]);
  const { refreshing, pullDistance, handlers: pullHandlers } = usePullToRefresh(handlePullRefresh);

  const toggleBrief = async (which: 'morning' | 'evening', value: boolean) => {
    if (!orgId) return;
    setSavingBrief(which);
    setBriefsAutoSend(prev => ({ ...prev, [which]: value }));
    const col = which === 'morning' ? 'notify_morning_brief' : 'notify_evening_brief';
    const { error: err } = await supabase
      .from('business_settings')
      .update({ [col]: value } as any)
      .eq('organization_id', orgId);
    setSavingBrief(null);
    if (err) {
      setBriefsAutoSend(prev => ({ ...prev, [which]: !value }));
      toast.error(err.message);
    } else {
      toast.success('Saved');
    }
  };

  const extractInvokeError = async (invokeErr: any): Promise<string> => {
    try {
      const ctx = invokeErr?.context;
      if (ctx && typeof ctx.json === 'function') {
        const body = await ctx.json();
        if (body?.error) return typeof body.error === 'string' ? body.error : JSON.stringify(body.error);
        if (body?.message) return body.message;
      }
      if (ctx && typeof ctx.text === 'function') {
        const txt = await ctx.text();
        if (txt) return txt;
      }
    } catch { /* ignore parse errors */ }
    return invokeErr?.message || 'Unknown error';
  };

  const handleSendBrief = async () => {
    if (!orgId) return;
    setSendingBrief(true);
    try {
      const { data, error: err } = await supabase.functions.invoke('morning-brief', {
        body: { org_id: orgId },
      });
      if (err) throw new Error(await extractInvokeError(err));
      if (data?.skipped) {
        toast.warning(`Morning brief skipped: ${data.reason || 'not eligible'}`);
      } else {
        toast.success(`Morning brief sent! Jobs: ${data?.sections?.jobs ?? 0}, Estimates: ${data?.sections?.estimates ?? 0}, Requests: ${data?.sections?.requests ?? 0}`);
      }
    } catch (e: any) {
      toast.error(`Failed to send morning brief: ${e.message}`);
    } finally {
      setSendingBrief(false);
    }
  };

  const handleSendEvening = async () => {
    if (!orgId) return;
    setSendingEvening(true);
    try {
      const { data, error: err } = await supabase.functions.invoke('evening-brief', {
        body: { org_id: orgId },
      });
      if (err) throw new Error(await extractInvokeError(err));
      if (data?.skipped) {
        toast.warning(`End of day report skipped: ${data.reason || 'not eligible'}`);
      } else {
        toast.success(`End of day report sent! Completed: ${data?.summary?.completed ?? 0}, Revenue: $${data?.summary?.revenue?.toFixed(0) ?? 0}, Tomorrow: ${data?.summary?.tomorrow ?? 0}`);
      }
    } catch (e: any) {
      toast.error(`Failed to send evening report: ${e.message}`);
    } finally {
      setSendingEvening(false);
    }
  };

  return (
    <AdminLayout title="Notifications" subtitle="Manage how you receive notifications">
<div className="portal-v2 portal-v2-scroll" {...pullHandlers}>
      <PullToRefreshIndicator pullDistance={pullDistance} refreshing={refreshing} />
      <SEOHead title="Notifications | TidyWise" description="Configure notification preferences" noIndex />
      {loading ? (
        <div className="space-y-6">
          {[1, 2].map(i => (
            <Card key={i} className="mb-6">
              <CardHeader><Skeleton className="h-6 w-48" /></CardHeader>
              <CardContent className="space-y-4">
                {[1, 2, 3].map(j => <Skeleton key={j} className="h-12 w-full" />)}
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <>
          {error && (
            <div className="mb-6 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
              Could not load notification settings: {error}
            </div>
          )}

          {/* Full per-event x per-channel matrix + master toggles + reset */}
          <NotificationPreferencesCard />

          {/* Push Notifications */}
          <Card className="mb-6">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2">
                  <Smartphone className="w-5 h-5 text-primary" />
                  Push Notifications
                </CardTitle>
                <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${
                  isRegistered
                    ? 'bg-green-500/10 text-green-500 border border-green-500/20'
                    : 'bg-muted text-muted-foreground border border-border'
                }`}>
                  {isRegistered ? '✓ Registered' : '⊘ Not Registered'}
                </span>
              </div>
              <CardDescription>
                Real-time alerts sent directly to your {runtimeFacts.iosShell ? 'iPhone' : 'browser'} for all key business events
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-1">
              <div className="divide-y divide-border rounded-lg border border-border overflow-hidden">
                {PUSH_CATEGORIES.map((cat) => {
                  const Icon = cat.icon;
                  return (
                    <div key={cat.key} className="flex items-center gap-3 px-4 py-3">
                      <div className="w-9 h-9 rounded-lg bg-muted flex items-center justify-center shrink-0">
                        <Icon className="w-4 h-4 text-primary" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm">{cat.label}</p>
                        <p className="text-xs text-muted-foreground">{cat.description}</p>
                      </div>
                      <CheckCircle2 className="w-5 h-5 text-green-500 shrink-0" />
                    </div>
                  );
                })}
              </div>

              {!isRegistered && isSupported && (
                !runtimeFacts.iosShell && runtimeFacts.webNotification === 'denied' ? (
                  <div className="mt-4 p-3 bg-destructive/10 border border-destructive/20 rounded-lg text-center space-y-1">
                    <p className="text-sm font-medium text-destructive">Notifications Blocked</p>
                    <p className="text-xs text-muted-foreground">
                      Your browser has blocked notifications. To enable them, click the lock icon in your browser's address bar → Site settings → Allow Notifications, then refresh this page.
                    </p>
                  </div>
                ) : (
                  <Button
                    onClick={() => { void registerDevice({ organizationId: orgId }); }}
                    disabled={isRegistering}
                    className="w-full mt-4 gap-2"
                    variant="outline"
                  >
                    {isRegistering ? <Loader2 className="w-4 h-4 animate-spin" /> : <Bell className="w-4 h-4" />}
                    {isRegistering ? 'Enabling...' : 'Enable Notifications'}
                  </Button>
                )
              )}

              {(runtimeFacts.iosShell || status.phase === 'failed' || status.phase === 'working') && !isRegistered && (
                <div
                  className={`mt-4 p-3 rounded-lg border space-y-1 ${
                    status.phase === 'failed'
                      ? 'bg-destructive/10 border-destructive/30'
                      : 'bg-muted/60 border-border'
                  }`}
                  role="status"
                >
                  <p className={`text-sm font-medium ${status.phase === 'failed' ? 'text-destructive' : 'text-foreground'}`}>
                    {status.phase === 'failed'
                      ? 'Notifications were not enabled'
                      : status.phase === 'working'
                        ? 'Asking iOS…'
                        : 'iPhone notification status'}
                  </p>
                  <p className="text-xs text-muted-foreground whitespace-pre-wrap">
                    {status.message || describePushRuntime(runtimeFacts)}
                  </p>
                </div>
              )}

              {!isSupported && (
                <p className="text-xs text-muted-foreground text-center mt-4">
                  Push notifications are not supported in this browser. Try using Chrome, Edge, or the native app.
                </p>
              )}
            </CardContent>
          </Card>

          {/* Daily briefs — kept because they own their own delivery schedule */}
          <Card className="mb-6">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Mail className="w-5 h-5 text-primary" />
                Daily briefs
              </CardTitle>
              <CardDescription>
                Automatic morning and end-of-day email summaries.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between gap-3">
                <div className="space-y-0.5">
                  <Label>Morning brief (8:00 AM Eastern)</Label>
                  <p className="text-sm text-muted-foreground">Today's jobs, open estimates, and new requests.</p>
                </div>
                <div className="flex items-center gap-3">
                  <Switch
                    checked={briefsAutoSend.morning}
                    disabled={savingBrief === 'morning'}
                    onCheckedChange={v => toggleBrief('morning', v)}
                  />
                  <Button onClick={handleSendBrief} disabled={sendingBrief} variant="outline" size="sm" className="gap-2">
                    {sendingBrief ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                    {sendingBrief ? 'Sending…' : 'Send now'}
                  </Button>
                </div>
              </div>
              <div className="flex items-center justify-between gap-3">
                <div className="space-y-0.5">
                  <Label>End-of-day report (7:00 PM Eastern)</Label>
                  <p className="text-sm text-muted-foreground">Completed jobs, revenue, unpaid invoices, tomorrow's preview.</p>
                </div>
                <div className="flex items-center gap-3">
                  <Switch
                    checked={briefsAutoSend.evening}
                    disabled={savingBrief === 'evening'}
                    onCheckedChange={v => toggleBrief('evening', v)}
                  />
                  <Button onClick={handleSendEvening} disabled={sendingEvening} variant="outline" size="sm" className="gap-2">
                    {sendingEvening ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                    {sendingEvening ? 'Sending…' : 'Send now'}
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
</AdminLayout>
  );
}
