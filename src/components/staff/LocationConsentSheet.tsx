import { LOCATION_SHARING_OFF_NOTE } from '@/lib/locationConsent';

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
