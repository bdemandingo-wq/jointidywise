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
      className="fixed inset-0 z-[210] flex flex-col bg-background"
      role="dialog"
      aria-modal="true"
      aria-labelledby="location-consent-title"
    >
      <div className="min-h-0 flex-1 overflow-y-auto px-6 pt-8">
        <div className="mx-auto w-full max-w-md space-y-6 text-center">
          <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-primary/10">
            <MapPin className="h-10 w-10 text-primary" />
          </div>
          <h1 id="location-consent-title" className="!text-[24px] font-bold !leading-tight">
            {LOCATION_CONSENT_HEADING}
          </h1>
          <p id="location-consent-copy" className="text-left !text-[16px] !leading-relaxed text-muted-foreground">
            {formatLocationConsentCopy(businessName)}
          </p>
        </div>
      </div>
      <div className="shrink-0 bg-background px-6 pb-6 pt-4">
        <div className="mx-auto flex w-full max-w-md flex-col gap-3">
          <Button type="button" onClick={onContinue} disabled={busy} className="h-12 w-full !text-[16px]" size="lg">
            Allow
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={onNotNow}
            className="h-12 w-full border-2 border-foreground bg-background !text-[16px] text-foreground"
            size="lg"
          >
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
