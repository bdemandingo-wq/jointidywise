import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useLocationConsent } from '@/hooks/useLocationConsent';
import { useLocationSharingGate } from '@/hooks/useLocationSharingGate';
import { useLocationPermission } from '@/hooks/useLocationPermission';
import {
  LOCATION_CONSENT_TOGGLE_LABEL,
  consentLogsForAction,
  formatLocationConsentCopy,
  settingsToggleOn,
} from '@/lib/locationConsent';

export function LocationSharingToggle({
  staffId,
  organizationId,
  businessName,
}: {
  staffId: string;
  organizationId: string | null;
  businessName: string | null;
}) {
  const sharing = useLocationSharingGate();
  const consent = useLocationConsent(sharing.showSettingsToggle ? staffId : undefined);
  const loc = useLocationPermission(sharing.showSettingsToggle ? staffId : undefined);
  const [saving, setSaving] = useState(false);
  const checked = settingsToggleOn(consent.decision);
  const copy = formatLocationConsentCopy(businessName);

  const onToggle = async (nextOn: boolean) => {
    if (!organizationId || saving || !sharing.logConsent) return;
    setSaving(true);
    try {
      const rows = consentLogsForAction({
        latest: consent.decision,
        action: { type: 'settings', nextOn, osDenied: false },
      });
      for (const row of rows) {
        await consent.logDecision({
          staffId,
          organizationId,
          decision: row.decision,
          source: row.source,
        });
      }
      if (!nextOn) return;
      const kind = await loc.request();
      if (kind !== 'off') return;
      const followUp = consentLogsForAction({
        latest: 'toggled_on',
        action: { type: 'os_turned_off' },
      });
      for (const row of followUp) {
        await consent.logDecision({
          staffId,
          organizationId,
          decision: row.decision,
          source: row.source,
        });
      }
    } catch (err) {
      console.error('[location-consent] could not save settings choice', err);
      toast.error('Could not save location sharing.');
    } finally {
      setSaving(false);
    }
  };

  if (sharing.pending || !sharing.showSettingsToggle) return null;

  return (
    <Card>
      <CardContent className="space-y-3 pt-6">
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor="share-location-on-my-way" className="text-sm font-medium leading-snug">
            {LOCATION_CONSENT_TOGGLE_LABEL}
          </Label>
          {consent.isLoading || saving ? (
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          ) : (
            <Switch
              id="share-location-on-my-way"
              checked={checked}
              disabled={!organizationId || consent.isError || loc.requesting}
              onCheckedChange={(value) => {
                void onToggle(value);
              }}
            />
          )}
        </div>
        <p className="text-sm text-muted-foreground">{copy}</p>
        {consent.isError && (
          <p className="text-sm text-destructive">Couldn't load your location sharing choice.</p>
        )}
      </CardContent>
    </Card>
  );
}
