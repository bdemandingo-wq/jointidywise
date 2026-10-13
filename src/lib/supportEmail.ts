/**
 * TidyWise's public support inbox.
 *
 * jointidywise.com is the verified Resend domain. This is a contact address
 * for the SaaS — terms, privacy, help, footers, and mailto links. It is not
 * a login. The platform owner's account is PLATFORM_OWNER_EMAIL in
 * platformOwner.ts and must stay that person's real login.
 *
 * Keep the default in sync with TIDYWISE_SUPPORT_EMAIL in
 * supabase/functions/_shared/email-footer.ts. Edge functions cannot import
 * from src/. Outbound mail can override that copy with the SUPPORT_EMAIL secret.
 */
export const SUPPORT_EMAIL = 'support@jointidywise.com';
