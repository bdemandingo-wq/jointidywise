import { Fragment, useState, useEffect, useRef } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { InPageLink } from '@/components/InPageLink';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { SEOHead } from '@/components/SEOHead';
import { softwareApplicationSchema, breadcrumbSchema } from '@/lib/seo/schemas';
import { SiteFooter } from '@/components/SiteFooter';
import {
  AdManagementRequestDialog,
  type AdServiceType,
} from '@/components/pricing/AdManagementRequestDialog';
import { useAuth } from '@/hooks/useAuth';
import { useOrgTimezone } from '@/hooks/useOrgTimezone';
import { useOrganization } from '@/contexts/OrganizationContext';
import { useLifetimeCounter } from '@/hooks/useLifetimeCounter';
import { usePublicGrowth } from '@/hooks/usePublicGrowth';
import { GrowthCounters } from '@/components/growth/GrowthCounters';
import { lifetimeSpotsLabel } from '@/lib/publicActivity';
import { TRIAL_CTA } from '@/lib/trialOffer';
import { readEdgeFunctionError } from '@/lib/edgeFunctionError';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { isAlreadyLifetimeError, ALREADY_LIFETIME_MESSAGE } from '@/lib/alreadyLifetime';
import { isCustomPriceMissing } from '@/lib/priceNotConfigured';
import { openEmbeddedCheckout, readCheckoutSession } from '@/lib/embeddedCheckout';
import {
  Check,
  Sparkles,
  Zap,
  Crown,
  Settings as SettingsIcon,
  Megaphone,
  Loader2,
} from 'lucide-react';

import { LIFETIME_FEATURES, PUBLIC_TIERS, type PublicTier } from '@/lib/publicPlans';
import { isActiveOrgTrial } from '@/lib/stripeMode';
import { renewalDisclosure, trialBillsOnCheckout, trialFirstChargeLine } from '@/lib/planBillingCopy';
import { formatLoyaltyDollars, LOYALTY_PRICING, pricingPageLoyaltyLine } from '../../supabase/functions/_shared/loyalty-pricing';

type Interval = 'monthly' | 'yearly';
type Tier = PublicTier;

// Card bullets live in publicPlans.ts so /choose-plan cannot drift from this
// page. The comparison table below is still the full list — nothing was cut
// from the page, only from the cards.
const TIERS: Tier[] = PUBLIC_TIERS;

/**
 * Every feature, in full. The cards carry only what distinguishes one tier from
 * the next; this is where the rest lives.
 *
 * NOTHING WAS DELETED when the cards were trimmed from 28 bullets to 12 — each
 * one is a row here. If you cut a card bullet, add it to this table in the same
 * change, or the page starts quietly claiming less than the product does.
 *
 * "Everything in Basic" / "Everything in Pro" are not rows: the cumulative
 * ticks below say the same thing without a reader having to hold two lists in
 * their head at once.
 */
interface ComparisonRow {
  label: string;
  basic: boolean;
  pro: boolean;
  custom: boolean;
  /** Indented under the row above — used for the done-for-you examples. */
  sub?: boolean;
}

const COMPARISON: { group: string; rows: ComparisonRow[] }[] = [
  {
    group: 'Bookings and scheduling',
    rows: [
      { label: 'Online booking system', basic: true, pro: true, custom: true },
      { label: 'Smart team scheduler', basic: true, pro: true, custom: true },
      { label: 'Recurring bookings and jobs', basic: true, pro: true, custom: true },
      { label: 'GPS tracking and operations dashboard', basic: false, pro: true, custom: true },
      { label: 'Lead pipeline', basic: false, pro: true, custom: true },
    ],
  },
  {
    group: 'Customers',
    rows: [
      { label: 'Unlimited customers + CRM', basic: true, pro: true, custom: true },
      { label: 'In-app messaging', basic: true, pro: true, custom: true },
      { label: 'Client portal', basic: false, pro: true, custom: true },
      { label: 'Data import from other CRMs', basic: false, pro: true, custom: true },
    ],
  },
  {
    group: 'Money',
    rows: [
      { label: 'Estimates, invoices and Stripe payments', basic: true, pro: true, custom: true },
      { label: 'Payroll for cleaners', basic: false, pro: true, custom: true },
      { label: 'Inventory and expenses', basic: false, pro: true, custom: true },
    ],
  },
  {
    group: 'Your team',
    rows: [
      { label: 'Staff management', basic: true, pro: true, custom: true },
      { label: 'Unlimited staff — no per-user fees', basic: true, pro: true, custom: true },
    ],
  },
  {
    group: 'Growth',
    rows: [
      { label: 'Automations — reviews, reminders, win-back, promos', basic: false, pro: true, custom: true },
      { label: 'Email marketing campaigns', basic: false, pro: true, custom: true },
    ],
  },
  {
    group: 'Insight',
    rows: [
      { label: 'Advanced reports and benchmarks', basic: false, pro: true, custom: true },
      { label: 'AI Intelligence + Copilot', basic: false, pro: true, custom: true },
    ],
  },
  {
    group: 'Done for you',
    rows: [
      { label: 'One done-for-you request per month', basic: false, pro: false, custom: true },
      { label: 'Build me a website and connect it to TidyWise', basic: false, pro: false, custom: true, sub: true },
      { label: 'Set up my SMS and email marketing', basic: false, pro: false, custom: true, sub: true },
      { label: 'Import my customers from another CRM', basic: false, pro: false, custom: true, sub: true },
      { label: 'Scripts and documents pack', basic: false, pro: false, custom: true, sub: true },
      { label: 'Or request anything custom', basic: false, pro: false, custom: true, sub: true },
    ],
  },
  {
    group: 'Access and support',
    rows: [
      // Was "Works on any phone (web)" on the Basic card. Two problems: the
      // parenthetical apologised, and it was inaccurate. Stated positively and
      // without claiming a specific app store presence.
      { label: 'Works on any device — phone, tablet or desktop', basic: true, pro: true, custom: true },
      { label: 'Email support', basic: true, pro: true, custom: true },
      { label: 'Priority support', basic: false, pro: false, custom: true },
    ],
  },
];


function priceFor(tier: Tier, interval: Interval): { display: string; sub: string } {
  if (interval === 'yearly') {
    const monthlyEquivalent = Math.round((tier.yearlyPrice / 12) * 100) / 100;
    return {
      display: `$${monthlyEquivalent.toFixed(2).replace(/\.00$/, '')}`,
      sub: `/mo, billed $${tier.yearlyPrice}/yr · 2 months free`,
    };
  }
  return {
    display: `$${tier.monthlyPrice}`,
    sub: '/mo',
  };
}

export default function PricingPage() {
  const navigate = useNavigate();
  const { user, subscription } = useAuth();
  const { timezone: orgTimezone } = useOrgTimezone();
  const { organization } = useOrganization();
  const orgTrialCheckout = organization?.plan_type === 'trial' || isActiveOrgTrial(subscription);
  const trialEndIso = subscription?.trial_end ?? null;
  const nowMs = Date.now();
  const billsNow = orgTrialCheckout && trialBillsOnCheckout(trialEndIso, nowMs);
  const trialDateLine = orgTrialCheckout && !billsNow
    ? trialFirstChargeLine({ trialEndIso, timeZone: orgTimezone, nowMs })
    : null;
  const [searchParams, setSearchParams] = useSearchParams();
  // billingInterval / setBillingInterval — NOT named "setInterval" so it
  // doesn't shadow the global timer function. Renaming because the prior
  // setState shadowing was a footgun for any future code in this file.
  const [billingInterval, setBillingInterval] = useState<Interval>('monthly');
  const monthlyRadioRef = useRef<HTMLButtonElement>(null);
  const yearlyRadioRef = useRef<HTMLButtonElement>(null);
  const [checkoutBusy, setCheckoutBusy] = useState<string | null>(null);
  const lifetime = useLifetimeCounter();
  const growth = usePublicGrowth();
  const [waitlistEmail, setWaitlistEmail] = useState('');
  const [waitlistSubmitted, setWaitlistSubmitted] = useState(false);
  const [highlightedPlan, setHighlightedPlan] = useState<Tier['id'] | null>(null);
  const [adRequestService, setAdRequestService] = useState<AdServiceType | null>(null);
  const tierRefs = useRef<Record<string, HTMLDivElement | null>>({});
  // Hard guard against duplicate checkout sessions / double redirects.
  // Once a click begins the redirect, every subsequent call bails until
  // the page actually unloads. pageshow resets it so a back-nav restore
  // (bfcache) doesn't leave the button permanently disabled. Also reset
  // checkoutBusy and cancel the pending fallback toast — otherwise the
  // button could remain spinning after a bfcache restore and the user
  // would see a stale "Continue to secure checkout" toast.
  const isRedirectingRef = useRef(false);
  useEffect(() => {
    const reset = () => {
      isRedirectingRef.current = false;
      setCheckoutBusy(null);
    };
    window.addEventListener('pageshow', reset);
    return () => window.removeEventListener('pageshow', reset);
  }, []);
  const spotsLeft = lifetime.spotsLeft;

  // Restore selected plan + interval after a return trip to Stripe.
  // Priority order:
  //   1. URL search params (?plan=pro&interval=yearly) — survives a
  //      full page refresh during checkout, deep links, and shared URLs.
  //   2. sessionStorage `tw_pending_plan` — survives the cancel_url
  //      round-trip when params aren't echoed back.
  // URL wins because it's the authoritative source the user can see.
  useEffect(() => {
    const validPlan = (v: string | null): v is Tier['id'] =>
      v === 'basic' || v === 'pro' || v === 'custom';
    const validInterval = (v: string | null): v is Interval =>
      v === 'monthly' || v === 'yearly';

    let plan: Tier['id'] | null = null;
    let intv: Interval | null = null;

    const urlPlan = searchParams.get('plan');
    const urlInterval = searchParams.get('interval');
    if (validPlan(urlPlan)) plan = urlPlan;
    if (validInterval(urlInterval)) intv = urlInterval;

    if (!plan || !intv) {
      try {
        const raw = sessionStorage.getItem('tw_pending_plan');
        if (raw) {
          const parsed = JSON.parse(raw) as { plan?: string; interval?: string };
          if (!plan && validPlan(parsed.plan ?? null)) plan = parsed.plan as Tier['id'];
          if (!intv && validInterval(parsed.interval ?? null)) intv = parsed.interval as Interval;
        }
      } catch {
        /* sessionStorage unavailable */
      }
    }

    if (intv) setBillingInterval(intv);
    if (plan) {
      setHighlightedPlan(plan);
      // Delay the smooth-scroll a beat so it doesn't fight the browser's
      // back-nav restoration animation when the user is returning from
      // Stripe Cancel (iOS in particular renders this as the page
      // visually fighting itself).
      const stripeReferrer = (() => {
        try { return new URL(document.referrer).hostname.includes('stripe.com'); }
        catch { return false; }
      })();
      const scrollDelay = stripeReferrer ? 600 : 150;
      window.setTimeout(() => {
        tierRefs.current[plan!]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, scrollDelay);
      window.setTimeout(() => setHighlightedPlan(null), 2400);
    }
    // Persisted entry has done its job — clear so a future fresh visit
    // doesn't re-highlight stale state. URL params stay (the user can
    // see them; clearing would feel surprising).
    try { sessionStorage.removeItem('tw_pending_plan'); } catch { /* no-op */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Cleanup: if the user leaves /pricing for somewhere that isn't part
  // of the checkout flow (signup, checkout success, Stripe-hosted page
  // which lives off-domain), drop the persisted plan so a future visit
  // starts fresh instead of re-highlighting a stale choice.
  useEffect(() => {
    return () => {
      try {
        const next = window.location.pathname;
        const inFlow =
          next.startsWith('/signup') ||
          next.startsWith('/checkout/') ||
          next.startsWith('/login');
        if (!inFlow) sessionStorage.removeItem('tw_pending_plan');
      } catch {
        /* no-op */
      }
    };
  }, []);

  // Mirror the interval toggle into the URL so a refresh keeps the
  // user's current view. We only sync interval here — plan only goes
  // into the URL when the user actively starts checkout.
  useEffect(() => {
    const current = searchParams.get('interval');
    if (current === billingInterval) return;
    const next = new URLSearchParams(searchParams);
    next.set('interval', billingInterval);
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [billingInterval]);





  // Logged out, Basic / Pro / Custom go to signup with the plan
  // preselected. Signup does not collect a card. Logged in, the same
  // buttons open embedded checkout. Lifetime opens Embedded Checkout
  // on this site. A canceled checkout returns with ?plan= in the URL;
  // the highlight restores, and we do not auto-open checkout again.

  async function startPlanCheckout(planId: 'basic' | 'pro' | 'custom') {
    if (!user) {
      navigate(`/signup?plan=${encodeURIComponent(planId)}&interval=${encodeURIComponent(billingInterval)}`);
      return;
    }
    if (isRedirectingRef.current || checkoutBusy) return;
    isRedirectingRef.current = true;
    setCheckoutBusy(planId);
    try {
      sessionStorage.setItem(
        'tw_pending_plan',
        JSON.stringify({ plan: planId, interval: billingInterval }),
      );
    } catch {
      /* no-op */
    }
    try {
      const { data, error } = await supabase.functions.invoke('create-subscription', {
        body: {
          plan: planId,
          interval: billingInterval,
          ...(organization?.id ? { organization_id: organization.id } : {}),
        },
      });
      if (error) {
        if (await isAlreadyLifetimeError(error)) {
          isRedirectingRef.current = false;
          setCheckoutBusy(null);
          toast.success(ALREADY_LIFETIME_MESSAGE);
          navigate('/dashboard');
          return;
        }
        if (planId === 'custom' && await isCustomPriceMissing(error)) {
          isRedirectingRef.current = false;
          setCheckoutBusy(null);
          try { sessionStorage.removeItem('tw_pending_plan'); } catch { /* no-op */ }
          navigate('/contact');
          return;
        }
        throw new Error(await readEdgeFunctionError(error, 'Could not start checkout. Try again.'));
      }
      const session = readCheckoutSession(data);
      openEmbeddedCheckout({
        ...session,
        plan: planId,
        interval: billingInterval,
        cancelPath: `/pricing?plan=${encodeURIComponent(planId)}&interval=${encodeURIComponent(billingInterval)}&canceled=1`,
      });
    } catch (err) {
      isRedirectingRef.current = false;
      setCheckoutBusy(null);
      const message = err instanceof Error ? err.message : 'Could not start checkout. Try again.';
      toast.error(message);
    }
  }

  async function startLifetimeCheckout() {
    if (isRedirectingRef.current || checkoutBusy) return;
    isRedirectingRef.current = true;

    setCheckoutBusy('lifetime');
    try {
      const { data, error } = await supabase.functions.invoke('buy-lifetime', {
        body: {},
      });
      // buy-lifetime returns real reasons — sold out, already subscribed,
      // price not configured. Throwing the raw error showed "non-2xx status
      // code" instead of any of them.
      if (error) throw new Error(await readEdgeFunctionError(error, 'Could not start the lifetime checkout. Try again.'));
      const session = readCheckoutSession(data);
      openEmbeddedCheckout({
        ...session,
        plan: 'lifetime',
        cancelPath: '/pricing?plan=lifetime&canceled=1',
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : '';
      // A 409 "you already have lifetime access" is not a failure — it is the
      // correct answer for someone who already bought.
      if (/already have lifetime access/i.test(message)) {
        toast.success('You already have lifetime access — nothing more to buy.');
        setCheckoutBusy(null);
        isRedirectingRef.current = false;
        navigate('/dashboard');
        return;
      }
      toast.error(message || 'Could not start the lifetime checkout. Try again.');
      setCheckoutBusy(null);
      isRedirectingRef.current = false;
    }
  }


  async function joinWaitlist(e: React.FormEvent) {
    e.preventDefault();
    if (!waitlistEmail.trim()) return;
    try {
      const { error } = await (supabase as any)
        .from('lifetime_waitlist')
        .insert({ email: waitlistEmail.trim().toLowerCase() });
      if (error && !error.message.toLowerCase().includes('duplicate')) {
        throw error;
      }
      setWaitlistSubmitted(true);
      toast.success("You're on the list. We'll email you if a spot opens up.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not join the waitlist.');
    }
  }

  return (
    <>
      <SEOHead
        title="Pricing | TidyWise — Cleaning Business Software"
        description="Four plans for cleaning businesses of every size. Basic $49, Pro $97, Custom $197, or a one-time Lifetime deal at $300 (100 spots only)."
        canonical="/pricing"
        ogImage="/images/og/og-pricing.png"
        schemaJson={[
          softwareApplicationSchema({ withOfferList: true }),
          breadcrumbSchema([
            { name: "Home", path: "/" },
            { name: "Pricing", path: "/pricing" },
          ]),
        ]}
      />

      <main className="portal-v2 portal-v2-scroll min-h-screen bg-background">
        <header className="border-b border-border/60">
          <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
            <Link to="/" className="pv-display text-2xl tracking-tight">
              TIDYWISE
            </Link>
            <div className="flex items-center gap-2">
              {user ? (
                <>
                  <span className="hidden sm:inline text-xs text-muted-foreground mr-1 truncate max-w-[180px]">
                    {user.email}
                  </span>
                  <Button asChild variant="ghost" size="sm">
                    <Link to="/dashboard/settings">Settings</Link>
                  </Button>
                  <Button asChild variant="outline" size="sm">
                    <Link to="/logout">Log out</Link>
                  </Button>
                </>
              ) : (
                <>
                  <Button asChild variant="ghost" size="sm">
                    <Link to="/login">Log in</Link>
                  </Button>
                  <Button asChild size="sm">
                    <Link to="/signup">Get started</Link>
                  </Button>
                </>
              )}
            </div>
          </div>
        </header>

        <section className="max-w-4xl mx-auto px-4 pt-16 pb-10 text-center">
          <p className="text-xs uppercase tracking-wider text-muted-foreground mb-3">
            Pricing
          </p>
          <h1 className="pv-display text-5xl md:text-6xl text-foreground mb-4">
            Pick the plan that fits your business.
          </h1>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            Built for cleaning operators — solo, growing, or scaling. Switch any time.
            No setup fees. Every plan includes Stripe payments, mobile-friendly web access,
            and real human support.
          </p>
          <div className="mt-6 flex flex-col items-center gap-3">
            <Button asChild size="lg" className="h-auto whitespace-normal px-6 py-3 text-base">
              <Link to={user ? '/dashboard' : '/signup'}>{TRIAL_CTA}</Link>
            </Button>
            <p className="text-sm text-muted-foreground max-w-xl">
              Full Pro access for 30 days. No card. Basic stays $49, Pro $97, and Lifetime $300 — pick one when the trial ends and the dashboard locks.
            </p>
            <GrowthCounters lifetime={lifetime} counters={growth.counters} />
            <p className="text-sm text-muted-foreground">
              {pricingPageLoyaltyLine()}
            </p>
            <div className="w-full max-w-xl overflow-x-auto text-left">
              <table className="w-full text-sm border border-border rounded-lg">
                <caption className="sr-only">Monthly loyalty prices</caption>
                <thead>
                  <tr className="border-b border-border text-muted-foreground">
                    <th scope="col" className="px-3 py-2 font-medium">Plan</th>
                    <th scope="col" className="px-3 py-2 font-medium">Starts at</th>
                    <th scope="col" className="px-3 py-2 font-medium">Every {LOYALTY_PRICING.intervalMonths} months</th>
                    <th scope="col" className="px-3 py-2 font-medium">Lowest</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b border-border">
                    <th scope="row" className="px-3 py-2 font-medium text-foreground">Pro</th>
                    <td className="px-3 py-2">{formatLoyaltyDollars(LOYALTY_PRICING.plans.pro.listCents)}/mo</td>
                    <td className="px-3 py-2">Drops {formatLoyaltyDollars(LOYALTY_PRICING.plans.pro.stepCents)}</td>
                    <td className="px-3 py-2">{formatLoyaltyDollars(LOYALTY_PRICING.plans.pro.floorCents)}/mo</td>
                  </tr>
                  <tr>
                    <th scope="row" className="px-3 py-2 font-medium text-foreground">Basic</th>
                    <td className="px-3 py-2">{formatLoyaltyDollars(LOYALTY_PRICING.plans.basic.listCents)}/mo</td>
                    <td className="px-3 py-2">Drops {formatLoyaltyDollars(LOYALTY_PRICING.plans.basic.stepCents)}</td>
                    <td className="px-3 py-2">{formatLoyaltyDollars(LOYALTY_PRICING.plans.basic.floorCents)}/mo</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <div
            role="group"
            aria-label="Billing interval"
            className="mt-8 inline-flex items-center gap-1 rounded-full border border-border bg-muted/40 p-1"
            onKeyDown={(e) => {
              // WAI-ARIA radio-group pattern: arrow keys move both focus and
              // selection between options (Home/End jump to the ends — with
              // only two options here, that's equivalent to toggling).
              // Previously these were just two independently-tabbable
              // buttons with no roving tabindex and no arrow-key handling
              // at all, which isn't a real radiogroup from a keyboard
              // user's perspective.
              if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key)) return;
              e.preventDefault();
              const next: Interval = billingInterval === 'monthly' ? 'yearly' : 'monthly';
              setBillingInterval(next);
              (next === 'monthly' ? monthlyRadioRef : yearlyRadioRef).current?.focus();
            }}
          >
            <button
              ref={monthlyRadioRef}
              type="button"
              role="radio"
              aria-checked={billingInterval === 'monthly'}
              tabIndex={billingInterval === 'monthly' ? 0 : -1}
              onClick={() => setBillingInterval('monthly')}
              className={`px-5 py-2 rounded-full text-sm font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background ${
                billingInterval === 'monthly'
                  ? 'bg-background shadow-sm text-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Monthly
            </button>
            <button
              ref={yearlyRadioRef}
              type="button"
              role="radio"
              aria-checked={billingInterval === 'yearly'}
              aria-label="Yearly billing, two months free"
              tabIndex={billingInterval === 'yearly' ? 0 : -1}
              onClick={() => setBillingInterval('yearly')}
              className={`px-5 py-2 rounded-full text-sm font-medium transition flex items-center gap-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background ${
                billingInterval === 'yearly'
                  ? 'bg-background shadow-sm text-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Yearly
              <span aria-hidden="true" className="text-[10px] font-bold uppercase tracking-wider bg-primary text-primary-foreground rounded-full px-2 py-0.5">
                2 mo free
              </span>
            </button>
          </div>

        </section>

        <section className="max-w-7xl mx-auto px-4 pb-12">
          {trialDateLine && (
            <p className="mb-6 whitespace-nowrap text-center text-xs text-muted-foreground">
              {trialDateLine}
            </p>
          )}
          <div
            role="list"
            aria-label="Subscription plans"
            className="grid grid-cols-1 md:grid-cols-3 gap-6"
          >
            {TIERS.map((tier) => {
              const price = priceFor(tier, billingInterval);
              const chargePrice = billingInterval === 'yearly' ? tier.yearlyPrice : tier.monthlyPrice;
              const isHighlighted = highlightedPlan === tier.id;
              const cardLabel = `${tier.name} plan, ${price.display}${price.sub}${tier.highlight ? ', most popular' : ''}${isHighlighted ? ', selected' : ''}`;
              return (
                <Card
                  key={tier.id}
                  ref={(el) => { tierRefs.current[tier.id] = el; }}
                  role="listitem"
                  aria-label={cardLabel}
                  aria-current={isHighlighted ? 'true' : undefined}
                  className={`p-7 flex flex-col transition-shadow focus-within:ring-2 focus-within:ring-primary focus-within:ring-offset-2 focus-within:ring-offset-background ${
                    tier.highlight
                      ? 'border-primary/60 shadow-lg shadow-primary/10 relative'
                      : ''
                  } ${
                    isHighlighted
                      ? 'ring-2 ring-primary ring-offset-2 ring-offset-background'
                      : ''
                  }`}
                >

                  {tier.highlight && (
                    <Badge className="absolute -top-3 left-1/2 -translate-x-1/2 uppercase tracking-wider text-[10px]">
                      Most popular
                    </Badge>
                  )}

                  <div className="flex items-center gap-2 mb-1">
                    {tier.id === 'basic' && (
                      <Sparkles aria-hidden="true" className="h-4 w-4 text-muted-foreground" />
                    )}
                    {tier.id === 'pro' && <Zap aria-hidden="true" className="h-4 w-4 text-primary" />}
                    {tier.id === 'custom' && (
                      <SettingsIcon aria-hidden="true" className="h-4 w-4 text-foreground" />
                    )}
                    <h3 className="pv-display text-2xl">{tier.name}</h3>
                  </div>
                  <p className="text-sm text-muted-foreground mb-5">{tier.tagline}</p>

                  <div className="mb-2">
                    <span className="text-4xl font-semibold tracking-tight">
                      {price.display}
                    </span>
                    <span className="text-sm text-muted-foreground ml-1">
                      {price.sub}
                    </span>
                  </div>
                  <p className="text-xs font-medium text-primary mb-6">
                    30 days of Pro free, then {price.display}{price.sub}
                  </p>

                  <Button
                    type="button"
                    variant={tier.highlight ? 'default' : 'outline'}
                    size="lg"
                    className="w-full mb-2"
                    disabled={checkoutBusy === tier.id}
                    aria-label={`Choose the ${tier.name} plan, ${billingInterval === 'yearly' ? 'billed yearly after the free Pro trial' : 'billed monthly after the free Pro trial'}`}
                    onClick={() => startPlanCheckout(tier.id)}
                  >
                    {checkoutBusy === tier.id ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      `Choose ${tier.name}`
                    )}
                  </Button>
                  <div className="mb-6 space-y-1 text-center">
                    {billsNow && (
                      <p className="whitespace-nowrap text-[11px] text-muted-foreground">
                        {trialFirstChargeLine({
                          trialEndIso,
                          timeZone: orgTimezone,
                          price: chargePrice,
                          nowMs,
                        })}
                      </p>
                    )}
                    <p className="text-[11px] text-muted-foreground">
                      {renewalDisclosure(chargePrice, billingInterval)}
                    </p>
                    {!orgTrialCheckout && (
                      <p className="text-[11px] text-muted-foreground">
                        No card to start. After 30 days of Pro the app asks you to pick a plan.
                      </p>
                    )}
                  </div>

                  <ul className="space-y-2.5 text-sm">
                    {tier.features.map((feature) => (
                      <li key={feature} className="flex items-start gap-2.5">
                        <Check aria-hidden="true" className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                        <span>{feature}</span>
                      </li>
                    ))}
                  </ul>
                </Card>
              );
            })}
          </div>

          {/*
            The cards answer "which one", the table answers "does it do X".
            Anchored on the same page rather than a /features route: sending
            someone to another URL mid-decision is where they get lost, and a
            new index would compete with the ten existing /features/* SEO pages
            for the same intent.
          */}
          <div className="mt-8 text-center">
            {/*
              preventDefault + scrollIntoView rather than letting the browser
              follow the hash. A bare href="#..." changes the URL, and this app
              has a global popstate interceptor (useAppStateHandler) that used to
              turn any such change on a non-root route into a redirect to
              /dashboard — i.e. /login for a visitor. That interceptor is now
              scoped to signed-in users inside the app, but scrolling directly is
              still the right call: it works identically under HashRouter on
              native, where a hash link would be read as a route change.

              The href stays for middle-click, "open in new tab" and keyboard
              users, and so the target is announced.
            */}
            <InPageLink
              href="#compare-plans"
              className="text-sm font-medium text-primary underline underline-offset-4 hover:text-primary/80"
            >
              See the full feature comparison
            </InPageLink>
          </div>

        </section>

        <section id="compare-plans" className="mx-auto w-full max-w-5xl px-4 py-12 scroll-mt-20">
          <h2 className="pv-display text-3xl text-center mb-2">Full feature comparison</h2>
          <p className="text-sm text-muted-foreground text-center mb-8">
            Everything in every plan. The cards above show only what changes between them.
          </p>

          {/* Wide content scrolls inside its own container — the page body must never scroll sideways on a phone. */}
          <div className="overflow-x-auto -mx-4 px-4">
            <table className="w-full min-w-[520px] border-collapse text-sm">
              <caption className="sr-only">
                Feature comparison across the Basic, Pro and Custom plans
              </caption>
              <thead>
                <tr className="border-b">
                  <th scope="col" className="py-3 pr-3 text-left font-semibold">Feature</th>
                  {TIERS.map((t) => (
                    <th key={t.id} scope="col" className="px-2 py-3 text-center font-semibold whitespace-nowrap">
                      {t.name}
                      <span className="block text-xs font-normal text-muted-foreground">
                        ${t.monthlyPrice}/mo
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {COMPARISON.map((section) => (
                  <Fragment key={section.group}>
                    <tr className="bg-muted/40">
                      <th
                        scope="colgroup"
                        colSpan={4}
                        className="py-2 pr-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground"
                      >
                        {section.group}
                      </th>
                    </tr>
                    {section.rows.map((row) => {
                      /*
                        A row every plan ticks cannot help anyone choose — it is
                        reassurance, not information. "Payroll for cleaners" on Pro
                        and Custom only is a decision point; "Email support"
                        everywhere is not. So the rows where the tiers actually
                        differ carry the weight, and the rest recede.

                        Two weights only. Sub-rows are detail under a decisive
                        parent, so they stay in the quiet treatment rather than
                        becoming a third tier of their own.

                        Emphasis is never the only signal: the check/dash and its
                        sr-only label still carry the actual answer, so this reads
                        the same to a screen reader and to anyone who can't
                        distinguish the two weights.

                        This applies to the LABEL only. Dimming the checkmarks was
                        tried and reversed — a light tick reads as "partially
                        included", which is a worse misreading than the ambiguity
                        it was meant to fix. The answer column is uniform; only
                        the row label carries the weight.
                      */
                      const decides =
                        !row.sub && !(row.basic === row.pro && row.pro === row.custom);
                      return (
                      <tr key={row.label} className="border-b border-border/50">
                        <th
                          scope="row"
                          className={`py-2.5 pr-3 text-left ${
                            decides
                              ? 'font-medium text-foreground'
                              : 'font-normal text-muted-foreground'
                          } ${row.sub ? 'pl-4' : ''}`}
                        >
                          {row.sub && <span aria-hidden="true" className="mr-1">–</span>}
                          {row.label}
                        </th>
                        {(['basic', 'pro', 'custom'] as const).map((tierId) => (
                          <td key={tierId} className="px-2 py-2.5 text-center">
                            {row[tierId] ? (
                              <>
                                {/*
                                  Uniform, full strength, every row. A dimmed
                                  tick was tried and read as PARTIALLY included
                                  — a lesser version of the feature — which is a
                                  worse problem than the one it solved. The
                                  answer column states what you get; it is not
                                  the place to editorialise about how useful the
                                  row is. Emphasis lives on the label instead.
                                */}
                                <Check aria-hidden="true" className="inline h-4 w-4 text-primary" />
                                <span className="sr-only">Included</span>
                              </>
                            ) : (
                              <>
                                {/* A dash, not an empty cell — a blank reads as "we forgot" rather than "not in this plan". */}
                                <span aria-hidden="true" className="text-muted-foreground/50">—</span>
                                <span className="sr-only">Not included</span>
                              </>
                            )}
                          </td>
                        ))}
                      </tr>
                      );
                    })}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="max-w-5xl mx-auto px-4 py-16">
          <Card className="p-8 md:p-12 border-2 border-amber-500/40 bg-gradient-to-br from-amber-50/40 to-transparent dark:from-amber-950/20 relative overflow-hidden">
            <div className="absolute top-6 right-6">
              <Crown className="h-8 w-8 text-amber-500/60" />
            </div>

            <Badge className="bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30 mb-4 uppercase tracking-wider text-[10px]">
              Founding offer{lifetime.loading || lifetime.unavailable ? '' : ` · ${lifetime.total} spots only`}
            </Badge>

            <h2 className="pv-display text-4xl md:text-5xl mb-3">
              Pay once. Use TidyWise forever.
            </h2>
            <p className="text-lg text-muted-foreground max-w-2xl mb-8">
              One $300 payment locks in lifetime access to every Pro feature — including
              everything we ship in the future. No recurring bill, ever.
              {' '}
              {lifetime.loading || lifetime.unavailable
                ? 'Limited spots at launch.'
                : `Only ${lifetime.total} spots at launch.`}
            </p>

            <div className="grid md:grid-cols-2 gap-8 items-start">
              <div>
                <div className="mb-6">
                  <div className="flex items-baseline gap-3 mb-2">
                    <span className="text-5xl font-bold tracking-tight">$300</span>
                    <span className="text-muted-foreground">one-time</span>
                  </div>
                  {lifetime.loading ? (
                    <p className="text-sm text-muted-foreground">Loading spots...</p>
                  ) : lifetime.soldOut ? (
                    <p className="text-sm font-medium text-amber-700 dark:text-amber-300">
                      SOLD OUT — thank you. Waitlist below.
                    </p>
                  ) : (
                    <p className="text-sm font-medium text-foreground">
                      <span className="text-amber-700 dark:text-amber-400 font-bold">
                        {lifetime.unavailable
                          ? 'Lifetime spots'
                          : lifetimeSpotsLabel(spotsLeft, lifetime.total)}
                      </span>
                    </p>
                  )}
                  {!lifetime.loading && !lifetime.soldOut && !lifetime.unavailable && (
                    <div className="mt-3 h-2 w-full bg-muted/60 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-amber-500 transition-all"
                        style={{
                          width: `${Math.min(100, (lifetime.sold / lifetime.total) * 100)}%`,
                        }}
                      />
                    </div>
                  )}
                </div>

                {lifetime.soldOut ? (
                  waitlistSubmitted ? (
                    <p className="text-sm text-foreground">
                      ✓ You're on the waitlist.
                    </p>
                  ) : (
                    <form onSubmit={joinWaitlist} className="flex gap-2">
                      <Input
                        type="email"
                        required
                        placeholder="you@business.com"
                        value={waitlistEmail}
                        onChange={(e) => setWaitlistEmail(e.target.value)}
                        className="bg-background"
                      />
                      <Button type="submit">Join waitlist</Button>
                    </form>
                  )
                ) : (
                  <Button
                    onClick={() => startLifetimeCheckout()}
                    disabled={checkoutBusy === 'lifetime'}
                    size="lg"
                    className="w-full md:w-auto bg-amber-600 hover:bg-amber-700"
                  >
                    {checkoutBusy === 'lifetime' ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <>
                        <Crown className="h-4 w-4 mr-2" /> Claim a lifetime spot
                      </>
                    )}
                  </Button>
                )}
              </div>

              <ul className="space-y-2.5 text-sm">
                {/*
                  Four, not six. 'Works on any device (web)' and 'Email support'
                  came off for the same reasons they came off the Basic card: the
                  parenthetical apologised for something it shouldn't, and naming
                  the support tier next to a price frames it as the cheap option
                  at the moment of decision. Both are in the comparison table.
                  What's left all speaks to the one-time offer specifically —
                  which is the only thing this block has to argue.
                */}
                {LIFETIME_FEATURES.map((f) => (
                  <li key={f} className="flex items-start gap-2.5">
                    <Check className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
            </div>
          </Card>
        </section>

        <section className="max-w-5xl mx-auto px-4 pb-16">
          <Card className="p-8 md:p-12 bg-muted/30 border-muted">
            <div className="flex items-start gap-4 mb-6">
              <div className="h-12 w-12 rounded-lg bg-foreground text-background flex items-center justify-center shrink-0">
                <Megaphone className="h-6 w-6" />
              </div>
              <div>
                <Badge variant="secondary" className="mb-2">
                  Add-on · any paid plan
                </Badge>
                <h2 className="pv-display text-3xl mb-1">Ad management</h2>
                <p className="text-muted-foreground">
                  We run your ads. You take the calls. Bookings flow straight into
                  TidyWise.
                </p>
              </div>
            </div>

            <div className="grid md:grid-cols-3 gap-4">
              {([
                {
                  slug: 'google_search' as AdServiceType,
                  name: 'Google Search Ads',
                  body:
                    'Capture "house cleaner near me" searches in your zip code. We build the campaign, write the ads, monitor performance.',
                  guarantee: null,
                },
                {
                  slug: 'google_lsa' as AdServiceType,
                  name: 'Google Local Services Ads',
                  body:
                    'Top of Google with the green checkmark. We handle license verification, lead scoring, and weekly optimization.',
                  guarantee: null,
                },
                {
                  slug: 'facebook' as AdServiceType,
                  name: 'Facebook Ads',
                  body:
                    'Retargeting and lookalike audiences from your customer list. We write the copy, design the creative, run the campaign.',
                  guarantee: '10 leads in 30 days',
                },
              ] as const).map((p) => (
                <div
                  key={p.name}
                  className={`rounded-lg bg-background p-5 border relative flex flex-col ${
                    p.guarantee ? 'border-success/50 shadow-sm shadow-success/10' : ''
                  }`}
                >
                  {p.guarantee && (
                    <Badge className="absolute -top-3 left-4 bg-success text-success-foreground border-0 uppercase tracking-wider text-[10px]">
                      Guaranteed
                    </Badge>
                  )}
                  <h3 className="font-medium mb-2">{p.name}</h3>
                  <p className="text-sm text-muted-foreground mb-4">{p.body}</p>
                  <p className="text-2xl font-semibold mb-2">
                    $400
                    <span className="text-sm font-normal text-muted-foreground">
                      /mo
                    </span>
                  </p>
                  {p.guarantee && (
                    <div className="mt-3 pt-3 border-t border-success/20">
                      <p className="text-xs font-medium text-success flex items-start gap-1.5">
                        <Check className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                        <span>
                          <strong>{p.guarantee}</strong> — or your next month is on us.
                        </span>
                      </p>
                    </div>
                  )}
                  <Button
                    className="mt-4 w-full"
                    variant={p.guarantee ? 'default' : 'outline'}
                    onClick={() => setAdRequestService(p.slug)}
                  >
                    Get started
                  </Button>
                </div>
              ))}
            </div>

            <div className="mt-6 space-y-2 text-xs text-muted-foreground">
              <p>
                <strong className="text-foreground">About the Facebook guarantee:</strong>{' '}
                A "lead" = a form fill, phone call, or direct message from someone in your
                service area. Requires a minimum $1500/mo ad budget paid to Facebook on your
                card. If we don't deliver 10 in your first 30 days, your second month of
                ad management is free while we tune.
              </p>
              <p>
                Auto-cancels if you cancel your TidyWise subscription. Ad spend (what you
                pay Google/Facebook) is separate and billed to your card on file with them.
              </p>
            </div>
          </Card>
        </section>

        <section className="max-w-3xl mx-auto px-4 pb-20">
          <h2 className="pv-display text-3xl mb-8 text-center">Common questions</h2>
          <div className="space-y-6">
            {[
              {
                q: 'Can I switch plans later?',
                a: 'Yes. Upgrade any time and the new features unlock instantly. Downgrade and the new plan kicks in at the end of your current billing month — no partial refunds, but no lost access either.',
              },
              {
                q: 'How does the free trial work?',
                a: 'Every new account gets 30 days of Pro with no card. When that ends, the dashboard locks until you pick a plan and add a card. Cancel before then and you pay nothing. Accounts already on a trial keep the end date they have. After you subscribe, canceling keeps access until the end of the month you paid for.',
              },
              {
                q: 'What happens at the end of my paid month if I cancel?',
                a: 'You keep using TidyWise until the day your last paid month ends. After that your account drops to a read-only state — your data stays, you can come back any time by resubscribing.',
              },
              {
                q: 'Does the lifetime plan include future features?',
                a: "Yes. Anything we ship later is included at no extra cost, for life. The only thing the lifetime plan does NOT include is the Custom plan's done-for-you requests — those are a Custom-tier benefit.",
              },
              {
                q: 'Can I buy ad management without TidyWise?',
                a: 'No — ad management is only available to TidyWise subscribers because the leads, jobs, and follow-ups all flow through the CRM.',
              },
            ].map((item) => (
              <div key={item.q}>
                <h3 className="font-medium mb-1.5">{item.q}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">{item.a}</p>
              </div>
            ))}
          </div>
        </section>

        <SiteFooter />
      </main>
      <AdManagementRequestDialog
        open={adRequestService !== null}
        onOpenChange={(o) => { if (!o) setAdRequestService(null); }}
        serviceType={adRequestService}
      />
    </>
  );
}
