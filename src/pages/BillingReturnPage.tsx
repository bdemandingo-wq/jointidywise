/**
 * Stripe redirects Embedded Checkout here when the session ends.
 * This page asks reconcile-checkout-session what happened. That function is
 * the same provisioner /checkout/success uses, so webhooks and fulfillment
 * stay as they are. A paid session continues to /checkout/success. An
 * unfinished session stays here and does not claim the buyer is in.
 */

import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { CheckCircle2, Loader2 } from 'lucide-react';
import { SEOHead } from '@/components/SEOHead';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { readEdgeFunctionError } from '@/lib/edgeFunctionError';
import { clearStagedCheckout } from '@/lib/embeddedCheckout';
import { supabase } from '@/lib/supabase';

type Status = 'checking' | 'confirmed' | 'incomplete' | 'unknown';

const PLAN_LABELS: Record<string, string> = {
  basic: 'Basic',
  pro: 'Pro',
  custom: 'Custom',
  lifetime: 'Lifetime',
  standard: 'Standard',
};

export default function BillingReturnPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const sessionId = searchParams.get('session_id');
  const [status, setStatus] = useState<Status>('checking');
  const [plan, setPlan] = useState<string | null>(null);

  useEffect(() => {
    clearStagedCheckout();
  }, []);

  useEffect(() => {
    if (!sessionId || !sessionId.startsWith('cs_')) {
      setStatus('unknown');
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const { data, error } = await supabase.functions.invoke('reconcile-checkout-session', {
          body: { session_id: sessionId },
        });
        if (cancelled) return;
        if (error) {
          console.error(
            '[billing-return] reconcile-checkout-session call failed:',
            await readEdgeFunctionError(error, 'no reason returned'),
          );
          setStatus('unknown');
          return;
        }
        const payload = data as { reason?: string; plan?: string; error?: string } | null;
        if (payload?.reason === 'not_paid') {
          setStatus('incomplete');
          return;
        }
        if (typeof payload?.plan === 'string') setPlan(payload.plan);
        setStatus('confirmed');
      } catch (err) {
        console.error('[billing-return] reconcile threw:', err);
        if (!cancelled) setStatus('unknown');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  useEffect(() => {
    if (status !== 'confirmed' || !sessionId) return;
    const timer = window.setTimeout(() => {
      const next = new URLSearchParams({ session_id: sessionId });
      if (plan) next.set('plan', plan);
      navigate(`/checkout/success?${next.toString()}`, { replace: true });
    }, 900);
    return () => window.clearTimeout(timer);
  }, [status, sessionId, plan, navigate]);

  const planLabel = plan ? PLAN_LABELS[plan] ?? null : null;
  const heading =
    status === 'confirmed'
      ? 'Payment confirmed'
      : status === 'incomplete'
        ? "Checkout wasn't completed"
        : status === 'unknown'
          ? "We couldn't confirm this checkout"
          : 'Confirming your payment';

  return (
    <>
      <SEOHead
        title="Checkout | TidyWise"
        description="Confirming your TidyWise checkout."
        canonical="/billing/return"
        noIndex
      />
      <main className="min-h-dvh bg-background flex items-center justify-center px-4 py-8 pt-[max(2rem,env(safe-area-inset-top))] pb-[max(2rem,env(safe-area-inset-bottom))]">
        <Card className="w-full max-w-md p-6 text-center" role="status" aria-live="polite">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10" aria-hidden="true">
            {status === 'checking' ? (
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            ) : (
              <CheckCircle2 className="h-6 w-6 text-primary" />
            )}
          </div>
          <h1 className="font-serif text-2xl mb-2">{heading}</h1>
          {status === 'checking' && (
            <p className="text-sm text-muted-foreground">This usually takes a moment. Don't close the app.</p>
          )}
          {status === 'confirmed' && (
            <p className="text-sm text-muted-foreground">
              {planLabel ? `${planLabel} is confirmed.` : 'Your purchase is confirmed.'} Taking you to your account…
            </p>
          )}
          {status === 'incomplete' && (
            <>
              <p className="text-sm text-muted-foreground mb-4">
                Nothing was charged. You can pick a plan and try again.
              </p>
              <Button asChild className="w-full">
                <Link to="/pricing">Back to plans</Link>
              </Button>
            </>
          )}
          {status === 'unknown' && (
            <>
              <p className="text-sm text-muted-foreground mb-4">
                {sessionId
                  ? 'If you finished paying, your account will still update in a minute. If you did not, nothing was charged.'
                  : 'This return link is missing a checkout session. Nothing was charged.'}
              </p>
              {sessionId && (
                <p className="text-xs text-muted-foreground mb-4 break-all">Session {sessionId}</p>
              )}
              <Button asChild variant="outline" className="w-full">
                <Link to="/pricing">Back to plans</Link>
              </Button>
            </>
          )}
        </Card>
      </main>
    </>
  );
}
