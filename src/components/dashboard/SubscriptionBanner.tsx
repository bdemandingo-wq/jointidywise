/**
 * Active-subscription banner shown at the top of the dashboard.
 *
 * Renders three distinct states with screen-reader-friendly messaging:
 *   - "active"    — paid subscription is in good standing
 *   - "trialing"  — inside the org Pro trial (or Stripe trialing)
 *   - "canceled"  — subscription ended (or scheduled to end); access lost
 *
 * Plan + interval are persisted to localStorage by the CheckoutSuccessPage
 * right after the Stripe redirect, so the banner updates immediately after
 * the invoice webhook completes without waiting for a full page refresh.
 *
 * Accessibility:
 *   - Wrapped in `role="status"` + `aria-live="polite"` so screen readers
 *     announce the current state + relevant dates (trial end / next bill /
 *     access-ends-on) the moment the subscription state flips.
 *   - "Download receipt" and "Resend receipt" are real <button>s with
 *     accessible names that include plan + interval + date context.
 */

import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { AlertCircle, CheckCircle2, Clock, Download, Mail, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

const PLAN_LABELS: Record<string, string> = {
  basic: 'Basic',
  pro: 'Pro',
  custom: 'Custom',
  lifetime: 'Lifetime',
};

interface ActivePlanMeta {
  plan?: string;
  interval?: 'monthly' | 'yearly' | string;
}

function readActivePlanMeta(): ActivePlanMeta {
  try {
    const raw = localStorage.getItem('tw_active_plan');
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return {
      plan: typeof parsed?.plan === 'string' ? parsed.plan : undefined,
      interval: typeof parsed?.interval === 'string' ? parsed.interval : undefined,
    };
  } catch {
    return {};
  }
}

function formatDate(iso?: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  /* eslint-disable-next-line local/no-device-local-dates -- viewer-local display of a stored instant, not a business-day boundary */
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
}

type BannerState = 'active' | 'trialing' | 'canceled';

export function SubscriptionBanner() {
  const { subscription, user } = useAuth();
  // localStorage value is set by the /checkout/success page only.
  // Reading it once on mount is sufficient — it doesn't change between
  // renders. Previous code re-read + re-parsed JSON on every
  // subscription state change for no benefit.
  const [meta] = useState<ActivePlanMeta>(() => readActivePlanMeta());
  const [resending, setResending] = useState(false);

  const nextBillingDate = formatDate(subscription?.subscription_end);
  const trialEndDate = formatDate(subscription?.trial_end);
  const planLabel = meta.plan ? PLAN_LABELS[meta.plan] ?? null : null;
  const intervalLabel =
    meta.interval === 'yearly' ? 'Yearly' : meta.interval === 'monthly' ? 'Monthly' : null;

  // Derive banner state.
  //  - trialing: trial_active=true (org trial or Stripe trial)
  //  - canceled: not subscribed + we have a previously-known subscription_end
  //              (i.e. they used to have access), OR payment_failed flag
  //  - active:   subscribed and not in a trial
  const state: BannerState | null = useMemo(() => {
    if (subscription?.trial_active) return 'trialing';
    if (subscription?.subscribed) return 'active';
    if (subscription && (subscription.subscription_end || subscription.payment_failed)) {
      return 'canceled';
    }
    return null;
  }, [subscription]);

  const srAnnouncement = useMemo(() => {
    if (!state) return '';
    const planPhrase = planLabel
      ? `${planLabel}${intervalLabel ? ` (${intervalLabel})` : ''}`
      : 'subscription';
    if (state === 'active') {
      return `Your ${planPhrase} plan is active.${nextBillingDate ? ` Next billing date: ${nextBillingDate}.` : ''}`;
    }
    if (state === 'trialing') {
      return `You are on a trial of the ${planPhrase} plan.${trialEndDate ? ` Trial ends on ${trialEndDate}.` : ''}`;
    }
    // canceled
    return `Your ${planPhrase} plan has been canceled.${
      nextBillingDate ? ` Access ends on ${nextBillingDate}.` : ''
    } Resubscribe to keep access.`;
  }, [state, planLabel, intervalLabel, nextBillingDate, trialEndDate]);

  if (!state) return null;

  const handleDownloadReceipt = async () => {
    try {
      const { jsPDF } = await import('jspdf');
      const doc = new jsPDF({ unit: 'pt', format: 'letter' });
      const left = 56;
      let y = 80;

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(20);
      doc.text('TidyWise — Subscription Receipt', left, y);

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(11);
      y += 28;
      /* eslint-disable-next-line local/no-device-local-dates -- viewer-local display of a stored instant, not a business-day boundary */
      doc.text(`Issued: ${new Date().toLocaleDateString()}`, left, y);

      y += 32;
      doc.setFont('helvetica', 'bold');
      doc.text('Account', left, y);
      doc.setFont('helvetica', 'normal');
      y += 16;
      doc.text(`Email: ${user?.email ?? 'N/A'}`, left, y);

      y += 32;
      doc.setFont('helvetica', 'bold');
      doc.text('Subscription', left, y);
      doc.setFont('helvetica', 'normal');
      y += 16;
      doc.text(`Plan: ${planLabel ?? 'Active subscription'}`, left, y);
      y += 16;
      doc.text(`Billing interval: ${intervalLabel ?? 'Recurring'}`, left, y);
      y += 16;
      if (state === 'trialing') {
        doc.text(`Trial ends: ${trialEndDate ?? 'N/A'}`, left, y);
      } else {
        doc.text(
          `Next billing date: ${nextBillingDate ?? 'See your inbox for confirmation'}`,
          left,
          y,
        );
      }

      y += 40;
      doc.setFontSize(10);
      doc.setTextColor(120);
      doc.text(
        'This is a summary receipt. Your official tax invoice is emailed from Stripe.',
        left,
        y,
      );

      /* eslint-disable-next-line local/no-device-local-dates -- names an export file with the downloader's own day; no org context here and nothing downstream reads it */
      const filename = `tidywise-receipt-${new Date().toISOString().slice(0, 10)}.pdf`;
      doc.save(filename);
    } catch (err) {
      console.error('Failed to generate receipt PDF', err);
      toast.error('Could not generate receipt. Please try again.');
    }
  };

  const handleResendReceipt = async () => {
    setResending(true);
    try {
      const { data, error } = await supabase.functions.invoke(
        'resend-subscription-receipt',
        { body: {} },
      );
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      toast.success(`Receipt re-sent to ${user?.email ?? 'your email'}.`);
    } catch (err: any) {
      console.error('Resend receipt failed', err);
      toast.error(err?.message ?? 'Could not resend receipt. Please try again.');
    } finally {
      setResending(false);
    }
  };

  // ---- Per-state visual config ----
  const config = {
    active: {
      Icon: CheckCircle2,
      tone: 'border-primary/20 bg-primary/5',
      iconWrap: 'bg-primary/10 text-primary',
      title: planLabel ? `${planLabel} plan active` : 'Subscription active',
      subtitle: nextBillingDate
        ? `Next billing date: ${nextBillingDate}`
        : 'Your subscription is active.',
    },
    trialing: {
      Icon: Clock,
      tone: 'border-warning/30 bg-warning/5',
      iconWrap: 'bg-warning/10 text-warning',
      title: planLabel ? `${planLabel} plan — trial` : 'Trial active',
      subtitle: trialEndDate
        ? `Trial ends on ${trialEndDate}`
        : 'You are currently on a trial.',
    },
    canceled: {
      Icon: AlertCircle,
      tone: 'border-destructive/30 bg-destructive/5',
      iconWrap: 'bg-destructive/10 text-destructive',
      title: planLabel ? `${planLabel} plan canceled` : 'Subscription canceled',
      subtitle: nextBillingDate
        ? `Access ends on ${nextBillingDate}`
        : 'Your subscription has ended.',
    },
  }[state];

  const Icon = config.Icon;

  const receiptCtx = `${planLabel ?? 'your'} plan${
    intervalLabel ? `, billed ${intervalLabel.toLowerCase()}` : ''
  }${nextBillingDate ? `, next billing ${nextBillingDate}` : ''}`;

  return (
    <section
      data-testid="subscription-banner"
      data-state={state}
      role="status"
      aria-live="polite"
      aria-atomic="true"
      className={`mb-6 rounded-xl border p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center gap-4 ${config.tone}`}
    >
      <div className="flex items-start gap-3 flex-1">
        <div
          aria-hidden="true"
          className={`h-10 w-10 rounded-full flex items-center justify-center shrink-0 ${config.iconWrap}`}
        >
          <Icon className="h-5 w-5" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-medium text-foreground">
            {config.title}
            {intervalLabel && state !== 'canceled' ? ` · ${intervalLabel}` : ''}
          </p>
          <p className="text-sm text-muted-foreground">{config.subtitle}</p>
          {/* Hidden single-shot announcement that includes every relevant
              date so a screen reader narrates the full state when the
              subscription changes (active → canceled, trialing → active, …). */}
          <span className="sr-only" data-testid="subscription-banner-sr">
            {srAnnouncement}
          </span>
        </div>
      </div>
      <div className="flex flex-wrap gap-2 sm:justify-end">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handleDownloadReceipt}
          aria-label={`Download receipt for ${receiptCtx}`}
          data-testid="download-receipt"
          className="focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
        >
          <Download aria-hidden="true" className="h-4 w-4 mr-2" />
          Download receipt
        </Button>
        {state !== 'trialing' && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleResendReceipt}
            disabled={resending}
            aria-label={`Resend receipt email for ${receiptCtx}`}
            data-testid="resend-receipt"
            className="focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
          >
            {resending ? (
              <Loader2 aria-hidden="true" className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Mail aria-hidden="true" className="h-4 w-4 mr-2" />
            )}
            {resending ? 'Sending…' : 'Resend receipt'}
          </Button>
        )}
      </div>
    </section>
  );
}

export default SubscriptionBanner;
