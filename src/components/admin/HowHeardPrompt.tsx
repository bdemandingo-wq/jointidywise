import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { toast } from 'sonner';
import { HowHeardChoices } from '@/components/onboarding/HowHeardChoices';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useAuth } from '@/hooks/useAuth';
import { isDemoAccount } from '@/hooks/useSubscription';
import { useOrganization } from '@/contexts/OrganizationContext';
import { supabase } from '@/lib/supabase';
import { isHowHeardComplete, shouldAskHowHeard } from '@/lib/onboardingAnswers';
import { readHowHeardSeen, writeHowHeardSeen } from '@/lib/onboardingDraft';

/**
 * One-time question for an org owner who never named a source.
 * Staff routes, the customer portal, and demo/Apple-review accounts never see it.
 * Not sure records that we asked and leaves howHeard empty.
 */
export function HowHeardPrompt() {
  const { user } = useAuth();
  const { organization, isOwner } = useOrganization();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');
  const [other, setOther] = useState('');
  const [saving, setSaving] = useState(false);
  const decided = useRef(false);

  const blockedPath = location.pathname.startsWith('/portal') || location.pathname.startsWith('/staff');
  const eligible = Boolean(
    user
    && organization
    && isOwner
    && organization.owner_id === user.id
    && !isDemoAccount(user.email)
    && !blockedPath,
  );

  useEffect(() => {
    if (!eligible || !user || !organization) return;
    if (readHowHeardSeen(window.localStorage, user.id, organization.id)) return;
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from('organizations')
        .select('onboarding_answers')
        .eq('id', organization.id)
        .maybeSingle();
      if (cancelled) return;
      if (error) {
        console.error('[how-heard] lookup failed', error.message);
        return;
      }
      if (shouldAskHowHeard(data?.onboarding_answers)) setOpen(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [eligible, user, organization]);

  const remember = () => {
    if (!user || !organization) return;
    writeHowHeardSeen(window.localStorage, user.id, organization.id);
  };

  const save = async (nextValue: string, nextOther: string) => {
    if (decided.current || saving) return;
    if (nextValue !== 'not_sure' && !isHowHeardComplete(nextValue, nextOther)) return;
    setSaving(true);
    const { error } = await supabase.rpc('save_how_heard', {
      p_value: nextValue,
      p_other: nextValue === 'other' ? nextOther.trim() : undefined,
    });
    setSaving(false);
    if (error) {
      console.error('[how-heard] save failed', error.message);
      toast.error('Could not save that. Try again.');
      return;
    }
    decided.current = true;
    remember();
    setOpen(false);
  };

  const dismiss = () => {
    if (saving || decided.current) {
      if (decided.current) setOpen(false);
      return;
    }
    decided.current = true;
    remember();
    setOpen(false);
    void supabase.rpc('save_how_heard', { p_value: 'not_sure' }).then(({ error }) => {
      if (error) console.error('[how-heard] not sure save failed', error.message);
    });
  };

  if (!eligible) return null;

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) dismiss(); }}>
      <DialogContent
        className="max-w-md"
        onPointerDownOutside={(event) => event.preventDefault()}
        onInteractOutside={(event) => event.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>How did you hear about us?</DialogTitle>
          <DialogDescription>
            One tap is enough. It tells us which posts are actually bringing owners in.
          </DialogDescription>
        </DialogHeader>
        <HowHeardChoices
          value={value}
          other={other}
          disabled={saving}
          showLabel={false}
          onChange={(next, nextOther) => {
            setValue(next);
            setOther(nextOther);
            if (next !== 'other') void save(next, '');
          }}
        />
        {value === 'other' && (
          <Button
            type="button"
            disabled={saving || !isHowHeardComplete(value, other)}
            onClick={() => void save(value, other)}
          >
            Save
          </Button>
        )}
        <Button type="button" variant="ghost" disabled={saving} onClick={() => void save('not_sure', '')}>
          Not sure
        </Button>
      </DialogContent>
    </Dialog>
  );
}
