/**
 * In-app Stripe Embedded Checkout for Basic, Pro, Custom, and Lifetime.
 *
 * The card form is Stripe's iframe. The page itself stays on jointidywise.com,
 * including inside the iOS Capacitor webview. Do not give this page a fixed
 * height or overflow:hidden — the iframe grows for 3D Secure and the webview
 * has to scroll it into view when the keyboard opens.
 */

import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { EmbeddedCheckout, EmbeddedCheckoutProvider } from '@stripe/react-stripe-js';
import { loadStripe } from '@stripe/stripe-js';
import { ArrowLeft } from 'lucide-react';
import { SEOHead } from '@/components/SEOHead';
import { Button } from '@/components/ui/button';
import { consumeEmbeddedCheckout, type EmbeddedCheckoutHandoff } from '@/lib/embeddedCheckout';

const PLAN_LABELS: Record<string, string> = {
  basic: 'Basic',
  pro: 'Pro',
  custom: 'Custom',
  lifetime: 'Lifetime',
};

export default function BillingCheckoutPage() {
  const [handoff] = useState<EmbeddedCheckoutHandoff | null>(() => consumeEmbeddedCheckout());
  const stripePromise = useMemo(
    () => (handoff ? loadStripe(handoff.publishableKey) : null),
    [handoff],
  );
  const planLabel = handoff ? PLAN_LABELS[handoff.plan] ?? 'your plan' : 'your plan';
  const cancelPath = handoff?.cancelPath || '/pricing';

  return (
    <>
      <SEOHead
        title="Checkout | TidyWise"
        description="Finish your TidyWise purchase without leaving the site."
        canonical="/billing/checkout"
        noIndex
      />
      <main className="min-h-dvh bg-background flex flex-col pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">
        <header className="sticky top-0 z-10 border-b bg-background/95 backdrop-blur">
          <div className="mx-auto flex w-full max-w-lg items-center gap-2 px-3 py-2">
            <Button variant="ghost" size="sm" className="min-h-[44px] px-2" asChild>
              <Link to={cancelPath}>
                <ArrowLeft className="mr-1 h-4 w-4" aria-hidden="true" />
                Back
              </Link>
            </Button>
            <h1 className="text-base font-semibold truncate">
              {handoff ? `Checkout — ${planLabel}` : 'Checkout'}
            </h1>
          </div>
        </header>
        <div className="mx-auto w-full max-w-lg flex-1 px-3 py-4">
          {handoff && stripePromise ? (
            <div className="w-full min-h-[28rem] [&_iframe]:w-full [&_iframe]:max-w-full [&_iframe]:border-0">
              <EmbeddedCheckoutProvider stripe={stripePromise} options={{ clientSecret: handoff.clientSecret }}>
                <EmbeddedCheckout className="w-full" />
              </EmbeddedCheckoutProvider>
            </div>
          ) : (
            <div className="rounded-lg border bg-card p-6 text-center" role="status">
              <h2 className="text-lg font-semibold mb-2">This checkout isn't open</h2>
              <p className="text-sm text-muted-foreground mb-4">
                Start again from the plans page. Nothing was charged.
              </p>
              <Button asChild>
                <Link to="/pricing">Back to plans</Link>
              </Button>
            </div>
          )}
        </div>
      </main>
    </>
  );
}
