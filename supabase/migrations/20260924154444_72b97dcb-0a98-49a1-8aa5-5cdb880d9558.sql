ALTER TABLE public.business_settings
  ADD COLUMN IF NOT EXISTS notification_phone text,
  ADD COLUMN IF NOT EXISTS business_line_phone text;

-- Existing orgs: the number they already saved is the one they've been reachable on.
UPDATE public.business_settings
SET notification_phone = company_phone
WHERE notification_phone IS NULL
  AND company_phone IS NOT NULL
  AND company_phone <> '';

COMMENT ON COLUMN public.business_settings.notification_phone IS
  'Owner/admin personal cell. Receives ALL admin SMS alerts. Falls back to company_phone when blank.';
COMMENT ON COLUMN public.business_settings.business_line_phone IS
  'Public-facing business line (e.g. the OpenPhone number). Never used for admin alerts.';