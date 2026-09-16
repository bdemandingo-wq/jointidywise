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
import { useLifetimeCounter } from '@/hooks/useLifetimeCounter';
import { readEdgeFunctionError } from '@/lib/edgeFunctionError';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { isAlreadyLifetimeError, ALREADY_LIFETIME_MESSAGE } from '@/lib/alreadyLifetime';
import {
  Check,
  Sparkles,
  Zap,
  Crown,
  Settings as SettingsIcon,
  Megaphone,
  Loader2,
} from 'lucide-react';

type Interval = 'monthly' | 'yearly';

interface Tier {
  id: 'basic' | 'pro' | 'custom';
  name: string;
  tagline: string;
  monthlyPrice: number;
  yearlyPrice: number;
  highlight?: boolean;
  features: string[];
}

const TIERS: Tier[] = [
  {
    id: 'basic',
    name: 'Basic',
    tagline: 'Run jobs, get paid, keep customers organized.',
    monthlyPrice: 49,
    yearlyPrice: 490,
    // Four bullets, not nine. A card's job is to help someone choose BETWEEN
    // tiers; anything table-stakes or true of all three is noise. Everything
    // cut is still on the page in COMPARISON below — demoted, not deleted.
    features: [
      'Unlimited customers, jobs and staff — no per-user fees',
      'Online booking that takes payment',
      'Scheduling and recurring jobs',
      'Estimates, invoices and Stripe payouts',
    ],
  },
  {
    id: 'pro',
    name: 'Pro',
    tagline: 'Everything in Basic, plus the growth toolkit.',
    monthlyPrice: 97,
    yearlyPrice: 970,
    highlight: true,
    // Client portal is on the card and GPS tracking is not — a deliberate swap.
    // "Your customers get their own login" is easy for an owner to picture and
    // sells to a two-cleaner business and a ten-van one alike. GPS reads as
    // surveillance at small headcounts: it wins the big operator and unsettles
    // the small one, which is the wrong trade on the card that has to convert
    // both. GPS is still in the comparison table.
    features: [
      'Everything in Basic',
      'Automated review requests, reminders and win-backs',
      'Payroll for your cleaners',
      'AI assistant and advanced reports',
      'Client portal — your customers get their own login',
    ],
  },
  {
    id: 'custom',
    name: 'Custom',
    tagline: 'Pro features + we do the heavy lifting for you.',
    monthlyPrice: 197,
    yearlyPrice: 1970,
    // The five '•' sub-items were examples of ONE feature, rendered as peers of
    // 'Priority support'. That nesting is what made this card read as clutter.
    // They collapse into the line below and appear in full in the table.
    features: [
      'Everything in Pro',
      'One done-for-you request every month — website build, CRM import, marketing setup, or anything custom',
      'Priority support',
    ],
  },
];

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
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  // billingInterval / setBillingInterval — NOT named "setInterval" so it
  // doesn't shadow the global timer function. Renaming because the prior
  // setState shadowing was a footgun for any future code in this file.
  const [billingInterval, setBillingInterval] = useState<Interval>('monthly');
  const monthlyRadioRef = useRef<HTMLButtonElement>(null);
  const yearlyRadioRef = useRef<HTMLButtonElement>(null);
  const [checkoutBusy, setCheckoutBusy] = useState<string | null>(null);
  const lifetime = useLifetimeCounter();
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
      if (checkoutToastTimerRef.current) {
        window.clearTimeout(checkoutToastTimerRef.current);
        checkoutToastTimerRef.current = null;
      }
    };
    // pagehide fires when the user is navigating away (including to
    // Stripe). Cancel the fallback toast so it doesn't pop in during
    // the unload transition — the load-bearing fix for the glitch the
    // user reported.
    window.addEventListener('pageshow', reset);
    window.addEventListener('pagehide', () => {
      if (checkoutToastTimerRef.current) {
        window.clearTimeout(checkoutToastTimerRef.current);
        checkoutToastTimerRef.current = null;
      }
    });
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





  // Detect iframe once per call. Cross-origin top access throws → iframed.
  function isInIframe(): boolean {
    try {
      return window.self !== window.top;
    } catch {
      return true;
    }
  }

  // Synchronously open a blank tab from inside a user-gesture click handler.
  // Browsers only honor window.open() during the gesture; after an `await`
  // it's treated as programmatic and popup-blocked. Call this BEFORE
  // awaiting the edge function, then point the returned window at the
  // Stripe URL once it resolves. Returns null when not iframed (we use
  // same-tab navigation instead, which is never popup-blocked) or when
  // the popup was blocked outright.
  function preopenCheckoutTab(): Window | null {
    if (!isInIframe()) return null;
    try {
      return window.open('', '_blank', 'noopener,noreferrer');
    } catch {
      return null;
    }
  }

  // Navigate to Stripe. Preferred path: top-level same-tab navigation,
  // which browsers never popup-block. If we're inside an iframe (Lovable
  // preview, in-app webview), use the pre-opened tab from the click
  // gesture, then fall back to top-frame break, then plain navigation.
  // A "Continue to secure checkout" toast appears after 2s as a safety
  // net for the rare case all paths are blocked.
  // Track the "Continue to secure checkout" toast timer at component
  // scope so the click handlers can cancel it once the redirect actually
  // succeeds. Without this, the toast fires after every click — even
  // successful navigations — and pops in during the brief unload window,
  // which looked like "glitching" to the user.
  const checkoutToastTimerRef = useRef<number | null>(null);

  function goToCheckout(url: string, preopened?: Window | null) {
    // Exactly ONE navigation per call. Caller MUST set
    // isRedirectingRef before invoking so duplicate sessions can't
    // ride alongside.
    if (preopened && !preopened.closed) {
      try {
        preopened.location.href = url;
      } catch {
        try { preopened.close(); } catch { /* ignore */ }
        try {
          if (window.top && window.top !== window.self) {
            window.top.location.href = url;
          } else {
            window.location.href = url;
          }
        } catch {
          window.location.href = url;
        }
      }
    } else {
      try {
        if (window.top && window.top !== window.self) {
          window.top.location.href = url;
        } else {
          window.location.href = url;
        }
      } catch {
        window.location.href = url;
      }
    }

    // Safety-net fallback toast in case the navigation is silently
    // blocked (popup blockers in some in-app webviews). Cancellable from
    // outside — once the browser actually starts navigating away (the
    // page hides via visibilitychange OR pagehide) we clear the timer
    // so it doesn't pop in during unload.
    if (checkoutToastTimerRef.current) {
      window.clearTimeout(checkoutToastTimerRef.current);
    }
    checkoutToastTimerRef.current = window.setTimeout(() => {
      checkoutToastTimerRef.current = null;
      // If the document is already hidden, we ARE mid-redirect. Skip
      // the toast — by the time the user gets back the toast is stale.
      if (document.visibilityState !== 'visible') return;
      toast.message('Continue to secure checkout', {
        description: 'If Stripe did not open automatically, tap below.',
        duration: 30000,
        action: {
          label: 'Open Stripe',
          onClick: () => {
            window.open(url, '_blank', 'noopener,noreferrer') ??
              (window.location.href = url);
          },
        },
      });
    }, 2500);
  }


  async function startSubscriptionCheckout(planId: Tier['id']) {
    // Idempotency guard — bail on every re-entry until the page
    // navigates away. Prevents the duplicate-session bug seen in
    // edge-function logs (multiple sessions per click from rapid
    // double-taps / re-renders firing the handler before busy state
    // painted). pageshow listener resets it on bfcache restore.
    if (isRedirectingRef.current || checkoutBusy) return;
    isRedirectingRef.current = true;

    // Open the blank tab synchronously (still inside the user gesture)
    // ONLY after the guard passes — so rapid clicks can't each pop a
    // blank tab before busy state lands.
    const preopened = preopenCheckoutTab();

    // Persist the choice in BOTH places:
    //   - sessionStorage for the Stripe cancel_url round-trip
    //   - URL params so a full refresh during checkout (or a deep
    //     link share) still restores the same tier highlight.
    try {
      sessionStorage.setItem(
        'tw_pending_plan',
        JSON.stringify({ plan: planId, interval: billingInterval }),
      );
    } catch {
      // sessionStorage unavailable — silent no-op.
    }
    const next = new URLSearchParams(searchParams);
    next.set('plan', planId);
    next.set('interval', billingInterval);
    setSearchParams(next, { replace: true });

    // Checkout-first flow: every click goes straight to Stripe. The
    // webhook creates the account from session.customer_details.email
    // after payment. No more signup detour, no more loop.
    setCheckoutBusy(planId);
    // Hard timeout — if the edge function or redirect never resolves
    // within 20s, surface an error instead of leaving the button
    // spinning forever (the bug the user reported on Basic).
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
      console.log('[pricing] starting checkout', { plan: planId, interval: billingInterval });
      const { data, error } = await supabase.functions.invoke('create-subscription', {
        body: { plan: planId, interval: billingInterval },
      });
      // Was a hand-rolled copy of readEdgeFunctionError. Same behaviour, one
      // definition — and this one also drops supabase-js's generic wrapper
      // instead of surfacing "non-2xx status code" when the body has nothing.
      if (error) {
        if (await isAlreadyLifetimeError(error)) {
          window.clearTimeout(timeoutId);
          isRedirectingRef.current = false;
          setCheckoutBusy(null);
          toast.success(ALREADY_LIFETIME_MESSAGE);
          return;
        }
        throw new Error(await readEdgeFunctionError(error, 'Could not start checkout. Try again.'));
      }
      const payload = data as { url?: string; error?: string } | null;
      if (payload?.error) throw new Error(payload.error);
      const url = payload?.url;
      if (!url) throw new Error('Checkout URL missing — please try again.');
      goToCheckout(url, preopened);

      // Only release the spinner if we're still visible after the
      // redirect window. If the browser actually started navigating to
      // Stripe, the document hides — keeping the spinner on through
      // the unload feels correct (the page is leaving). Clearing it
      // mid-navigation made the button briefly flash back to "Start
      // Basic" while Stripe was loading, which contributed to the
      // glitch the user reported.
      window.setTimeout(() => {
        if (document.visibilityState === 'visible') {
          setCheckoutBusy((current) => (current === planId ? null : current));
        }
      }, 2000);
    } catch (err) {
      // Close the pre-opened tab so the user isn't left with a blank page.
      if (preopened && !preopened.closed) {
        try { preopened.close(); } catch { /* ignore */ }
      }
      console.error('[pricing] create-subscription failed', err);
      toast.error(
        err instanceof Error ? err.message : 'Could not start checkout. Try again.',
      );
      setCheckoutBusy(null);
      isRedirectingRef.current = false;
    } finally {
      window.clearTimeout(timeoutId);
    }
  }


  // Auto-resume after the cancel_url round-trip. If the user clicks a
  // plan, lands on Stripe, then clicks cancel and returns to /pricing,
  // they still have ?plan=…&interval=… in the URL and a sessionStorage
  // marker. We could fire checkout immediately on return, but that
  // would feel pushy after they explicitly cancelled — instead we keep
  // the tier highlighted (via the existing effect) so a one-click
  // retry is right there. No auto-resume.

  async function startLifetimeCheckout() {
    if (isRedirectingRef.current || checkoutBusy) return;
    isRedirectingRef.current = true;

    const preopened = preopenCheckoutTab();
    setCheckoutBusy('lifetime');
    try {
      const { data, error } = await supabase.functions.invoke('buy-lifetime', {
        body: {},
      });
      // buy-lifetime returns real reasons — sold out, already subscribed,
      // price not configured. Throwing the raw error showed "non-2xx status
      // code" instead of any of them.
      if (error) throw new Error(await readEdgeFunctionError(error, 'Could not start the lifetime checkout. Try again.'));
      const payload = data as { url?: string; error?: string } | null;
      if (payload?.error) throw new Error(payload.error);
      const url = payload?.url;
      if (!url) throw new Error('Checkout URL missing');
      goToCheckout(url, preopened);
      window.setTimeout(() => {
        if (document.visibilityState === 'visible') {
          setCheckoutBusy((current) => (current === 'lifetime' ? null : current));
        }
      }, 2000);
    } catch (err) {
      if (preopened && !preopened.closed) {
        try { preopened.close(); } catch { /* ignore */ }
      }
      const message = err instanceof Error ? err.message : '';
      // A 409 "you already have lifetime access" is not a failure — it is the
      // correct answer for someone who already bought. Treating it as an error
      // left them staring at a blank pre-opened tab and a red toast, so send
      // them to the dashboard with a neutral message instead.
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
          <p className="mt-4 inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-4 py-1.5 text-sm font-medium text-primary">
            <Sparkles aria-hidden="true" className="h-3.5 w-3.5" />
            Start with a 14-day free trial — card required, cancel anytime.
          </p>

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
          <div
            role="list"
            aria-label="Subscription plans"
            className="grid grid-cols-1 md:grid-cols-3 gap-6"
          >
            {TIERS.map((tier) => {
              const price = priceFor(tier, billingInterval);
              const isBusy = checkoutBusy === tier.id;
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
                    14 days free, then {price.display}{price.sub}
                  </p>

                  <Button
                    onClick={() => startSubscriptionCheckout(tier.id)}
                    disabled={isBusy}
                    variant={tier.highlight ? 'default' : 'outline'}
                    size="lg"
                    className="w-full mb-2"
                    aria-label={`Start 14-day free trial of ${tier.name} plan, ${billingInterval === 'yearly' ? 'billed yearly after trial' : 'billed monthly after trial'}`}
                    aria-busy={isBusy}
                  >
                    {isBusy ? (
                      <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
                    ) : (
                      `Start 14-day free trial`
                    )}
                  </Button>
                  <p className="text-[11px] text-muted-foreground text-center mb-6">
                    Card required. Cancel anytime before day 14 and you won't be charged.
                  </p>

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
              Founding offer · 100 spots only
            </Badge>

            <h2 className="pv-display text-4xl md:text-5xl mb-3">
              Pay once. Use TidyWise forever.
            </h2>
            <p className="text-lg text-muted-foreground max-w-2xl mb-8">
              One $300 payment locks in lifetime access to every Pro feature — including
              everything we ship in the future. No recurring bill, ever. Only 100 spots
              at launch.
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
                        {spotsLeft} of {lifetime.total}
                      </span>{' '}
                      spots remaining
                    </p>
                  )}
                  {!lifetime.loading && !lifetime.soldOut && (
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
                {[
                  'Every Pro feature, forever',
                  'All future features included free',
                  'No recurring bill — ever',
                  'Excludes the Custom plan done-for-you requests',
                ].map((f) => (
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
                a: 'Every plan starts with a 14-day free trial. A card is required up front, but you are not charged until the trial ends — cancel before then and you pay nothing. Cancel later and you keep access until the end of the month you paid for.',
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
