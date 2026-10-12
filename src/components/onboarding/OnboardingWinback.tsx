import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { parseOnboardingDraft, type OnboardingDraft } from '@/lib/onboardingDraft';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { toast } from 'sonner';

const IDLE_MS = 60_000;

interface OnboardingWinbackProps {
  active: boolean;
  /** True after the local draft restore has run, so we do not overwrite it. */
  readyToSync: boolean;
  organizationId: string | null;
  draft: OnboardingDraft;
  hasLocalDraft: boolean;
  onRestore: (draft: OnboardingDraft) => void;
}

function offerNote(offer: string | null | undefined): string | null {
  if (offer === 'trial_30') return 'Finish these steps and your free trial is 30 days instead of 14.';
  if (offer === 'half_off_first_month') return '50% off your first month is saved. It applies when you pick a plan.';
  if (offer === 'first_month_free') return 'Your first month free is saved. It applies when you pick a plan.';
  return null;
}

/**
 * Exit, back, and idle offer while setup is unfinished, plus the email
 * resume link. The row and the coupons live in the onboarding-winback
 * function. This component only asks.
 */
export function OnboardingWinback({
  active,
  readyToSync,
  organizationId,
  draft,
  hasLocalDraft,
  onRestore,
}: OnboardingWinbackProps) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [synced, setSynced] = useState(false);
  const shown = useRef(false);
  const dismissed = useRef(false);
  const discountClaimed = useRef(false);
  const ready = useRef(false);

  const show = useCallback(() => {
    if (!active || !ready.current || shown.current || dismissed.current || discountClaimed.current) return;
    shown.current = true;
    setOpen(true);
    void supabase.functions.invoke('onboarding-winback', { body: { action: 'modal_shown' } });
  }, [active]);

  useEffect(() => {
    if (!active || !readyToSync) return;
    let cancelled = false;
    const params = new URLSearchParams(window.location.search);
    const token = params.get('winback');
    const offer = params.get('offer');

    (async () => {
      const { data, error } = token
        ? await supabase.functions.invoke('onboarding-winback', {
            body: { action: 'claim_link', token, offer },
          })
        : await supabase.functions.invoke('onboarding-winback', {
            body: {
              action: 'sync',
              step: draft.step,
              draft,
              hasLocalDraft,
              organizationId,
            },
          });
      if (cancelled) return;
      if (error) {
        console.error('[onboarding-winback] start failed', error);
        ready.current = true;
        setSynced(true);
        return;
      }
      const payload = data as {
        skipped?: boolean;
        offer_used?: string | null;
        modal_shown?: boolean;
        draft?: OnboardingDraft | null;
        step?: number;
        trial_30_accepted?: boolean;
      } | null;
      if (payload?.skipped) {
        dismissed.current = true;
        return;
      }
      if (payload?.modal_shown) shown.current = true;
      const used = payload?.offer_used ?? (payload?.trial_30_accepted ? 'trial_30' : null);
      if (used === 'half_off_first_month' || used === 'first_month_free') {
        discountClaimed.current = true;
      }
      setNote(offerNote(used));
      const parsed = parseOnboardingDraft({
        ...(payload?.draft && typeof payload.draft === 'object' ? payload.draft : {}),
        step: payload?.step,
      });
      if (parsed && !hasLocalDraft) onRestore(parsed);
      if (token && used && used !== 'trial_30') {
        toast.success(offerNote(used) ?? 'Offer saved.');
      }
      ready.current = true;
      setSynced(true);
    })();

    return () => {
      cancelled = true;
    };
    // Once the local draft has been restored. Later edits are saved below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, readyToSync]);

  useEffect(() => {
    if (!active || !synced) return;
    const handle = window.setTimeout(() => {
      void supabase.functions.invoke('onboarding-winback', {
        body: {
          action: 'sync',
          step: draft.step,
          draft,
          hasLocalDraft: true,
          organizationId,
        },
      });
    }, 1500);
    return () => window.clearTimeout(handle);
  }, [active, draft, organizationId, synced]);

  useEffect(() => {
    if (!active || !synced) return;

    const onMouseOut = (event: MouseEvent) => {
      if (event.clientY <= 8 && event.relatedTarget == null) show();
    };
    document.addEventListener('mouseout', onMouseOut);

    let idle = window.setTimeout(show, IDLE_MS);
    const bump = () => {
      window.clearTimeout(idle);
      idle = window.setTimeout(show, IDLE_MS);
    };
    window.addEventListener('pointerdown', bump);
    window.addEventListener('keydown', bump);

    const guard = { twOnboardingGuard: 1 };
    window.history.pushState(guard, '');
    const onPop = () => {
      if (dismissed.current || discountClaimed.current || shown.current) return;
      window.history.pushState(guard, '');
      show();
    };
    window.addEventListener('popstate', onPop);

    return () => {
      document.removeEventListener('mouseout', onMouseOut);
      window.removeEventListener('pointerdown', bump);
      window.removeEventListener('keydown', bump);
      window.removeEventListener('popstate', onPop);
      window.clearTimeout(idle);
    };
  }, [active, show, synced]);

  const accept = async () => {
    setOpen(false);
    dismissed.current = true;
    const { error } = await supabase.functions.invoke('onboarding-winback', {
      body: { action: 'accept_trial_30' },
    });
    if (error) {
      toast.error('Could not save the 30-day trial. You can keep setting up on the 14-day trial.');
      return;
    }
    setNote(offerNote('trial_30'));
    toast.success('Finish setup and your trial is 30 days.');
  };

  const decline = () => {
    setOpen(false);
    dismissed.current = true;
  };

  return (
    <>
      {note && (
        <p className="text-sm text-primary text-center">{note}</p>
      )}
      <Dialog open={open} onOpenChange={(next) => { if (!next) decline(); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Finish setup and get 30 days free</DialogTitle>
            <DialogDescription>
              Your trial is 14 days, with no card. Finish setup now and we will make it 30 days instead.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" className="min-h-[44px]" onClick={decline}>
              No thanks
            </Button>
            <Button type="button" variant="premium" className="min-h-[44px]" onClick={() => void accept()}>
              Finish setup — 30 days free
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
