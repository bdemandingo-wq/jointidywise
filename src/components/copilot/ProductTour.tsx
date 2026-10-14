import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Joyride, {
  ACTIONS,
  CallBackProps,
  EVENTS,
  STATUS,
  Step,
} from 'react-joyride';
import { useLocation } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { useOrgId } from '@/hooks/useOrgId';
import { setProductTourActive } from '@/lib/productTourGate';

// Short tour on the dashboard only. It used to navigate Help → Settings tabs
// on every Next, and the Joyride overlay kept capturing clicks when the
// tooltip had nothing visible to anchor to. Steps stay on /dashboard, and
// there is no full-screen overlay.
//
// Eligibility (computed against onboarding_progress):
//   activated_at IS NULL AND tour_completed_at IS NULL AND tour_skipped_at IS NULL
// All existing orgs at migration time were backfilled with tour_skipped_at,
// so only post-migration signups are eligible.

const STEPS: Step[] = [
  {
    target: '[data-tour-id="today-stats"]',
    title: 'Today at a glance',
    content:
      'Today’s jobs, payments, and new customers show up here. You can leave this tour any time — it will not move you to another page.',
    disableBeacon: true,
    placement: 'auto',
    spotlightClicks: true,
  },
  {
    target: '[data-tour-id="sidebar-nav"]',
    title: 'The menu is grouped',
    content:
      'Open a section to find bookings, customers, money, and the rest. Settings and Help stay pinned at the top.',
    disableBeacon: true,
    placement: 'right',
    spotlightClicks: true,
  },
  {
    target: '[data-tour-id="tidy-bubble"]',
    title: 'Need help? Just ask Tidy',
    content:
      "Click this bubble anytime to chat with Tidy, your AI co-pilot. You're all set.",
    disableBeacon: true,
    placement: 'left',
    spotlightClicks: true,
  },
];

const TARGET_WAIT_MS = 100;
const TARGET_WAIT_MAX_ATTEMPTS = 20;

const TOUR_LOCK_PROPS = [
  'overflow',
  'position',
  'top',
  'left',
  'right',
  'width',
  'height',
  'paddingRight',
  'paddingTop',
  'marginTop',
  'transform',
] as const;

/** Joyride writes scroll-lock styles and a portal. Unmounting it on Finish
 *  leaves those behind: a dark strip, a missing header, and a ~20px shift. */
function releaseTourLock() {
  if (typeof document === 'undefined') return;
  const root = document.getElementById('root');
  for (const el of [document.documentElement, document.body, root]) {
    if (!el) continue;
    for (const prop of TOUR_LOCK_PROPS) {
      el.style[prop] = '';
    }
  }
  document
    .querySelectorAll(
      '#react-joyride-portal, .react-joyride__overlay, .react-joyride__spotlight',
    )
    .forEach((node) => node.remove());
}

function useNarrowViewport() {
  const query = '(max-width: 767px)';
  const [matches, setMatches] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(query).matches,
  );
  useEffect(() => {
    const media = window.matchMedia(query);
    const update = () => setMatches(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  return matches;
}

export function ProductTour() {
  const { user } = useAuth();
  const { organizationId } = useOrgId();
  const location = useLocation();
  const narrow = useNarrowViewport();
  // The desktop sidebar is display:none on a phone but still in the DOM.
  // Anchoring the tour there floats a tooltip over a hidden menu.
  const steps = useMemo<Step[]>(() => {
    const menu = narrow
      ? {
          ...STEPS[1],
          target: '[data-tour-id="mobile-nav-toggle"]',
          placement: 'bottom' as const,
          content:
            'Tap the menu. Bookings, customers, money, and the rest are grouped inside it. Settings and Help stay pinned at the top.',
        }
      : STEPS[1];
    return [STEPS[0], menu, STEPS[2]];
  }, [narrow]);

  const [eligible, setEligible] = useState(false);
  const [run, setRun] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  // Refs prevent infinite useEffect loops when we're inside the joyride callback.
  const eligibilityCheckedFor = useRef<string | null>(null);
  const tourStartedLogged = useRef(false);

  // ── Eligibility check ──────────────────────────────────────────────────
  useEffect(() => {
    if (!user?.id || !organizationId) return;
    const key = `${user.id}:${organizationId}`;
    if (eligibilityCheckedFor.current === key) return;
    eligibilityCheckedFor.current = key;

    let cancelled = false;
    (async () => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const db = supabase as any;
        const { data, error } = await db
          .from('onboarding_progress')
          .select('activated_at, tour_completed_at, tour_skipped_at, tour_current_step')
          .eq('organization_id', organizationId)
          .maybeSingle();
        if (cancelled) return;
        if (error) {
          console.warn('[ProductTour] Eligibility check failed:', error);
          return;
        }
        const blocked =
          !!data?.activated_at ||
          !!data?.tour_completed_at ||
          !!data?.tour_skipped_at;
        if (blocked) return;

        const startStep = Number(data?.tour_current_step ?? 0);
        setStepIndex(Math.max(0, Math.min(startStep, steps.length - 1)));
        setEligible(true);
      } catch (err) {
        console.warn('[ProductTour] Eligibility check threw:', err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.id, organizationId, steps.length]);

  // ── Step navigator ─────────────────────────────────────────────────────
  // Only on the dashboard itself. Never calls navigate — a missing target
  // skips that step instead of covering the page with an overlay.
  useEffect(() => {
    if (!eligible) return;
    if (location.pathname !== '/dashboard') {
      setRun(false);
      return;
    }
    const step = steps[stepIndex];
    if (!step) return;

    let attempts = 0;
    const interval = setInterval(() => {
      attempts++;
      const el = typeof step.target === 'string'
        ? document.querySelector(step.target)
        : step.target;
      if (el) {
        clearInterval(interval);
        setRun(true);
        if (!tourStartedLogged.current) {
          tourStartedLogged.current = true;
          void logEvent('tour_started', stepIndex);
        }
        return;
      }
      if (attempts < TARGET_WAIT_MAX_ATTEMPTS) return;
      clearInterval(interval);
      setRun(false);
      if (stepIndex >= steps.length - 1) {
        setEligible(false);
        void markSkipped();
        void logEvent('tour_skipped', stepIndex, { reason: 'target_not_found' });
        return;
      }
      setStepIndex(stepIndex + 1);
    }, TARGET_WAIT_MS);

    return () => clearInterval(interval);
    // markSkipped and logEvent are stable callbacks defined below; the effect
    // only needs to restart when the step or the route changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eligible, stepIndex, location.pathname, steps]);

  // ── Persistence helpers ────────────────────────────────────────────────
  const saveStep = useCallback(
    async (next: number) => {
      if (!organizationId) return;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const db = supabase as any;
      await db
        .from('onboarding_progress')
        .upsert(
          { organization_id: organizationId, tour_current_step: next },
          { onConflict: 'organization_id' },
        );
    },
    [organizationId],
  );

  const markCompleted = useCallback(async () => {
    if (!organizationId) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabase as any;
    await db
      .from('onboarding_progress')
      .upsert(
        {
          organization_id: organizationId,
          tour_completed_at: new Date().toISOString(),
        },
        { onConflict: 'organization_id' },
      );
  }, [organizationId]);

  const markSkipped = useCallback(async () => {
    if (!organizationId) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabase as any;
    await db
      .from('onboarding_progress')
      .upsert(
        {
          organization_id: organizationId,
          tour_skipped_at: new Date().toISOString(),
        },
        { onConflict: 'organization_id' },
      );
  }, [organizationId]);

  const logEvent = useCallback(
    async (
      eventType: 'tour_started' | 'step_viewed' | 'tour_completed' | 'tour_skipped',
      step: number | null,
      metadata: Record<string, unknown> = {},
    ) => {
      if (!user?.id || !organizationId) return;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const db = supabase as any;
      try {
        await db.from('product_tour_events').insert({
          organization_id: organizationId,
          user_id: user.id,
          event_type: eventType,
          step_number: step,
          metadata,
        });
      } catch (err) {
        // Analytics failures are non-fatal.
        console.warn('[ProductTour] logEvent failed:', err);
      }
    },
    [user?.id, organizationId],
  );

  // ── Joyride callback ───────────────────────────────────────────────────
  const handleCallback = useCallback(
    async (data: CallBackProps) => {
      const { action, index, status, type } = data;

      // Step transitions — happen on STEP_AFTER for prev/next/skip.
      if (type === EVENTS.STEP_AFTER) {
        if (action === ACTIONS.NEXT) {
          const next = index + 1;
          if (next >= steps.length) {
            releaseTourLock();
            setRun(false);
            setEligible(false);
            await Promise.all([
              markCompleted(),
              logEvent('tour_completed', index),
            ]);
            return;
          }
          setStepIndex(next);
          void saveStep(next);
          void logEvent('step_viewed', next);
          return;
        }
        if (action === ACTIONS.PREV) {
          const prev = Math.max(0, index - 1);
          setStepIndex(prev);
          void saveStep(prev);
          return;
        }
      }

      // Skip button. ACTIONS.CLOSE on the X button is also treated as skip
      // so users don't accidentally lose progress.
      if (action === ACTIONS.SKIP || action === ACTIONS.CLOSE || status === STATUS.SKIPPED) {
        releaseTourLock();
        setRun(false);
        setEligible(false);
        await Promise.all([
          markSkipped(),
          logEvent('tour_skipped', index, { skipped_on_step: index }),
        ]);
        return;
      }

      // Joyride finished (tour reached its last step naturally — usually
      // covered by the NEXT-overflow branch above, but kept as a safety net).
      if (status === STATUS.FINISHED) {
        releaseTourLock();
        setRun(false);
        setEligible(false);
        await Promise.all([
          markCompleted(),
          logEvent('tour_completed', index),
        ]);
        return;
      }

      // Target missing — log and let joyride fall back to center placement.
      if (type === EVENTS.TARGET_NOT_FOUND) {
        console.warn(`[ProductTour] Target not found for step ${index}: ${steps[index]?.target}`);
      }
    },
    [logEvent, markCompleted, markSkipped, saveStep, steps],
  );

  useEffect(() => {
    if (eligible) return;
    releaseTourLock();
    const soon = window.setTimeout(releaseTourLock, 50);
    return () => window.clearTimeout(soon);
  }, [eligible]);

  useEffect(() => {
    setProductTourActive(run);
    return () => setProductTourActive(false);
  }, [run]);

  useEffect(() => () => releaseTourLock(), []);

  if (!eligible) return null;

  return (
    <Joyride
      steps={steps}
      run={run}
      stepIndex={stepIndex}
      continuous
      showSkipButton
      showProgress
      disableOverlay
      disableScrollParentFix
      disableScrolling={false}
      spotlightClicks
      spotlightPadding={8}
      callback={handleCallback}
      floaterProps={{
        styles: {
          floater: {
            transition: 'opacity 200ms ease, transform 200ms ease',
          },
        },
      }}
      // z-index 1000 keeps the overlay BELOW the Tidy bubble (z-9999) so the
      // bubble stays visible & clickable mid-tour. Step 6 spotlights the
      // bubble — joyride's spotlight is a hole in the overlay rather than a
      // layer above it, so the bubble at z-9999 still shows correctly.
      styles={{
        options: {
          primaryColor: '#4f46e5',
          textColor: '#111827',
          backgroundColor: '#ffffff',
          arrowColor: '#ffffff',
          overlayColor: 'rgba(15, 15, 20, 0.55)',
          zIndex: 1000,
        },
        spotlight: {
          borderRadius: 12,
          boxShadow: '0 0 0 4px rgba(79, 70, 229, 0.25), 0 8px 32px rgba(0, 0, 0, 0.4)',
        },
        tooltip: {
          borderRadius: 12,
          borderTop: '3px solid #4f46e5',
          padding: 20,
        },
        tooltipTitle: {
          fontSize: 16,
          fontWeight: 600,
          color: '#111827',
        },
        tooltipContent: {
          fontSize: 14,
          color: '#4b5563',
          padding: '8px 0 0',
        },
        buttonNext: {
          backgroundColor: '#4f46e5',
          fontSize: 14,
          padding: '8px 16px',
          borderRadius: 8,
        },
        buttonBack: {
          color: '#4f46e5',
          fontSize: 14,
        },
        buttonSkip: {
          color: '#6b7280',
          fontSize: 13,
          textDecoration: 'underline',
        },
      }}
      locale={{
        back: '← Back',
        close: 'Close',
        last: 'Finish ✓',
        next: 'Next →',
        open: 'Open',
        skip: "Skip. I'll explore on my own",
      }}
    />
  );
}
