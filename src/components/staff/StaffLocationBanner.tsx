import { MapPin } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useLocationPermission } from '@/hooks/useLocationPermission';
import { locationBannerCopy } from '@/lib/locationPermission';

export function StaffLocationBanner({ onOpen }: { onOpen: () => void }) {
  const { kind } = useLocationPermission();
  const copy = locationBannerCopy(kind);
  if (!copy) return null;

  return (
    <div
      className="flex items-start gap-3 rounded-2xl border p-4"
      style={{ background: 'hsl(var(--pv-warn-soft))', borderColor: 'hsl(var(--pv-warn) / 0.25)' }}
    >
      <MapPin className="mt-0.5 h-4 w-4 shrink-0" style={{ color: 'hsl(var(--pv-warn))' }} aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold" style={{ color: 'hsl(var(--pv-warn))' }}>
          {copy.title}
        </p>
        <p className="mt-0.5 text-sm text-muted-foreground">{copy.body}</p>
      </div>
      <Button type="button" variant="outline" size="sm" className="shrink-0 min-h-[44px]" onClick={onOpen}>
        Location settings
      </Button>
    </div>
  );
}
