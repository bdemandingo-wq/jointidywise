import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
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
import { Mail, Loader2, AlertTriangle, CheckCircle2, Unplug, Send, Copy, Lock } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';
import { useOrganization } from '@/contexts/OrganizationContext';
import { useSearchParams } from 'react-router-dom';
import { formatTimestampWithZone } from '@/lib/timezoneUtils';
import { useOrgTimezone } from '@/hooks/useOrgTimezone';

interface GmailConnection {
  id: string;
  google_email: string;
  status: 'active' | 'revoked' | 'expired';
  connected_at: string;
  last_send_at: string | null;
  connected_by_user_id: string | null;
  connected_by_name?: string;
}

export function GmailConnectionCard() {
  const { timezone } = useOrgTimezone();
  const { organization, isAdmin } = useOrganization();
  const [searchParams, setSearchParams] = useSearchParams();
  const [connection, setConnection] = useState<GmailConnection | null>(null);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [recentFailures, setRecentFailures] = useState(0);
  const [sendingTest, setSendingTest] = useState(false);

  useEffect(() => {
    if (organization?.id) {
      fetchConnection();
      fetchFailures();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- fetchConnection/fetchFailures are recreated each render; runs once per org
  }, [organization?.id]);

  useEffect(() => {
    if (searchParams.get('gmail_connected') === 'true') {
      toast.success('Gmail connected successfully');
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        next.delete('gmail_connected');
        return next;
      });
      fetchConnection();
    }
    const oauthError = searchParams.get('oauth_error');
    if (oauthError) {
      toast.error(`Gmail connection failed: ${oauthError}`);
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        next.delete('oauth_error');
        return next;
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const fetchConnection = async () => {
    if (!organization?.id) return;
    setLoading(true);
    try {
      const { data } = await supabase
        .from('org_gmail_connections')
        .select('id, google_email, status, connected_at, last_send_at, connected_by_user_id')
        .eq('organization_id', organization.id)
        .maybeSingle();

      if (data) {
        let connected_by_name: string | undefined;
        if (data.connected_by_user_id) {
          const { data: profile } = await supabase
            .from('profiles')
            .select('email, full_name')
            .eq('id', data.connected_by_user_id)
            .maybeSingle();
          connected_by_name = (profile as any)?.full_name || (profile as any)?.email;
        }
        setConnection({ ...(data as any), connected_by_name });
      } else {
        setConnection(null);
      }
    } catch (e) {
      console.error('[GmailConnectionCard] fetch failed', e);
    } finally {
      setLoading(false);
    }
  };

  const fetchFailures = async () => {
    if (!organization?.id) return;
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { count } = await supabase
      .from('email_send_failures')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', organization.id)
      .gte('attempted_at', since);
    setRecentFailures(count || 0);
  };

  const handleConnect = async () => {
    if (!organization?.id) return;
    setConnecting(true);
    try {
      const { data, error } = await supabase.functions.invoke('gmail-oauth-init', {
        body: { organization_id: organization.id },
      });
      if (error) throw error;
      if (!data?.url) throw new Error('No OAuth URL returned');
      window.location.href = data.url;
    } catch (e: any) {
      toast.error(`Failed to start Gmail connection: ${e.message || e}`);
      setConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    if (!organization?.id) return;
    setDisconnecting(true);
    try {
      const { error } = await supabase.functions.invoke('gmail-disconnect', {
        body: { organization_id: organization.id },
      });
      if (error) throw error;
      toast.success('Gmail disconnected');
      setShowConfirm(false);
      fetchConnection();
    } catch (e: any) {
      toast.error(`Failed to disconnect: ${e.message || e}`);
    } finally {
      setDisconnecting(false);
    }
  };

  const handleSendTest = async () => {
    if (!organization?.id || !connection?.google_email) return;
    setSendingTest(true);
    try {
      const timestamp = formatTimestampWithZone(new Date(), timezone);
      const { data, error } = await supabase.functions.invoke('gmail-send', {
        body: {
          organization_id: organization.id,
          to: connection.google_email,
          subject: 'TidyWise Gmail Test',
          html: `<p>Hello from TidyWise! If you can read this, your Gmail integration is working correctly.</p><p>Sent at: ${timestamp}</p>`,
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast.success('Test email sent. Check your inbox.');
      fetchConnection();
    } catch (e: any) {
      console.error('[GmailConnectionCard] test email failed', e);
      toast.error(`Test email failed: ${e?.message || e}`);
    } finally {
      setSendingTest(false);
    }
  };

  const formatDate = (iso: string | null) => {
    if (!iso) return 'Never';
    return formatTimestampWithZone(iso, timezone);
  };

  const isConnected = connection?.status === 'active';
  const isLost = connection && (connection.status === 'revoked' || connection.status === 'expired');

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Mail className="h-5 w-5 text-[#4f46e5]" />
                Gmail Connection
                {isConnected && <Badge className="bg-[#4CAF3F] hover:bg-[#4CAF3F]">Active</Badge>}
                {isLost && <Badge variant="destructive">Connection Lost</Badge>}
              </CardTitle>
              <CardDescription>
                Send transactional emails directly from your real Gmail address
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <Alert className="border-amber-300 bg-amber-50 text-amber-900">
            <AlertTriangle className="h-4 w-4 !text-amber-600" />
            <AlertDescription className="text-sm">
              ⚠️ Gmail integration is in beta. Only test users can connect right now.
              Google verification is in progress.
            </AlertDescription>
          </Alert>

          {recentFailures > 0 && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                {recentFailures} email{recentFailures === 1 ? '' : 's'} failed to send in the last 24h.
              </AlertDescription>
            </Alert>
          )}

          {loading ? (
            <div className="flex items-center justify-center py-6">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : !connection ? (
            <div className="space-y-3">
              <div className="rounded-lg border bg-muted/30 p-4 space-y-3">
                <p className="text-sm text-foreground">
                  Gmail integration is currently in private beta. To request access, email{' '}
                  <span className="font-medium">support@tidywisecleaning.com</span> with your TidyWise account email and we'll add you to the test users list.
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    navigator.clipboard.writeText('support@tidywisecleaning.com');
                    toast.success('Email copied');
                  }}
                >
                  <Copy className="h-4 w-4 mr-2" />
                  Copy support email
                </Button>
              </div>
              <Button disabled className="bg-muted text-muted-foreground cursor-not-allowed">
                <Lock className="h-4 w-4 mr-2" />
                Connect Gmail (request access)
              </Button>
            </div>
          ) : isLost ? (
            <div className="space-y-3">
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>
                  Gmail connection lost ({connection.status}) — please reconnect to resume sending from your address.
                </AlertDescription>
              </Alert>
              <div className="text-sm text-muted-foreground">
                Was connected as <span className="font-medium text-foreground">{connection.google_email}</span>
              </div>
              <Button
                onClick={handleConnect}
                disabled={!isAdmin || connecting}
                className="bg-[#4f46e5] hover:bg-[#4338ca] text-white"
              >
                {connecting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Mail className="h-4 w-4 mr-2" />}
                Reconnect Gmail
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="rounded-lg border bg-muted/30 p-4 space-y-2">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-[#4CAF3F]" />
                  <span className="font-medium">{connection.google_email}</span>
                </div>
                <div className="text-sm text-muted-foreground">
                  Connected{connection.connected_by_name ? ` by ${connection.connected_by_name}` : ''} on {formatDate(connection.connected_at)}
                </div>
                <div className="text-sm text-muted-foreground">
                  Last email sent: {formatDate(connection.last_send_at)}
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  onClick={handleSendTest}
                  disabled={sendingTest}
                  className="bg-[#4f46e5] hover:bg-[#4338ca] text-white"
                >
                  {sendingTest ? (
                    <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Sending…</>
                  ) : (
                    <><Send className="h-4 w-4 mr-2" />Send test email</>
                  )}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => setShowConfirm(true)}
                  disabled={!isAdmin || disconnecting}
                >
                  <Unplug className="h-4 w-4 mr-2" />
                  Disconnect
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <AlertDialog open={showConfirm} onOpenChange={setShowConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Disconnect Gmail?</AlertDialogTitle>
            <AlertDialogDescription>
              Outgoing transactional emails will fall back to the standard sender until you reconnect.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={disconnecting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDisconnect}
              disabled={disconnecting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {disconnecting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
              Disconnect
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export const useHasActiveGmail = () => {
  const { organization } = useOrganization();
  const [active, setActive] = useState<boolean | null>(null);
  useEffect(() => {
    if (!organization?.id) return;
    supabase
      .from('org_gmail_connections')
      .select('status')
      .eq('organization_id', organization.id)
      .maybeSingle()
      .then(({ data }) => setActive(data?.status === 'active'));
  }, [organization?.id]);
  return active;
};
