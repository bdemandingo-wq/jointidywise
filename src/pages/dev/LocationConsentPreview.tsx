import { LocationConsentSheet } from '@/components/staff/LocationConsentSheet';

/**
 * Dev-only render of the On My Way consent sheet.
 * Nothing here calls Supabase, SMS, or the browser location prompt.
 */
export default function LocationConsentPreview() {
  return (
    <LocationConsentSheet
      open
      businessName="Bright Clean"
      busy={false}
      onContinue={() => {}}
      onNotNow={() => {}}
    />
  );
}
