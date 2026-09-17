REVOKE SELECT (resend_api_key), UPDATE (resend_api_key) ON public.business_settings FROM authenticated;
REVOKE SELECT (resend_api_key), UPDATE (resend_api_key) ON public.business_settings FROM anon;
GRANT ALL ON public.business_settings TO service_role;