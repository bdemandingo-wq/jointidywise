-- Re-assert the daily 6 AM Eastern blog publisher.
--
-- pg_cron stores UTC. 10:00 UTC is 6:00 AM Eastern Daylight Time
-- (5:00 AM Eastern Standard Time). That is the same hour the
-- 2026-10-13 publisher job used.
--
-- This does not delete blog_posts and does not touch completed keywords.
-- Failed rows with fewer than 5 attempts are queued again so a draft-gate
-- or JSON failure can run after generate-daily-blogs is redeployed.
-- attempts is left as-is. A keyword at 5 or more stays failed and is not
-- retried forever. The keyword insert is repeated with ON CONFLICT DO
-- NOTHING so a queue that never received the 2026-10-13 seed still has
-- work. Completed rows and blog_posts are left alone.

CREATE UNIQUE INDEX IF NOT EXISTS idx_blog_keyword_queue_keyword_lower
  ON public.blog_keyword_queue (lower(keyword));

INSERT INTO public.blog_keyword_queue (keyword, intent, priority, opportunity, status)
VALUES
  -- Pricing per square foot, quotes, and recurring revenue.
  ('house cleaning price per square foot by home size', 'bottom_funnel', 2, 'High', 'queued'),
  ('deep clean vs recurring clean price per square foot', 'bottom_funnel', 2, 'High', 'queued'),
  ('airbnb turnover cleaning price per square foot', 'bottom_funnel', 2, 'High', 'queued'),
  ('how to set a minimum charge for a small apartment clean', 'bottom_funnel', 2, 'High', 'queued'),
  ('when to raise recurring house cleaning rates', 'bottom_funnel', 2, 'High', 'queued'),
  ('how to quote a house cleaning job from square footage', 'bottom_funnel', 2, 'High', 'queued'),
  ('maid service estimate template for a first visit', 'bottom_funnel', 2, 'High', 'queued'),
  ('what to include on a residential cleaning quote', 'bottom_funnel', 2, 'High', 'queued'),
  ('how to price extras on a house cleaning estimate', 'bottom_funnel', 2, 'High', 'queued'),
  ('move out cleaning quote checklist for a maid service', 'bottom_funnel', 2, 'High', 'queued'),

  -- Software comparisons. Distinct from the existing Jobber / BookingKoala /
  -- Housecall Pro cornerstone posts.
  ('zenmaid vs jobber for a residential cleaning company', 'bottom_funnel', 2, 'High', 'queued'),
  ('housecall pro pricing for a small maid service', 'bottom_funnel', 2, 'High', 'queued'),
  ('launch27 vs zenmaid for airbnb turnover teams', 'bottom_funnel', 2, 'High', 'queued'),
  ('bookingkoala vs launch27 for recurring maid service routes', 'bottom_funnel', 2, 'High', 'queued'),
  ('jobber limitations for biweekly house cleaning routes', 'bottom_funnel', 2, 'High', 'queued'),
  ('zenmaid alternative when a maid service needs payroll', 'bottom_funnel', 2, 'High', 'queued'),

  ('how to convert a one time house clean into a recurring client', 'bottom_funnel', 2, 'High', 'queued'),
  ('weekly vs biweekly pricing for recurring maid service clients', 'bottom_funnel', 2, 'High', 'queued'),
  ('how many recurring homes a two person crew can hold', 'bottom_funnel', 2, 'High', 'queued'),
  ('card on file billing for recurring house cleaning clients', 'bottom_funnel', 2, 'High', 'queued'),

  -- Hiring and payroll. Not the existing 1099 vs W-2 post.
  ('how to hire house cleaners for a growing maid service', 'middle_funnel', 4, 'High', 'queued'),
  ('interview questions for residential house cleaner candidates', 'middle_funnel', 4, 'High', 'queued'),
  ('house cleaner job description template for a maid service', 'middle_funnel', 4, 'High', 'queued'),
  ('first week onboarding checklist for a new house cleaner', 'middle_funnel', 4, 'High', 'queued'),
  ('background check steps before hiring a residential cleaner', 'middle_funnel', 4, 'High', 'queued'),
  ('how to cut cleaner no shows after you hire', 'middle_funnel', 4, 'High', 'queued'),
  ('training checklist for new maid service employees', 'middle_funnel', 4, 'High', 'queued'),
  ('house cleaning payroll weekly vs biweekly', 'middle_funnel', 4, 'High', 'queued'),
  ('how to track client tips in maid service payroll', 'middle_funnel', 4, 'High', 'queued'),
  ('mileage reimbursement between residential cleaning jobs', 'middle_funnel', 4, 'High', 'queued'),
  ('overtime rules for house cleaning employees', 'middle_funnel', 4, 'High', 'queued'),
  ('calculating cleaner pay from completed house cleaning jobs', 'middle_funnel', 4, 'High', 'queued'),
  ('quarterly payroll tax checklist for a maid service owner', 'middle_funnel', 4, 'High', 'queued'),
  ('cleaner bonus pay without wrecking the payroll run', 'middle_funnel', 4, 'High', 'queued'),

  -- Scheduling. Not the existing scheduling-software roundup.
  ('how to build a recurring residential cleaning route', 'middle_funnel', 4, 'High', 'queued'),
  ('scheduling a two and three person maid service crew', 'middle_funnel', 4, 'High', 'queued'),
  ('same day cancellation policy for house cleaning jobs', 'middle_funnel', 4, 'High', 'queued'),
  ('buffer time between back to back house cleans', 'middle_funnel', 4, 'High', 'queued'),
  ('scheduling airbnb turnovers around guest checkout', 'middle_funnel', 4, 'High', 'queued'),
  ('assigning house cleaners by neighborhood to cut drive time', 'middle_funnel', 4, 'High', 'queued'),

  -- SOPs, insurance, reviews, agreements.
  ('house cleaning checklist sop for a three bedroom home', 'middle_funnel', 4, 'High', 'queued'),
  ('airbnb turnover cleaning sop for a maid service', 'middle_funnel', 4, 'High', 'queued'),
  ('bathroom cleaning sop for a residential crew', 'middle_funnel', 4, 'High', 'queued'),
  ('kitchen reset sop for recurring house cleaning', 'middle_funnel', 4, 'High', 'queued'),
  ('supply restock sop for a maid service van', 'middle_funnel', 4, 'High', 'queued'),
  ('general liability insurance for a house cleaning business', 'middle_funnel', 4, 'High', 'queued'),
  ('bonding and insurance a maid service client will ask for', 'middle_funnel', 4, 'High', 'queued'),
  ('workers compensation for residential cleaning employees', 'middle_funnel', 4, 'High', 'queued'),
  ('how much liability coverage a house cleaning company needs', 'middle_funnel', 4, 'High', 'queued'),
  ('how to ask for a google review after a house cleaning', 'middle_funnel', 4, 'High', 'queued'),
  ('how to reply to a one star maid service review', 'middle_funnel', 4, 'High', 'queued'),
  ('when to send a review request after an airbnb turnover', 'middle_funnel', 4, 'High', 'queued'),
  ('recurring house cleaning service agreement template', 'middle_funnel', 4, 'High', 'queued'),
  ('what to do when a biweekly cleaning client wants to pause', 'middle_funnel', 4, 'High', 'queued'),
  ('win back text for a house cleaning client who canceled', 'middle_funnel', 4, 'High', 'queued'),

  -- Marketing and the first-visit retention check-in.
  ('google business profile posts that book house cleaning jobs', 'middle_funnel', 5, 'High', 'queued'),
  ('how to get maid service leads from facebook without discounting', 'middle_funnel', 5, 'High', 'queued'),
  ('local seo pages for a residential cleaning company', 'middle_funnel', 5, 'High', 'queued'),
  ('referral program that keeps house cleaning clients sending neighbors', 'middle_funnel', 5, 'High', 'queued'),
  ('client check in script after the first house cleaning visit', 'middle_funnel', 5, 'High', 'queued')
ON CONFLICT ((lower(keyword))) DO NOTHING;


DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT jobname
    FROM cron.job
    WHERE jobname LIKE 'blog-publisher-%'
       OR jobname IN ('blog-publisher-monday', 'blog-publisher-thursday')
  LOOP
    PERFORM cron.unschedule(r.jobname);
  END LOOP;
END $$;

SELECT cron.schedule(
  'blog-publisher-daily',
  '0 10 * * *',
  $$SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='supabase_url') || '/functions/v1/generate-daily-blogs',
    headers := jsonb_build_object('Content-Type','application/json','x-cron-secret',(SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='cron_secret')),
    body := jsonb_build_object('auto_publish', true)
  );$$
);

UPDATE public.blog_keyword_queue
SET status = 'queued',
    error_message = NULL,
    last_attempted_at = NULL
WHERE status = 'failed'
  AND attempts < 5;
