-- Repoint stored TidyWise *SaaS* support/sender copy off the owner's
-- cleaning-business mailbox onto the verified jointidywise.com domain.
--
-- The cleaning business is itself a tenant org. Its customer-facing mail
-- must keep support@tidywisecleaning.com. This migration does not update
-- organization-level rows:
--   organization_email_settings, business_settings, automation_steps,
--   custom_automation_steps, automated_campaigns, sms_templates,
--   broadcast_recipients, or any other org-scoped template.
--
-- Exact mailbox only: support@tidywisecleaning.com, plus
-- noreply@tidywisecleaning.com where a platform row stored it as a From.
-- Other addresses on that domain — plus-aliases, staff, customers, the
-- owner's login — are left alone.
--
-- Does not touch auth.users, profiles.email, or any login/allowlist
-- predicate. Already-applied migrations that compare the owner's login
-- stay as history.

-- Platform admin broadcasts email org owners as TidyWise. The table has
-- no organization_id. Recipient addresses live on broadcast_recipients
-- and are not rewritten.
UPDATE public.broadcasts
SET
  signature_text = regexp_replace(
    regexp_replace(signature_text, 'support@tidywisecleaning\.com', 'support@jointidywise.com', 'gi'),
    'noreply@tidywisecleaning\.com', 'noreply@jointidywise.com', 'gi'
  ),
  body_text = regexp_replace(
    regexp_replace(body_text, 'support@tidywisecleaning\.com', 'support@jointidywise.com', 'gi'),
    'noreply@tidywisecleaning\.com', 'noreply@jointidywise.com', 'gi'
  ),
  updated_at = now()
WHERE coalesce(signature_text, '') ~* '(support|noreply)@tidywisecleaning\.com'
   OR body_text ~* '(support|noreply)@tidywisecleaning\.com';

UPDATE public.platform_settings
SET
  value = regexp_replace(
    regexp_replace(value::text, 'support@tidywisecleaning\.com', 'support@jointidywise.com', 'gi'),
    'noreply@tidywisecleaning\.com', 'noreply@jointidywise.com', 'gi'
  )::jsonb,
  updated_at = now()
WHERE value::text ~* '(support|noreply)@tidywisecleaning\.com';

UPDATE public.site_content
SET
  value = regexp_replace(
    regexp_replace(value, 'support@tidywisecleaning\.com', 'support@jointidywise.com', 'gi'),
    'noreply@tidywisecleaning\.com', 'noreply@jointidywise.com', 'gi'
  ),
  updated_at = now()
WHERE value ~* '(support|noreply)@tidywisecleaning\.com';

-- Public marketing blog. No organization_id.
UPDATE public.blog_posts
SET
  content = regexp_replace(
    regexp_replace(content, 'support@tidywisecleaning\.com', 'support@jointidywise.com', 'gi'),
    'noreply@tidywisecleaning\.com', 'noreply@jointidywise.com', 'gi'
  ),
  excerpt = regexp_replace(
    regexp_replace(excerpt, 'support@tidywisecleaning\.com', 'support@jointidywise.com', 'gi'),
    'noreply@tidywisecleaning\.com', 'noreply@jointidywise.com', 'gi'
  ),
  meta_title = regexp_replace(
    regexp_replace(meta_title, 'support@tidywisecleaning\.com', 'support@jointidywise.com', 'gi'),
    'noreply@tidywisecleaning\.com', 'noreply@jointidywise.com', 'gi'
  ),
  meta_description = regexp_replace(
    regexp_replace(meta_description, 'support@tidywisecleaning\.com', 'support@jointidywise.com', 'gi'),
    'noreply@tidywisecleaning\.com', 'noreply@jointidywise.com', 'gi'
  ),
  updated_at = now()
WHERE content ~* '(support|noreply)@tidywisecleaning\.com'
   OR excerpt ~* '(support|noreply)@tidywisecleaning\.com'
   OR coalesce(meta_title, '') ~* '(support|noreply)@tidywisecleaning\.com'
   OR coalesce(meta_description, '') ~* '(support|noreply)@tidywisecleaning\.com';

-- Platform SEO only. Rows tied to an organization stay as that tenant wrote them.
UPDATE public.page_seo_metadata
SET
  seo_title = regexp_replace(
    regexp_replace(seo_title, 'support@tidywisecleaning\.com', 'support@jointidywise.com', 'gi'),
    'noreply@tidywisecleaning\.com', 'noreply@jointidywise.com', 'gi'
  ),
  meta_description = regexp_replace(
    regexp_replace(meta_description, 'support@tidywisecleaning\.com', 'support@jointidywise.com', 'gi'),
    'noreply@tidywisecleaning\.com', 'noreply@jointidywise.com', 'gi'
  ),
  og_title = regexp_replace(
    regexp_replace(og_title, 'support@tidywisecleaning\.com', 'support@jointidywise.com', 'gi'),
    'noreply@tidywisecleaning\.com', 'noreply@jointidywise.com', 'gi'
  ),
  og_description = regexp_replace(
    regexp_replace(og_description, 'support@tidywisecleaning\.com', 'support@jointidywise.com', 'gi'),
    'noreply@tidywisecleaning\.com', 'noreply@jointidywise.com', 'gi'
  ),
  updated_at = now()
WHERE organization_id IS NULL
  AND (
    coalesce(seo_title, '') ~* '(support|noreply)@tidywisecleaning\.com'
    OR coalesce(meta_description, '') ~* '(support|noreply)@tidywisecleaning\.com'
    OR coalesce(og_title, '') ~* '(support|noreply)@tidywisecleaning\.com'
    OR coalesce(og_description, '') ~* '(support|noreply)@tidywisecleaning\.com'
  );

-- Platform help copy. Org-owned videos are left alone.
UPDATE public.help_videos
SET
  description = regexp_replace(
    regexp_replace(description, 'support@tidywisecleaning\.com', 'support@jointidywise.com', 'gi'),
    'noreply@tidywisecleaning\.com', 'noreply@jointidywise.com', 'gi'
  ),
  updated_at = now()
WHERE organization_id IS NULL
  AND coalesce(description, '') ~* '(support|noreply)@tidywisecleaning\.com';
