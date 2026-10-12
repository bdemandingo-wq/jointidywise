CREATE TABLE public.winback_sends (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  organization_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL,
  email text NOT NULL,
  segment text NOT NULL CHECK (segment IN (
    'S5_cancelled_paid',
    'S3_went_quiet',
    'S4_trial_no_pay',
    'S1_no_onboarding',
    'S2_no_bookings'
  )),
  step smallint NOT NULL CHECK (step IN (1, 2)),
  status text NOT NULL CHECK (status IN ('sending', 'sent', 'failed')),
  resend_id text,
  sent_at timestamptz,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT winback_sends_email_lower CHECK (email = lower(email)),
  CONSTRAINT winback_sends_email_step_key UNIQUE (email, step)
);

CREATE INDEX winback_sends_step_status_sent_at_idx
  ON public.winback_sends (step, status, sent_at);

ALTER TABLE public.winback_sends ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.winback_sends FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.winback_sends TO service_role;

CREATE TABLE public.winback_campaign_halt (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  halted_at timestamptz NOT NULL DEFAULT now(),
  reason text NOT NULL,
  detail text
);

ALTER TABLE public.winback_campaign_halt ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.winback_campaign_halt FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.winback_campaign_halt TO service_role;

CREATE OR REPLACE FUNCTION public.winback_recipient_candidates()
RETURNS TABLE (
  organization_id uuid,
  user_id uuid,
  business_name text,
  first_name text,
  email text,
  segment text,
  is_lifetime boolean,
  signed_up_at timestamptz,
  last_sign_in_at timestamptz,
  bookings bigint,
  last_booking_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH owners AS (
    SELECT
      o.id AS organization_id,
      coalesce(nullif(btrim(o.name), ''), 'your business') AS business_name,
      p.id AS user_id,
      coalesce(nullif(split_part(coalesce(p.full_name, ''), ' ', 1), ''), 'there') AS first_name,
      lower(coalesce(nullif(btrim(p.email), ''), nullif(btrim(u.email), ''))) AS email,
      p.created_at AS signed_up_at,
      u.last_sign_in_at,
      p.trial_ends_at,
      coalesce(p.email_unsubscribed, false) AS unsub,
      NOT coalesce(o.needs_onboarding, false) AS onboarding_completed,
      (o.plan_type = 'lifetime' OR o.grandfathered_lifetime IS TRUE) AS is_lifetime
    FROM public.organizations o
    JOIN public.profiles p ON p.id = o.owner_id
    JOIN auth.users u ON u.id = p.id
  ),
  act AS (
    SELECT organization_id, count(*) AS bookings, max(created_at) AS last_booking_at
    FROM public.bookings
    WHERE organization_id IS NOT NULL
    GROUP BY organization_id
  ),
  bill AS (
    SELECT
      organization_id,
      bool_or(status IN ('active', 'past_due', 'trialing')) AS live_sub
    FROM public.stripe_subscriptions
    GROUP BY organization_id
  ),
  paid AS (
    SELECT
      organization_id,
      count(DISTINCT coalesce(stripe_invoice_id, stripe_object_id)) AS paid_n
    FROM public.billing_events
    WHERE organization_id IS NOT NULL
      AND event_type IN ('invoice.paid', 'charge.succeeded')
      AND amount_cents > 0
      AND counts_as_cash
      AND coalesce(revenue_stream_corrected, revenue_stream) = 'plan'
    GROUP BY organization_id
  ),
  paid_by_email AS (
    SELECT
      lower(customer_email) AS email,
      count(DISTINCT coalesce(stripe_invoice_id, stripe_object_id)) AS paid_n
    FROM public.billing_events
    WHERE organization_id IS NULL
      AND customer_email IS NOT NULL
      AND event_type IN ('invoice.paid', 'charge.succeeded')
      AND amount_cents > 0
      AND counts_as_cash
      AND coalesce(revenue_stream_corrected, revenue_stream) = 'plan'
    GROUP BY 1
  ),
  base AS (
    SELECT
      ow.*,
      coalesce(a.bookings, 0) AS bookings,
      a.last_booking_at,
      coalesce(b.live_sub, false) AS live_sub,
      coalesce(pd.paid_n, 0) + coalesce(pe.paid_n, 0) AS paid_n,
      greatest(ow.last_sign_in_at, a.last_booking_at) AS last_activity
    FROM owners ow
    LEFT JOIN act a ON a.organization_id = ow.organization_id
    LEFT JOIN bill b ON b.organization_id = ow.organization_id
    LEFT JOIN paid pd ON pd.organization_id = ow.organization_id
    LEFT JOIN paid_by_email pe ON pe.email = ow.email
    WHERE ow.email IS NOT NULL
      AND NOT ow.unsub
      AND NOT EXISTS (
        SELECT 1
        FROM public.suppressed_emails s
        WHERE lower(s.email) = ow.email
      )
      AND ow.email NOT IN ('agencyfootprintllc@gmail.com', 'vitalnestinc@gmail.com')
      AND ow.email NOT LIKE 'tidywise.qa+%'
      AND ow.email NOT LIKE '%@jointidywise.com'
      AND ow.email NOT LIKE '%@%.jointidywise.com'
      AND ow.email NOT LIKE '%@tidywisecleaning.com'
      AND ow.email NOT LIKE '%@%.tidywisecleaning.com'
      AND ow.email NOT LIKE '%test%'
      AND ow.email NOT LIKE '%example%'
  ),
  seg AS (
    SELECT
      *,
      CASE
        WHEN last_activity >= now() - interval '30 days' THEN NULL
        WHEN paid_n > 0 AND NOT live_sub AND NOT is_lifetime THEN 'S5_cancelled_paid'
        WHEN bookings > 0 AND last_activity < now() - interval '30 days' THEN 'S3_went_quiet'
        WHEN NOT is_lifetime AND paid_n = 0 AND NOT live_sub AND trial_ends_at < now() THEN 'S4_trial_no_pay'
        WHEN onboarding_completed AND bookings = 0 THEN 'S2_no_bookings'
        WHEN NOT onboarding_completed AND bookings = 0 THEN 'S1_no_onboarding'
      END AS segment
    FROM base
  ),
  ranked AS (
    SELECT
      organization_id,
      user_id,
      business_name,
      first_name,
      email,
      segment,
      is_lifetime,
      signed_up_at,
      last_sign_in_at,
      bookings,
      last_booking_at,
      CASE segment
        WHEN 'S5_cancelled_paid' THEN 1
        WHEN 'S3_went_quiet' THEN 2
        WHEN 'S4_trial_no_pay' THEN 3
        WHEN 'S1_no_onboarding' THEN 4
        WHEN 'S2_no_bookings' THEN 5
        ELSE 9
      END AS segment_rank
    FROM seg
    WHERE segment IS NOT NULL
  )
  SELECT DISTINCT ON (email)
    organization_id,
    user_id,
    business_name,
    first_name,
    email,
    segment,
    is_lifetime,
    signed_up_at,
    last_sign_in_at,
    bookings,
    last_booking_at
  FROM ranked
  ORDER BY email, segment_rank, signed_up_at DESC;
$$;

REVOKE ALL ON FUNCTION public.winback_recipient_candidates() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.winback_recipient_candidates() TO service_role;

COMMENT ON FUNCTION public.winback_recipient_candidates() IS
  'Churned owner audience for send-winback-campaign. One row per email, highest-value segment kept. Service role only.';