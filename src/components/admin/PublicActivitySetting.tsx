import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { useOrganization } from '@/contexts/OrganizationContext';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';

/**
 * One-click opt-out of the public activity feed. Default on. Saved on its
 * own so a missing column cannot block the rest of the settings form.
 */
export function PublicActivitySetting() {
  const { organization } = useOrganization();
  const [enabled, setEnabled] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!organization?.id) return;
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from('business_settings')
        .select('*')
        .eq('organization_id', organization.id)
        .maybeSingle();
      if (cancelled) return;
      if (!error && data) {
        const row = data as { show_public_activity?: boolean | null };
        setEnabled(row.show_public_activity !== false);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [organization?.id]);

  const save = async (next: boolean) => {
    if (!organization?.id) return;
    const previous = enabled;
    setEnabled(next);
    setSaving(true);
    const payload = { show_public_activity: next } as never;
    const { data: existing } = await supabase
      .from('business_settings')
      .select('id')
      .eq('organization_id', organization.id)
      .maybeSingle();

    const result = existing?.id
      ? await supabase.from('business_settings').update(payload).eq('id', existing.id)
      : await supabase.from('business_settings').insert({
          organization_id: organization.id,
          company_name: organization.name || 'My Cleaning Business',
          show_public_activity: next,
        } as never);

    setSaving(false);
    if (result.error) {
      setEnabled(previous);
      const missing = /show_public_activity|column/i.test(result.error.message);
      toast.error(missing
        ? 'This switch is not live in the database yet. You stay included until it is.'
        : 'Could not update the public activity setting.');
      return;
    }
    toast.success(next
      ? 'Anonymous activity can appear in the TidyWise feed.'
      : 'Your business is left out of the TidyWise feed.');
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Public activity</CardTitle>
        <CardDescription>
          The TidyWise marketing site shows a live feed of anonymous jobs and new businesses. Only a city and a rounded amount are used.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex items-start justify-between gap-4 rounded-lg border bg-muted/30 p-4">
          <div className="space-y-1">
            <Label htmlFor="show_public_activity" className="text-base">
              Show my anonymous activity in the TidyWise feed
            </Label>
            <p className="text-sm text-muted-foreground">
              On by default. We never share your name, a customer, or an address. Turn this off to leave the feed.
            </p>
          </div>
          {loading ? (
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          ) : (
            <Switch
              id="show_public_activity"
              checked={enabled}
              disabled={saving}
              onCheckedChange={(value) => void save(value)}
            />
          )}
        </div>
      </CardContent>
    </Card>
  );
}
