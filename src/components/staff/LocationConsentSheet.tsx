import { MapPin } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  LOCATION_CONSENT_HEADING,
  LOCATION_SHARING_OFF_NOTE,
  formatLocationConsentCopy,
} from '@/lib/locationConsent';

export function LocationConsentSheet({
  open,
  businessName,
  busy,
  onContinue,
  onNotNow,
}: {
  open: boolean;
  businessName: string | null;
  busy: boolean;
  onContinue: () => void;
  onNotNow: () => void;
}) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[210] bg-background flex items-center justify-center p-6 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby="location-consent-title"
    >
      <div className="max-w-md w-full text-center space-y-6 my-auto">
        <div className="mx-auto w-20 h-20 rounded-full bg-primary/10 flex items-center justify-center">
          <MapPin className="h-10 w-10 text-primary" />
        </div>
        <h1 id="location-consent-title" className="text-2xl font-bold">
          {LOCATION_CONSENT_HEADING}
        </h1>
        <p className="text-muted-foreground text-left">{formatLocationConsentCopy(businessName)}</p>
        <div className="flex flex-col gap-2">
          <Button type="button" onClick={onContinue} disabled={busy} className="w-full" size="lg">
            Continue
          </Button>
          <Button type="button" onClick={onNotNow} disabled={busy} variant="ghost" className="w-full" size="lg">
            Not now
          </Button>
        </div>
      </div>
    </div>
  );
}

export function LocationSharingOffNote({ onOpenSettings }: { onOpenSettings: () => void }) {
  const [before, after] = LOCATION_SHARING_OFF_NOTE.split('Settings');
  return (
    <p className="text-[11px] text-muted-foreground">
      {before}
      <button type="button" className="underline underline-offset-2" onClick={onOpenSettings}>
        Settings
      </button>
      {after}
    </p>
  );
}
