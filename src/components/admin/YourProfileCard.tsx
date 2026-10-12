import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { PERSON_NAME_MAX } from '@/lib/displayName';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, User } from 'lucide-react';
import { toast } from 'sonner';

/**
 * Lets a person set their own display name.
 *
 * There was no UI for this anywhere, which is why profiles.full_name sat blank
 * for months and was being corrected with hand-written SQL. handle_new_user
 * also stopped writing it between 2025-12-29 and 2026-07-31, so accounts
 * created in that window have nothing unless the July backfill recovered a
 * name from auth metadata.
 *
 * Own row only. profiles carries "Users can update own profile only" with both
 * USING and WITH CHECK on auth.uid() = id, so this needs no new policy and no
 * role gate — every role can edit exactly one row, their own.
 */
export function YourProfileCard() {
  const { user } = useAuth();
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  // One-shot, so the fetch cannot overwrite something already being typed.
  const prefilled = useRef(false);

  useEffect(() => {
    if (!user?.id || prefilled.current) return;
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('full_name')
        .eq('id', user.id)
        .maybeSingle();
      if (cancelled) return;
      setLoading(false);
      if (error) {
        // Non-fatal: an unreadable profile costs the prefill, not the ability
        // to set a name. But it is said out loud rather than swallowed — a
        // silently blank field would look like "you have no name set".
        console.warn('[YourProfileCard] could not read profile:', error);
        return;
      }
      prefilled.current = true;
      // Split on the FIRST space only. "Mary Anne Van Der Berg" keeps
      // everything after the first space as the surname rather than losing it,
      // which a split(' ') into two variables would do.
      const full = (data?.full_name ?? '').trim();
      if (!full) return;
      const i = full.indexOf(' ');
      if (i === -1) {
        setFirstName(full);
      } else {
        setFirstName(full.slice(0, i));
        setLastName(full.slice(i + 1).trim());
      }
    })();
    return () => { cancelled = true; };
  }, [user?.id]);

  const fullName = [firstName.trim(), lastName.trim()].filter(Boolean).join(' ');
  const dirty = fullName.length > 0;

  const save = async () => {
    if (!user?.id || !dirty) return;
    setSaving(true);
    const { error } = await supabase
      .from('profiles')
      .update({ full_name: fullName })
      .eq('id', user.id);
    setSaving(false);
    if (error) {
      toast.error(`Could not save your name: ${error.message}`);
      return;
    }
    toast.success('Name updated');
  };

  // Two letters need two names. Mirrors initialsOf() in useOrgMemberNames,
  // which gives one letter for a single-word name — the reason for the hint.
  const initials = [firstName.trim(), lastName.trim()]
    .filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase())
    .join('');

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <User className="w-5 h-5" />
          Your profile
        </CardTitle>
        <CardDescription>How your name appears to the rest of your team.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="profile-first-name">First name</Label>
            <Input
              id="profile-first-name"
              value={firstName}
              maxLength={PERSON_NAME_MAX}
              disabled={loading}
              onChange={(e) => setFirstName(e.target.value)}
              placeholder="Emmanuel"
              className="mt-1.5"
            />
          </div>
          <div>
            <Label htmlFor="profile-last-name">Last name</Label>
            <Input
              id="profile-last-name"
              value={lastName}
              maxLength={PERSON_NAME_MAX}
              disabled={loading}
              onChange={(e) => setLastName(e.target.value)}
              placeholder="Forkuoh"
              className="mt-1.5"
            />
          </div>
        </div>

        <p className="text-xs text-muted-foreground">
          Both names are used for the initials shown on leads and messages
          {initials ? <> — yours will read <span className="font-medium tracking-wide">{initials}</span></> : null}.
          A single name gives a single letter.
        </p>

        <Button onClick={save} disabled={!dirty || saving || loading}>
          {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
          Save name
        </Button>
      </CardContent>
    </Card>
  );
}
