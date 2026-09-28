import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AdminLayout } from '@/components/admin/AdminLayout';
import { SEOHead } from '@/components/SEOHead';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Button } from '@/components/ui/button';
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';
import { defaultSignatureText, MAX_SUBJECT, renderBroadcastHtml } from '@/lib/broadcast-render';
import {
  useBroadcasts,
  useBroadcastTested,
  useCreateBroadcast,
  useStartBroadcast,
  useTestSend,
  type MessageClass,
} from '@/hooks/useBroadcasts';
import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, Loader2, Mail, Send } from 'lucide-react';
import { OrgTimestamp } from '@/components/OrgTimestamp';

/**
 * Platform broadcast composer — subject/body -> class -> resolve audience ->
 * test send -> confirm -> send to every organization owner.
 *
 * The five gates below are not defensive UX polish; each is the only thing
 * standing between a typo and either a mislabeled email or an irreversible
 * send to ~97 owners. See the inline comment at each gate.
 */

/**
 * A preview-only stand-in for the real unsubscribe link. The actual link is
 * minted per-recipient by ensureUnsubscribeToken() at send time (see
 * supabase/functions/broadcast-admin) — there is no real token to show here,
 * and pretending otherwise would make the preview lie about what a specific
 * recipient will click.
 */
const PREVIEW_UNSUBSCRIBE_URL = 'https://tidywisecleaning.com/unsubscribe?token=preview-only';

interface CreateBroadcastResult {
  broadcast_id: string;
  total: number;
  queued: number;
  skipped: number;
}

/**
 * `embedded` renders the composer without the page chrome, so the Broadcasts
 * tab on Platform Analytics and the standalone route stay one component and
 * can never drift apart. Same split as PlatformRevenueView in
 * PlatformRevenuePage.tsx, for the same reason.
 */
export function BroadcastView({ embedded = false }: { embedded?: boolean }) {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { user } = useAuth();

  const [subject, setSubject] = useState('');
  const [bodyText, setBodyText] = useState('');
  // No default — see the RadioGroup below. A default in either direction
  // would silently mislabel a service notice as an ad, or an ad as a notice.
  const [messageClass, setMessageClass] = useState<MessageClass | null>(null);

  // Not state, and not editable. The signature is fixed in the renderer; this
  // is the exact string the send will use, shown so the preview stays honest.
  // It was a free-text field until an empty box sent 96 owners an unsigned
  // email that looked identical to a signed one from this screen.
  const signature = defaultSignatureText();

  const [draftId, setDraftId] = useState<string | null>(null);
  const [createResult, setCreateResult] = useState<CreateBroadcastResult | null>(null);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [sendError, setSendError] = useState<string | null>(null);

  const createBroadcast = useCreateBroadcast();
  const testSend = useTestSend();
  const startBroadcast = useStartBroadcast();
  const { data: history, isLoading: historyLoading, error: historyError } = useBroadcasts();
  // The send gate, read from the draft row instead of local state — see
  // useBroadcastTested. Defaults to false while loading and on error, so Send
  // is locked until the row positively says a test went out.
  const { data: testedFromRow } = useBroadcastTested(draftId);
  const queryClient = useQueryClient();
  // Transitional, and the only reason the composer still holds any test state.
  // useBroadcastTested reads `broadcasts.last_test_sent_at`, which does not
  // exist until the broadcast-admin migration lands; until then it returns
  // false for every draft and Send would never unlock at all. This same-session
  // flag keeps the tool usable in the gap. It is not a weaker gate — it is set
  // only from a test_send that actually succeeded, which is exactly the proof
  // the row will record. What it cannot do is survive an unmount, which is why
  // the row is the primary source and this is the fallback, not the reverse.
  // DELETE THIS once last_test_sent_at is live and verified.
  const [testedDraftId, setTestedDraftId] = useState<string | null>(null);

  // Once a draft row exists, broadcast-admin's `create` action has already
  // written subject/body/message_class to the database and resolved the
  // audience against them. Local state that kept editing after this point
  // would drift from what test_send and start actually read and send — the
  // preview would show one email while the real send goes out with another.
  // Locking the inputs is what keeps "what you see is what sends" true.
  const locked = draftId !== null;

  const canCreateDraft =
    !locked && subject.trim().length > 0 && bodyText.trim().length > 0 && messageClass !== null;

  const previewHtml = useMemo(
    () =>
      renderBroadcastHtml({
        bodyText,
        unsubscribeUrl: messageClass === 'marketing' ? PREVIEW_UNSUBSCRIBE_URL : null,
        // Deliberately not passing `signature`. Passing the default's plain text
        // would send the renderer down the STORED path, which escapes and emits
        // no markup — so the preview would show a dead "Emmanuel Forkuoh •
        // https://..." line instead of the anchor the recipient actually gets.
        // Omitting it is what makes this preview truthful.
      }),
    [bodyText, messageClass],
  );

  function handleCreateDraft() {
    if (!messageClass) return;
    createBroadcast.mutate(
      {
        subject: subject.trim(),
        body_text: bodyText.trim(),
        message_class: messageClass,
        // Empty on purpose. broadcast-admin turns '' into NULL, which is what
        // sends the renderer down the DEFAULT path — the one with the LinkedIn
        // anchor. Persisting the default's text here would make every new
        // broadcast take the stored path and quietly lose the link, while old
        // broadcasts that already carry a value keep rendering as they were sent.
        signature_text: '',
      },
      {
        onSuccess: (data) => {
          const result = data as CreateBroadcastResult;
          setDraftId(result.broadcast_id);
          setCreateResult(result);
        },
        onError: (error: Error) => {
          toast({ title: 'Could not save draft', description: error.message, variant: 'destructive' });
        },
      },
    );
  }

  function handleTestSend() {
    if (!draftId) return;
    const testedFor = draftId;
    testSend.mutate(testedFor, {
      onSuccess: () => {
        // Refetch the gate rather than asserting it locally. If broadcast-admin
        // did not stamp last_test_sent_at, Send stays locked and the operator
        // is told to test again — the honest outcome, and the safe direction.
        queryClient.invalidateQueries({ queryKey: ['broadcast-tested', testedFor] });
        setTestedDraftId(testedFor);
        toast({ title: 'Test sent', description: `Sent to ${user?.email ?? 'your inbox'}.` });
      },
      onError: (error: Error) => {
        toast({ title: 'Test send failed', description: error.message, variant: 'destructive' });
      },
    });
  }

  // Required before the real send button enables at all. The value is keyed by
  // draftId inside the query, so a test-send resolving after Start over / a new
  // draft can never light up the wrong broadcast's send button — the same
  // property the old id-compared useState had, now surviving an unmount.
  // The `!== null` guard is not redundant: with no draft yet both ids are null,
  // and a bare equality would report "already tested" on a blank composer.
  const hasTested =
    testedFromRow === true || (testedDraftId !== null && testedDraftId === draftId);
  const canSend = messageClass !== null && draftId !== null && hasTested;

  const queuedCount = createResult?.queued ?? null;

  // The confirm button inside the dialog stays disabled until the typed text
  // matches the exact queued count. This is the only guard against sending to
  // ~97 people by a stray click — it must be the live number from the create
  // response, not a hardcoded "97", so it can never confirm a stale count.
  const confirmDisabled =
    queuedCount === null || confirmText.trim() !== String(queuedCount) || startBroadcast.isPending;

  async function handleConfirmSend() {
    if (!draftId) return;
    setSendError(null);
    try {
      await startBroadcast.mutateAsync(draftId);
      setDialogOpen(false);
      navigate(`/dashboard/broadcasts/${draftId}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not start the send.';
      setSendError(message);
      toast({ title: 'Send failed', description: message, variant: 'destructive' });
    }
  }

  function handleStartOver() {
    setSubject('');
    setBodyText('');
    setMessageClass(null);
    setDraftId(null);
    setCreateResult(null);
    setTestedDraftId(null);
    setDialogOpen(false);
    setConfirmText('');
    setSendError(null);
  }

  const startOverButton = locked ? (
    <Button variant="ghost" size="sm" onClick={handleStartOver}>
      Start over
    </Button>
  ) : undefined;

  const body = (
    <div className="space-y-6 max-w-3xl">
      {/* Embedded, AdminLayout's `actions` slot belongs to Platform Analytics,
          so Start over has nowhere to go up there and renders inline instead.
          PlatformRevenueView does the same with its export button. */}
      {embedded && startOverButton && (
        <div className="flex justify-end">{startOverButton}</div>
      )}
      {/* 1. Compose */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Compose</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <label htmlFor="broadcast-subject" className="text-sm font-medium">
              Subject
            </label>
            <Input
              id="broadcast-subject"
              value={subject}
              maxLength={MAX_SUBJECT}
              disabled={locked}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="What's this about?"
              className="mt-1.5"
            />
            <p className="text-xs text-muted-foreground text-right mt-1 tabular-nums">
              {subject.length}/{MAX_SUBJECT}
            </p>
          </div>

          <div>
            <label htmlFor="broadcast-body" className="text-sm font-medium">
              Body
            </label>
            <Textarea
              id="broadcast-body"
              value={bodyText}
              disabled={locked}
              onChange={(e) => setBodyText(e.target.value)}
              placeholder="Write the message. Blank lines start a new paragraph."
              rows={10}
              className="mt-1.5"
            />
          </div>

          <div>
            <label htmlFor="broadcast-signature" className="text-sm font-medium">
              Signature <span className="text-muted-foreground font-normal">(fixed)</span>
            </label>
            <Textarea
              id="broadcast-signature"
              value={signature}
              readOnly
              rows={4}
              className="mt-1.5 bg-muted/50 text-muted-foreground cursor-default"
            />
            <p className="text-xs text-muted-foreground mt-1">
              Appended to every broadcast, both classes. Set in broadcast-render.ts rather
              than typed per send. Shown here as plain text; in the email the first line is
              a LinkedIn link — see the preview below for exactly what sends.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* 2. Message class — deliberately nothing preselected */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Message class</CardTitle>
          <CardDescription>Nothing is picked by default — choose one on purpose.</CardDescription>
        </CardHeader>
        <CardContent>
          {/* value={messageClass ?? undefined}: with messageClass starting at
              null there is no selected radio on first render. Defaulting to
              either option here would silently mislabel a service notice as
              an ad, or an ad as a notice — see broadcast-render.ts's own
              comment on validateBroadcastInput for why the edge function
              enforces the same "no default" rule server-side. */}
          <RadioGroup
            value={messageClass ?? undefined}
            onValueChange={(v) => setMessageClass(v as MessageClass)}
            disabled={locked}
            className="space-y-3"
          >
            <label
              htmlFor="class-transactional"
              className="flex items-start gap-3 rounded-md border p-3 cursor-pointer has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60"
            >
              <RadioGroupItem value="transactional" id="class-transactional" className="mt-0.5" />
              <span>
                <span className="block text-sm font-medium">Transactional</span>
                <span className="block text-xs text-muted-foreground">
                  A service notice. Reaches all owners, including those who opted out.
                </span>
              </span>
            </label>

            <label
              htmlFor="class-marketing"
              className="flex items-start gap-3 rounded-md border p-3 cursor-pointer has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60"
            >
              <RadioGroupItem value="marketing" id="class-marketing" className="mt-0.5" />
              <span>
                <span className="block text-sm font-medium">Marketing</span>
                <span className="block text-xs text-muted-foreground">
                  Promotional. Skips opted-out owners and appends an unsubscribe link.
                </span>
              </span>
            </label>
          </RadioGroup>

          {messageClass === 'marketing' && (
            <div className="mt-3 rounded-md border border-primary/20 bg-primary/5 p-3 text-xs space-y-1">
              <p>An unsubscribe link is appended automatically — it is not part of the body you write.</p>
              {createResult ? (
                <p className="font-medium text-foreground">
                  {createResult.queued} of {createResult.total} owners will receive this — {createResult.skipped}{' '}
                  skipped (opted out).
                </p>
              ) : (
                <p>Save the draft below to see the live recipient split.</p>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* 3. Draft + preview */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Draft &amp; preview</CardTitle>
          <CardDescription>Resolves the audience and locks the message so nothing can drift before it sends.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Button onClick={handleCreateDraft} disabled={!canCreateDraft || createBroadcast.isPending}>
            {createBroadcast.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            {locked ? 'Draft saved' : 'Save draft & resolve audience'}
          </Button>

          {createResult && (
            <div className="rounded-md border p-3 text-sm flex flex-wrap gap-x-4 gap-y-1">
              <span>
                <span className="font-medium tabular-nums">{createResult.total}</span> total
              </span>
              <span>
                <span className="font-medium tabular-nums">{createResult.queued}</span> queued
              </span>
              <span>
                <span className="font-medium tabular-nums">{createResult.skipped}</span> skipped
              </span>
            </div>
          )}

          {(subject.trim() || bodyText.trim()) && (
            <div>
              <p className="text-sm font-medium mb-2">Preview</p>
              {/* Rendered through the exact same renderBroadcastHtml the
                  dispatch worker calls (src/lib/broadcast-render.ts, mirrored
                  verbatim in supabase/functions/_shared for the Deno side) —
                  this is not a hand-rolled approximation of the email, it is
                  the email. Safe to inject directly: renderBroadcastHtml only
                  ever emits markup it constructs itself, and it escapes
                  bodyText and unsubscribeUrl internally — this is not raw
                  user HTML reaching the DOM. */}
              <div
                className="rounded-md border bg-muted/30 overflow-auto"
                dangerouslySetInnerHTML={{ __html: previewHtml }}
              />
            </div>
          )}
        </CardContent>
      </Card>

      {/* 4. Test send — required before the real send unlocks */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Test send</CardTitle>
          <CardDescription>Sends the exact rendered email to your own inbox only.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Button
            variant="outline"
            onClick={handleTestSend}
            disabled={!draftId || testSend.isPending}
          >
            {testSend.isPending ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <Mail className="w-4 h-4 mr-2" />
            )}
            {hasTested ? 'Send another test' : 'Send test to myself'}
          </Button>

          {hasTested && (
            <p className="text-xs text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5">
              <CheckCircle2 className="w-3.5 h-3.5" />
              Test sent to {user?.email ?? 'your inbox'} — the real send button is unlocked.
            </p>
          )}
          {!draftId && (
            <p className="text-xs text-muted-foreground">Save the draft above first.</p>
          )}
        </CardContent>
      </Card>

      {/* 5. Send — gated on class chosen, draft saved, AND a successful test */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Send</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Button
            variant="destructive"
            disabled={!canSend}
            onClick={() => {
              setConfirmText('');
              setSendError(null);
              setDialogOpen(true);
            }}
          >
            <Send className="w-4 h-4 mr-2" />
            Send to {queuedCount ?? '—'} owners
          </Button>
          {!canSend && (
            <p className="text-xs text-muted-foreground">
              {!messageClass
                ? 'Choose a message class first.'
                : !draftId
                  ? 'Save the draft above first.'
                  : 'Send a test to yourself first.'}
            </p>
          )}

          <AlertDialog
            open={dialogOpen}
            onOpenChange={(open) => {
              setDialogOpen(open);
              if (open) {
                setConfirmText('');
                setSendError(null);
              }
            }}
          >
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Send to {queuedCount ?? 0} owners?</AlertDialogTitle>
                <AlertDialogDescription>
                  This cannot be undone. Type <span className="font-semibold text-foreground">{queuedCount ?? 0}</span>{' '}
                  — the exact number of owners who will receive this — to confirm.
                </AlertDialogDescription>
              </AlertDialogHeader>

              <Input
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                placeholder={String(queuedCount ?? '')}
                inputMode="numeric"
                autoFocus
              />

              {sendError && (
                <p className="text-sm text-destructive flex items-start gap-1.5">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  {sendError}
                </p>
              )}

              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                {/* preventDefault so Radix does not close the dialog before
                    the mutation resolves — an irreversible send to ~97
                    people must not leave an ambiguous "did it go?" moment
                    behind a dialog that already vanished. */}
                <AlertDialogAction
                  disabled={confirmDisabled}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  onClick={(e) => {
                    e.preventDefault();
                    void handleConfirmSend();
                  }}
                >
                  {startBroadcast.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                  Send now
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </CardContent>
      </Card>

      {/* 6. History */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">History</CardTitle>
        </CardHeader>
        <CardContent>
          {historyError && (
            <p className="text-sm text-destructive flex items-start gap-1.5">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              Could not load broadcast history — {(historyError as Error).message}
            </p>
          )}

          {historyLoading && (
            <p className="text-sm text-muted-foreground flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading…
            </p>
          )}

          {!historyLoading && !historyError && (history ?? []).length === 0 && (
            <p className="text-sm text-muted-foreground">No broadcasts sent yet.</p>
          )}

          {!historyLoading && !historyError && (history ?? []).length > 0 && (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Subject</TableHead>
                    <TableHead>Class</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Sent</TableHead>
                    <TableHead className="text-right">Failed</TableHead>
                    <TableHead className="text-right">Skipped</TableHead>
                    <TableHead>Created</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(history ?? []).map((b) => (
                    <TableRow
                      key={b.id}
                      className="cursor-pointer"
                      onClick={() => navigate(`/dashboard/broadcasts/${b.id}`)}
                    >
                      <TableCell>
                        <Link
                          to={`/dashboard/broadcasts/${b.id}`}
                          className="font-medium hover:underline"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {b.subject}
                        </Link>
                      </TableCell>
                      <TableCell className="capitalize">{b.message_class}</TableCell>
                      <TableCell className="capitalize">{b.status}</TableCell>
                      <TableCell className="text-right tabular-nums">{b.sent_count}</TableCell>
                      <TableCell className="text-right tabular-nums">{b.failed_count}</TableCell>
                      <TableCell className="text-right tabular-nums">{b.skipped_count}</TableCell>
                      <TableCell className="whitespace-nowrap">
                        <OrgTimestamp value={b.created_at} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );

  if (embedded) return body;

  return (
    <AdminLayout title="Broadcasts" subtitle="Email every organization owner" actions={startOverButton}>
      <SEOHead title="Broadcasts | TidyWise" description="Platform broadcast email" noIndex />
      {body}
    </AdminLayout>
  );
}

export default function BroadcastPage() {
  return <BroadcastView />;
}
