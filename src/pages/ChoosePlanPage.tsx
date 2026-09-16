import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Capacitor } from '@capacitor/core';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { useSubscription } from '@/hooks/useSubscription';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Check, Crown, Loader2, Lock, LogOut, Sparkles } from 'lucide-react';
import { SEOHead } from '@/components/SEOHead';
import { useLifetimeCounter } from '@/hooks/useLifetimeCounter';
import { readEdgeFunctionError } from '@/lib/edgeFunctionError';
import {
import { isAlreadyLifetimeError, ALREADY_LIFETIME_MESSAGE } from '@/lib/alreadyLifetime';
  hasAnswer,
  normalizeAnswers,
  primaryPain,
  recommendPlan,
  type OnboardingAnswers,
} from '@/lib/onboardingAnswers';

type Interval = 'monthly' | 'yearly';

/**
 * Everything this page can start a checkout for.
 *
 * Lifetime is deliberately outside `Tier`: it has no monthly or yearly price,
 * ignores the billing-interval toggle, and goes to a different edge function.
 * Widening `Tier` to carry optional prices would push a null check into every
 * subscription card to accommodate one product that isn't a subscription.
 */
type PlanId = 'basic' | 'pro' | 'custom' | 'lifetime';

const LIFETIME_PRICE = 300;

interface Tier {
  id: Exclude<PlanId, 'lifetime'>;
  name: string;
  tagline: string;
  monthlyPrice: number;
  yearlyPrice: number;
  highlight?: boolean;
  features: string[];
}

// Mirrors PricingPage tiers — trimmed feature lists for a faster decision.
const TIERS: Tier[] = [
  {
    id: 'basic',
    name: 'Basic',
    tagline: 'Run jobs, get paid, keep customers organized.',
    monthlyPrice: 49,
    yearlyPrice: 490,
    features: [
      'Online booking system',
      'Unlimited customers + CRM',
      'Smart team scheduler',
      'Estimates, invoices, Stripe payments',
      'Recurring bookings + staff management',
    ],
  },
  {
    id: 'pro',
    name: 'Pro',
    tagline: 'Everything in Basic, plus the growth toolkit.',
    monthlyPrice: 97,
    yearlyPrice: 970,
    highlight: true,
    features: [
      'Everything in Basic',
      'Automations (reviews, reminders, win-back)',
      'AI Intelligence + Copilot',
      'GPS tracking + advanced reports',
      'Payroll, inventory, client portal',
    ],
  },
  {
    id: 'custom',
    name: 'Custom',
    tagline: 'Pro features + we do the heavy lifting for you.',
    monthlyPrice: 197,
    yearlyPrice: 1970,
    features: [
      'Everything in Pro',
      '1 done-for-you request per month',
      'Website build, CRM import, marketing setup',
      'Priority support',
    ],
  },
];

/** Pro's list, minus the recurring framing — what the one payment actually buys. */
const LIFETIME_FEATURES = [
  'Everything in Pro, forever',
  'Every feature we ship in future',
  'No recurring bill, ever',
  'Founding member — 100 spots total',
];

function priceFor(tier: Tier, interval: Interval): { display: string; sub: string } {
  if (interval === 'yearly') {
    const monthlyEquivalent = Math.round((tier.yearlyPrice / 12) * 100) / 100;
    return {
      display: `$${monthlyEquivalent.toFixed(2).replace(/\.00$/, '')}`,
      sub: `/mo · billed $${tier.yearlyPrice}/yr · 2 months free`,
    };
  }
  return { display: `$${tier.monthlyPrice}`, sub: '/mo' };
}

// ── Personalization from onboarding answers ─────────────────────────────
// The shape and the recommendation rules live in @/lib/onboardingAnswers, which
// is unit-tested. They used to be local to this file, where they could not be:
// the answers became multi-select (string[]), and every consumer here failed
// SILENTLY on that — `a.teamSize === 'large'` is false for ['large'], so every
// user would quietly have been recommended 'pro'.

/** Read raw, normalise through the tested module. */
function readAnswers(): OnboardingAnswers {
  try {
    return normalizeAnswers(JSON.parse(sessionStorage.getItem('tw_onboarding_answers') ?? 'null'));
  } catch {
    return normalizeAnswers(null);
  }
}

/**
 * businessName is read separately: it is a plain string written alongside the
 * answers, and normalizeAnswers deliberately drops unknown keys so nothing
 * user-writable rides into the database payload.
 */
function readBusinessName(): string | null {
  try {
    const raw = JSON.parse(sessionStorage.getItem('tw_onboarding_answers') ?? 'null');
    const name = raw && typeof raw === 'object' ? (raw as Record<string, unknown>).businessName : null;
    return typeof name === 'string' && name.trim() ? name : null;
  } catch {
    return null;
  }
}

// Ties the paywall pitch back to the pain they named minutes ago.
const PAIN_PITCH: Record<string, string> = {
  scheduling: 'You said scheduling is eating your week — your smart scheduler and dispatch board are ready to take that over.',
  payments: 'You said chasing payments is the problem — automated invoicing and Stripe payments are set up and waiting.',
  noshows: 'You said no-shows are costing you — automated reminders and confirmations are ready to protect your calendar.',
  everything: "You said you're doing everything yourself — your automations are ready to take work off your plate.",
};

/**
 * ChoosePlanPage — hard paywall shown after onboarding, before the dashboard.
 *
 * Flow: Signup → Onboarding → HERE → Stripe Checkout → /checkout/success → /dashboard
 *
 * - Web only. Native builds never route here (App Store 3.1.1) — a native
 *   visit redirects straight to /dashboard.
 * - Users with full access (subscribed / demo accounts) redirect to /dashboard.
 * - No skip. Only escape hatch is logout.
 * - AdminRoute is the backstop: any /dashboard visit without a subscription
 *   bounces new users back here.
 */
export default function ChoosePlanPage() {
  const navigate = useNavigate();
  const { user, loading: authLoading, signOut, checkSubscription } = useAuth();
  const { hasFullAccess, isLoading: subLoading } = useSubscription();
  const [billingInterval, setBillingInterval] = useState<Interval>('monthly');
  const [checkoutBusy, setCheckoutBusy] = useState<string | null>(null);
  // Same live counter the landing and pricing pages use, so the offer appears
  // and disappears in one place rather than three. Hidden while loading: a card
  // that flashes in and then vanishes as sold-out is worse than arriving late.
  const lifetime = useLifetimeCounter();
  const showLifetime = !lifetime.loading && !lifetime.soldOut;
  // "Have a code?" redemption — same RPC/pattern as RedeemAccessCodeCard.
  const [showRedeem, setShowRedeem] = useState(false);
  const [redeemValue, setRedeemValue] = useState('');
  const [redeemBusy, setRedeemBusy] = useState(false);
  const [redeemError, setRedeemError] = useState<string | null>(null);
  // Onboarding answers — read once; personalizes headline + recommendation.
  const [personal] = useState<OnboardingAnswers>(() => readAnswers());
  const [businessName] = useState<string | null>(() => readBusinessName());
  const recommendedId = recommendPlan(personal);
  // primaryPain, not personal.biggestPain: PAIN_PITCH is keyed by ONE pain and
  // indexing it with an array yields undefined — no pitch, no error, no clue.
  const pain = primaryPain(personal);
  const painPitch = pain ? PAIN_PITCH[pain] : null;
  // One redirect per click — same duplicate-session guard as PricingPage.
  const isRedirectingRef = useRef(false);

  useEffect(() => {
    const reset = () => {
      isRedirectingRef.current = false;
      setCheckoutBusy(null);
    };
    window.addEventListener('pageshow', reset);
    return () => window.removeEventListener('pageshow', reset);
  }, []);

  // Native builds never see this page.
  useEffect(() => {
    if (Capacitor.isNativePlatform()) navigate('/dashboard', { replace: true });
  }, [navigate]);

  // Not logged in → login. Already has access → dashboard.
  useEffect(() => {
    if (authLoading || subLoading) return;
    if (!user) {
      navigate('/login', { replace: true });
      return;
    }
    if (hasFullAccess) navigate('/dashboard', { replace: true });
  }, [authLoading, subLoading, user, hasFullAccess, navigate]);

  async function startCheckout(planId: PlanId) {
    if (isRedirectingRef.current || checkoutBusy) return;
    isRedirectingRef.current = true;
    setCheckoutBusy(planId);

    // Persist choice so a Stripe cancel round-trip restores the highlight
    // if the user ends up on /pricing.
    try {
      sessionStorage.setItem(
        'tw_pending_plan',
        JSON.stringify({ plan: planId, interval: billingInterval }),
      );
    } catch { /* no-op */ }

    const timeoutId = window.setTimeout(() => {
      setCheckoutBusy((current) => {
        if (current === planId) {
          isRedirectingRef.current = false;
          toast.error('Checkout is taking longer than expected. Please try again.');
          return null;
        }
        return current;
      });
    }, 20000);

    try {
      // One code path, one branch. Lifetime is a single payment, so it goes to
      // buy-lifetime — which claims a spot atomically and rejects the sale if
      // the last one went while this page was open. The billing interval is
      // meaningless for it and is not sent.
      const { data, error } = planId === 'lifetime'
        ? await supabase.functions.invoke('buy-lifetime', { body: {} })
        : await supabase.functions.invoke('create-subscription', {
            body: { plan: planId, interval: billingInterval },
          });
      // Was a hand-rolled copy of readEdgeFunctionError. Folded into the shared
      // helper so the sold-out and already-subscribed messages buy-lifetime and
      // create-subscription return reach the person, and so there is one
      // definition of "read the function's own error" rather than three.
      if (error) {
        if (await isAlreadyLifetimeError(error)) {
          window.clearTimeout(timeoutId);
          isRedirectingRef.current = false;
          setCheckoutBusy(null);
          toast.success(ALREADY_LIFETIME_MESSAGE);
          navigate('/dashboard');
          return;
        }
        throw new Error(await readEdgeFunctionError(error, 'Failed to start checkout'));
      }
      const payload = data as { url?: string; error?: string } | null;
      if (payload?.error) throw new Error(payload.error);
      if (!payload?.url) throw new Error('No checkout URL returned');
      window.clearTimeout(timeoutId);
      // Same-tab redirect — smoother than a popup and never blocked.
      window.location.href = payload.url;
    } catch (err: unknown) {
      window.clearTimeout(timeoutId);
      isRedirectingRef.current = false;
      setCheckoutBusy(null);
      const message = err instanceof Error ? err.message : 'Failed to start checkout';
      toast.error(message);
    }
  }

  async function redeemCode(e: React.FormEvent) {
    e.preventDefault();
    if (!redeemValue.trim() || redeemBusy || checkoutBusy) return;
    setRedeemBusy(true);
    setRedeemError(null);
    try {
      const { data, error } = await supabase.rpc('redeem_access_code', {
        _code: redeemValue.trim(),
      });
      if (error) throw error;
      const payload = data as { duration_days?: number } | null;
      toast.success(
        payload?.duration_days
          ? `Code redeemed — ${payload.duration_days} days of full access activated.`
          : 'Code redeemed successfully.',
      );
      await checkSubscription();
      navigate('/dashboard', { replace: true });
    } catch (err: any) {
      setRedeemError(err?.message ?? 'Could not redeem code');
    } finally {
      setRedeemBusy(false);
    }
  }

  if (authLoading || subLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="portal-v2 portal-v2-scroll min-h-screen bg-background">
      <SEOHead title="Choose Your Plan | TidyWise" description="Pick a plan to activate your TidyWise account." noIndex />

      {/* Top bar — brand + logout only. No nav, no skip. */}
      <header className="flex items-center justify-between px-6 py-4 border-b">
        <span className="font-semibold text-lg">TidyWise</span>
        <Button
          variant="ghost"
          size="sm"
          className="gap-2 text-muted-foreground"
          onClick={async () => {
            await signOut();
            navigate('/login', { replace: true });
          }}
        >
          <LogOut className="h-4 w-4" />
          Log out
        </Button>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-10 sm:py-14">
        {/* Progress framing — onboarding just finished, this is the last step */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2 rounded-full bg-primary/10 text-primary px-3 py-1 text-sm font-medium mb-4">
            <Sparkles className="h-4 w-4" />
            {businessName
              ? `${businessName} is set up and ready`
              : 'Last step — your business is set up'}
          </div>
          <h1 className="pv-display text-3xl sm:text-5xl tracking-tight">
            Choose your plan to enter your dashboard
          </h1>
          <p className="text-muted-foreground mt-3 max-w-xl mx-auto">
            {painPitch ??
              'Your booking page, scheduler, and CRM are ready. Pick a plan to activate them.'}
          </p>
        </div>

        {/* Interval toggle */}
        <div className="flex justify-center mb-8">
          <div className="inline-flex rounded-lg border p-1 bg-muted/40">
            {(['monthly', 'yearly'] as Interval[]).map((intv) => (
              <button
                key={intv}
                type="button"
                onClick={() => setBillingInterval(intv)}
                className={cn(
                  'px-4 py-1.5 rounded-md text-sm font-medium transition-colors',
                  billingInterval === intv
                    ? 'bg-background shadow text-foreground'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {intv === 'monthly' ? 'Monthly' : 'Yearly · 2 months free'}
              </button>
            ))}
          </div>
        </div>

        {/* Tiers */}
        <div className={cn('grid gap-6', showLifetime ? 'md:grid-cols-2 xl:grid-cols-4' : 'md:grid-cols-3')}>
          {TIERS.map((tier) => {
            const price = priceFor(tier, billingInterval);
            const busy = checkoutBusy === tier.id;
            const isRecommended = tier.id === recommendedId;
            return (
              <Card
                key={tier.id}
                className={cn(
                  'relative flex flex-col',
                  isRecommended && 'border-primary shadow-lg',
                )}
              >
                {isRecommended && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-primary text-primary-foreground text-xs font-semibold px-3 py-1 whitespace-nowrap">
                    {/* hasAnswer, not truthiness: an empty ARRAY is truthy, so
                        `personal.teamSize ?` would claim a personalised
                        recommendation for someone who answered nothing. */}
                    {hasAnswer(personal.teamSize) ? 'Recommended for you' : 'Most popular'}
                  </div>
                )}
                <CardContent className="flex flex-col flex-1 pt-6 space-y-4">
                  <div>
                    <h2 className="text-xl font-semibold">{tier.name}</h2>
                    <p className="text-sm text-muted-foreground mt-1">{tier.tagline}</p>
                  </div>
                  <div className="flex items-baseline gap-1">
                    <span className="text-4xl font-bold">{price.display}</span>
                    <span className="text-sm text-muted-foreground">{price.sub}</span>
                  </div>
                  <ul className="space-y-2 flex-1">
                    {tier.features.map((f) => (
                      <li key={f} className="flex items-start gap-2 text-sm">
                        <Check className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                        <span>{f}</span>
                      </li>
                    ))}
                  </ul>
                  <Button
                    className="w-full gap-2"
                    variant={isRecommended ? 'default' : 'outline'}
                    disabled={!!checkoutBusy || redeemBusy}
                    onClick={() => startCheckout(tier.id)}
                  >
                    {busy ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Opening checkout…
                      </>
                    ) : (
                      <>Choose {tier.name}</>
                    )}
                  </Button>
                </CardContent>
              </Card>
            );
          })}

          {/* The founding offer. It was reachable from /pricing and by a
              ?plan=lifetime deep link, and buy-lifetime has always worked — but
              this page never listed it, so anyone who clicked the offer, signed
              up, and landed here was shown three subscriptions and no way to buy
              the thing they came for. */}
          {showLifetime && (
            <Card className="relative flex flex-col border-amber-500/50 bg-amber-50/30 dark:bg-amber-950/20">
              <div className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-amber-500 text-white text-xs font-semibold px-3 py-1 whitespace-nowrap tabular-nums">
                {lifetime.spotsLeft} of {lifetime.total} left
              </div>
              <CardContent className="flex flex-col flex-1 pt-6 space-y-4">
                <div>
                  <h2 className="text-xl font-semibold flex items-center gap-2">
                    <Crown className="h-5 w-5 text-amber-600 dark:text-amber-400" />
                    Lifetime
                  </h2>
                  <p className="text-sm text-muted-foreground mt-1">
                    Pay once. Every Pro feature, including everything we ship later.
                  </p>
                </div>
                <div className="flex items-baseline gap-1">
                  <span className="text-4xl font-bold">${LIFETIME_PRICE}</span>
                  {/* No interval — the toggle above does not apply to this card. */}
                  <span className="text-sm text-muted-foreground">one-time</span>
                </div>
                <ul className="space-y-2 flex-1">
                  {LIFETIME_FEATURES.map((f) => (
                    <li key={f} className="flex items-start gap-2 text-sm">
                      <Check className="h-4 w-4 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>
                <Button
                  className="w-full gap-2 bg-amber-600 hover:bg-amber-700 text-white dark:bg-amber-500 dark:hover:bg-amber-600"
                  disabled={!!checkoutBusy || redeemBusy}
                  onClick={() => startCheckout('lifetime')}
                >
                  {checkoutBusy === 'lifetime' ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Opening checkout…
                    </>
                  ) : (
                    <>Claim my spot</>
                  )}
                </Button>
              </CardContent>
            </Card>
          )}
        </div>

        {/* "Have a code?" redemption — comped access / promo codes */}
        <div className="flex flex-col items-center mt-8 gap-2">
          {!showRedeem ? (
            <button
              type="button"
              onClick={() => setShowRedeem(true)}
              className="text-sm text-muted-foreground underline underline-offset-2 hover:text-foreground transition-colors"
            >
              Have a code?
            </button>
          ) : (
            <form onSubmit={redeemCode} className="flex flex-col items-center gap-2 w-full max-w-xs">
              <div className="flex w-full gap-2">
                <Input
                  value={redeemValue}
                  onChange={(e) => {
                    setRedeemValue(e.target.value.toUpperCase());
                    setRedeemError(null);
                  }}
                  placeholder="Enter code"
                  autoComplete="off"
                  disabled={redeemBusy}
                  className="flex-1"
                />
                <Button
                  type="submit"
                  variant="outline"
                  disabled={redeemBusy || !!checkoutBusy || !redeemValue.trim()}
                >
                  {redeemBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Redeem'}
                </Button>
              </div>
              {redeemError && <p className="text-xs text-destructive">{redeemError}</p>}
            </form>
          )}
        </div>

        <p className="flex items-center justify-center gap-2 text-xs text-muted-foreground mt-8">
          <Lock className="h-3.5 w-3.5" />
          Secure checkout powered by Stripe. Cancel anytime.
        </p>
      </main>
    </div>
  );
}
