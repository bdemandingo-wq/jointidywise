import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { usePlatform } from '@/hooks/usePlatform';
import { trialDaysLeft } from '@/lib/trialClock';

/**
 * Days left on the trial check-subscription already granted. The banner
 * does not decide access — AdminRoute does, and it sends an ended trial
 * to /choose-plan. Stripe trials (a card already on file) keep their own
 * wording so this does not tell them they still need a card.
 */
export function TrialDaysBanner() {
  const { subscription, subscriptionCheck } = useAuth();
  const { canShowPaymentFlows } = usePlatform();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();

  if (subscriptionCheck !== 'ready' || !subscription?.trial_active) return null;
  const days = trialDaysLeft(subscription.trial_end);
  if (days === null) return null;

  const orgTrial = subscription.product_id === 'org_trial';
  const urgent = days <= 4;
  const dayLabel = days === 1 ? '1 day left' : `${days} days left`;
  const onSettings = location.pathname === '/dashboard/settings';

  return (
    <div
      role="status"
      className={`mb-4 flex flex-col gap-2 rounded-lg border px-3 py-3 sm:flex-row sm:items-center sm:justify-between ${
        urgent
          ? 'border-amber-500/50 bg-amber-500/10'
          : 'border-primary/30 bg-primary/5'
      }`}
    >
      <p className="text-sm">
        <span className="font-medium">{dayLabel}</span>
        {' '}
        in your free trial.
        {orgTrial
          ? ' Full Pro access. No card is on file. When the trial ends, the dashboard locks until you pick a plan.'
          : ' Your current trial billing is unchanged.'}
      </p>
      {onSettings ? (
        <button
          type="button"
          className="inline-flex min-h-[44px] shrink-0 items-center text-sm font-medium text-primary underline-offset-2 hover:underline"
          onClick={() => {
            const next = new URLSearchParams(searchParams);
            next.set('tab', 'subscription');
            setSearchParams(next);
          }}
        >
          {orgTrial && canShowPaymentFlows ? 'Pick a plan' : 'View subscription'}
        </button>
      ) : (
        <Link
          to="/dashboard/settings?tab=subscription"
          className="inline-flex min-h-[44px] shrink-0 items-center text-sm font-medium text-primary underline-offset-2 hover:underline"
        >
          {orgTrial && canShowPaymentFlows ? 'Pick a plan' : 'View subscription'}
        </Link>
      )}
    </div>
  );
}
