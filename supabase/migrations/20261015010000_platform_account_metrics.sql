-- Read-only account metrics for platform admins.
--
-- One row per organization. The view is not granted to anon, authenticated,
-- or service_role. The only app entry is public.platform_account_metrics(),
-- which raises 42501 unless public.is_platform_admin() is true.
--
-- Run this in the SQL editor after 20261014230000_activation_tracking_and_signup_utm.sql.
-- Then deploy stripe-invoice-webhook and stripe-subscription-webhook.
-- If the functions ship first, they fall back to the previous row shape
-- until these columns exist, and the paywall mirror keeps working.
--
-- This file does not call Stripe. Prices, cancellation timestamps, and
-- refund dates come from rows already in the database. New webhook writes
-- fill unit_amount_cents, discount_*, canceled_at, and
-- platform_subscription_refunds from the event payload only.
--
-- Activation milestones are aggregated from organization_activation_events.
-- The view does not name milestone keys, so a rename does not require a
-- new migration. Milestone timestamps are not revenue. MRR is mrr_cents,
-- and only Stripe subscription billing (active or past_due, not lifetime)
-- is copied into that column.
--
-- Monthly amount math matches normalizeMonthlyBilledCents in
-- supabase/functions/_shared/subscription-billing-snapshot.ts.
-- The discount is removed from the invoice, then the result is divided
-- into months. public.billing_monthly_cents subtracts the discount after
-- the division, which understates an annual coupon. This view does not
-- use that function.
--
-- monthly_amount_cents and mrr_cents are the amount collected after the
-- loyalty discount. They share one result, so an annual plan is
-- (yearly invoice after discount) / 12 in both columns. A Stripe coupon
-- the webhook could read is used once and loyalty is not subtracted
-- again. When that coupon was not readable, the stored loyalty
-- amount-off is subtracted once for monthly Basic or Pro. A period row
-- already stores its coupon and loyalty is not added on top.
--
-- subscription_status is the raw Stripe status (active, past_due,
-- trialing, canceled, and the other Stripe values).
--
-- billing_event_at is the Stripe event created time of the price and
-- cancel snapshot. Webhook writes keep a newer snapshot when a duplicate
-- or older event arrives. This file does not drop the activation
-- milestone check; that allowlist lives in the activation migration.
--
-- Manual check, using the API role (not the SQL editor superuser):
--   1. Platform admin: select * from public.platform_account_metrics(10, 0);  -- rows
--   2. Any API role: select * from public.platform_account_metrics_v;          -- permission denied
--   3. Normal org user: select * from public.platform_account_metrics(10, 0); -- 42501
--   4. A lifetime org has is_lifetime true, plan Lifetime, and null
--      monthly_amount_cents and mrr_cents.
--   5. An annual plan has monthly_amount_basis = normalized_from_annual
--      and monthly_amount_cents = (invoice after discount) / 12.
--   6. A demo or test org is present with is_demo_or_test true.
--   7. Inserting an activation milestone changes activation_milestones
--      and does not change mrr_cents.
--   8. After the webhook deploy, subscription.updated fills
--      stripe_subscriptions.unit_amount_cents, and charge.refunded inserts
--      platform_subscription_refunds.

-- ---------------------------------------------------------------------------
-- Subscription price and cancellation timestamp (webhook payload)
-- ---------------------------------------------------------------------------

ALTER TABLE public.stripe_subscriptions
  ADD COLUMN IF NOT EXISTS unit_amount_cents bigint,
  ADD COLUMN IF NOT EXISTS quantity integer,
  ADD COLUMN IF NOT EXISTS interval_count integer,
  ADD COLUMN IF NOT EXISTS discount_amount_cents bigint,
  ADD COLUMN IF NOT EXISTS discount_percent numeric,
  ADD COLUMN IF NOT EXISTS discount_known boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS canceled_at timestamptz,
  ADD COLUMN IF NOT EXISTS ended_at timestamptz,
  ADD COLUMN IF NOT EXISTS billing_event_at timestamptz;

COMMENT ON COLUMN public.stripe_subscriptions.unit_amount_cents IS
  'Stripe price.unit_amount from the subscription webhook payload, in cents. Null until a webhook writes it. Not a live Stripe read.';
COMMENT ON COLUMN public.stripe_subscriptions.discount_amount_cents IS
  'Sum of expanded coupon amount_off values on the subscription, in cents, for one invoice. Null when discount_known is false.';
COMMENT ON COLUMN public.stripe_subscriptions.discount_percent IS
  'Single expanded coupon percent_off. Null when there is no percent coupon or the coupon was not on the payload.';
COMMENT ON COLUMN public.stripe_subscriptions.discount_known IS
  'True when the webhook could see that there was no coupon, or could read the coupon. False on older rows and when the payload only contained discount ids.';
COMMENT ON COLUMN public.stripe_subscriptions.canceled_at IS
  'Stripe subscription.canceled_at from the webhook payload. Null until a webhook writes it.';
COMMENT ON COLUMN public.stripe_subscriptions.ended_at IS
  'Stripe subscription.ended_at from the webhook payload.';
COMMENT ON COLUMN public.stripe_subscriptions.billing_event_at IS
  'Stripe event.created of the payload that last wrote the price and cancel snapshot. A later webhook overwrites those fields only when its event.created is strictly newer. Equal or older events leave them in place. When this is null, the writer compares against updated_at.';

-- ---------------------------------------------------------------------------
-- SaaS refund dates from charge.refunded (platform Stripe webhook)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.platform_subscription_refunds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL,
  stripe_refund_id text NOT NULL,
  stripe_charge_id text,
  stripe_customer_id text,
  stripe_invoice_id text,
  stripe_subscription_id text,
  amount_cents bigint,
  currency text,
  refunded_at timestamptz NOT NULL,
  source text NOT NULL DEFAULT 'charge.refunded',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT platform_subscription_refunds_refund_key UNIQUE (stripe_refund_id),
  CONSTRAINT platform_subscription_refunds_source_chk CHECK (source IN ('charge.refunded'))
);

CREATE INDEX IF NOT EXISTS platform_subscription_refunds_org_idx
  ON public.platform_subscription_refunds (organization_id, refunded_at);

CREATE INDEX IF NOT EXISTS platform_subscription_refunds_customer_idx
  ON public.platform_subscription_refunds (stripe_customer_id);

COMMENT ON TABLE public.platform_subscription_refunds IS
  'TidyWise subscription refunds copied from the platform charge.refunded webhook. Cleaning-client refunds on Connect are not written here. Historical refunds that predate this table are read from billing_events when that ledger has them.';

ALTER TABLE public.platform_subscription_refunds ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.platform_subscription_refunds FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON TABLE public.platform_subscription_refunds TO service_role;

-- No SELECT policy for authenticated. Org users cannot read this table.
-- The metrics function is security definer and does not rely on a policy.

-- ---------------------------------------------------------------------------
-- Monthly price. Discount comes off the invoice, then the invoice is divided.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.platform_monthly_billed_cents(
  p_unit_amount_cents bigint,
  p_quantity integer,
  p_billing_interval text,
  p_interval_count integer,
  p_discount_percent numeric,
  p_discount_amount_cents bigint
) RETURNS TABLE (monthly_amount_cents bigint, amount_basis text)
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $fn$
  WITH calc AS (
    SELECT
      CASE lower(COALESCE(p_billing_interval, ''))
        WHEN 'month' THEN GREATEST(COALESCE(NULLIF(p_interval_count, 0), 1), 1)::numeric
        WHEN 'monthly' THEN GREATEST(COALESCE(NULLIF(p_interval_count, 0), 1), 1)::numeric
        WHEN 'year' THEN GREATEST(COALESCE(NULLIF(p_interval_count, 0), 1), 1)::numeric * 12
        WHEN 'yearly' THEN GREATEST(COALESCE(NULLIF(p_interval_count, 0), 1), 1)::numeric * 12
        WHEN 'annual' THEN GREATEST(COALESCE(NULLIF(p_interval_count, 0), 1), 1)::numeric * 12
        WHEN 'week' THEN GREATEST(COALESCE(NULLIF(p_interval_count, 0), 1), 1)::numeric * 12.0 / 52.0
        WHEN 'weekly' THEN GREATEST(COALESCE(NULLIF(p_interval_count, 0), 1), 1)::numeric * 12.0 / 52.0
        WHEN 'day' THEN GREATEST(COALESCE(NULLIF(p_interval_count, 0), 1), 1)::numeric * 12.0 / 365.0
        WHEN 'daily' THEN GREATEST(COALESCE(NULLIF(p_interval_count, 0), 1), 1)::numeric * 12.0 / 365.0
        ELSE NULL
      END AS months,
      GREATEST(COALESCE(NULLIF(p_interval_count, 0), 1), 1) AS interval_count
  )
  SELECT
    CASE
      WHEN p_unit_amount_cents IS NULL OR calc.months IS NULL THEN NULL
      ELSE GREATEST(0, ROUND(
        (
          (p_unit_amount_cents::numeric * COALESCE(p_quantity, 1))
          * (1 - COALESCE(p_discount_percent, 0) / 100.0)
          - COALESCE(p_discount_amount_cents, 0)
        ) / calc.months
      ))::bigint
    END,
    CASE
      WHEN p_unit_amount_cents IS NULL THEN NULL
      WHEN calc.months IS NULL THEN 'unknown_interval'
      WHEN lower(p_billing_interval) IN ('year', 'yearly', 'annual')
        OR (lower(p_billing_interval) IN ('month', 'monthly') AND calc.interval_count = 12)
        THEN 'normalized_from_annual'
      WHEN lower(p_billing_interval) IN ('month', 'monthly') AND calc.interval_count = 1 THEN 'monthly'
      WHEN lower(p_billing_interval) IN ('month', 'monthly') THEN 'normalized_from_multi_month'
      WHEN lower(p_billing_interval) IN ('week', 'weekly') THEN 'normalized_from_weekly'
      WHEN lower(p_billing_interval) IN ('day', 'daily') THEN 'normalized_from_daily'
      ELSE 'unknown_interval'
    END
  FROM calc;
$fn$;

REVOKE ALL ON FUNCTION public.platform_monthly_billed_cents(bigint, integer, text, integer, numeric, bigint)
  FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.platform_monthly_billed_cents(bigint, integer, text, integer, numeric, bigint) IS
  'Normalizes a stored Stripe subscription price to monthly cents. Discount is applied to the invoice, then divided. Null unit amount yields a null monthly amount. Not granted to clients.';

-- ---------------------------------------------------------------------------
-- The view. security_invoker so a stray GRANT still runs as the caller.
-- Grants below remove anon, authenticated, and service_role.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE VIEW public.platform_account_metrics_v
WITH (security_invoker = true) AS
WITH chosen_sub AS (
  SELECT DISTINCT ON (s.organization_id)
    s.organization_id,
    s.stripe_subscription_id,
    s.status,
    s.plan,
    s.billing_interval,
    s.interval_count,
    s.unit_amount_cents,
    s.quantity,
    s.discount_amount_cents,
    s.discount_percent,
    s.discount_known,
    s.trial_end,
    s.canceled_at,
    s.cancel_at_period_end,
    s.current_period_end,
    s.updated_at
  FROM public.stripe_subscriptions s
  ORDER BY s.organization_id,
    CASE s.status
      WHEN 'active' THEN 0
      WHEN 'trialing' THEN 1
      WHEN 'past_due' THEN 2
      WHEN 'unpaid' THEN 3
      WHEN 'paused' THEN 4
      WHEN 'canceled' THEN 5
      WHEN 'cancelled' THEN 5
      WHEN 'incomplete' THEN 6
      WHEN 'incomplete_expired' THEN 7
      ELSE 8
    END,
    CASE
      WHEN lower(coalesce(s.plan, '')) = 'lifetime'
        OR starts_with(coalesce(s.stripe_subscription_id, ''), 'lifetime_')
      THEN 1 ELSE 0
    END,
    s.updated_at DESC NULLS LAST,
    s.id
),
activation AS (
  SELECT
    e.organization_id,
    COALESCE(
      jsonb_object_agg(e.milestone, e.occurred_at ORDER BY e.milestone),
      '{}'::jsonb
    ) AS activation_milestones
  FROM (
    SELECT organization_id, milestone, max(occurred_at) AS occurred_at
    FROM public.organization_activation_events
    GROUP BY organization_id, milestone
  ) e
  GROUP BY e.organization_id
),
latest_activation AS (
  SELECT DISTINCT ON (e.organization_id)
    e.organization_id,
    e.milestone AS latest_milestone,
    e.occurred_at AS latest_milestone_at
  FROM public.organization_activation_events e
  ORDER BY e.organization_id, e.occurred_at DESC, e.created_at DESC, e.milestone
),
period_price AS (
  SELECT DISTINCT ON (p.organization_id)
    p.organization_id,
    p.unit_amount_cents,
    p.quantity,
    p.billing_interval,
    p.interval_count,
    p.discount_percent,
    p.discount_amount_cents
  FROM public.billing_subscription_periods p
  WHERE p.revenue_stream = 'plan'
    AND p.organization_id IS NOT NULL
  ORDER BY p.organization_id,
    (p.effective_to IS NULL) DESC,
    p.effective_from DESC,
    p.id
),
period_cancel AS (
  SELECT DISTINCT ON (p.organization_id)
    p.organization_id,
    p.effective_to
  FROM public.billing_subscription_periods p
  WHERE p.revenue_stream = 'plan'
    AND p.organization_id IS NOT NULL
    AND p.effective_to IS NOT NULL
    AND p.cancellation_reason IS NOT NULL
  ORDER BY p.organization_id, p.effective_to DESC, p.id
),
feedback_cancel AS (
  SELECT f.organization_id, max(f.canceled_at) AS canceled_at
  FROM public.cancellation_feedback f
  WHERE f.organization_id IS NOT NULL
  GROUP BY f.organization_id
),
refund_rows AS (
  SELECT organization_id, refunded_at
  FROM (
    SELECT
      COALESCE(r.organization_id, linked.organization_id) AS organization_id,
      r.refunded_at
    FROM public.platform_subscription_refunds r
    LEFT JOIN LATERAL (
      SELECT s.organization_id
      FROM public.stripe_subscriptions s
      WHERE r.organization_id IS NULL
        AND r.stripe_customer_id IS NOT NULL
        AND s.stripe_customer_id = r.stripe_customer_id
      ORDER BY s.updated_at DESC NULLS LAST, s.id
      LIMIT 1
    ) linked ON true
    UNION ALL
    SELECT be.organization_id, be.occurred_at
    FROM public.billing_events be
    WHERE be.event_type = 'charge.refunded'
      AND be.organization_id IS NOT NULL
      AND COALESCE(be.revenue_stream_corrected, be.revenue_stream) IN ('plan', 'lifetime')
  ) raw
  WHERE organization_id IS NOT NULL
    AND refunded_at IS NOT NULL
),
refunds AS (
  SELECT
    d.organization_id,
    array_agg(d.refunded_at ORDER BY d.refunded_at) AS refund_dates
  FROM (
    SELECT DISTINCT organization_id, refunded_at FROM refund_rows
  ) d
  GROUP BY d.organization_id
),
org_core AS (
  SELECT
    o.id AS organization_id,
    o.name AS organization_name,
    owner.email AS owner_email,
    o.created_at AS signup_at,
    o.plan_type AS org_plan_type,
    o.last_login_at,
    CASE
      WHEN jsonb_typeof(o.onboarding_answers -> 'howHeard') = 'array' THEN (
        SELECT NULLIF(string_agg(
          CASE WHEN jsonb_typeof(elem) = 'string' THEN elem #>> '{}' ELSE NULL END,
          ', ' ORDER BY ord
        ), '')
        FROM jsonb_array_elements(o.onboarding_answers -> 'howHeard') WITH ORDINALITY AS heard(elem, ord)
      )
      WHEN jsonb_typeof(o.onboarding_answers -> 'howHeard') = 'string'
        THEN NULLIF(o.onboarding_answers ->> 'howHeard', '')
      ELSE NULL
    END AS how_heard,
    attr.utm_source,
    attr.utm_medium,
    attr.utm_campaign,
    attr.referrer,
    s.status AS stripe_subscription_status,
    s.stripe_subscription_id,
    s.plan AS sub_plan,
    s.billing_interval AS sub_billing_interval,
    s.interval_count AS sub_interval_count,
    s.unit_amount_cents AS sub_unit_amount_cents,
    s.quantity AS sub_quantity,
    s.discount_amount_cents AS sub_discount_amount_cents,
    s.discount_percent AS sub_discount_percent,
    COALESCE(s.discount_known, false) AS sub_discount_known,
    s.trial_end AS sub_trial_end,
    s.canceled_at AS sub_canceled_at,
    COALESCE(s.cancel_at_period_end, false) AS cancel_at_period_end,
    s.current_period_end,
    owner.trial_ends_at AS profile_trial_ends_at,
    per.unit_amount_cents AS period_unit_amount_cents,
    per.quantity AS period_quantity,
    per.billing_interval AS period_billing_interval,
    per.interval_count AS period_interval_count,
    per.discount_percent AS period_discount_percent,
    per.discount_amount_cents AS period_discount_amount_cents,
    l.applied_discount_cents::bigint AS loyalty_discount_cents,
    pc.effective_to AS period_canceled_at,
    fb.canceled_at AS feedback_canceled_at,
    COALESCE(act.activation_milestones, '{}'::jsonb) AS activation_milestones,
    latest.latest_milestone,
    latest.latest_milestone_at,
    COALESCE(rf.refund_dates, ARRAY[]::timestamptz[]) AS refund_dates,
    (
      public.activation_subject_is_demo(o.id)
      OR public.jsonb_flag_true(to_jsonb(o), 'is_test')
      OR COALESCE((
        SELECT public.jsonb_flag_true(to_jsonb(ps), 'is_test')
        FROM public.organization_pricing_settings ps
        WHERE ps.organization_id = o.id
      ), false)
    ) AS is_demo_or_test,
    (
      o.grandfathered_lifetime IS TRUE
      OR lower(coalesce(o.plan_type, '')) = 'lifetime'
      OR lower(coalesce(s.plan, '')) = 'lifetime'
      OR starts_with(coalesce(s.stripe_subscription_id, ''), 'lifetime_')
    ) AS is_lifetime
  FROM public.organizations o
  LEFT JOIN public.profiles owner ON owner.id = o.owner_id
  LEFT JOIN chosen_sub s ON s.organization_id = o.id
  LEFT JOIN public.org_subscription_loyalty l ON l.organization_id = o.id
  LEFT JOIN period_price per ON per.organization_id = o.id
  LEFT JOIN period_cancel pc ON pc.organization_id = o.id
  LEFT JOIN feedback_cancel fb ON fb.organization_id = o.id
  LEFT JOIN activation act ON act.organization_id = o.id
  LEFT JOIN latest_activation latest ON latest.organization_id = o.id
  LEFT JOIN refunds rf ON rf.organization_id = o.id
  LEFT JOIN LATERAL (
    SELECT a.utm_source, a.utm_medium, a.utm_campaign, a.referrer
    FROM public.account_signup_attribution a
    WHERE a.organization_id = o.id
       OR (a.user_id = o.owner_id AND a.organization_id IS NULL)
    ORDER BY (a.organization_id = o.id) DESC, a.captured_at ASC
    LIMIT 1
  ) attr ON true
),
priced AS (
  SELECT
    c.*,
    CASE
      WHEN c.is_lifetime THEN 'lifetime'
      -- Known Stripe coupon, including a known zero. Loyalty is not applied
      -- again: the expanded coupon is already the amount off the invoice.
      WHEN c.sub_unit_amount_cents IS NOT NULL AND c.sub_discount_known THEN 'stripe'
      -- Coupon id was not expanded. Monthly Basic/Pro loyalty is an amount-off
      -- coupon we stored ourselves. Subtract that once. Do not also use the
      -- unreadable Stripe discount fields (they are null).
      WHEN c.sub_unit_amount_cents IS NOT NULL
        AND NOT c.sub_discount_known
        AND c.loyalty_discount_cents IS NOT NULL
        AND c.loyalty_discount_cents > 0
        AND lower(coalesce(nullif(c.sub_plan, ''), nullif(c.org_plan_type, ''), '')) IN ('basic', 'pro')
        AND lower(coalesce(c.sub_billing_interval, '')) IN ('month', 'monthly')
        AND GREATEST(COALESCE(NULLIF(c.sub_interval_count, 0), 1), 1) = 1
        THEN 'loyalty'
      -- Some other unread coupon. Leave the price null rather than treating
      -- the list price, or a zero loyalty row, as money collected.
      WHEN c.sub_unit_amount_cents IS NOT NULL AND NOT c.sub_discount_known THEN 'unknown_discount'
      -- Period rows already store list price and the coupon separately.
      -- Do not subtract loyalty on top of that coupon.
      WHEN c.period_unit_amount_cents IS NOT NULL THEN 'period'
      ELSE 'none'
    END AS price_mode
  FROM org_core c
)
SELECT
  p.organization_id,
  p.organization_name,
  p.owner_email,
  p.signup_at,
  CASE
    WHEN p.is_lifetime THEN 'not_applicable'
    WHEN p.stripe_subscription_status = 'trialing' THEN 'stripe_trialing'
    WHEN p.stripe_subscription_status IN ('active', 'past_due') THEN 'not_on_trial'
    WHEN p.profile_trial_ends_at IS NOT NULL
      AND p.profile_trial_ends_at > now()
      AND lower(coalesce(p.org_plan_type, 'trial')) IN ('trial', 'free', '')
      THEN 'card_free_trial'
    WHEN p.profile_trial_ends_at IS NOT NULL
      AND p.profile_trial_ends_at <= now()
      AND (p.stripe_subscription_status IS NULL OR p.stripe_subscription_status IN ('canceled', 'cancelled', 'incomplete', 'incomplete_expired', 'unpaid', 'paused'))
      AND lower(coalesce(p.org_plan_type, '')) IN ('trial', 'free', '')
      THEN 'trial_ended'
    ELSE 'none'
  END AS trial_status,
  CASE
    WHEN p.stripe_subscription_status = 'trialing' AND p.sub_trial_end IS NOT NULL THEN p.sub_trial_end
    ELSE p.profile_trial_ends_at
  END AS trial_ends_at,
  CASE
    WHEN p.stripe_subscription_status = 'trialing' AND p.sub_trial_end IS NOT NULL THEN 'stripe_subscription'
    WHEN p.profile_trial_ends_at IS NOT NULL THEN 'profile'
    ELSE NULL
  END AS trial_end_source,
  p.latest_milestone,
  p.latest_milestone_at,
  p.activation_milestones,
  p.last_login_at,
  p.how_heard,
  p.utm_source,
  p.utm_medium,
  p.utm_campaign,
  p.referrer,
  p.stripe_subscription_status,
  p.stripe_subscription_status AS subscription_status,
  p.stripe_subscription_id,
  CASE
    WHEN p.is_lifetime THEN 'Lifetime'
    WHEN lower(coalesce(nullif(p.sub_plan, ''), nullif(p.org_plan_type, ''), '')) = 'basic' THEN 'Basic'
    WHEN lower(coalesce(nullif(p.sub_plan, ''), nullif(p.org_plan_type, ''), '')) = 'pro' THEN 'Pro'
    WHEN lower(coalesce(nullif(p.sub_plan, ''), nullif(p.org_plan_type, ''), '')) = 'custom' THEN 'Custom'
    ELSE NULL
  END AS plan,
  p.is_lifetime,
  COALESCE(p.sub_billing_interval, p.period_billing_interval) AS billing_interval,
  CASE
    WHEN p.is_lifetime THEN NULL
    ELSE price.monthly_amount_cents
  END AS monthly_amount_cents,
  CASE
    WHEN p.is_lifetime THEN 'lifetime_excluded'
    WHEN p.price_mode = 'unknown_discount' THEN 'discount_unknown'
    WHEN p.price_mode = 'none' THEN NULL
    ELSE price.amount_basis
  END AS monthly_amount_basis,
  CASE p.price_mode
    WHEN 'stripe' THEN 'stripe_subscription'
    WHEN 'loyalty' THEN 'stripe_subscription_loyalty_discount'
    WHEN 'period' THEN 'billing_subscription_period'
    ELSE NULL
  END AS monthly_amount_source,
  CASE
    WHEN p.is_lifetime THEN NULL
    WHEN p.stripe_subscription_status IN ('active', 'past_due') THEN price.monthly_amount_cents
    ELSE NULL
  END AS mrr_cents,
  (
    p.is_lifetime IS NOT TRUE
    AND p.stripe_subscription_status IN ('active', 'past_due')
    AND price.monthly_amount_cents IS NOT NULL
  ) AS counts_toward_mrr,
  p.loyalty_discount_cents,
  CASE
    WHEN p.sub_canceled_at IS NOT NULL THEN p.sub_canceled_at
    WHEN p.period_canceled_at IS NOT NULL THEN p.period_canceled_at
    ELSE p.feedback_canceled_at
  END AS canceled_at,
  CASE
    WHEN p.sub_canceled_at IS NOT NULL THEN 'stripe_subscription'
    WHEN p.period_canceled_at IS NOT NULL THEN 'billing_subscription_period'
    WHEN p.feedback_canceled_at IS NOT NULL THEN 'cancellation_feedback'
    ELSE NULL
  END AS cancellation_source,
  p.cancel_at_period_end,
  CASE
    WHEN p.cancel_at_period_end AND p.current_period_end IS NOT NULL THEN p.current_period_end
    ELSE NULL
  END AS cancel_scheduled_for,
  p.refund_dates,
  p.is_demo_or_test
FROM priced p
JOIN LATERAL public.platform_monthly_billed_cents(
  CASE p.price_mode
    WHEN 'stripe' THEN p.sub_unit_amount_cents
    WHEN 'loyalty' THEN p.sub_unit_amount_cents
    WHEN 'period' THEN p.period_unit_amount_cents
    ELSE NULL
  END,
  CASE p.price_mode
    WHEN 'stripe' THEN p.sub_quantity
    WHEN 'loyalty' THEN p.sub_quantity
    WHEN 'period' THEN p.period_quantity
    ELSE NULL
  END,
  CASE p.price_mode
    WHEN 'stripe' THEN p.sub_billing_interval
    WHEN 'loyalty' THEN p.sub_billing_interval
    WHEN 'period' THEN p.period_billing_interval
    ELSE NULL
  END,
  CASE p.price_mode
    WHEN 'stripe' THEN p.sub_interval_count
    WHEN 'loyalty' THEN p.sub_interval_count
    WHEN 'period' THEN p.period_interval_count
    ELSE NULL
  END,
  CASE p.price_mode
    WHEN 'stripe' THEN p.sub_discount_percent
    WHEN 'period' THEN p.period_discount_percent
    ELSE NULL
  END,
  CASE p.price_mode
    WHEN 'stripe' THEN COALESCE(p.sub_discount_amount_cents, 0)
    WHEN 'loyalty' THEN p.loyalty_discount_cents
    WHEN 'period' THEN COALESCE(p.period_discount_amount_cents, 0)
    ELSE NULL
  END
) price ON true;

COMMENT ON VIEW public.platform_account_metrics_v IS
  'One row per organization for platform admins. Do not grant this view. Read it through public.platform_account_metrics(). monthly_amount_cents and mrr_cents are the collected amount after one loyalty or Stripe coupon, never both. An annual plan is that invoice divided by 12 in both columns. mrr_cents is null for lifetime, trials, canceled subscriptions, and rows whose price is not stored. subscription_status is the raw Stripe status. Activation milestone timestamps are not copied into mrr_cents. Demo and test orgs stay in the result with is_demo_or_test true.';

REVOKE ALL ON public.platform_account_metrics_v FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Admin-gated reader. Authenticated may execute it; the body checks the caller.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.platform_account_metrics(
  p_limit integer DEFAULT 1000,
  p_offset integer DEFAULT 0
) RETURNS SETOF public.platform_account_metrics_v
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  IF COALESCE(public.is_platform_admin(), false) IS NOT TRUE THEN
    RAISE EXCEPTION 'platform admin only'
      USING ERRCODE = '42501';
  END IF;

  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 1000 THEN
    RAISE EXCEPTION 'p_limit must be between 1 and 1000'
      USING ERRCODE = '22023';
  END IF;

  IF p_offset IS NULL OR p_offset < 0 THEN
    RAISE EXCEPTION 'p_offset must be >= 0'
      USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  SELECT *
  FROM public.platform_account_metrics_v v
  ORDER BY v.signup_at DESC, v.organization_id
  LIMIT p_limit
  OFFSET p_offset;
END;
$fn$;

REVOKE ALL ON FUNCTION public.platform_account_metrics(integer, integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.platform_account_metrics(integer, integer) TO authenticated;

COMMENT ON FUNCTION public.platform_account_metrics(integer, integer) IS
  'Platform-admin account metrics. Raises 42501 for every other caller. Pages are at most 1000 rows, ordered by signup_at desc, organization_id. Does not call Stripe.';

-- Re-revoke in case a default privilege re-granted the view.
REVOKE ALL ON public.platform_account_metrics_v FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.platform_subscription_refunds FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.platform_subscription_refunds TO service_role;
