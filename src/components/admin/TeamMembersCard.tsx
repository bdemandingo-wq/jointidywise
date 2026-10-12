import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useOrganization } from '@/contexts/OrganizationContext';
import { useAuth } from '@/hooks/useAuth';
import { useOrgRole } from '@/hooks/useOrgRole';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { Loader2, Trash2, Mail, Copy, Check, AlertTriangle } from 'lucide-react';
import { readEdgeFunctionError, readEdgeFunctionErrorBody } from '@/lib/edgeFunctionError';
import { plainInviteEmailError } from '@/lib/inviteEmailError';
import { QueryError } from '@/components/QueryError';
import { confirmDialog } from "@/components/AppDialogs";

type Role = 'owner' | 'manager';

const roleDesc: Record<Role, string> = {
  owner: 'Full access, including billing and financial data',
  manager: 'Operations only. No financial data (payroll, expenses, finance, reports).',
};


export function TeamMembersCard() {
  const { organization } = useOrganization();
  const { canManageTeam } = useOrgRole();
  const qc = useQueryClient();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('manager');

  const [busy, setBusy] = useState(false);
  // Set when the invite row was created but delivery failed — carries the
  // still-valid accept link so it can be passed on by hand.
  const [failedEmailLink, setFailedEmailLink] = useState<{ email: string; url: string; reason: string | null } | null>(null);
  const [linkCopied, setLinkCopied] = useState(false);

  const orgId = organization?.id;
  // The session is a precondition, not an assumption. organization?.id can
  // resolve before the Supabase client has attached the token, and
  // list_org_members gates on has_org_financial_access(), which reads
  // auth.uid(). An untokened call therefore returns ZERO ROWS rather than an
  // error — the function is executable by anon — so it renders as "No members
  // yet" with nothing in the console and no refetch, because the query key
  // never changes afterwards.
  const { session } = useAuth();
  const accessToken = session?.access_token;
  // Keyed on the user id, not the token: the token rotates on refresh and would
  // refetch the list every time. The id goes undefined -> defined exactly once,
  // when the session lands, which is the transition that needs to trigger.
  const sessionUserId = session?.user?.id;

  const {
    data: members = [],
    error: membersError,
    isLoading: membersLoading,
  } = useQuery({
    queryKey: ['org-members', orgId, sessionUserId],
    enabled: !!orgId && !!accessToken,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('list_org_members', { _organization_id: orgId! });
      if (error) throw error;
      const rows = (data as { user_id: string; email: string; full_name: string; role: string; joined_at: string }[]) ?? [];
      // Team members = owner/manager only. Cleaners (role='member') are staff,
      // not teammates. Any legacy 'admin' rows are shown as 'manager'.
      return rows
        .filter(r => r.role === 'owner' || r.role === 'admin' || r.role === 'manager')
        .map(r => ({ ...r, role: r.role === 'admin' ? 'manager' : r.role }));

    },
  });

  // Same session dependency as the member list above. organization_invites is
  // RLS-gated on the same owner helper, so an untokened read returns an empty
  // set rather than an error — pending invites would silently vanish.
  const { data: invites = [], error: invitesError } = useQuery({
    queryKey: ['org-invites', orgId, sessionUserId],
    enabled: !!orgId && !!accessToken,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('organization_invites')
        .select('id,email,role,expires_at,accepted_at,created_at')
        .eq('organization_id', orgId!)
        .is('accepted_at', null)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const invite = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke('send-team-invite', {
        body: { organization_id: orgId, email, role },
      });

      if (error) {
        // Read the body BEFORE deciding this is a dead end. When the invite row
        // was created but the email could not be delivered, the function returns
        // 502 with the working accept_url alongside the error — throwing here
        // discarded a link that was ready to use. readEdgeFunctionErrorBody
        // clones the Response, so readEdgeFunctionError below can still read it.
        const body = await readEdgeFunctionErrorBody(error);
        const acceptUrl = typeof body?.accept_url === 'string' ? body.accept_url : null;
        if (acceptUrl) {
          return {
            emailFailed: true,
            acceptUrl,
            reason: plainInviteEmailError(typeof body?.error === 'string' ? body.error : null),
          };
        }

        // Everything else: surface what the function said. supabase-js reports
        // every non-2xx as "Edge Function returned a non-2xx status code", which
        // hid the real reason — insufficient_permission, invalid_email and the
        // rest all looked identical.
        throw new Error(plainInviteEmailError(await readEdgeFunctionError(error, 'Failed to send invite')));
      }
      return data;
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['org-invites', orgId] });

      if (data?.emailFailed) {
        // The invite is valid and pending — only delivery failed. Hand over the
        // link so it can be sent by any other means.
        setFailedEmailLink({ email, url: data.acceptUrl, reason: data.reason });
        setEmail('');
        toast.warning('Invite created, but the email could not be sent. Copy the link below.', {
          duration: 8000,
        });
        return;
      }

      setFailedEmailLink(null);
      toast.success(`Invite sent to ${email}`);
      setEmail('');
    },
    onError: (e: Error) => toast.error(e.message || 'Failed to send invite'),
  });

  const changeRole = useMutation({
    mutationFn: async ({ userId, newRole }: { userId: string; newRole: Role }) => {
      const { error } = await supabase.rpc('update_org_member_role', {
        _organization_id: orgId!, _target_user_id: userId, _new_role: newRole,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Role updated');
      qc.invalidateQueries({ queryKey: ['org-members', orgId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const removeMember = useMutation({
    mutationFn: async (userId: string) => {
      const { error } = await supabase.rpc('remove_org_member', {
        _organization_id: orgId!, _target_user_id: userId,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Member removed');
      qc.invalidateQueries({ queryKey: ['org-members', orgId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const revokeInvite = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('organization_invites').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Invite revoked');
      qc.invalidateQueries({ queryKey: ['org-invites', orgId] });
    },
  });

  if (membersError) return <QueryError subject="team members" onRetry={() => qc.invalidateQueries({ queryKey: ['org-members', orgId] })} />;
  if (invitesError) return <QueryError subject="pending invites" onRetry={() => qc.invalidateQueries({ queryKey: ['org-invites', orgId] })} />;

  return (
    <div className="space-y-6">
      {canManageTeam && (
        <Card>
          <CardHeader>
            <CardTitle>Invite a teammate</CardTitle>
            <CardDescription>They'll receive an email to create their account and join this workspace.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-[1fr_180px_auto]">
              <div>
                <Label>Email</Label>
                <Input type="email" placeholder="coworker@company.com"
                  value={email} onChange={e => setEmail(e.target.value)} />
              </div>
              <div>
                <Label>Role</Label>
                <Select value={role} onValueChange={v => setRole(v as Role)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="owner">Owner</SelectItem>
                    <SelectItem value="manager">Manager</SelectItem>
                  </SelectContent>
                </Select>

              </div>
              <div className="flex items-end">
                <Button
                  disabled={!email || invite.isPending}
                  onClick={() => invite.mutate()}
                  className="w-full"
                >
                  {invite.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Mail className="h-4 w-4 mr-2" />Send invite</>}
                </Button>
              </div>
            </div>
            <p className="text-sm text-muted-foreground">{roleDesc[role]}</p>

            {/* The invite exists and is pending — only the email bounced. The
                link is valid for 14 days, so hand it over rather than making
                someone re-send into the same broken mail path. */}
            {failedEmailLink && (
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 space-y-2">
                <p className="text-sm font-medium flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-amber-600" />
                  Invite for {failedEmailLink.email} was created, but the email didn't send
                </p>
                {failedEmailLink.reason && (
                  <p className="text-xs text-muted-foreground">{failedEmailLink.reason}</p>
                )}
                <p className="text-xs text-muted-foreground">
                  The invite is valid for 14 days. Send them this link directly.
                </p>
                <p className="font-mono text-xs break-all bg-background p-2 rounded border">
                  {failedEmailLink.url}
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full gap-2"
                  onClick={() => {
                    navigator.clipboard.writeText(failedEmailLink.url);
                    setLinkCopied(true);
                    setTimeout(() => setLinkCopied(false), 2000);
                  }}
                >
                  {linkCopied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                  {linkCopied ? 'Copied!' : 'Copy invite link'}
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Team members</CardTitle>
          <CardDescription>People with access to this workspace.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {members.map(m => (
              <div key={m.user_id} className="flex items-center justify-between gap-3 rounded-lg border p-3">
                <div className="min-w-0">
                  <div className="font-medium truncate">{m.full_name || m.email}</div>
                  <div className="text-xs text-muted-foreground truncate">{m.email}</div>
                </div>
                <div className="flex items-center gap-2">
                  {canManageTeam && m.role !== 'member' ? (
                    <Select
                      value={m.role}
                      onValueChange={v => changeRole.mutate({ userId: m.user_id, newRole: v as Role })}
                    >
                      <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="owner">Owner</SelectItem>
                        <SelectItem value="manager">Manager</SelectItem>
                      </SelectContent>
                    </Select>

                  ) : (
                    <Badge variant="secondary">{m.role}</Badge>
                  )}
                  {canManageTeam && m.role !== 'member' && (
                    <Button variant="ghost" size="icon"
                      onClick={() => {
                        void confirmDialog(`Remove ${m.email} from this workspace?`).then((ok) => { if (ok) removeMember.mutate(m.user_id); });
                      }}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  )}
                </div>
              </div>
            ))}
            {/* Three states, not two. An empty list and a failed load rendered
                identically as "No members yet", which is what made this look
                like an empty organization for an org with five members. */}
            {membersLoading && (
              <p className="text-sm text-muted-foreground">Loading team…</p>
            )}
            {!membersLoading && members.length === 0 && (
              <p className="text-sm text-muted-foreground">No members yet.</p>
            )}
          </div>
        </CardContent>
      </Card>

      {invites.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Pending invites</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {invites.map(i => (
                <div key={i.id} className="flex items-center justify-between gap-3 rounded-lg border p-3">
                  <div className="min-w-0">
                    <div className="font-medium truncate">{i.email}</div>
                    <div className="text-xs text-muted-foreground">
                      {/* eslint-disable-next-line local/no-device-local-dates -- viewer-local display of a stored instant, not a business-day boundary */}
                      {i.role} · expires {new Date(i.expires_at).toLocaleDateString()}
                    </div>
                  </div>
                  {canManageTeam && (
                    <Button variant="ghost" size="sm" onClick={() => revokeInvite.mutate(i.id)}>
                      Revoke
                    </Button>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
