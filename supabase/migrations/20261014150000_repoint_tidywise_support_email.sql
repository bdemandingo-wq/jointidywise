-- Repoint stored TidyWise support/sender copy off the owner's separate
-- cleaning-business mailbox onto the verified jointidywise.com domain.
--
-- Exact mailbox only: support@tidywisecleaning.com (and, where it was stored
-- as a platform From, noreply@tidywisecleaning.com). Other addresses on that
-- domain — plus-aliases, staff, customers — are left alone.
--
-- Does not touch auth.users, profiles.email, or any login/allowlist
-- predicate. Already-applied migrations that compare the owner's login
-- stay as history.

UPDATE public.organization_email_settings
SET
  from_email = CASE lower(btrim(from_email))
    WHEN 'support@tidywisecleaning.com' THEN 'support@jointidywise.com'
    WHEN 'noreply@tidywisecleaning.com' THEN 'noreply@jointidywise.com'
    ELSE from_email
  END,
  reply_to_email = CASE lower(btrim(reply_to_email))
    WHEN 'support@tidywisecleaning.com' THEN 'support@jointidywise.com'
    WHEN 'noreply@tidywisecleaning.com' THEN 'noreply@jointidywise.com'
    ELSE reply_to_email
  END,
  smtp_email = CASE lower(btrim(smtp_email))
    WHEN 'support@tidywisecleaning.com' THEN 'support@jointidywise.com'
    WHEN 'noreply@tidywisecleaning.com' THEN 'noreply@jointidywise.com'
    ELSE smtp_email
  END,
  email_footer = CASE
    WHEN email_footer ~* 'support@tidywisecleaning\.com'
      THEN regexp_replace(email_footer, 'support@tidywisecleaning\.com', 'support@jointidywise.com', 'gi')
    ELSE email_footer
  END,
  updated_at = now()
WHERE lower(btrim(from_email)) IN ('support@tidywisecleaning.com', 'noreply@tidywisecleaning.com')
   OR lower(btrim(coalesce(reply_to_email, ''))) IN ('support@tidywisecleaning.com', 'noreply@tidywisecleaning.com')
   OR lower(btrim(coalesce(smtp_email, ''))) IN ('support@tidywisecleaning.com', 'noreply@tidywisecleaning.com')
   OR coalesce(email_footer, '') ~* 'support@tidywisecleaning\.com';

UPDATE public.business_settings
SET
  company_email = CASE
    WHEN lower(btrim(company_email)) = 'support@tidywisecleaning.com' THEN 'support@jointidywise.com'
    ELSE company_email
  END,
  cancellation_policy = regexp_replace(cancellation_policy, 'support@tidywisecleaning\.com', 'support@jointidywise.com', 'gi'),
  confirmation_email_body = regexp_replace(confirmation_email_body, 'support@tidywisecleaning\.com', 'support@jointidywise.com', 'gi'),
  reminder_email_body = regexp_replace(reminder_email_body, 'support@tidywisecleaning\.com', 'support@jointidywise.com', 'gi'),
  invoice_footer_message = regexp_replace(invoice_footer_message, 'support@tidywisecleaning\.com', 'support@jointidywise.com', 'gi'),
  review_sms_template = regexp_replace(review_sms_template, 'support@tidywisecleaning\.com', 'support@jointidywise.com', 'gi'),
  confirmation_email_sections = CASE
    WHEN confirmation_email_sections::text ~* 'support@tidywisecleaning\.com'
      THEN regexp_replace(confirmation_email_sections::text, 'support@tidywisecleaning\.com', 'support@jointidywise.com', 'gi')::jsonb
    ELSE confirmation_email_sections
  END,
  reminder_email_sections = CASE
    WHEN reminder_email_sections::text ~* 'support@tidywisecleaning\.com'
      THEN regexp_replace(reminder_email_sections::text, 'support@tidywisecleaning\.com', 'support@jointidywise.com', 'gi')::jsonb
    ELSE reminder_email_sections
  END,
  updated_at = now()
WHERE lower(btrim(coalesce(company_email, ''))) = 'support@tidywisecleaning.com'
   OR coalesce(cancellation_policy, '') ~* 'support@tidywisecleaning\.com'
   OR coalesce(confirmation_email_body, '') ~* 'support@tidywisecleaning\.com'
   OR coalesce(reminder_email_body, '') ~* 'support@tidywisecleaning\.com'
   OR coalesce(invoice_footer_message, '') ~* 'support@tidywisecleaning\.com'
   OR coalesce(review_sms_template, '') ~* 'support@tidywisecleaning\.com'
   OR coalesce(confirmation_email_sections::text, '') ~* 'support@tidywisecleaning\.com'
   OR coalesce(reminder_email_sections::text, '') ~* 'support@tidywisecleaning\.com';

UPDATE public.broadcasts
SET
  signature_text = regexp_replace(signature_text, 'support@tidywisecleaning\.com', 'support@jointidywise.com', 'gi'),
  body_text = regexp_replace(body_text, 'support@tidywisecleaning\.com', 'support@jointidywise.com', 'gi'),
  updated_at = now()
WHERE coalesce(signature_text, '') ~* 'support@tidywisecleaning\.com'
   OR body_text ~* 'support@tidywisecleaning\.com';

UPDATE public.platform_settings
SET
  value = regexp_replace(value::text, 'support@tidywisecleaning\.com', 'support@jointidywise.com', 'gi')::jsonb,
  updated_at = now()
WHERE value::text ~* 'support@tidywisecleaning\.com';

UPDATE public.site_content
SET
  value = regexp_replace(value, 'support@tidywisecleaning\.com', 'support@jointidywise.com', 'gi'),
  updated_at = now()
WHERE value ~* 'support@tidywisecleaning\.com';

UPDATE public.automation_steps
SET
  email_subject = regexp_replace(email_subject, 'support@tidywisecleaning\.com', 'support@jointidywise.com', 'gi'),
  email_body = regexp_replace(email_body, 'support@tidywisecleaning\.com', 'support@jointidywise.com', 'gi'),
  sms_body = regexp_replace(sms_body, 'support@tidywisecleaning\.com', 'support@jointidywise.com', 'gi'),
  updated_at = now()
WHERE email_subject ~* 'support@tidywisecleaning\.com'
   OR email_body ~* 'support@tidywisecleaning\.com'
   OR sms_body ~* 'support@tidywisecleaning\.com';

UPDATE public.custom_automation_steps
SET message_body = regexp_replace(message_body, 'support@tidywisecleaning\.com', 'support@jointidywise.com', 'gi')
WHERE message_body ~* 'support@tidywisecleaning\.com';

UPDATE public.automated_campaigns
SET
  subject = regexp_replace(subject, 'support@tidywisecleaning\.com', 'support@jointidywise.com', 'gi'),
  body = regexp_replace(body, 'support@tidywisecleaning\.com', 'support@jointidywise.com', 'gi'),
  sms_body = regexp_replace(sms_body, 'support@tidywisecleaning\.com', 'support@jointidywise.com', 'gi'),
  updated_at = now()
WHERE subject ~* 'support@tidywisecleaning\.com'
   OR body ~* 'support@tidywisecleaning\.com'
   OR coalesce(sms_body, '') ~* 'support@tidywisecleaning\.com';

UPDATE public.sms_templates
SET
  subject = regexp_replace(subject, 'support@tidywisecleaning\.com', 'support@jointidywise.com', 'gi'),
  content = regexp_replace(content, 'support@tidywisecleaning\.com', 'support@jointidywise.com', 'gi'),
  updated_at = now()
WHERE coalesce(subject, '') ~* 'support@tidywisecleaning\.com'
   OR content ~* 'support@tidywisecleaning\.com';
