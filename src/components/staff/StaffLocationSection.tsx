import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Loader2, MapPin } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useLocationPermission } from '@/hooks/useLocationPermission';
import {
  LOCATION_CARD_LEARN_MORE,
  LOCATION_CARD_SUMMARY,
  buildLocationSectionModel,
  type LocationSectionModel,
} from '@/lib/locationPermission';

const TONE_CLASS = {
  on: 'bg-success/10 text-success border-success/30',
  off: 'bg-destructive/10 text-destructive border-destructive/30',
  warn: 'bg-warning/10 text-warning border-warning/30',
  neutral: 'bg-muted text-muted-foreground border-border',
} as const;

/** The card's disclosure. Learn more stays in the app and does not fetch. */
function LocationCardDisclosure() {
  const [open, setOpen] = useState(false);
  return (
    <div className="space-y-2">
      <p className="text-sm text-muted-foreground">{LOCATION_CARD_SUMMARY}</p>
      <Button
        type="button"
        variant="outline"
        className="min-h-[44px] w-full"
        onClick={() => setOpen(true)}
      >
        Learn more
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Location</DialogTitle>
            <DialogDescription className="text-left text-foreground">
              {LOCATION_CARD_LEARN_MORE}
            </DialogDescription>
          </DialogHeader>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function StaffLocationSectionView({
  model,
  requesting,
  onTurnOn,
  onOpenSettings,
  id = 'staff-location',
}: {
  model: LocationSectionModel;
  requesting: boolean;
  onTurnOn: () => void;
  onOpenSettings: () => void;
  id?: string;
}) {
  return (
    <Card id={id} className="scroll-mt-28">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <MapPin className="h-5 w-5" />
          Location
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <LocationCardDisclosure />
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm text-muted-foreground">Permission</span>
          <Badge variant="outline" className={TONE_CLASS[model.tone]}>
            {model.label}
          </Badge>
        </div>

        {model.statusNote && <p className="text-sm text-muted-foreground">{model.statusNote}</p>}

        <div className="flex flex-col gap-2">
          {model.showTurnOn && (
            <Button type="button" className="w-full min-h-[44px]" disabled={requesting} onClick={onTurnOn}>
              {requesting ? <Loader2 className="h-4 w-4 animate-spin" /> : <MapPin className="h-4 w-4" />}
              Turn on location
            </Button>
          )}
          {model.showCheckAgain && (
            <Button
              type="button"
              variant="outline"
              className="w-full min-h-[44px]"
              disabled={requesting}
              onClick={onTurnOn}
            >
              {requesting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Check again
            </Button>
          )}
          {model.showOpenSettings && (
            <Button type="button" variant="outline" className="w-full min-h-[44px]" onClick={onOpenSettings}>
              Open iPhone Settings
            </Button>
          )}
        </div>

        {model.androidHandNote && <p className="text-sm text-muted-foreground">{model.androidHandNote}</p>}
        {model.browserHelp && <p className="text-sm text-muted-foreground">{model.browserHelp}</p>}

        {model.steps && (
          <div className="space-y-2">
            {model.stepsTitle && <p className="text-sm font-medium">{model.stepsTitle}</p>}
            <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
              {model.steps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function StaffLocationSection({ staffId }: { staffId: string }) {
  const [params, setParams] = useSearchParams();
  const loc = useLocationPermission(staffId);
  const model =
    loc.kind === 'checking'
      ? null
      : buildLocationSectionModel({
          kind: loc.kind,
          precise: loc.precise,
          platform: loc.platform,
          native: loc.native,
          userAgent: typeof navigator === 'undefined' ? '' : navigator.userAgent,
        });

  useEffect(() => {
    if (params.get('focus') !== 'location') return;
    document.getElementById('staff-location')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    const next = new URLSearchParams(params);
    next.delete('focus');
    setParams(next, { replace: true });
  }, [params, setParams]);

  if (!model) {
    return (
      <Card id="staff-location" className="scroll-mt-28">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MapPin className="h-5 w-5" />
            Location
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <LocationCardDisclosure />
          <p className="text-sm text-muted-foreground">Checking location permission…</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <StaffLocationSectionView
      requesting={loc.requesting}
      model={model}
      onTurnOn={() => {
        void loc.request();
      }}
      onOpenSettings={loc.openSettings}
    />
  );
}
