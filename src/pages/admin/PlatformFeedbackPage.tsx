import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { AdminLayout } from '@/components/admin/AdminLayout';
import { SEOHead } from '@/components/SEOHead';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { AlertTriangle, Loader2, MailCheck, MessageSquare } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';

/**
 * Where product feedback is read.
 *
 * Feedback used to go to Jotform and an inbox; it now lands in
 * public.product_feedback and this page is the surface for it, so "it's only in
 * a database" is not the answer. Platform admin only — RLS enforces that too,
 * this route guard is just the polite version.
 */

type Feedback = {
  id: string;
  organization_id: string | null;
  user_id: string | null;
  topic: string;
  message: string;
  app_area: string | null;
  severity: string | null;
  sender_name: string | null;
  reply_email: string | null;
  is_read: boolean;
  created_at: string;
  organizations?: { name: string | null } | null;
};

const TOPIC_LABEL: Record<string, string> = {
  broken: "Something's broken",
  suggestion: 'A suggestion',
  like: 'Something they like',
  dislike: "Something they don't like",
  other: 'Other',
};

const SEVERITY: Record<string, { label: string; className: string }> = {
  blocking: { label: 'Blocking', className: 'bg-destructive text-destructive-foreground' },
  annoying: { label: 'Annoying', className: 'bg-amber-500 text-white' },
  idea: { label: 'Just an idea', className: 'bg-muted text-muted-foreground' },
};

function useFeedback() {
  return useQuery({
    queryKey: ['platform-product-feedback'],
    queryFn: async (): Promise<Feedback[]> => {
      const { data, error } = await supabase
        .from('product_feedback')
        .select(
          'id, organization_id, user_id, topic, message, app_area, severity, sender_name, reply_email, is_read, created_at, organizations(name)',
        )
        // Ordered by a unique tiebreaker as well as the timestamp — created_at
        // is not unique and ties would otherwise shuffle between loads.
        .order('created_at', { ascending: false })
        .order('id', { ascending: false });

      // Surfaced, not swallowed: an empty feedback list and a broken query look
      // identical, and only one of them means nobody has written in.
      if (error) throw error;
      return (data ?? []) as unknown as Feedback[];
    },
  });
}

export default function PlatformFeedbackPage() {
  const { data, isLoading, error, refetch } = useFeedback();
  const queryClient = useQueryClient();
  const [showRead, setShowRead] = useState(true);

  const markRead = useMutation({
    mutationFn: async ({ id, isRead }: { id: string; isRead: boolean }) => {
      const { error: err } = await supabase
        .from('product_feedback')
        .update({ is_read: isRead })
        .eq('id', id);
      if (err) throw err;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['platform-product-feedback'] }),
    onError: (err: unknown) => {
      console.error('[platform-feedback] mark read failed:', err);
      toast.error("Couldn't update that. Try again.");
    },
  });

  // eslint-disable-next-line react-hooks/exhaustive-deps -- rows is derived via ?? which creates a new ref each render; content changes when data changes
  const rows = data ?? [];
  const unread = useMemo(() => rows.filter((r) => !r.is_read).length, [rows]);
  const visible = showRead ? rows : rows.filter((r) => !r.is_read);

  return (
    <AdminLayout title="Feedback">
      <SEOHead title="Feedback | TidyWise" description="Product feedback from businesses." noIndex />
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold flex items-center gap-2">
              <MessageSquare className="w-6 h-6" />
              Feedback
            </h1>
            <p className="text-sm text-muted-foreground">
              Everything sent from Settings → Feedback. {unread} unread of {rows.length}.
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setShowRead((v) => !v)}>
              {showRead ? 'Unread only' : 'Show all'}
            </Button>
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              Refresh
            </Button>
          </div>
        </div>

        {isLoading && (
          <div className="flex items-center gap-2 text-muted-foreground py-12 justify-center">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading feedback…
          </div>
        )}

        {error && (
          <Card className="border-destructive">
            <CardContent className="flex items-start gap-3 py-6">
              <AlertTriangle className="w-5 h-5 text-destructive mt-0.5" />
              <div>
                <p className="font-medium">Couldn't load feedback.</p>
                <p className="text-sm text-muted-foreground">{(error as Error).message}</p>
              </div>
            </CardContent>
          </Card>
        )}

        {!isLoading && !error && visible.length === 0 && (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground">
              {rows.length === 0 ? 'No feedback yet.' : 'Nothing unread.'}
            </CardContent>
          </Card>
        )}

        <div className="space-y-4">
          {visible.map((f) => (
            <Card key={f.id} className={f.is_read ? 'opacity-70' : ''}>
              <CardHeader className="pb-3">
                <div className="flex flex-wrap items-center gap-2 justify-between">
                  <CardTitle className="text-base flex flex-wrap items-center gap-2">
                    {TOPIC_LABEL[f.topic] ?? f.topic}
                    {f.severity && SEVERITY[f.severity] && (
                      <Badge className={SEVERITY[f.severity].className}>
                        {SEVERITY[f.severity].label}
                      </Badge>
                    )}
                    {!f.is_read && <Badge variant="outline">New</Badge>}
                  </CardTitle>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={markRead.isPending}
                    onClick={() => markRead.mutate({ id: f.id, isRead: !f.is_read })}
                  >
                    <MailCheck className="w-4 h-4 mr-1" />
                    {f.is_read ? 'Mark unread' : 'Mark read'}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  {f.sender_name || f.organizations?.name || 'Unknown business'}
                  {' · '}
                  {new Date(f.created_at).toLocaleString('en-US', {
                    timeZone: 'America/New_York',
                    month: 'short',
                    day: 'numeric',
                    hour: 'numeric',
                    minute: '2-digit',
                    timeZoneName: 'short',
                  })}
                  {f.app_area ? ` · ${f.app_area}` : ''}
                </p>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="whitespace-pre-wrap text-sm">{f.message}</p>
                {f.reply_email && (
                  <a
                    href={`mailto:${f.reply_email}?subject=${encodeURIComponent('Re: your TidyWise feedback')}`}
                    className="text-sm text-primary underline"
                  >
                    Reply to {f.reply_email}
                  </a>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </AdminLayout>
  );
}
